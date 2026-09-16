import { cursorCommands } from "./commands.js";
import type { HarnessCommandCatalog } from "@codexhost/shared-contracts";
import type {
  NewSessionResponse,
  LoadSessionResponse,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { parseCursorAvailableModels } from "./available-models.js";
import {
  CursorConnectionPool,
  CursorRequestTimeoutError,
  type CursorConnection,
  type CursorSessionHandlers,
} from "./connection.js";

export interface CursorTransportOptions {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  command?: string;
  force?: boolean;
  timeoutMs?: number;
  /**
   * Shared CLI connections. Sessions that share a working directory and
   * execution mode reuse one process, so only the first one pays for spawning
   * and authenticating. Without a pool each transport gets a private one,
   * which is the previous one-process-per-Session behavior.
   */
  pool?: CursorConnectionPool;
}
export type CursorAvailableModel = {
  value: string;
  name: string;
  configOptions: NonNullable<NewSessionResponse["configOptions"]>;
};
export type CursorSessionInfo = (NewSessionResponse | LoadSessionResponse) & {
  availableModels?: CursorAvailableModel[];
};
export interface CursorCallbacks {
  update(value: SessionNotification): void;
  permission(value: RequestPermissionRequest): Promise<RequestPermissionResponse>;
  extension(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  notification?(method: string, params: Record<string, unknown>): void;
}

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

export class CursorTransport {
  commandCatalog: HarnessCommandCatalog = { commands: [] };
  sessionId = "";
  replay: SessionNotification[] = [];
  #connection: CursorConnection | undefined;
  #ownPool: CursorConnectionPool | undefined;
  #callbacks: CursorCallbacks | undefined;
  #closed = false;
  #rejectClosed!: (error: Error) => void;
  readonly #closedSignal = new Promise<never>((_, reject) => {
    this.#rejectClosed = reject;
  });
  readonly #handlers: CursorSessionHandlers;

  constructor(readonly options: CursorTransportOptions) {
    void this.#closedSignal.catch(() => undefined);
    this.#handlers = {
      update: (value) => {
        if (this.sessionId && value.sessionId !== this.sessionId) return;
        const catalog = cursorCommands(value);
        if (catalog) this.commandCatalog = catalog;
        if (this.#callbacks) this.#callbacks.update(value);
        else if (this.replay.length < 100_000) this.replay.push(value);
        else throw new Error("Cursor replay exceeds the supported history limit");
      },
      permission: (value) =>
        this.#callbacks && value.sessionId === this.sessionId
          ? this.#callbacks.permission(value)
          : Promise.resolve(CANCELLED),
      extension: (method, params) =>
        this.#callbacks
          ? this.#callbacks.extension(method, params)
          : Promise.resolve({ outcome: { outcome: "cancelled" } }),
      notification: (method, params) => {
        this.#callbacks?.notification?.(method, params);
      },
    };
  }

  #require(): CursorConnection {
    if (!this.#connection) throw new Error("Cursor session is not open");
    return this.#connection;
  }

  async #bounded<T>(work: Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("Cursor session closed");
    try {
      return await this.#require().bounded(work);
    } catch (error) {
      // A late answer to a timed-out request could still land on a later turn,
      // so this Session stops here. The shared process keeps serving the others.
      if (error instanceof CursorRequestTimeoutError) await this.close();
      throw error;
    }
  }

  async open(sessionId?: string): Promise<CursorSessionInfo> {
    if (this.#closed || this.#connection) throw new Error("Cursor transport cannot be reopened");
    const pool = this.options.pool ?? (this.#ownPool = new CursorConnectionPool());
    let connection: CursorConnection;
    try {
      connection = await pool.acquire(
        { cwd: this.options.cwd, force: this.options.force === true },
        this.options.environment,
        this.options.command,
        this.options.timeoutMs ?? 30_000,
      );
    } catch (error) {
      // A transport that never reached a connection is spent, not reusable.
      await this.close();
      throw error;
    }
    this.#connection = connection;
    try {
      if (sessionId && !connection.loadSessionSupported)
        throw new Error("Cursor does not support the required ACP session protocol");
      this.sessionId = sessionId ?? "";
      // Attach before loading so replayed history is never dropped.
      if (sessionId) connection.attach(sessionId, this.#handlers);
      const info = sessionId
        ? await connection.bounded(
            connection.rpc.loadSession({ sessionId, cwd: this.options.cwd, mcpServers: [] }),
          )
        : await connection.create(this.#handlers, () =>
            connection.bounded(
              connection.rpc.newSession({ cwd: this.options.cwd, mcpServers: [] }),
            ),
          );
      if ("sessionId" in info && typeof info.sessionId === "string") this.sessionId = info.sessionId;
      if (!this.sessionId) throw new Error("Cursor returned no native session ID");
      connection.attach(this.sessionId, this.#handlers);
      return info;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async availableModels(): Promise<CursorAvailableModel[]> {
    return parseCursorAvailableModels(
      await this.#bounded(this.#require().rpc.extMethod("cursor/list_available_models", {})),
    );
  }

  async configure(configId: string, value: string) {
    return this.#bounded(
      this.#require().rpc.setSessionConfigOption({
        sessionId: this.sessionId,
        configId,
        value,
      }),
    );
  }

  async prompt(text: string, callbacks: CursorCallbacks) {
    if (!this.#connection || this.#closed || this.#callbacks)
      throw new Error("Cursor session is closed or busy");
    const connection = this.#connection;
    this.#callbacks = callbacks;
    try {
      // Native turns have no arbitrary wall-clock deadline; cancellation, closing
      // this Session, or the shared process exiting settle them.
      return await Promise.race([
        connection.rpc.prompt({
          sessionId: this.sessionId,
          prompt: [{ type: "text", text }],
        }),
        connection.failed,
        this.#closedSignal,
      ]);
    } finally {
      this.#callbacks = undefined;
    }
  }

  async cancel() {
    if (this.#connection && !this.#closed)
      await this.#bounded(this.#require().rpc.cancel({ sessionId: this.sessionId }));
  }

  /**
   * Releases this Session. The CLI process belongs to the pool and survives for
   * the next Session in the same working directory until it goes idle.
   */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectClosed(new Error("Cursor session closed"));
    this.#callbacks = undefined;
    this.#connection?.detach(this.sessionId, this.#handlers);
    this.#connection = undefined;
    const own = this.#ownPool;
    this.#ownPool = undefined;
    if (own) await own.close();
  }
}
