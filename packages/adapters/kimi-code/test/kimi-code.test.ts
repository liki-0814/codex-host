import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  configuredModelRef,
  hostTurnIdSchema,
  harnessPermissionModeIdSchema,
} from "@codexhost/shared-contracts";
import {
  alias,
  modelCatalog,
  modelRef,
  selection,
  permissionProfile,
  nativeModelsSchema,
} from "../src/models.js";
import { projectTurn, turnSchema } from "../src/projection.js";
import { KimiServer, isSupportedKimiServer } from "../src/server.js";
import { KimiSession } from "../src/session.js";
import { readFileChanges } from "../src/file-history.js";
import type { HarnessOutput } from "@codexhost/harness-adapter";

const models = nativeModelsSchema.parse({
  items: [
    {
      provider: "managed:kimi-code",
      model: "kimi-code/k3",
      display_name: "K3",
      max_context_size: 1048576,
      support_efforts: ["low", "high"],
      default_effort: "high",
    },
    { provider: "managed:kimi-code", model: "kimi-code/highspeed", max_context_size: 262144 },
  ],
}).items;
const status = {
  busy: false,
  model: "kimi-code/k3",
  thinking_level: "low",
  permission: "manual" as const,
  plan_mode: false,
  context_tokens: 20,
  max_context_tokens: 1048576,
};
const nativeTurn = (state = "completed", text = "hello") =>
  turnSchema.parse({
    kind: "turn",
    turnId: "t0",
    triggerPromptId: "p0",
    state,
    prompt: "hi",
    steps: [{ state: "completed", frames: [{ kind: "text", frameId: "t0.1.f1", text }] }],
  });
afterEach(() => vi.restoreAllMocks());

describe("Kimi native file history", () => {
  it("builds a diff from native turn checkpoints, including deleted content", async () => {
    const server = new KimiServer({});
    vi.spyOn(server, "request").mockImplementation(async <T>(path: string, schema: z.ZodType<T>) =>
      schema.parse(
        path.includes("/changes?")
          ? { recorded: true, changes: [{ path: "a.txt", status: "deleted" }] }
          : path.includes("phase=start")
            ? { content: { version: 1, content: "old\n" } }
            : { content: null },
      ),
    );
    const result = await readFileChanges(server, "s", "t4");
    expect(result).toMatchObject([
      {
        item: {
          type: "fileChange",
          itemId: "t4.files",
          changes: [{ path: "a.txt", kind: "delete", oldText: "old\n", newText: "" }],
        },
      },
    ]);
    expect(JSON.stringify(result)).toContain("-old");
  });
  it("does not fabricate a diff for unrecorded or binary changes", async () => {
    const server = new KimiServer({});
    const request = vi
      .spyOn(server, "request")
      .mockImplementation(async <T>(_path: string, schema: z.ZodType<T>) =>
        schema.parse({
          recorded: true,
          changes: [{ path: "a.bin", status: "added", binary: true }],
        }),
      );
    expect(await readFileChanges(server, "s", "t0")).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("Kimi native configuration", () => {
  it("uses the native alias without duplicating the provider namespace", () => {
    expect(alias(models.at(0) as (typeof models)[number])).toBe("kimi-code/k3");
    const catalog = modelCatalog(models, "kimi-code/k3", "low");
    expect(selection(catalog.defaultModel ?? modelRef("missing"), models)).toEqual({
      model: "kimi-code/k3",
      thinking: "low",
    });
    expect(catalog.models.at(1)?.configurationOptions).toEqual([]);
  });
  it("rejects invented effort and parameters instead of silently applying them", () => {
    expect(() =>
      selection(configuredModelRef(modelRef("kimi-code/k3"), { effort: "max" }), models),
    ).toThrow();
    expect(() =>
      selection(configuredModelRef(modelRef("kimi-code/highspeed"), { fast: "true" }), models),
    ).toThrow();
    expect(() => selection(modelRef("missing"), models)).toThrow();
  });
  it("keeps Plan independent of the native approval policy", () => {
    expect(permissionProfile("plan.auto")).toEqual({ plan_mode: true, permission_mode: "auto" });
    expect(permissionProfile("agent.yolo")).toEqual({ plan_mode: false, permission_mode: "yolo" });
    expect(() => permissionProfile("allow")).toThrow();
  });
});

describe("Kimi transcript", () => {
  it("preserves stable identities and distinguishes incomplete and cancelled turns", () => {
    expect(projectTurn("s", nativeTurn()).nativeTurnRef.nativeTurnKey).toBe("t0");
    expect(projectTurn("s", nativeTurn("running")).outcome.status).toBe("unknown");
    expect(projectTurn("s", nativeTurn("cancelled")).outcome.status).toBe("cancelled");
    expect(projectTurn("s", nativeTurn())).toEqual(projectTurn("s", nativeTurn()));
  });
  it("keeps a failed tool separate from a successful overall turn", () => {
    const turn = nativeTurn();
    turn.steps.at(0)?.frames.push({
      kind: "tool",
      frameId: "tool",
      name: "Read",
      state: "failed",
      input: { path: "missing" },
      output: "not found",
    });
    const projected = projectTurn("s", turn);
    expect(projected.outcome.status).toBe("succeeded");
    expect(projected.items.at(1)?.outcome.status).toBe("failed");
  });
});

function fixture() {
  const server = new KimiServer({});
  let turn: ReturnType<typeof nativeTurn> | undefined;
  let failPrompt = false;
  const calls: string[] = [];
  vi.spyOn(server, "close").mockResolvedValue();
  vi.spyOn(KimiSession.prototype, "start").mockResolvedValue();
  vi.spyOn(server, "request").mockImplementation(
    async <T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> => {
      calls.push(path);
      let result: unknown = {};
      if (path.includes("/file-history/changes")) result = { recorded: true, changes: [] };
      else if (path.endsWith("/status")) result = status;
      else if (path.includes("/transcript"))
        result = { items: turn ? [turn] : [], has_more: false };
      else if (path.includes("?status=pending")) result = { items: [] };
      else if (path.endsWith("/prompts") && body) {
        if (failPrompt) throw new Error("HTTP request failed");
        const prompt = z.object({ prompt_id: z.string() }).parse(body);
        turn = { ...nativeTurn("running", "hel"), triggerPromptId: prompt.prompt_id };
        result = prompt;
      } else if (path.endsWith("/prompts")) result = { active: null, queued: [] };
      return schema.parse(result);
    },
  );
  const session = new KimiSession(server, "s", models, status, () => undefined);
  const outputs: HarnessOutput[] = [];
  const collected = (async () => {
    for await (const value of session.outputs) outputs.push(value);
  })();
  return {
    session,
    outputs,
    calls,
    collected,
    complete: () => {
      turn = {
        ...nativeTurn(),
        ...turn,
        state: "completed",
        steps: nativeTurn("completed", "hello").steps,
      };
    },
    fail: () => {
      failPrompt = true;
    },
  };
}
describe("Kimi Session lifecycle", () => {
  it("rejects a second turn, streams append-only text, and emits one terminal event", async () => {
    const f = fixture();
    const id = hostTurnIdSchema.parse("host1");
    expect(
      (
        await f.session.execute({
          type: "turn.start",
          turnId: id,
          input: [{ type: "text", text: "hi" }],
        })
      ).ok,
    ).toBe(true);
    expect((await f.session.execute({ type: "turn.start", turnId: id, input: [] })).ok).toBe(false);
    await f.session.poll();
    f.complete();
    await f.session.poll();
    await f.session.poll();
    await f.session.close();
    await f.collected;
    const events = f.outputs.flatMap((o) => (o.kind === "event" ? [o.event] : []));
    expect(events.filter((e) => e.type === "turn.started")).toHaveLength(1);
    expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    expect(events.find((e) => e.type === "item.updated")).toMatchObject({
      update: { type: "text.append", text: "lo" },
    });
    expect(events.find((e) => e.type === "item.completed")).toMatchObject({
      snapshot: { item: { text: "hello" } },
    });
  });
  it("does not emit a lifecycle for a rejected prompt", async () => {
    const f = fixture();
    f.fail();
    expect(
      (
        await f.session.execute({
          type: "turn.start",
          turnId: hostTurnIdSchema.parse("bad"),
          input: [],
        })
      ).ok,
    ).toBe(false);
    await f.session.close();
    await f.collected;
    expect(f.outputs).toEqual([]);
  });
  it("does not send a prompt when only changing configuration", async () => {
    const f = fixture();
    await f.session.execute({
      type: "permissionMode.select",
      permissionModeId: harnessPermissionModeIdSchema.parse("plan.auto"),
    });
    expect(f.calls.some((p) => p.endsWith("/profile"))).toBe(true);
    expect(f.calls.some((p) => p.endsWith("/prompts"))).toBe(false);
    await f.session.close();
    await f.collected;
  });
});

describe("Kimi Server protocol gate", () => {
  it("accepts the generation the Adapter speaks, reported by the server itself", () => {
    expect(isSupportedKimiServer({ server_version: "0.43.1", backend: "v2" })).toBe(true);
    expect(isSupportedKimiServer({ server_version: "0.44.0", backend: "v2" })).toBe(true);
  });

  it("still accepts builds from before the backend marker existed", () => {
    expect(isSupportedKimiServer({ server_version: "0.42.7" })).toBe(true);
    expect(isSupportedKimiServer({ server_version: "0.43.1" })).toBe(true);
  });

  it("refuses a server that reports neither a known version nor the generation", () => {
    expect(isSupportedKimiServer({ server_version: "0.41.0" })).toBe(false);
    expect(isSupportedKimiServer({ server_version: "1.2.3" })).toBe(false);
    expect(isSupportedKimiServer({ server_version: "0.44.0", backend: "v1" })).toBe(false);
  });
});
