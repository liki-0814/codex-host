import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hostTurnIdSchema,
  hostInteractionIdSchema,
  harnessPermissionModeIdSchema,
  harnessThinkingOptionIdSchema,
  harnessInspectionSchema,
} from "@codexhost/shared-contracts";
import type { HarnessOutput } from "@codexhost/harness-adapter";
import { CursorAdapter, CursorSession } from "../src/adapter.js";
import { CursorTransport, type CursorCallbacks } from "../src/transport.js";
import { cursorModelRef, cursorCatalog, cursorNativeModel } from "../src/models.js";
import { CursorInteractions } from "../src/interactions.js";
import { cursorSnapshot } from "../src/projection.js";

const native = vi.hoisted(() => ({ turns: [] as Array<{ id: string; text: string }> }));
vi.mock("../src/native-history.js", () => ({
  readCursorNativeTurns: () => structuredClone(native.turns),
  readCursorNativeHistory: () => ({
    revision: JSON.stringify(native.turns),
    turns: structuredClone(native.turns),
  }),
}));
const info = {
  sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  configOptions: [
    {
      id: "model",
      name: "Model",
      type: "select" as const,
      currentValue: "model[effort=high]",
      options: [{ value: "model[effort=high]", name: "Model" }],
    },
  ],
};
const turnId = hostTurnIdSchema.parse("turn-one");
const start = {
  type: "turn.start" as const,
  turnId,
  input: [{ type: "text" as const, text: "hello" }],
};

class FakeTransport extends CursorTransport {
  override sessionId = info.sessionId;
  action: (
    text: string,
    callbacks: CursorCallbacks,
  ) => Promise<{ stopReason: "end_turn" | "cancelled" }> = async (text, callbacks) => {
    callbacks.update({
      sessionId: this.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
    });
    native.turns.push({ id: randomUUID(), text });
    return { stopReason: "end_turn" };
  };
  override async prompt(text: string, callbacks: CursorCallbacks) {
    return this.action(text, callbacks);
  }
  override async close() {}
  override async cancel() {}
  override async configure(configId: string, value: string) {
    return {
      configOptions: [
        {
          id: configId,
          name: configId,
          type: "select" as const,
          currentValue: value,
          options: [{ value, name: value }],
        },
      ],
    };
  }
}
function session(initial = info) {
  const transport = new FakeTransport({ cwd: process.cwd(), environment: {} });
  const session = new CursorSession(transport, initial, () => {});
  const output: HarnessOutput[] = [];
  const done = (async () => {
    for await (const item of session.outputs) output.push(item);
  })();
  return { transport, session, output, done };
}
afterEach(() => {
  vi.restoreAllMocks();
  native.turns = [];
});

describe("Cursor native configuration", () => {
  it("forwards model variants while a Turn is active", async () => {
    const f = session();
    const currentModel = f.session.info.configOptions?.find((option) => option.id === "model");
    if (!currentModel) throw new Error("Missing model");
    currentModel.currentValue = "model[effort=low]";
    const gate = Promise.withResolvers<{ stopReason: "end_turn" }>();
    f.transport.action = () => gate.promise;
    const configure = vi.spyOn(f.transport, "configure");
    try {
      await f.session.execute(start);
      const model = cursorModelRef("model[effort=high]");
      expect(await f.session.execute({ type: "model.select", model })).toMatchObject({ ok: true });
      expect(configure).toHaveBeenCalledWith("model", "model[effort=high]");
      expect(
        await f.session.execute({ ...start, turnId: hostTurnIdSchema.parse("duplicate") }),
      ).toMatchObject({ error: { code: "sessionBusy" } });
    } finally {
      gate.resolve({ stopReason: "end_turn" });
      await f.session.close();
      await f.done;
    }
  });
  it("starts inspection cache expiry at completion, including slow native startup", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0),
      gate = Promise.withResolvers<typeof info>();
    const open = vi.spyOn(CursorTransport.prototype, "open").mockImplementation(() => gate.promise);
    vi.spyOn(CursorTransport.prototype, "close").mockResolvedValue();
    const adapter = new CursorAdapter();
    try {
      const first = adapter.inspect();
      const concurrentRefresh = adapter.inspect({ refresh: true });
      expect(open).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(400_000);
      gate.resolve(info);
      await Promise.all([first, concurrentRefresh]);
      await adapter.inspect();
      expect(open).toHaveBeenCalledTimes(1);
      await adapter.inspect({ refresh: true });
      expect(open).toHaveBeenCalledTimes(2);
    } finally {
      await adapter.close();
    }
  });
  it.each([false, true])(
    "does not mutate a previously returned snapshot after mode changes (history=%s)",
    async (history) => {
      const f = session();
      vi.spyOn(CursorTransport.prototype, "open").mockImplementation(async function (
        this: CursorTransport,
      ) {
        this.replay = native.turns.map((turn) => ({
          sessionId: info.sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: turn.text },
          },
        }));
        return info;
      });
      try {
        if (history) {
          await f.session.execute(start);
          await vi.waitFor(() =>
            expect(
              f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed"),
            ).toBe(true),
          );
        }
        const snapshot = await f.session.readSnapshot();
        if (!snapshot.ok) throw Error(snapshot.error.message);
        await f.session.execute({
          type: "permissionMode.select",
          permissionModeId: harnessPermissionModeIdSchema.parse("plan"),
        });
        expect(snapshot.value.state?.effectivePermissionModeId).toBe("agent");
      } finally {
        await f.session.close();
        await f.done;
      }
    },
  );
  it("preserves the complete parameterized native model behind an opaque Host ref", () => {
    const ref = cursorModelRef("model[effort=high]");
    expect(ref.id).toMatch(/^[A-Za-z0-9._~-]+$/u);
    expect(cursorNativeModel(info, ref.id)).toBe("model[effort=high]");
    expect(() => cursorNativeModel(info, "unknown")).toThrow();
    expect(cursorCatalog(info).models.map((model) => model.label)).toEqual(["Model"]);
    expect(cursorCatalog(info).thinkingOptions).toEqual([]);
  });
  it("rejects thinking.select when ACP has no independent thinking selector", async () => {
    const f = session();
    const configure = vi.spyOn(f.transport, "configure");
    expect(
      (
        await f.session.execute({
          type: "thinking.select",
          thinkingOptionId: harnessThinkingOptionIdSchema.parse("high"),
        })
      ).ok,
    ).toBe(false);
    expect(configure).not.toHaveBeenCalled();
    expect(f.session.initialState.effectiveThinkingOptionId).toBeUndefined();
    await f.session.close();
    await f.done;
  });
  it("restores catalog and current model from session/load configOptions", () => {
    const loaded = {
      sessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select" as const,
          currentValue: "composer-2.5[fast=true]",
          options: [
            { value: "default[]", name: "Auto" },
            { value: "composer-2.5[fast=true]", name: "composer-2.5" },
          ],
        },
      ],
    };
    const transport = new FakeTransport({ cwd: process.cwd(), environment: {} });
    transport.sessionId = loaded.sessionId;
    const restored = new CursorSession(transport, loaded, () => {}, false);
    expect(restored.initialState.effectiveModel).toEqual(cursorModelRef("composer-2.5[fast=true]"));
    expect(cursorCatalog(loaded).models.map((model) => model.label)).toEqual([
      "Auto",
      "composer-2.5",
    ]);
  });
  it("caches failed inspection and retries only on explicit refresh or expiry", async () => {
    const open = vi
      .spyOn(CursorTransport.prototype, "open")
      .mockRejectedValue(new Error("not logged in"));
    vi.spyOn(CursorTransport.prototype, "close").mockResolvedValue();
    const adapter = new CursorAdapter();
    const first = await adapter.inspect();
    expect(harnessInspectionSchema.safeParse(first).success).toBe(true);
    expect(await adapter.inspect()).toEqual(first);
    expect(open).toHaveBeenCalledTimes(1);
    await adapter.inspect({ refresh: true });
    expect(open).toHaveBeenCalledTimes(2);
    await adapter.close();
  });
  it("does not claim unconfirmed mode selection", async () => {
    const f = session();
    vi.spyOn(f.transport, "configure").mockResolvedValue({ configOptions: [] });
    expect(
      (
        await f.session.execute({
          type: "permissionMode.select",
          permissionModeId: harnessPermissionModeIdSchema.parse("plan"),
        })
      ).ok,
    ).toBe(false);
    expect(f.session.initialState.effectivePermissionModeId).toBe("agent");
    await f.session.close();
    await f.done;
  });
});

describe("Cursor turn lifecycle", () => {
  it("faults and closes a dead ACP session instead of accepting further turns", async () => {
    const f = session();
    f.transport.action = async () => {
      throw new Error("Cursor ACP process exited (1)");
    };
    const close = vi.spyOn(f.transport, "close");
    await f.session.execute(start);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    expect(
      (await f.session.execute({ ...start, turnId: hostTurnIdSchema.parse("after-exit") })).ok,
    ).toBe(false);
    expect(f.output.some((x) => x.kind === "event" && x.event.type === "session.faulted")).toBe(
      true,
    );
    expect(close).toHaveBeenCalled();
    await f.session.close();
    await f.done;
  });
  it("emits a single terminal with durable native identity and refuses duplicate submission", async () => {
    const f = session();
    expect((await f.session.execute(start)).ok).toBe(true);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    expect((await f.session.execute(start)).ok).toBe(false);
    await f.session.close();
    await f.done;
    const terminal = f.output.filter(
      (x) => x.kind === "event" && x.event.type === "turn.completed",
    );
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      event: {
        outcome: { status: "succeeded" },
        nativeTurnRef: { nativeTurnKey: native.turns[0]?.id },
      },
    });
  });
  it.each([0, 2])("fails a nominal success when native history added %i turns", async (count) => {
    const f = session();
    f.transport.action = async (text) => {
      for (let index = 0; index < count; index++) native.turns.push({ id: randomUUID(), text });
      return { stopReason: "end_turn" };
    };
    await f.session.execute(start);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    await f.session.close();
    await f.done;
    expect(f.output).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          type: "turn.completed",
          outcome: expect.objectContaining({ status: "failed" }),
        }),
      }),
    );
  });
  it("rejects a concurrent turn and closes pending approval on cancel", async () => {
    const f = session();
    f.transport.action = async (text, callbacks) => {
      const response = await callbacks.permission({
        sessionId: info.sessionId,
        toolCall: { toolCallId: "p", title: "shell" },
        options: [{ kind: "allow_once", optionId: "yes", name: "Allow" }],
      });
      expect(response).toEqual({ outcome: { outcome: "cancelled" } });
      native.turns.push({ id: randomUUID(), text });
      return { stopReason: "cancelled" };
    };
    await f.session.execute(start);
    expect((await f.session.execute({ ...start, turnId: hostTurnIdSchema.parse("two") })).ok).toBe(
      false,
    );
    expect((await f.session.execute({ type: "turn.cancel", turnId })).ok).toBe(true);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    await f.session.close();
    await f.done;
    expect(f.output).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({ type: "interaction.closed", reason: "cancelled" }),
      }),
    );
    expect(
      f.output.filter((x) => x.kind === "event" && x.event.type === "turn.completed"),
    ).toHaveLength(1);
  });
  it("keeps a completed answer when Cursor streams WritableIterable closed after it", async () => {
    const f = session();
    f.transport.action = async (text, callbacks) => {
      callbacks.update({
        sessionId: f.transport.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "PONG" } },
      });
      callbacks.update({
        sessionId: f.transport.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "\n\nError: RetriableError: WritableIterable is closed" },
        },
      });
      native.turns.push({ id: randomUUID(), text });
      return { stopReason: "end_turn" };
    };
    await f.session.execute(start);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    await f.session.close();
    await f.done;
    const terminal = f.output.find((x) => x.kind === "event" && x.event.type === "turn.completed");
    expect(terminal).toMatchObject({ event: { outcome: { status: "succeeded" } } });
    expect(
      f.output.some(
        (x) =>
          x.kind === "event" &&
          x.event.type === "item.updated" &&
          x.event.update.type === "text.append" &&
          x.event.update.text.includes("WritableIterable"),
      ),
    ).toBe(false);
  });

  it("retries an empty WritableIterable closed prompt when native history did not persist", async () => {
    const f = session();
    let calls = 0;
    f.transport.action = async (text, callbacks) => {
      calls += 1;
      if (calls === 1) {
        callbacks.update({
          sessionId: f.transport.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "\n\nError: RetriableError: WritableIterable is closed" },
          },
        });
        return { stopReason: "end_turn" };
      }
      callbacks.update({
        sessionId: f.transport.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "recovered" } },
      });
      native.turns.push({ id: randomUUID(), text });
      return { stopReason: "end_turn" };
    };
    await f.session.execute(start);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    await f.session.close();
    await f.done;
    expect(calls).toBe(2);
    expect(
      f.output.find((x) => x.kind === "event" && x.event.type === "turn.completed"),
    ).toMatchObject({ event: { outcome: { status: "succeeded" } } });
  });

  it("fails retryable without faulting the Session when the closed stream already persisted", async () => {
    const f = session();
    f.transport.action = async (text, callbacks) => {
      callbacks.update({
        sessionId: f.transport.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "\n\nError: RetriableError: WritableIterable is closed" },
        },
      });
      native.turns.push({ id: randomUUID(), text });
      return { stopReason: "end_turn" };
    };
    await f.session.execute(start);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    await f.session.close();
    await f.done;
    expect(
      f.output.find((x) => x.kind === "event" && x.event.type === "turn.completed"),
    ).toMatchObject({
      event: {
        outcome: {
          status: "failed",
          error: { code: "nativeFailure", retryable: true },
        },
      },
    });
    expect(f.output.some((x) => x.kind === "event" && x.event.type === "session.faulted")).toBe(
      false,
    );
  });

  it("reports process failure without a guessed native turn ID", async () => {
    const f = session();
    f.transport.action = async () => {
      throw new Error("Cursor ACP process exited");
    };
    await f.session.execute(start);
    await vi.waitFor(() =>
      expect(f.output.some((x) => x.kind === "event" && x.event.type === "turn.completed")).toBe(
        true,
      ),
    );
    await f.session.close();
    await f.done;
    const terminal = f.output.find((x) => x.kind === "event" && x.event.type === "turn.completed");
    expect(terminal).toMatchObject({
      event: { outcome: { status: "failed", error: { code: "processExited" } } },
    });
    expect(terminal && "event" in terminal && "nativeTurnRef" in terminal.event).toBe(false);
  });
});

describe("Cursor interactions", () => {
  it("binds permissions to the exact interaction and rejects unknown or repeated decisions", async () => {
    const outputs: HarnessOutput[] = [];
    const interactions = new CursorInteractions((x) => outputs.push(x));
    const waiting = interactions.permission(turnId, {
      sessionId: info.sessionId,
      toolCall: { toolCallId: "p", title: "shell" },
      options: [{ kind: "reject_once", optionId: "reject-once", name: "Reject" }],
    });
    const first = outputs[0];
    if (first?.kind !== "interaction") throw new Error("missing interaction");
    expect(
      interactions.respond({
        type: "interaction.respond",
        interactionId: hostInteractionIdSchema.parse("wrong"),
        response: { type: "approval", actionId: "reject-once" },
      }).ok,
    ).toBe(false);
    const command = {
      type: "interaction.respond" as const,
      interactionId: first.interaction.interactionId,
      response: { type: "approval" as const, actionId: "reject-once" },
    };
    expect(interactions.respond(command).ok).toBe(true);
    expect(interactions.respond(command).ok).toBe(false);
    expect(await waiting).toEqual({ outcome: { outcome: "selected", optionId: "reject-once" } });
  });
  it("requires an explicit response for plans and questions, and cancels both on close", async () => {
    const outputs: HarnessOutput[] = [];
    const interactions = new CursorInteractions((x) => outputs.push(x));
    const plan = interactions.extension(turnId, "cursor/create_plan", { plan: "Do a thing" });
    const question = interactions.extension(turnId, "cursor/ask_question", {
      questions: [{ id: "q", prompt: "Which?", options: [{ id: "a", label: "A" }] }],
    });
    expect(outputs.filter((x) => x.kind === "interaction")).toHaveLength(2);
    interactions.cancel();
    expect(await plan).toEqual({ outcome: { outcome: "cancelled" } });
    expect(await question).toEqual({ outcome: { outcome: "cancelled" } });
  });
});

describe("Cursor replay identity", () => {
  const identity = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", text: "hello" };
  const replay = [
    {
      sessionId: info.sessionId,
      update: {
        sessionUpdate: "user_message_chunk" as const,
        content: { type: "text" as const, text: "hello" },
      },
    },
    {
      sessionId: info.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        content: { type: "text" as const, text: "ok" },
      },
    },
  ];
  it("uses native identity and preserves unknown historical outcome", () => {
    const snapshot = cursorSnapshot(info.sessionId, [identity], replay);
    expect(snapshot.turns[0]).toMatchObject({
      nativeTurnRef: { nativeTurnKey: identity.id },
      outcome: { status: "unknown" },
    });
  });
  it("fails closed on count, prompt and session mismatch", () => {
    expect(() => cursorSnapshot(info.sessionId, [], replay)).toThrow();
    expect(() =>
      cursorSnapshot(info.sessionId, [{ ...identity, text: "other" }], replay),
    ).toThrow();
    expect(() => cursorSnapshot("other", [identity], replay)).toThrow();
  });
});

describe("Cursor native commands and unattended policy", () => {
  it("rejects unattended full access because Cursor cannot confirm native policy", async () => {
    const adapter = new CursorAdapter();
    try {
      const result = await adapter.open({
        kind: "create",
        cwd: process.cwd(),
        executionPolicy: "unattended-full-access",
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected unattended create to fail");
      expect(result.error.message).toMatch(/unattended full access/i);
    } finally {
      await adapter.close();
    }
  });
});
