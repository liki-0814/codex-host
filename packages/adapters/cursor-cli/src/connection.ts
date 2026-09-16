import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

import { cursorInvocation } from "./command.js";

/**
 * Reaching Cursor costs several seconds before any Session work happens:
 * spawning the CLI, the ACP handshake and authentication. None of that is
 * specific to a Session, and ACP carries `sessionId` on every request and
 * notification, so one connection can serve many Sessions and pay it once.
 *
 * Connections are keyed, not global, for two measured reasons:
 *  - `--force` is a process argument rather than a Session option.
 *  - Cursor resolves project instructions (AGENTS.md and project rules) from
 *    the CLI process working directory, even though tool execution correctly
 *    follows the per-Session cwd. Sharing one process across working
 *    directories would silently give every Session the wrong project
 *    instructions, so the process cwd must keep matching the Session cwd.
 */
export interface CursorConnectionKey {
  readonly cwd: string;
  readonly force: boolean;
}

export interface CursorSessionHandlers {
  update(value: SessionNotification): void;
  permission(value: RequestPermissionRequest): Promise<RequestPermissionResponse>;
  extension(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  notification(method: string, params: Record<string, unknown>): void;
}

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

/**
 * A request the agent never answered in time. The caller must stop trusting
 * its Session, because a late response could still arrive and be applied to a
 * later turn.
 */
export class CursorRequestTimeoutError extends Error {
  constructor() {
    super("Cursor ACP request timed out");
    this.name = "CursorRequestTimeoutError";
  }
}

export class CursorConnection {
  #child: ChildProcessWithoutNullStreams | undefined;
  #connection: ClientSideConnection | undefined;
  #closed = false;
  #fault: Error | undefined;
  #rejectFault!: (error: Error) => void;
  readonly #failed = new Promise<never>((_, reject) => {
    this.#rejectFault = reject;
  });
  readonly #handlers = new Map<string, CursorSessionHandlers>();
  /** Notifications for a Session created here whose id the agent has not returned yet. */
  #claiming: CursorSessionHandlers | undefined;
  #started: Promise<void> | undefined;
  #loadSessionSupported = false;

  constructor(
    readonly key: CursorConnectionKey,
    readonly environment: NodeJS.ProcessEnv,
    readonly command: string | undefined,
    readonly timeoutMs: number,
    /** Called when the last Session detaches, so the pool can retire this entry. */
    private readonly onIdle: (connection: CursorConnection) => void,
  ) {
    void this.#failed.catch(() => undefined);
  }

  get closed(): boolean {
    return this.#closed;
  }

  get attachedCount(): number {
    return this.#handlers.size;
  }

  get loadSessionSupported(): boolean {
    return this.#loadSessionSupported;
  }

  /**
   * A timed-out request fails on its own. Unlike a per-Session process, a
   * shared connection must not be torn down because one Session was slow;
   * only a process fault takes every Session down with it.
   */
  async bounded<T>(work: Promise<T>, timeout = this.timeoutMs): Promise<T> {
    if (this.#fault) throw this.#fault;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        this.#failed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CursorRequestTimeoutError()), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Idempotent: concurrent Session opens share a single startup. */
  async start(): Promise<void> {
    if (this.#closed) throw new Error("Cursor connection is closed");
    this.#started ??= this.#start();
    try {
      await this.#started;
    } catch (error) {
      // A failed startup must never be reused as a live connection.
      await this.close();
      throw error;
    }
  }

  async #start(): Promise<void> {
    const invocation = cursorInvocation(this.environment, this.command, this.key.force);
    const child = spawn(invocation.command, invocation.arguments, {
      cwd: this.key.cwd,
      env: this.environment,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: "pipe",
      ...(process.platform === "win32" ? {} : { detached: true }),
    });
    this.#child = child;
    const fault = (message: string) => {
      if (this.#fault) return;
      this.#fault = new Error(message);
      this.#rejectFault(this.#fault);
    };
    child.on("error", () => fault("Cursor ACP process could not start"));
    child.on("exit", (code) => fault(`Cursor ACP process exited (${code ?? "signal"})`));
    child.stderr.resume(); // Native diagnostics may contain secrets; never copy them to Host events.
    this.#connection = new ClientSideConnection(
      () => ({
        sessionUpdate: (value) => {
          (this.#handlers.get(value.sessionId) ?? this.#claiming)?.update(value);
        },
        requestPermission: (value) => {
          const handlers = this.#handlers.get(value.sessionId);
          return handlers ? handlers.permission(value) : Promise.resolve(CANCELLED);
        },
        extMethod: (method, params) => {
          const handlers = this.#routed(params);
          return handlers
            ? handlers.extension(method, params)
            : Promise.resolve({ outcome: { outcome: "cancelled" } });
        },
        extNotification: async (method, params) => {
          this.#routed(params)?.notification(method, params);
        },
      }),
      ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    const init = await this.bounded(
      this.#connection.initialize({
        protocolVersion: 1,
        clientCapabilities: { _meta: { parameterizedModelPicker: true } },
        clientInfo: { name: "codexhost", version: "0.6.2" },
      }),
    );
    if (init.protocolVersion !== 1) throw new Error("Cursor does not support the required ACP protocol");
    this.#loadSessionSupported = init.agentCapabilities?.loadSession === true;
    // This reuses an existing native login. The adapter never launches login or reads credentials.
    await this.bounded(this.#connection.authenticate({ methodId: "cursor_login" }));
  }

  #routed(params: Record<string, unknown>): CursorSessionHandlers | undefined {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
    return sessionId ? this.#handlers.get(sessionId) : (this.#claiming ?? undefined);
  }

  get rpc(): ClientSideConnection {
    if (!this.#connection) throw new Error("Cursor connection is not started");
    return this.#connection;
  }

  /** Settles only when the process itself faults, taking every Session with it. */
  get failed(): Promise<never> {
    return this.#failed;
  }

  #creating: Promise<unknown> = Promise.resolve();

  /**
   * Creating a Session is serialized per connection: the agent only reveals the
   * new id in the response, so until then its notifications can be routed by
   * nothing but "the Session currently being created".
   */
  async create<T>(handlers: CursorSessionHandlers, run: () => Promise<T>): Promise<T> {
    const previous = this.#creating;
    let release!: () => void;
    this.#creating = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    if (this.#closed) throw this.#fault ?? new Error("Cursor connection is closed");
    this.#claiming = handlers;
    try {
      return await run();
    } finally {
      if (this.#claiming === handlers) this.#claiming = undefined;
      release();
    }
  }

  attach(sessionId: string, handlers: CursorSessionHandlers): void {
    if (this.#claiming === handlers) this.#claiming = undefined;
    this.#handlers.set(sessionId, handlers);
  }

  detach(sessionId: string, handlers: CursorSessionHandlers): void {
    if (this.#claiming === handlers) this.#claiming = undefined;
    if (this.#handlers.get(sessionId) !== handlers) return;
    this.#handlers.delete(sessionId);
    if (this.#handlers.size === 0) this.onIdle(this);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#handlers.clear();
    this.#claiming = undefined;
    this.#fault ??= new Error("Cursor session closed");
    this.#rejectFault(this.#fault);
    const child = this.#child;
    if (!child) return;
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else if (child.pid) {
        // Terminate only this owned CLI tree, including a native tool still running.
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            killer.kill();
            resolve();
          }, 2_000);
          const finish = () => {
            clearTimeout(timer);
            resolve();
          };
          killer.once("error", finish);
          killer.once("exit", finish);
        });
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
  }
}

/** Retire an idle CLI instead of keeping one alive per browsed Thread. */
export const CURSOR_CONNECTION_IDLE_MS = 60_000;

export class CursorConnectionPool {
  readonly #entries = new Map<string, CursorConnection>();
  readonly #idleTimers = new Map<CursorConnection, ReturnType<typeof setTimeout>>();

  constructor(private readonly idleMs: number = CURSOR_CONNECTION_IDLE_MS) {}

  #key(key: CursorConnectionKey): string {
    return `${key.force ? "force" : "normal"}\u0000${key.cwd}`;
  }

  async acquire(
    key: CursorConnectionKey,
    environment: NodeJS.ProcessEnv,
    command: string | undefined,
    timeoutMs: number,
  ): Promise<CursorConnection> {
    const id = this.#key(key);
    const existing = this.#entries.get(id);
    const entry =
      existing && !existing.closed
        ? existing
        : new CursorConnection(key, environment, command, timeoutMs, (connection) =>
            this.#scheduleRetire(id, connection),
          );
    this.#entries.set(id, entry);
    this.#cancelRetire(entry);
    try {
      await entry.start();
    } catch (error) {
      if (this.#entries.get(id) === entry) this.#entries.delete(id);
      throw error;
    }
    return entry;
  }

  #cancelRetire(connection: CursorConnection): void {
    const timer = this.#idleTimers.get(connection);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#idleTimers.delete(connection);
  }

  #scheduleRetire(id: string, connection: CursorConnection): void {
    if (this.#idleTimers.has(connection)) return;
    const timer = setTimeout(() => {
      this.#idleTimers.delete(connection);
      if (connection.attachedCount > 0) return;
      if (this.#entries.get(id) === connection) this.#entries.delete(id);
      void connection.close();
    }, this.idleMs);
    timer.unref?.();
    this.#idleTimers.set(connection, timer);
  }

  async close(): Promise<void> {
    for (const timer of this.#idleTimers.values()) clearTimeout(timer);
    this.#idleTimers.clear();
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.all(entries.map((entry) => entry.close()));
  }
}
