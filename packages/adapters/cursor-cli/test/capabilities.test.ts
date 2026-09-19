import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessThinkingOptionIdSchema, hostTurnIdSchema } from "@codexhost/shared-contracts";
import type { HarnessOutput } from "@codexhost/harness-adapter";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { CursorAdapter, CursorSession } from "../src/adapter.js";
import { CursorTransport, type CursorSessionInfo } from "../src/transport.js";
import { cursorCatalog, cursorModelRef } from "../src/models.js";
import { cursorCommands, cursorCommandPrompt } from "../src/slash-commands.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}

const history = vi.hoisted(() => ({ turns: [] as Array<{ id: string; text: string }> }));
vi.mock("../src/native-history.js", () => ({
  readCursorNativeTurns: () => structuredClone(history.turns),
  readCursorNativeHistory: () => ({
    revision: JSON.stringify(history.turns),
    turns: structuredClone(history.turns),
  }),
}));
const select = (
  id: string,
  currentValue: string,
  values: string[],
  category = "thought_level",
): SessionConfigOption & { type: "select" } => ({
  id,
  name: id,
  type: "select",
  currentValue,
  category,
  options: values.map((value) => ({ value, name: value })),
});
const model = select("model", "alpha", ["alpha", "auto"], "model");
const thinking = select("thinking", "true", ["false", "true"]);
const effort = select("effort", "high", ["low", "high"]);
const context = select("context", "200k", ["200k", "1m"], "model_config");
const info: CursorSessionInfo = {
  sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  configOptions: [model, thinking, effort, context],
  nativeModels: [
    { value: "alpha", name: "Alpha", configOptions: [thinking, effort, context] },
    { value: "auto", name: "Auto", configOptions: [] },
  ],
};
const turnId = hostTurnIdSchema.parse("commands-test");
function setup() {
  const transport = new CursorTransport({ cwd: process.cwd(), environment: {} });
  transport.sessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  let options = structuredClone(info.configOptions ?? []);
  vi.spyOn(transport, "configure").mockImplementation(async (id, value) => {
    if (id === "model" && value === "auto")
      options = [select("model", "auto", ["alpha", "auto"], "model")];
    else
      options = options.map((option) =>
        option.id === id ? ({ ...option, currentValue: value } as SessionConfigOption) : option,
      );
    return { configOptions: structuredClone(options) };
  });
  vi.spyOn(transport, "close").mockResolvedValue();
  const session = new CursorSession(transport, info, () => {});
  const outputs: HarnessOutput[] = [];
  const done = (async () => {
    for await (const output of session.outputs) outputs.push(output);
  })();
  return { transport, session, outputs, done };
}
afterEach(() => {
  vi.restoreAllMocks();
  history.turns = [];
});

describe("Cursor parameterized ACP configuration", () => {
  it("exposes Fast, Thinking, Effort and Context as native configuration controls", () => {
    const catalog = cursorCatalog(info);
    expect(catalog.thinkingOptions).toEqual([]);
    expect(catalog.configurationOptions?.map((option) => option.id)).toEqual([
      "thinking",
      "effort",
      "context",
    ]);
    expect(catalog.models[0]?.label).toBe("alpha");
  });
  it("applies a saved Model Ref parameter without using Thinking.select", async () => {
    const f = setup();
    await f.session.execute({ type: "model.select", model: cursorModelRef("alpha[context=1m]") });
    const saved = structuredClone(f.session.initialState);
    await f.session.close();
    await f.done;
    vi.spyOn(CursorTransport.prototype, "open").mockImplementation(async function (
      this: CursorTransport,
    ) {
      this.sessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      return structuredClone(info);
    });
    vi.spyOn(CursorTransport.prototype, "close").mockResolvedValue();
    let config = structuredClone(info.configOptions ?? []);
    const configure = vi
      .spyOn(CursorTransport.prototype, "configure")
      .mockImplementation(async (id, value) => {
        config = config.map((entry) =>
          entry.id === id ? ({ ...entry, currentValue: value } as SessionConfigOption) : entry,
        );
        return { configOptions: structuredClone(config) };
      });
    const adapter = new CursorAdapter();
    try {
      const resumed = await adapter.open({
        kind: "resume",
        cwd: process.cwd(),
        nativeRef: required(saved.nativeRef),
        model: required(saved.effectiveModel),
      });
      if (!resumed.ok) throw Error(resumed.error.message);
      expect(configure).toHaveBeenCalledWith("context", "1m");
    } finally {
      await adapter.close();
    }
  });
  it("rejects Thinking.select in favor of native model configuration controls", async () => {
    const f = setup();
    try {
      expect(
        await f.session.execute({
          type: "thinking.select",
          thinkingOptionId: harnessThinkingOptionIdSchema.parse("high"),
        }),
      ).toMatchObject({ ok: false, error: { code: "unsupported" } });
    } finally {
      await f.session.close();
      await f.done;
    }
  });
});

describe("Cursor advertised slash commands", () => {
  const native = [
    { name: "review", description: "Review changes" },
    { name: "copy-request-id", description: "Copy request ID" },
  ];
  it("honors explicit native command input while retaining legacy custom arguments", () => {
    const catalog = cursorCommands([
      ...native,
      { name: "status", description: "Native local status", input: null },
      { name: "search", description: "Search", input: { hint: "query" } },
    ]);
    expect(catalog.commands.map(({ id, argumentMode }) => [id, argumentMode])).toEqual([
      ["cursor.review", "text"],
      ["cursor.copy-request-id", "none"],
      ["cursor.status", "none"],
      ["cursor.search", "text"],
    ]);
    expect(
      cursorCommandPrompt(
        { turnId, commandId: "cursor.status", arguments: { text: "x" } },
        catalog,
      ),
    ).toMatchObject({ error: { code: "invalidRequest" } });
  });
  it("rejects unadvertised commands and invalid arguments", () => {
    const catalog = cursorCommands(native);
    expect(cursorCommandPrompt({ turnId, commandId: "cursor.compact" }, catalog)).toMatchObject({
      error: { code: "unsupported" },
    });
    expect(
      cursorCommandPrompt(
        { turnId, commandId: "cursor.review", arguments: { unexpected: true } },
        catalog,
      ),
    ).toMatchObject({ error: { code: "invalidRequest" } });
    expect(
      cursorCommandPrompt(
        { turnId, commandId: "cursor.copy-request-id", arguments: { text: "x" } },
        catalog,
      ),
    ).toMatchObject({ ok: false });
    expect(
      cursorCommandPrompt(
        { turnId, commandId: "cursor.review", arguments: { text: "latest changes" } },
        catalog,
      ),
    ).toEqual({ ok: true, value: "/review latest changes" });
  });
  it.each(["review", "copy-request-id"])("uses native history semantics for %s", async (name) => {
    const f = setup();
    f.transport.availableCommands = native;
    const prompt = vi.spyOn(f.transport, "prompt").mockImplementation(async (text, callbacks) => {
      callbacks.update({
        sessionId: f.transport.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "native output" },
        },
      });
      if (name === "review") history.turns.push({ id: "native-command-turn", text });
      return { stopReason: "end_turn" };
    });
    try {
      expect(
        await f.session.commands.execute({ turnId, commandId: `cursor.${name}` }),
      ).toMatchObject({ ok: true });
      await vi.waitFor(() =>
        expect(
          f.outputs.some(
            (output) => output.kind === "event" && output.event.type === "turn.completed",
          ),
        ).toBe(true),
      );
      const terminal = f.outputs.find(
        (output) => output.kind === "event" && output.event.type === "turn.completed",
      );
      expect(terminal).toMatchObject({ event: { outcome: { status: "succeeded" } } });
      if (name === "copy-request-id")
        expect(terminal).not.toMatchObject({ event: { nativeTurnRef: expect.anything() } });
      else
        expect(terminal).toMatchObject({
          event: { nativeTurnRef: { nativeTurnKey: "native-command-turn" } },
        });
      expect(prompt).toHaveBeenCalledWith(`/${name}`, expect.anything());
      expect(
        await f.session.commands.execute({ turnId, commandId: `cursor.${name}` }),
      ).toMatchObject({ error: { code: "invalidState" } });
    } finally {
      await f.session.close();
      await f.done;
    }
    expect(await f.session.commands.list()).toMatchObject({ error: { code: "invalidState" } });
  });
  it("keeps full-access delegation unsupported without native policy confirmation", async () => {
    const adapter = new CursorAdapter();
    const open = vi.spyOn(CursorTransport.prototype, "open");
    expect(
      await adapter.open({
        kind: "create",
        cwd: process.cwd(),
        executionPolicy: "unattended-full-access",
      }),
    ).toMatchObject({ error: { code: "unsupported" } });
    expect(open).not.toHaveBeenCalled();
    await adapter.close();
  });
});
