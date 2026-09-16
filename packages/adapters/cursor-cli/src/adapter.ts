import { nativeSessionImport } from "@codexhost/harness-adapter";
import { cursorImportCandidates } from "./session-import.js";
import type { HarnessCommandCapability } from "@codexhost/harness-adapter";
import { fetchCursorAccount } from "./account-usage.js";
import { decodeCursorPermission } from "./permission-modes.js";
import path from "node:path";
import {
  HarnessOutputChannel,
  sanitizeDiagnosticTail,
  type HarnessAdapter,
  type HarnessError,
  type HarnessInspection,
  type HarnessOutput,
  type HarnessResult,
  type HarnessSession,
  type HarnessSessionCapabilities,
  type HarnessSessionState,
  type HostCommand,
  type HostThreadSnapshot,
  type InspectHarnessInput,
  type OpenSessionInput,
  type TurnOutcome,
  type TurnStartCommand,
  type TurnStartAccepted,
  type TurnCancelCommand,
  type TurnCancelAccepted,
  type InteractionRespondCommand,
  type InteractionRespondAccepted,
  type ModelSelectCommand,
  type ModelSelectCompleted,
  type ThinkingSelectCommand,
  type ThinkingSelectCompleted,
  type PermissionModeSelectCommand,
  type PermissionModeSelectCompleted,
} from "@codexhost/harness-adapter";
import {
  harnessIdSchema,
  nativeTurnRefSchema,
  type HarnessModelRef,
} from "@codexhost/shared-contracts";
import {
  CURSOR_MODES,
  configString,
  cursorCapabilities,
  cursorCatalog,
  cursorSessionState,
  configureCursorModel,
  withConfigOptions,
} from "./models.js";
import {
  CursorTransport,
  type CursorSessionInfo,
  type CursorTransportOptions,
} from "./transport.js";
import { CursorConnectionPool } from "./connection.js";
import { readCursorNativeTurns, type CursorNativeTurn } from "./native-history.js";
import { CursorTurnOutput, cursorSnapshot } from "./projection.js";
import { CursorInteractions } from "./interactions.js";
import { type CursorSubagents, cursorTaskAddress } from "./subagents.js";
import type { HarnessSubagentCapability } from "@codexhost/harness-adapter";

export interface CursorAdapterOptions {
  environment?: NodeJS.ProcessEnv;
  command?: string;
  timeoutMs?: number;
}
export function cursorError(error: unknown): HarnessError {
  const message = sanitizeDiagnosticTail(
    error instanceof Error ? error.message : "Cursor operation failed",
  );
  const code = /not installed/iu.test(message)
    ? "notInstalled"
    : /auth|not logged in|login/iu.test(message)
      ? "authenticationRequired"
      : /exited|closed/iu.test(message)
        ? "processExited"
        : "protocolError";
  return { code, message, retryable: false };
}
function rejected(code: HarnessError["code"], message: string): { ok: false; error: HarnessError } {
  return { ok: false, error: { code, message, retryable: false } };
}
export class CursorAdapter implements HarnessAdapter {
  readonly sessionImport = nativeSessionImport(
    harnessIdSchema.parse("cursor-cli"),
    (signal) => cursorImportCandidates(this.options.environment ?? process.env, signal),
    () => this.#closed,
  );

  readonly subagents: HarnessSubagentCapability = {
    readSnapshot: async ({ parent, nativeSubagentId, cwd }) => {
      if (parent.harnessId !== this.harnessId || this.#closed)
        return rejected("invalidRequest", "Invalid Cursor parent");
      let replay: CursorTransport | undefined;
      try {
        cursorTaskAddress(nativeSubagentId);
        const session = [...this.#sessions].find(
          (s) => s.transport.sessionId === parent.nativeSessionId,
        );
        if (session && path.resolve(session.transport.options.cwd) !== path.resolve(cwd))
          return rejected("invalidRequest", "Cursor parent workspace does not match");
        const active = session?.subagentSnapshot(nativeSubagentId);
        if (active) return { ok: true, value: active };
        const options = session?.transport.options ?? this.transportOptions(cwd);
        const before = readCursorNativeTurns(parent.nativeSessionId, cwd, options.environment);
        replay = new CursorTransport(options);
        await replay.open(parent.nativeSessionId);
        const after = readCursorNativeTurns(parent.nativeSessionId, cwd, options.environment);
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new Error("Cursor native history changed during child read");
        return {
          ok: true,
          value: cursorSnapshot(parent.nativeSessionId, after, replay.replay, nativeSubagentId),
        };
      } catch (error) {
        return { ok: false, error: cursorError(error) };
      } finally {
        await replay?.close();
      }
    },
  };
  readonly harnessId = harnessIdSchema.parse("cursor-cli");
  readonly #sessions = new Set<CursorSession>();
  /** Shared across every Session this adapter opens, so browsing Threads in one
   *  working directory does not spawn and authenticate a CLI per Thread. */
  readonly #pool = new CursorConnectionPool();
  readonly #inspections = new Map<
    string,
    { expires: number; pending: boolean; result: Promise<HarnessInspection> }
  >();
  #closed = false;
  #availableModels: CursorSessionInfo["availableModels"];
  constructor(readonly options: CursorAdapterOptions = {}) {}
  transportOptions(cwd: string, environment?: NodeJS.ProcessEnv): CursorTransportOptions {
    return {
      cwd: path.resolve(cwd),
      environment: { ...(this.options.environment ?? process.env), ...environment },
      pool: this.#pool,
      ...(this.options.command ? { command: this.options.command } : {}),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
    };
  }
  async inspectAccount() {
    if (this.#closed) return null;
    return fetchCursorAccount({ environment: this.options.environment ?? process.env });
  }
  async inspect(input: InspectHarnessInput = {}): Promise<HarnessInspection> {
    if (this.#closed)
      return {
        status: "unavailable",
        error: { code: "unavailable", message: "Cursor adapter is closed", retryable: false },
      };
    const cwd = path.resolve(input.cwd ?? process.cwd());
    const cacheKey = cwd;
    const cached = this.#inspections.get(cacheKey);
    if (cached && (cached.pending || (!input.refresh && cached.expires > Date.now())))
      return cached.result;
    const result = (async (): Promise<HarnessInspection> => {
      const transport = new CursorTransport(this.transportOptions(cwd));
      try {
        const info = await transport.open();
        this.#availableModels = await transport.availableModels();
        info.availableModels = this.#availableModels;
        const catalog = cursorCatalog(info);
        return {
          status: "ready",
          catalog,
          capabilities: cursorCapabilities(),
          permissionModes: CURSOR_MODES,
        };
      } catch (error) {
        const failure = cursorError(error);
        return {
          status: failure.code === "notInstalled" ? "notInstalled" : "unavailable",
          error: failure,
        };
      } finally {
        await transport.close();
      }
    })();
    // Cache negative results as well; discovery never starts a polling/retry timer.
    const entry = { expires: Number.POSITIVE_INFINITY, pending: true, result };
    this.#inspections.set(cacheKey, entry);
    void result.finally(() => {
      entry.pending = false;
      entry.expires = Date.now() + 5 * 60_000;
    });
    return result;
  }
  async open(input: OpenSessionInput): Promise<HarnessResult<HarnessSession>> {
    if (this.#closed) return rejected("invalidState", "Cursor adapter is closed");
    if (input.kind !== "create" && input.kind !== "resume")
      return rejected("unsupported", "Cursor fork and rollback are not supported");
    if (input.kind === "resume" && input.nativeRef.harnessId !== this.harnessId)
      return rejected("invalidRequest", "Session belongs to another Harness");
    const options = this.transportOptions(input.cwd, input.environment);
    try {
      if (input.permissionModeId)
        options.force = decodeCursorPermission(input.permissionModeId).force;
    } catch {
      return rejected("invalidRequest", "Unknown Cursor execution/approval mode");
    }
    const unattended =
      input.kind === "create" && input.executionPolicy === "unattended-full-access";
    if (unattended) options.force = true;
    const transport = new CursorTransport(options);
    try {
      if (input.kind === "resume")
        readCursorNativeTurns(input.nativeRef.nativeSessionId, options.cwd, options.environment);
      const info = await transport.open(
        input.kind === "resume" ? input.nativeRef.nativeSessionId : undefined,
      );
      if (this.#availableModels) info.availableModels = this.#availableModels;
      const session = new CursorSession(
        transport,
        info,
        () => {
          this.#sessions.delete(session);
        },
        input.kind === "create",
        input.model,
        unattended ? "agent-auto" : input.permissionModeId,
      );
      if (input.kind === "resume") {
        const native = readCursorNativeTurns(transport.sessionId, options.cwd, options.environment);
        // Opening already replayed the whole history. Keep that projection so
        // the first read does not load the Session a second time.
        session.adoptRestoredSnapshot(
          cursorSnapshot(transport.sessionId, native, transport.replay),
        );
        if (
          input.knownTurnRefs?.some(
            (ref) =>
              ref.harnessId !== this.harnessId ||
              ref.nativeSessionId !== transport.sessionId ||
              !native.some((turn) => turn.id === ref.nativeTurnKey),
          )
        )
          throw new Error("Saved Cursor turn identity no longer exists in native history");
      }
      if (input.thinkingOptionId) {
        const selected = await session.execute({
          type: "thinking.select",
          thinkingOptionId: input.thinkingOptionId,
        });
        if (!selected.ok) throw new Error(selected.error.message);
      }
      if (this.#closed) {
        await session.close();
        return rejected("invalidState", "Cursor adapter closed during session startup");
      }
      this.#sessions.add(session);
      return { ok: true, value: session };
    } catch (error) {
      await transport.close();
      return { ok: false, error: cursorError(error) };
    }
  }
  async close() {
    this.#closed = true;
    await this.sessionImport.close();
    await Promise.allSettled([...this.#sessions].map((session) => session.close()));
    await Promise.allSettled(
      [...this.#inspections.values()].map((inspection) => inspection.result),
    );
    // Sessions only detach from their connection; the pool owns the CLI processes.
    await this.#pool.close();
  }
}

export class CursorSession implements HarnessSession {
  readonly harnessId = harnessIdSchema.parse("cursor-cli");
  capabilities: HarnessSessionCapabilities;
  readonly initialUsage = null;
  readonly initialState: HarnessSessionState;
  #info: CursorSessionInfo;
  readonly #channel = new HarnessOutputChannel<HarnessOutput>();
  readonly outputs = this.#channel.outputs;
  readonly #interactions = new CursorInteractions((output) => this.#channel.emit(output));
  readonly #submitted = new Set<string>();
  #active: { command: TurnStartCommand; cancelled: boolean; task: Promise<void> } | undefined;
  readonly #commandTurns = new Set<string>();
  readonly commands: HarnessCommandCapability = {
    list: async () => ({ ok: true, value: this.transport.commandCatalog }),
    execute: async (command) => {
      const entry = this.transport.commandCatalog.commands.find((c) => c.id === command.commandId);
      if (!entry)
        return rejected("unsupported", "Cursor command is not advertised by this session");
      if (
        command.arguments &&
        (Object.keys(command.arguments).some((k) => k !== "text") ||
          (command.arguments.text !== undefined && typeof command.arguments.text !== "string"))
      )
        return rejected("invalidRequest", "Invalid command arguments");
      const text = `${entry.invocation}${command.arguments?.text ? ` ${command.arguments.text}` : ""}`;
      this.#commandTurns.add(command.turnId);
      const result = await this.execute({
        type: "turn.start",
        turnId: command.turnId,
        input: [{ type: "text", text }],
      });
      if (!result.ok) this.#commandTurns.delete(command.turnId);
      return result;
    },
  };
  #configuring = false;
  #closed = false;
  #fresh: boolean;
  #subagentOutput: CursorSubagents | undefined;
  subagentSnapshot(callId: string): HostThreadSnapshot | undefined {
    try {
      return this.#subagentOutput?.snapshot(this.transport.sessionId, callId);
    } catch {
      return undefined;
    }
  }
  constructor(
    public transport: CursorTransport,
    info: CursorSessionInfo,
    readonly onClose: () => void,
    created = true,
    private requestedModel?: HarnessModelRef,
    private requestedPermission?: string,
  ) {
    this.#fresh = created;
    this.#info = info;
    this.capabilities = cursorCapabilities();
    this.initialState = cursorSessionState(info, transport.sessionId, transport.options.force);
  }
  #native(allowMissing = false) {
    return readCursorNativeTurns(
      this.transport.sessionId,
      this.transport.options.cwd,
      this.transport.options.environment,
      allowMissing,
    );
  }
  /**
   * History replayed while opening a resumed Session, held until the first
   * read. It stops being authoritative as soon as the Session advances or its
   * transport is replaced, and is dropped at those points.
   */
  #restoredSnapshot: Omit<HostThreadSnapshot, "state"> | undefined;
  adoptRestoredSnapshot(snapshot: Omit<HostThreadSnapshot, "state">): void {
    this.#restoredSnapshot = snapshot;
  }
  async readSnapshot(): Promise<HarnessResult<HostThreadSnapshot>> {
    if (this.#closed) return rejected("invalidState", "Cursor session is closed");
    if (this.#active || this.#configuring) return rejected("sessionBusy", "Cursor session is busy");
    const restored = this.#restoredSnapshot;
    if (restored) {
      this.#restoredSnapshot = undefined;
      return { ok: true, value: { ...restored, state: structuredClone(this.initialState) } };
    }
    this.#configuring = true;
    // Re-reading needs its own CLI: a shared connection routes by Session id,
    // so a second attachment for this Session would displace the live one.
    const isolated = { ...this.transport.options };
    delete isolated.pool;
    const replay = new CursorTransport(isolated);
    try {
      const before = this.#native(this.#fresh);
      if (before.length === 0 && this.#fresh)
        return { ok: true, value: { turns: [], state: structuredClone(this.initialState) } };
      await replay.open(this.transport.sessionId);
      const after = this.#native();
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error("Cursor native history changed during snapshot read");
      return {
        ok: true,
        value: {
          ...cursorSnapshot(this.transport.sessionId, after, replay.replay),
          state: structuredClone(this.initialState),
        },
      };
    } catch (error) {
      return { ok: false, error: cursorError(error) };
    } finally {
      await replay.close();
      this.#configuring = false;
    }
  }
  execute(command: TurnStartCommand): Promise<HarnessResult<TurnStartAccepted>>;
  execute(command: TurnCancelCommand): Promise<HarnessResult<TurnCancelAccepted>>;
  execute(command: InteractionRespondCommand): Promise<HarnessResult<InteractionRespondAccepted>>;
  execute(command: ModelSelectCommand): Promise<HarnessResult<ModelSelectCompleted>>;
  execute(command: ThinkingSelectCommand): Promise<HarnessResult<ThinkingSelectCompleted>>;
  execute(
    command: PermissionModeSelectCommand,
  ): Promise<HarnessResult<PermissionModeSelectCompleted>>;
  async execute(
    command: HostCommand,
  ): Promise<
    HarnessResult<
      | TurnStartAccepted
      | TurnCancelAccepted
      | InteractionRespondAccepted
      | ModelSelectCompleted
      | ThinkingSelectCompleted
      | PermissionModeSelectCompleted
    >
  > {
    if (this.#closed) return rejected("invalidState", "Cursor session is closed");
    if (command.type === "interaction.respond") return this.#interactions.respond(command);
    if (command.type === "turn.cancel") {
      if (!this.#active || this.#active.command.turnId !== command.turnId)
        return rejected("invalidState", "Cursor turn is not active");
      const active = this.#active;
      active.cancelled = true;
      this.#interactions.cancel();
      try {
        await this.transport.cancel();
      } catch {
        await this.transport.close();
      }
      const timer = setTimeout(() => {
        if (this.#active === active) void this.transport.close();
      }, 5_000);
      void active.task.finally(() => clearTimeout(timer));
      return { ok: true, value: { cancellationRequested: true } };
    }
    if (this.#active || this.#configuring) return rejected("sessionBusy", "Cursor session is busy");
    if (command.type === "turn.start") {
      if (this.#submitted.has(command.turnId))
        return rejected("invalidState", "Cursor turn was already submitted");
      if (
        !command.input.length ||
        command.input.some((part) => part.type !== "text") ||
        !command.input.some((part) => part.text.trim())
      )
        return rejected("invalidRequest", "Cursor requires nonempty text input");
      let before: CursorNativeTurn[];
      try {
        before = this.#native(this.#fresh);
      } catch (error) {
        return { ok: false, error: cursorError(error) };
      }
      const invocation = command.input
        .map((part) => part.text)
        .join("\n")
        .trim()
        .split(/\s/u)[0];
      if (this.transport.commandCatalog.commands.some((item) => item.invocation === invocation))
        this.#commandTurns.add(command.turnId);
      this.#submitted.add(command.turnId);
      const active = { command, cancelled: false, task: Promise.resolve() };
      // The Session is about to advance past the history captured at open.
      this.#restoredSnapshot = undefined;
      this.#active = active;
      active.task = this.#run(command, before);
      return { ok: true, value: { turnId: command.turnId } };
    }
    this.#configuring = true;
    try {
      if (command.type === "thinking.select") {
        return rejected("unsupported", "Use the native Model configuration controls");
      }
      if (command.type === "model.select") {
        const next = await configureCursorModel(this.transport, this.#info, command.model.id);
        this.#applyConfig(next.configOptions);
        return { ok: true, value: { completed: true } };
      }
      if (!CURSOR_MODES.modes.some((mode) => mode.id === command.permissionModeId))
        return rejected("invalidRequest", "Unknown Cursor execution mode");
      await this.#applyPermission(command.permissionModeId);
      return { ok: true, value: { completed: true } };
    } catch (error) {
      return { ok: false, error: cursorError(error) };
    } finally {
      this.#configuring = false;
    }
  }
  async #applyPermission(id: string): Promise<void> {
    const { mode, force } = decodeCursorPermission(id);
    if (force !== (this.transport.options.force ?? false)) {
      const { sessionId, options } = this.transport;
      // The replay held from the previous transport does not belong to the new one.
      this.#restoredSnapshot = undefined;
      await this.transport.close();
      this.transport = new CursorTransport({ ...options, force });
      const info = await this.transport.open(sessionId);
      this.#info = {
        ...info,
        ...(this.#info.availableModels ? { availableModels: this.#info.availableModels } : {}),
      };
    }
    const current =
      this.#info.configOptions?.find((o) => o.id === "mode")?.currentValue ??
      this.#info.modes?.currentModeId ??
      "agent";
    if (current !== mode) {
      const result = await this.#configure("mode", mode);
      if (!result.ok) throw new Error(result.error.message);
    } else this.#applyConfig(this.#info.configOptions);
    this.requestedPermission = id;
  }
  async #configure(configId: string, value: string): Promise<HarnessResult<{ completed: true }>> {
    const result = await this.transport.configure(configId, value);
    const option = result.configOptions?.find((entry) => entry.id === configId);
    if (!option || configString(option.currentValue) !== value)
      throw new Error("Cursor did not confirm configuration selection");
    this.#applyConfig(result.configOptions);
    return { ok: true, value: { completed: true } };
  }
  #applyConfig(configOptions: CursorSessionInfo["configOptions"]) {
    const info = withConfigOptions(this.#info, configOptions);
    this.capabilities = cursorCapabilities();
    const next = cursorSessionState(info, this.transport.sessionId, this.transport.options.force);
    this.#info = info;
    this.initialState.modelCatalog = cursorCatalog(info);
    if (next.effectiveModel) this.initialState.effectiveModel = next.effectiveModel;
    else delete this.initialState.effectiveModel;
    if (next.resolvedModelLabel) this.initialState.resolvedModelLabel = next.resolvedModelLabel;
    else delete this.initialState.resolvedModelLabel;
    if (next.effectiveThinkingOptionId)
      this.initialState.effectiveThinkingOptionId = next.effectiveThinkingOptionId;
    else delete this.initialState.effectiveThinkingOptionId;
    if (next.availableThinkingOptions)
      this.initialState.availableThinkingOptions = next.availableThinkingOptions;
    else delete this.initialState.availableThinkingOptions;
    if (next.effectivePermissionModeId)
      this.initialState.effectivePermissionModeId = next.effectivePermissionModeId;
    this.#channel.emit({
      kind: "event",
      event: { type: "session.state.changed", state: { ...this.initialState } },
    });
  }
  async #run(command: TurnStartCommand, before: CursorNativeTurn[]) {
    let fault: HarnessError | undefined;
    const output = new CursorTurnOutput(
      command.turnId,
      (event) => this.#channel.emit({ kind: "event", event }),
      before.length,
    );
    this.#subagentOutput = output.subagents;
    this.#channel.emit({ kind: "event", event: { type: "turn.started", turnId: command.turnId } });
    let outcome: TurnOutcome = {
      status: "failed",
      error: { code: "nativeFailure", message: "Cursor turn failed", retryable: false },
    };
    let nativeTurnRef: ReturnType<typeof nativeTurnRefSchema.parse> | undefined;
    try {
      const permission = command.permissionModeId ?? this.requestedPermission;
      const previousModel = this.initialState.effectiveModel;
      if (permission) await this.#applyPermission(permission);
      const model = command.model ?? this.requestedModel ?? previousModel;
      if (model && model.id !== this.initialState.effectiveModel?.id) {
        const next = await configureCursorModel(this.transport, this.#info, model.id);
        this.#applyConfig(next.configOptions);
        this.requestedModel = this.initialState.effectiveModel;
      }
      if (this.#active?.cancelled) throw new Error("Cursor turn cancelled before prompting");
      const result = await this.transport.prompt(
        command.input.map((part) => part.text).join("\n"),
        {
          update: (event) => output.update(event),
          permission: (request) => this.#interactions.permission(command.turnId, request),
          extension: (method, params) =>
            Promise.resolve(
              output.subagents.extension(method, params) ??
                this.#interactions.extension(command.turnId, method, params),
            ),
          notification: (method, params) => {
            output.subagents.extension(method, params);
          },
        },
      );
      outcome =
        this.#active?.cancelled || result.stopReason === "cancelled"
          ? { status: "cancelled" }
          : result.stopReason === "end_turn"
            ? { status: "succeeded" }
            : {
                status: "failed",
                error: {
                  code: "nativeFailure",
                  message: `Cursor stopped: ${result.stopReason}`,
                  retryable: false,
                },
              };
    } catch (error) {
      fault = cursorError(error);
      outcome = this.#active?.cancelled
        ? { status: "cancelled" }
        : { status: "failed", error: cursorError(error) };
    }
    try {
      const after = this.#native();
      const added = after.filter((turn) => !before.some((old) => old.id === turn.id));
      if (
        added.length !== 1 ||
        after.length !== before.length + 1 ||
        before.some((turn, index) => after[index]?.id !== turn.id) ||
        (!this.#commandTurns.has(command.turnId) &&
          added[0]?.text !== command.input.map((part) => part.text).join("\n"))
      )
        throw new Error("Cursor terminal has no unique, verified native turn identity");
      nativeTurnRef = nativeTurnRefSchema.parse({
        harnessId: "cursor-cli",
        nativeSessionId: this.transport.sessionId,
        nativeTurnKey: added[0]?.id,
        formatVersion: 1,
      });
      this.#fresh = false;
    } catch (error) {
      if (outcome.status === "succeeded") outcome = { status: "failed", error: cursorError(error) };
    }
    this.#commandTurns.delete(command.turnId);
    this.#interactions.cancel();
    output.finish(outcome);
    this.#active = undefined;
    this.#channel.emit({
      kind: "event",
      event: {
        type: "turn.completed",
        turnId: command.turnId,
        outcome,
        ...(nativeTurnRef ? { nativeTurnRef } : {}),
      },
    });
    if (fault && !this.#closed) {
      this.#channel.emit({ kind: "event", event: { type: "session.faulted", error: fault } });
      void this.close().catch(() => {});
    }
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    const active = this.#active;
    if (active) active.cancelled = true;
    this.#interactions.cancel();
    try {
      await this.transport.close();
      await active?.task;
    } finally {
      this.#channel.end();
      this.onClose();
    }
  }
}
