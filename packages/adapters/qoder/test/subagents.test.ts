import { expect, it } from "vitest";
import { hostTurnIdSchema } from "@codexhost/shared-contracts";
import type { HostEvent } from "@codexhost/harness-adapter";
import { QoderSubagentObserver } from "../src/qoder-subagents.js";
import { mapQoderSnapshot, mapQoderSubagentSnapshot } from "../src/qoder-history.js";
import type { SessionMessage } from "../src/qoder-sdk-types.js";
it("preserves native child identities and interrupts children without observed completion", () => {
  const events: HostEvent[] = [];
  const observer = new QoderSubagentObserver((e) => events.push(e));
  const turn = hostTurnIdSchema.parse("turn");
  observer.start("aExplore-native", "Explore", turn);
  observer.start("aExplore-native", "Explore", turn);
  observer.endTurn(turn);
  expect(events).toHaveLength(3);
  expect(events[0]).toMatchObject({
    item: { subagents: [{ nativeSubagentId: "aExplore-native", status: "running" }] },
  });
  expect(events[2]).toMatchObject({
    snapshot: {
      item: { subagents: [{ status: "interrupted" }] },
      outcome: { status: "cancelled" },
    },
  });
});
it("replays native agent-result identity as a browsable child", () => {
  const base = { session_id: "parent", parent_tool_use_id: null, parent_agent_id: null };
  const messages: SessionMessage[] = [
    { ...base, type: "user", uuid: "u", message: { role: "user", content: "Delegate" } },
    {
      ...base,
      type: "assistant",
      uuid: "a",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "call", name: "Agent", input: {} }],
      },
    },
    {
      ...base,
      type: "user",
      uuid: "r",
      tool_use_result: {
        kind: "agent-result",
        agentId: "aExplore-native",
        agentType: "Explore",
        state: "completed",
      },
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call", content: "Done" }],
      },
    },
  ];
  expect(mapQoderSnapshot(messages, "parent").turns[0]?.items[0]).toMatchObject({
    item: {
      type: "subagentDelegation",
      subagents: [
        { nativeSubagentId: "aExplore-native", status: "completed", resultSummary: "Done" },
      ],
    },
  });
});

it("projects child input without mistaking its parent tool link for an internal tool result", () => {
  const messages: SessionMessage[] = [
    {
      type: "user",
      uuid: "native-child-input",
      session_id: "parent",
      parent_tool_use_id: "native-parent-tool",
      parent_agent_id: null,
      message: { role: "user", content: "Child task" },
    },
    {
      type: "assistant",
      uuid: "native-child-answer",
      session_id: "parent",
      parent_tool_use_id: "native-parent-tool",
      parent_agent_id: null,
      message: { role: "assistant", content: [{ type: "text", text: "Child answer" }] },
    },
  ];
  expect(mapQoderSnapshot(messages, "parent").turns).toHaveLength(0);
  const child = mapQoderSubagentSnapshot(messages, "parent");
  expect(child.turns).toHaveLength(1);
  expect(child.turns[0]?.nativeTurnRef.nativeTurnKey).toBe("native-child-input");
  expect(child.turns[0]?.items[0]?.item).toMatchObject({ text: "Child answer" });
  expect(messages[0]?.parent_tool_use_id).toBe("native-parent-tool");
});
