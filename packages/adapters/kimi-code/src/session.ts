import { readTurns } from "./history.js";
import { readFileChanges } from "./file-history.js";
import { readUsage } from "./usage.js";
import { childRecord, type ChildRecord } from "./subagents.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type WebSocket from "ws";
import {
  HarnessOutputChannel,
  validateHostInteractionResponse,
  type HarnessOutput,
  type HarnessSession,
  type HarnessSessionState,
  type HostCommand,
  type HostEvent,
  type HostInteraction,
  type HostItemSnapshot,
  type HostThreadSnapshot,
  type HarnessResult,
  type HostUsage,
} from "@codexhost/harness-adapter";
import {
  harnessPermissionModeIdSchema,
  hostInteractionIdSchema,
  type HostTurnId,
  harnessThinkingOptionIdSchema,
  harnessCommandCatalogSchema,
  hostItemIdSchema,
  type HarnessSessionCapabilities,
} from "@codexhost/shared-contracts";
import type { KimiServer } from "./server.js";
import { KimiError, kimiError } from "./server.js";
import { kimiId, modelCatalog, selection, permissionProfile, type NativeModel } from "./models.js";
import {
  nativeRef,
  frames,
  projectTurn,
  statusSchema,
  statusUsage,
  transcriptSchema,
  turnSchema,
  type NativeTurn,
} from "./projection.js";

export const capabilities: HarnessSessionCapabilities = {
  configuration: {
    selectModel: true,
    modelSelectionScope: "turn",
    selectThinkingOption: false,
    selectPermissionMode: true,
    permissionModeScope: "turn",
  },
  history: { fork: true, forkAcrossCwd: false, rollbackLastTurn: true },
  subagents: { observe: true, readTranscript: true },
};
export const commandCatalog = harnessCommandCatalogSchema.parse({
  commands: [
    {
      id: "compact",
      invocation: "/compact",
      label: "Compact",
      description: "压缩 Kimi 会话上下文",
      argumentMode: "text",
    },
  ],
});
const approvalsSchema = z.object({
  items: z.array(
    z.object({
      approval_id: z.string(),
      action: z.string(),
      tool_name: z.string(),
      expires_at: z.string().optional(),
    }),
  ),
});
const questionsSchema = z.object({
  items: z.array(
    z.object({
      question_id: z.string(),
      questions: z.array(
        z.object({
          id: z.string(),
          question: z.string(),
          multi_select: z.boolean().optional(),
          allow_other: z.boolean().optional(),
          options: z.array(
            z.object({ id: z.string(), label: z.string(), description: z.string().optional() }),
          ),
        }),
      ),
    }),
  ),
});
type Active = {
  turnId: HostTurnId;
  promptId: string;
  items: Map<string, HostItemSnapshot>;
  interactions: Map<string, HostInteraction>;
  started: boolean;
};

/** Native Transcript is the single projection source for streaming and restored history. */
export class KimiSession implements HarnessSession {
  readonly harnessId = kimiId;
  readonly capabilities = capabilities;
  readonly #channel = new HarnessOutputChannel<HarnessOutput>();
  readonly outputs = this.#channel.outputs;
  readonly initialState: HarnessSessionState;
  readonly initialUsage: HostUsage;
  #state: HarnessSessionState;
  #active: Active | undefined;
  #closed = false;
  #busy = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #socket?: WebSocket;
  #poll: Promise<void> | undefined;
  #close?: Promise<void>;
  readonly #children = new Map<string, ChildRecord>();
  readonly #files = new Map<string, HostItemSnapshot[]>();
  #compact:
    | {
        turnId: HostTurnId;
        accepted: boolean;
        finishing?: boolean;
        result?: { type: string; payload?: Record<string, unknown> | undefined };
        timeout: ReturnType<typeof setTimeout>;
      }
    | undefined;
  constructor(
    readonly server: KimiServer,
    readonly id: string,
    readonly models: NativeModel[],
    status: z.infer<typeof statusSchema>,
    readonly onClosed: () => void,
    usage?: HostUsage,
  ) {
    this.#state = this.state(status);
    this.initialState = this.#state;
    this.initialUsage = usage ?? statusUsage(status);
  }
  get path(): string {
    return `/sessions/${encodeURIComponent(this.id)}`;
  }
  state(status: z.infer<typeof statusSchema>): HarnessSessionState {
    const catalog = modelCatalog(this.models, status.model, status.thinking_level);
    const current = this.models.find((m) => m.model === status.model);
    const options = catalog.thinkingOptions.filter((o) => current?.support_efforts.includes(o.id));
    return {
      nativeRef: nativeRef(this.id),
      modelCatalog: catalog,
      ...(catalog.defaultModel ? { effectiveModel: catalog.defaultModel } : {}),
      ...(current ? { resolvedModelLabel: current.display_name ?? current.model } : {}),
      availableThinkingOptions: options,
      ...(options.some((o) => o.id === status.thinking_level)
        ? { effectiveThinkingOptionId: harnessThinkingOptionIdSchema.parse(status.thinking_level) }
        : {}),
      effectivePermissionModeId: harnessPermissionModeIdSchema.parse(
        `${status.plan_mode ? "plan" : "agent"}.${status.permission}`,
      ),
    };
  }
  async start(): Promise<void> {
    this.#socket?.terminate();
    this.#socket = await this.server.subscribe(this.id, (event) => {
      if (event?.type.startsWith("subagent.")) {
        const id = event.payload?.subagentId;
        const record = childRecord(
          event.type,
          event.payload,
          typeof id === "string" ? this.#children.get(id) : undefined,
        );
        if (record) {
          this.#children.set(record.state.subagentId, record);
          this.event({
            type: "subagent.state.changed",
            nativeSubagentId: record.state.subagentId,
            status: record.state.status,
            ...(record.state.resultSummary ? { resultSummary: record.state.resultSummary } : {}),
          });
          this.event({
            type: "subagent.transcript.changed",
            nativeSubagentId: record.state.subagentId,
          });
        }
      }
      if (
        event &&
        ["compaction.completed", "compaction.failed"].includes(event.type) &&
        this.#compact
      ) {
        this.#compact.result = event;
        if (this.#compact.accepted) void this.finishCompact();
      }
      this.schedule();
    });
  }
  readonly commands: NonNullable<HarnessSession["commands"]> = {
    list: async () => ({ ok: true, value: commandCatalog }),
    execute: async (command) => {
      if (command.commandId !== "compact")
        return {
          ok: false,
          error: kimiError(new KimiError("unsupported", "Unknown Kimi command")),
        };
      if (this.#closed || this.#busy || this.#active || this.#compact)
        return {
          ok: false,
          error: kimiError(new KimiError("sessionBusy", "Kimi Session is not idle")),
        };
      const timeout = setTimeout(() => {
        void this.fault(
          new KimiError("unavailable", "Kimi compaction completion was not confirmed"),
        );
      }, 180_000);
      this.#compact = { turnId: command.turnId, accepted: false, timeout };
      try {
        const text = command.arguments?.text;
        await this.server.request(
          `${this.path}:compact`,
          z.unknown(),
          typeof text === "string" ? { instruction: text } : {},
        );
        this.#compact.accepted = true;
        this.event({ type: "turn.started", turnId: command.turnId });
        this.event({
          type: "item.started",
          turnId: command.turnId,
          item: {
            type: "contextCompaction",
            itemId: hostItemIdSchema.parse(`compact-${command.turnId}`),
          },
        });
        if (this.#compact.result) void this.finishCompact();
        return { ok: true, value: { turnId: command.turnId } };
      } catch (error) {
        clearTimeout(timeout);
        this.#compact = undefined;
        return { ok: false, error: kimiError(error) };
      }
    },
  };
  async finishCompact(): Promise<void> {
    const compact = this.#compact;
    if (!compact?.accepted || !compact.result || compact.finishing) return;
    compact.finishing = true;
    clearTimeout(compact.timeout);
    const outcome =
      compact.result.type === "compaction.completed"
        ? { status: "succeeded" as const }
        : { status: "failed" as const, error: kimiError(new Error("Kimi compaction failed")) };
    await this.refreshUsage().catch(() => undefined);
    if (this.#compact !== compact) return;
    this.#compact = undefined;
    this.event({
      type: "item.completed",
      turnId: compact.turnId,
      snapshot: {
        item: {
          type: "contextCompaction",
          itemId: hostItemIdSchema.parse(`compact-${compact.turnId}`),
        },
        outcome,
      },
    });
    this.event({ type: "turn.completed", turnId: compact.turnId, outcome });
  }
  endCompact(error: Error): void {
    const compact = this.#compact;
    if (!compact) return;
    this.#compact = undefined;
    clearTimeout(compact.timeout);
    if (!compact.accepted) return;
    const outcome = { status: "failed" as const, error: kimiError(error) };
    this.event({
      type: "item.completed",
      turnId: compact.turnId,
      snapshot: {
        item: {
          type: "contextCompaction",
          itemId: hostItemIdSchema.parse(`compact-${compact.turnId}`),
        },
        outcome,
      },
    });
    this.event({ type: "turn.completed", turnId: compact.turnId, outcome });
  }
  event(event: HostEvent): void {
    this.#channel.emit({ kind: "event", event });
  }
  async refreshUsage(): Promise<void> {
    const status = await this.server.request(`${this.path}/status`, statusSchema);
    this.#state = this.state(status);
    this.event({ type: "session.state.changed", state: this.#state });
    this.event({
      type: "session.usage.changed",
      usage: await readUsage(this.server, this.path, status),
      ...(this.#active ? { observedForTurnId: this.#active.turnId } : {}),
    });
  }
  readTurns(): Promise<NativeTurn[]> {
    return readTurns(this.server, this.id);
  }
  async readSnapshot(): Promise<HarnessResult<HostThreadSnapshot>> {
    try {
      const turns = [];
      for (const turn of await this.readTurns()) {
        const projected = projectTurn(this.id, turn);
        if (["completed", "failed", "cancelled", "interrupted"].includes(turn.state))
          projected.items.push(...(await this.fileChanges(turn.turnId)));
        turns.push(projected);
      }
      return {
        ok: true,
        value: {
          turns,
          state: this.#state,
        },
      };
    } catch (error) {
      return { ok: false, error: kimiError(error) };
    }
  }
  async fileChanges(turnId: string): Promise<HostItemSnapshot[]> {
    const cached = this.#files.get(turnId);
    if (cached) return cached;
    const result = await readFileChanges(this.server, this.id, turnId);
    this.#files.set(turnId, result);
    return result;
  }
  // The public overloads are fulfilled by the discriminated command implementation below.
  execute: HarnessSession["execute"] = (async (command: HostCommand) => {
    try {
      if (this.#closed) throw new KimiError("invalidState", "Kimi Session is closed");
      if (command.type === "turn.cancel") {
        if (this.#active?.turnId !== command.turnId)
          throw new KimiError("invalidRequest", "Kimi Turn is not active");
        await this.server.request(
          `${this.path}/prompts/${encodeURIComponent(this.#active.promptId)}:abort`,
          z.unknown(),
          {},
        );
        this.schedule();
        return { ok: true, value: { cancellationRequested: true } };
      }
      if (command.type === "interaction.respond") {
        const active = this.#active;
        const interaction = active?.interactions.get(command.interactionId);
        if (!active || !interaction)
          throw new KimiError("invalidRequest", "Kimi Interaction is no longer active");
        const validated = validateHostInteractionResponse(interaction, command.response);
        if (validated) return { ok: false, error: validated };
        if (command.response.type === "approval") {
          const action = command.response.actionId;
          await this.server.request(
            `${this.path}/approvals/${encodeURIComponent(command.interactionId)}`,
            z.object({ resolved: z.literal(true) }),
            {
              decision: action === "deny" ? "rejected" : "approved",
              ...(action === "session" ? { scope: "session" } : {}),
            },
          );
        } else if (command.response.cancelled) {
          await this.server.request(
            `${this.path}/questions/${encodeURIComponent(command.interactionId)}:dismiss`,
            z.unknown(),
            {},
          );
        } else {
          if (interaction.type !== "question")
            throw new KimiError("invalidRequest", "Question response required");
          const answers = Object.fromEntries(
            interaction.questions.map((q) => {
              const values =
                command.response.type === "question" ? (command.response.answers[q.id] ?? []) : [];
              const ids =
                q.type === "choice"
                  ? values.filter((v) => q.options.some((o) => o.value === v))
                  : [];
              const other = values.filter((v) => !ids.includes(v)).join("\n");
              return [
                q.id,
                !values.length
                  ? { kind: "skipped" }
                  : other
                    ? ids.length
                      ? { kind: "multi_with_other", option_ids: ids, other_text: other }
                      : { kind: "other", text: other }
                    : q.type === "choice" && q.multiple
                      ? { kind: "multi", option_ids: ids }
                      : { kind: "single", option_id: ids[0] },
              ];
            }),
          );
          await this.server.request(
            `${this.path}/questions/${encodeURIComponent(command.interactionId)}`,
            z.object({ resolved: z.literal(true) }),
            { answers, method: "click" },
          );
        }
        if (this.#active === active && active.interactions.delete(command.interactionId))
          this.event({
            type: "interaction.closed",
            interactionId: command.interactionId,
            turnId: active.turnId,
            reason: "responded",
          });
        this.schedule();
        return { ok: true, value: { accepted: true } };
      }
      if (this.#active || this.#busy || this.#compact)
        throw new KimiError("sessionBusy", "Kimi Session is busy");
      this.#busy = true;
      try {
        const profile: Record<string, unknown> = {};
        if ((command.type === "model.select" || command.type === "turn.start") && command.model)
          Object.assign(profile, selection(command.model, this.models));
        if (
          (command.type === "permissionMode.select" || command.type === "turn.start") &&
          command.permissionModeId
        )
          Object.assign(profile, permissionProfile(command.permissionModeId));
        if (command.type === "thinking.select") {
          if (!this.#state.availableThinkingOptions?.some((o) => o.id === command.thinkingOptionId))
            throw new KimiError("invalidRequest", "Kimi effort is not available");
          profile.thinking = command.thinkingOptionId;
        }
        if (Object.keys(profile).length) {
          await this.server.request(`${this.path}/profile`, z.unknown(), { agent_config: profile });
          await this.refreshUsage();
          // Native profile changes can replace the agent event source.
          await this.start();
        }
        if (command.type !== "turn.start") return { ok: true, value: { completed: true } };
        const active: Active = {
          turnId: command.turnId,
          promptId: randomUUID(),
          items: new Map(),
          interactions: new Map(),
          started: false,
        };
        this.#active = active;
        try {
          await this.server.request(`${this.path}/prompts`, z.object({ prompt_id: z.string() }), {
            prompt_id: active.promptId,
            content: command.input,
          });
        } catch (error) {
          // A lost HTTP response must not cause a second native prompt.
          const turns = await this.readTurns();
          const queue = await this.server.request(
            `${this.path}/prompts`,
            z.object({ active: z.unknown(), queued: z.array(z.unknown()) }),
          );
          if (
            !turns.some((t) => t.triggerPromptId === active.promptId) &&
            !JSON.stringify(queue).includes(active.promptId)
          ) {
            this.#active = undefined;
            throw error;
          }
        }
        active.started = true;
        this.event({ type: "turn.started", turnId: active.turnId });
        this.schedule();
        return { ok: true, value: { turnId: active.turnId } };
      } finally {
        this.#busy = false;
      }
    } catch (error) {
      return { ok: false, error: kimiError(error) };
    }
  }) as HarnessSession["execute"];
  schedule(): void {
    if (this.#closed || !this.#active?.started || this.#timer || this.#poll) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#poll = this.poll()
        .catch((error: unknown) => this.fault(error))
        .finally(() => {
          this.#poll = undefined;
          this.schedule();
        });
    }, 150);
  }
  async poll(): Promise<void> {
    const active = this.#active;
    if (!active) return;
    const page = await this.server.request(
      `${this.path}/transcript?agent_id=main&page_size=1`,
      transcriptSchema,
    );
    if (this.#active !== active) return;
    const turn = page.items
      .map((v) => turnSchema.safeParse(v))
      .find((v) => v.success && v.data.triggerPromptId === active.promptId);
    if (turn?.success) {
      for (const snapshot of frames(turn.data, [...this.#children.values()])) {
        const item = snapshot.item;
        const previous = active.items.get(item.itemId)?.item;
        if (!previous) this.event({ type: "item.started", turnId: active.turnId, item });
        else if (
          (item.type === "reasoning" || item.type === "agentMessage") &&
          (previous.type === "reasoning" || previous.type === "agentMessage")
        ) {
          if (!item.text.startsWith(previous.text))
            throw new KimiError(
              "protocolError",
              "Kimi text changed outside its append-only stream",
            );
          if (item.text.length > previous.text.length)
            this.event({
              type: "item.updated",
              turnId: active.turnId,
              itemId: item.itemId,
              update: { type: "text.append", text: item.text.slice(previous.text.length) },
            });
        } else if (item.type === "commandExecution" && previous.type === "commandExecution") {
          const output = item.output ?? "";
          const old = previous.output ?? "";
          if (output.startsWith(old) && output !== old)
            this.event({
              type: "item.updated",
              turnId: active.turnId,
              itemId: item.itemId,
              update: { type: "output.append", text: output.slice(old.length) },
            });
        } else if (
          item.type === "toolExecution" &&
          previous.type === "toolExecution" &&
          item.output &&
          JSON.stringify(item.output) !== JSON.stringify(previous.output)
        )
          this.event({
            type: "item.updated",
            turnId: active.turnId,
            itemId: item.itemId,
            update: { type: "output.replace", output: item.output },
          });
        else if (
          item.type === "subagentDelegation" &&
          previous.type === "subagentDelegation" &&
          JSON.stringify(item.subagents) !== JSON.stringify(previous.subagents)
        )
          this.event({
            type: "item.updated",
            turnId: active.turnId,
            itemId: item.itemId,
            update: { type: "subagents.replace", subagents: item.subagents },
          });
        active.items.set(item.itemId, snapshot);
      }
      if (["completed", "failed", "cancelled", "interrupted"].includes(turn.data.state)) {
        for (const snapshot of await this.fileChanges(turn.data.turnId)) {
          this.event({ type: "item.started", turnId: active.turnId, item: snapshot.item });
          active.items.set(snapshot.item.itemId, snapshot);
        }
        await this.refreshUsage();
        const projected = projectTurn(this.id, turn.data);
        this.finish(
          active,
          projected.outcome.status === "unknown"
            ? { status: "failed", error: kimiError(new Error(projected.outcome.reason)) }
            : {
                ...projected.outcome,
                ...(projected.checkpoint ? { checkpoint: projected.checkpoint } : {}),
              },
          projected.nativeTurnRef,
        );
        return;
      }
    }
    const [approvals, questions] = await Promise.all([
      this.server.request(`${this.path}/approvals?status=pending`, approvalsSchema),
      this.server.request(`${this.path}/questions?status=pending`, questionsSchema),
    ]);
    if (this.#active !== active) return;
    const pending = new Set<string>();
    for (const a of approvals.items) {
      pending.add(a.approval_id);
      this.interact(active, {
        type: "approval",
        interactionId: hostInteractionIdSchema.parse(a.approval_id),
        turnId: active.turnId,
        title: a.tool_name,
        description: a.action,
        subject: { type: "nativeAction" },
        actions: [
          { id: "once", label: "允许一次", effect: "allowOnce" },
          { id: "session", label: "本会话允许", effect: "allowForSession" },
          { id: "deny", label: "拒绝", effect: "deny" },
        ],
      });
    }
    for (const q of questions.items) {
      pending.add(q.question_id);
      this.interact(active, {
        type: "question",
        interactionId: hostInteractionIdSchema.parse(q.question_id),
        turnId: active.turnId,
        questions: q.questions.map((question) => ({
          id: question.id,
          type: "choice",
          prompt: question.question,
          options: question.options.map((o) => ({
            value: o.id,
            label: o.label,
            ...(o.description ? { description: o.description } : {}),
          })),
          multiple: question.multi_select ?? false,
          allowOther: question.allow_other ?? false,
          optional: true,
        })),
      });
    }
    for (const [id, interaction] of active.interactions)
      if (!pending.has(id)) {
        active.interactions.delete(id);
        this.event({
          type: "interaction.closed",
          interactionId: interaction.interactionId,
          turnId: active.turnId,
          reason: "superseded",
        });
      }
  }
  interact(active: Active, interaction: HostInteraction): void {
    if (active.interactions.has(interaction.interactionId)) return;
    active.interactions.set(interaction.interactionId, interaction);
    this.#channel.emit({ kind: "interaction", interaction });
  }
  finish(
    active: Active,
    outcome: Extract<HostEvent, { type: "turn.completed" }>["outcome"],
    ref?: Extract<HostEvent, { type: "turn.completed" }>["nativeTurnRef"],
  ): void {
    if (this.#active !== active) return;
    for (const interaction of active.interactions.values())
      this.event({
        type: "interaction.closed",
        interactionId: interaction.interactionId,
        turnId: active.turnId,
        reason: "cancelled",
      });
    for (const snapshot of active.items.values())
      this.event({ type: "item.completed", turnId: active.turnId, snapshot });
    this.#active = undefined;
    this.event({
      type: "turn.completed",
      turnId: active.turnId,
      outcome,
      ...(ref ? { nativeTurnRef: ref } : {}),
    });
  }
  async fault(error: unknown): Promise<void> {
    if (this.#closed) return;
    if (this.#active) this.finish(this.#active, { status: "failed", error: kimiError(error) });
    this.endCompact(error instanceof Error ? error : new Error("Kimi Session faulted"));
    this.event({ type: "session.faulted", error: kimiError(error) });
    this.#closed = true;
    this.#socket?.terminate();
    await this.server.close();
    this.#channel.end();
    this.onClosed();
  }
  close(): Promise<void> {
    return (this.#close ??= this.closeSession());
  }
  async closeSession(): Promise<void> {
    if (this.#closed) return;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#active)
      await this.server.request(`${this.path}:abort`, z.unknown(), {}).catch(() => undefined);
    await this.#poll;
    this.#closed = true;
    this.#socket?.terminate();
    await this.server.close();
    this.endCompact(new Error("Session closed before Kimi compaction completed"));
    if (this.#active) this.finish(this.#active, { status: "cancelled", reason: "Session closed" });
    this.#channel.end();
    this.onClosed();
  }
}
