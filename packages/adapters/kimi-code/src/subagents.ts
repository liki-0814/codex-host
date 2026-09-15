import { z } from "zod";
import type { HostSubagentState } from "@codexhost/harness-adapter";
export const childEventSchema = z.object({
  subagentId: z.string(),
  parentToolCallId: z.string().optional(),
  description: z.string().optional(),
  subagentName: z.string().optional(),
  model: z.string().optional(),
  thinkingEffort: z.string().optional(),
  runInBackground: z.boolean().optional(),
  resultSummary: z.string().optional(),
});
export type ChildRecord = { toolCallId?: string; state: HostSubagentState };
export function childRecord(
  type: string,
  value: unknown,
  previous?: ChildRecord,
): ChildRecord | undefined {
  const result = childEventSchema.safeParse(value);
  if (!result.success) return undefined;
  const child = result.data;
  const status: HostSubagentState["status"] = type.endsWith(".completed")
    ? "completed"
    : type.endsWith(".failed")
      ? "failed"
      : type.endsWith(".suspended")
        ? "interrupted"
        : "running";
  return {
    ...(previous?.toolCallId || child.parentToolCallId
      ? { toolCallId: child.parentToolCallId ?? previous?.toolCallId ?? "" }
      : {}),
    state: {
      ...previous?.state,
      subagentId: child.subagentId,
      nativeSubagentId: child.subagentId,
      description: child.description ?? previous?.state.description ?? child.subagentId,
      background: child.runInBackground ?? previous?.state.background ?? false,
      status,
      ...(child.model ? { model: child.model } : {}),
      ...(child.thinkingEffort ? { reasoningEffort: child.thinkingEffort } : {}),
      ...(child.subagentName ? { role: child.subagentName } : {}),
      ...(child.resultSummary ? { resultSummary: child.resultSummary } : {}),
    },
  };
}
