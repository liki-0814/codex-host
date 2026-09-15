import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveHarnessExecutable } from "@codexhost/harness-discovery";
import type { HarnessError } from "@codexhost/harness-adapter";
import { z } from "zod";
import WebSocket from "ws";

export class KimiError extends Error {
  constructor(
    readonly code: HarnessError["code"],
    message: string,
  ) {
    super(message);
  }
}
export function kimiError(error: unknown): HarnessError {
  return {
    code: error instanceof KimiError ? error.code : "nativeFailure",
    message: error instanceof Error ? error.message : "Kimi operation failed",
    retryable: false,
  };
}
export interface KimiServerOptions {
  environment?: NodeJS.ProcessEnv;
  command?: string;
  cwd?: string;
}
const envelope = z.object({ code: z.number(), msg: z.string(), data: z.unknown() });

/** One execution process per Host Session: tool environments must never cross Threads. */
export class KimiServer {
  #child?: ChildProcess;
  #port = 0;
  #closed = false;
  #start?: Promise<void>;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #tokenPath: string;
  constructor(readonly options: KimiServerOptions) {
    this.#environment = options.environment ?? process.env;
    this.#tokenPath = join(
      this.#environment.KIMI_CODE_HOME ?? join(this.#environment.HOME ?? homedir(), ".kimi-code"),
      "server.token",
    );
  }
  start(): Promise<void> {
    return (this.#start ??= this.#launch());
  }
  async #launch(): Promise<void> {
    if (this.#closed) throw new KimiError("invalidState", "Kimi server is closed");
    const resolution = resolveHarnessExecutable(
      {
        id: "kimi-code",
        command: "kimi",
        commandEnvironmentVariable: "CODEXHOST_KIMI_CODE_COMMAND",
        installRoots: { posix: ["~/.kimi-code/bin"], windows: ["~/.kimi-code/bin"] },
      },
      {
        environment: this.#environment,
        ...(this.options.command ? { command: this.options.command } : {}),
      },
    );
    if (!resolution) throw new KimiError("notInstalled", "Kimi Code executable not found");
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new KimiError("internalError", "Cannot allocate Kimi port");
    this.#port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    this.#child = spawn(
      resolution.executable,
      ["web", "--no-open", "--host", "127.0.0.1", "--port", String(this.#port)],
      {
        cwd: this.options.cwd ?? this.#environment.HOME ?? homedir(),
        env: this.#environment,
        // The native startup banner contains its bearer token. Never forward it to diagnostics.
        stdio: "ignore",
        windowsHide: true,
      },
    );
    let spawnError: Error | undefined;
    this.#child.on("error", (error) => {
      spawnError = error;
    });
    const deadline = Date.now() + 15_000;
    try {
      while (Date.now() < deadline) {
        if (this.#closed || spawnError || this.#child.exitCode !== null)
          throw new KimiError("processExited", "Kimi server exited during startup");
        try {
          const meta = await this.request(
            "/meta",
            z.object({ server_version: z.string() }),
            undefined,
            500,
          );
          if (!/^0\.42\./u.test(meta.server_version))
            throw new KimiError(
              "unsupported",
              `Kimi Server ${meta.server_version} is not a validated protocol version`,
            );
          return;
        } catch (error) {
          if (error instanceof KimiError && error.code === "unsupported") throw error;
        }
        await delay(100);
      }
      throw new KimiError("unavailable", "Kimi server startup timed out");
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async subscribe(
    sessionId: string,
    changed: (event?: { type: string; payload?: Record<string, unknown> | undefined }) => void,
  ): Promise<WebSocket> {
    const token = (await readFile(this.#tokenPath, "utf8")).trim();
    const socket = new WebSocket(`ws://127.0.0.1:${this.#port}/api/v1/ws`, {
      headers: { Authorization: `Bearer ${token}` },
      handshakeTimeout: 5_000,
    });
    socket.on("error", () => changed());
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.on("message", (raw) => {
      try {
        changed(
          z
            .object({ type: z.string(), payload: z.record(z.string(), z.unknown()).optional() })
            .parse(JSON.parse(raw.toString())),
        );
      } catch {
        changed();
      }
    });
    socket.on("close", () => changed());
    socket.send(
      JSON.stringify({ type: "subscribe", id: "host", payload: { session_ids: [sessionId] } }),
    );
    return socket;
  }
  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    timeout = 15_000,
  ): Promise<T> {
    if (this.#closed) throw new KimiError("invalidState", "Kimi server is closed");
    const token = (await readFile(this.#tokenPath, "utf8")).trim();
    const response = await fetch(`http://127.0.0.1:${this.#port}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok)
      throw new KimiError(
        response.status === 401
          ? "authenticationRequired"
          : response.status === 404
            ? "sessionNotFound"
            : response.status === 409
              ? "sessionBusy"
              : "nativeFailure",
        `Kimi request failed (${response.status})`,
      );
    const result = envelope.parse(await response.json());
    if (result.code !== 0 && !(path.endsWith(":dismiss") && result.code === 40909))
      throw new KimiError("nativeFailure", `Kimi: ${result.msg}`);
    return schema.parse(result.data);
  }
  async close(): Promise<void> {
    this.#closed = true;
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await Promise.race([exited, delay(2_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}
