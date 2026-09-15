import { z } from "zod";
import {
  hostItemIdSchema,
  nativeTurnRefSchema,
  nativeSessionRefSchema,
  nativeCheckpointRefSchema,
  jsonValueSchema,
} from "@codexhost/shared-contracts";
import {
  parseHostUsage,
  type HostItem,
  type HostItemSnapshot,
  type HostTurnSnapshot,
} from "@codexhost/harness-adapter";
import { kimiId } from "./models.js";
import type { ChildRecord } from "./subagents.js";

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  metadata: z.object({ cwd: z.string() }),
  updated_at: z.string(),
  busy: z.boolean().optional(),
  archived: z.boolean().optional(),
  agent_config: z
    .object({
      model: z.string().optional(),
      thinking: z.string().optional(),
      permission_mode: z.string().optional(),
      plan_mode: z.boolean().optional(),
    })
    .optional(),
});
export const statusSchema = z.object({
  busy: z.boolean(),
  model: z.string().optional(),
  thinking_level: z.string(),
  permission: z.enum(["manual", "yolo", "auto"]),
  plan_mode: z.boolean(),
  context_tokens: z.number().nonnegative(),
  max_context_tokens: z.number().positive(),
});
const frameSchema = z.object({
  kind: z.string(),
  frameId: z.string(),
  text: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  state: z.string().optional(),
  input: jsonValueSchema.optional(),
  output: jsonValueSchema.optional(),
  toolCallId: z.string().optional(),
  error: z.unknown().optional(),
});
export const turnSchema = z.object({
  kind: z.literal("turn"),
  turnId: z.string(),
  triggerPromptId: z.string().optional(),
  state: z.string(),
  prompt: z.string().default(""),
  endedAt: z.string().optional(),
  startedAt: z.string().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  steps: z.array(z.object({ state: z.string(), frames: z.array(frameSchema) })),
});
export type NativeTurn = z.infer<typeof turnSchema>;
export const transcriptSchema = z.object({
  items: z.array(z.unknown()),
  has_more: z.boolean(),
  seq: z.number().optional(),
});
export const nativeRef = (id: string) =>
  nativeSessionRefSchema.parse({ harnessId: kimiId, nativeSessionId: id, formatVersion: 1 });
export const turnRef = (id: string, turn: string) =>
  nativeTurnRefSchema.parse({ ...nativeRef(id), nativeTurnKey: turn });
export function frames(
  turn: NativeTurn,
  children: readonly ChildRecord[] = [],
): HostItemSnapshot[] {
  return turn.steps.flatMap((step) =>
    step.frames.flatMap((frame): HostItemSnapshot[] => {
      const itemId = hostItemIdSchema.parse(frame.frameId);
      let item: HostItem;
      if (frame.kind === "text" && frame.role && frame.role !== "assistant") return [];
      if (frame.kind === "thinking" || frame.kind === "text")
        item = {
          type: frame.kind === "thinking" ? "reasoning" : "agentMessage",
          itemId,
          text: frame.text ?? "",
        };
      else if (frame.kind === "tool") {
        if (!frame.name) return [];
        const input = frame.input;
        const command =
          input && typeof input === "object" && !Array.isArray(input) ? input.command : undefined;
        if ((frame.name === "Bash" || frame.name === "Shell") && typeof command !== "string")
          return [];
        const output =
          typeof frame.output === "string"
            ? frame.output
            : frame.output === undefined
              ? ""
              : JSON.stringify(frame.output);
        const args = input && typeof input === "object" && !Array.isArray(input) ? input : {};
        const childId = /^agent_id: ([A-Za-z0-9._-]+)$/mu.exec(output)?.[1];
        item =
          frame.name === "Agent"
            ? {
                type: "subagentDelegation",
                itemId,
                operation: typeof args.resume === "string" ? "send" : "spawn",
                ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}),
                subagents: children.some((c) => c.toolCallId === frame.toolCallId)
                  ? children.filter((c) => c.toolCallId === frame.toolCallId).map((c) => c.state)
                  : childId
                    ? [
                        {
                          subagentId: childId,
                          nativeSubagentId: childId,
                          description:
                            typeof args.description === "string" ? args.description : childId,
                          background: args.run_in_background === true,
                          status: /^status: completed$/mu.test(output)
                            ? "completed"
                            : /^status: failed$/mu.test(output)
                              ? "failed"
                              : "running",
                        },
                      ]
                    : [],
              }
            : (frame.name === "Bash" || frame.name === "Shell") && typeof command === "string"
              ? {
                  type: "commandExecution",
                  itemId,
                  command,
                  output: output.slice(0, 256_000),
                  outputTruncated: output.length > 256_000,
                }
              : {
                  type: "toolExecution",
                  itemId,
                  toolName: frame.name ?? "Tool",
                  arguments: input ?? {},
                  output: {
                    content: [{ type: "text", text: output.slice(0, 256_000) }],
                    truncated: output.length > 256_000,
                  },
                };
      } else return [];
      return [
        {
          item,
          outcome:
            frame.state === "error" || frame.state === "failed" || frame.error
              ? {
                  status: "failed",
                  error: { code: "nativeFailure", message: "Kimi tool failed", retryable: false },
                }
              : ["cancelled", "interrupted", "aborted"].includes(frame.state ?? "") ||
                  ["cancelled", "interrupted"].includes(turn.state)
                ? { status: "cancelled" }
                : { status: "succeeded" },
        },
      ];
    }),
  );
}
export function projectTurn(id: string, turn: NativeTurn): HostTurnSnapshot {
  const outcome: HostTurnSnapshot["outcome"] =
    turn.state === "completed"
      ? { status: "succeeded" }
      : turn.state === "failed"
        ? {
            status: "failed",
            error: {
              code: "nativeFailure",
              message: turn.error ?? "Kimi turn failed",
              retryable: false,
            },
          }
        : turn.state === "interrupted" || turn.state === "cancelled"
          ? { status: "cancelled" }
          : { status: "unknown", reason: `Native turn state: ${turn.state}` };
  return {
    nativeTurnRef: turnRef(id, turn.turnId),
    checkpoint: nativeCheckpointRefSchema.parse({ ...nativeRef(id), checkpointId: turn.turnId }),
    input: [{ type: "text", text: turn.prompt }],
    items: frames(turn),
    outcome,
    ...(turn.endedAt ? { completedAtMs: Date.parse(turn.endedAt) } : {}),
    ...(turn.startedAt
      ? { startedAtMs: Date.parse(turn.startedAt) }
      : turn.endedAt && turn.durationMs !== undefined
        ? { startedAtMs: Date.parse(turn.endedAt) - turn.durationMs }
        : {}),
  };
}
export function statusUsage(status: z.infer<typeof statusSchema>) {
  return parseHostUsage({
    contextUsedTokens: status.context_tokens,
    contextWindowTokens: status.max_context_tokens,
    contextUsagePercent: (100 * status.context_tokens) / status.max_context_tokens,
  });
}
