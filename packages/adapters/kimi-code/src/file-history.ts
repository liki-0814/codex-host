import { z } from "zod";
import { createTwoFilesPatch } from "diff";
import { hostItemIdSchema } from "@codexhost/shared-contracts";
import type { HostFileChange, HostItemSnapshot } from "@codexhost/harness-adapter";
import type { KimiServer } from "./server.js";

const changesSchema = z.object({
  recorded: z.boolean(),
  changes: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["added", "modified", "deleted"]),
      binary: z.boolean().optional(),
      oversize: z.boolean().optional(),
    }),
  ),
});
const contentSchema = z.object({
  content: z
    .object({ version: z.number(), content: z.string().optional(), binary: z.boolean().optional() })
    .nullable(),
});

/** Read native turn checkpoints, never the current working tree or guessed tool edits. */
export async function readFileChanges(
  server: KimiServer,
  sessionId: string,
  turnId: string,
): Promise<HostItemSnapshot[]> {
  const number = /^t(\d+)$/u.exec(turnId)?.[1];
  if (!number) return [];
  const path = `/sessions/${encodeURIComponent(sessionId)}/file-history`;
  const recorded = await server.request(`${path}/changes?turn_id=${number}`, changesSchema);
  if (!recorded.recorded || !recorded.changes.length) return [];
  const changes: HostFileChange[] = [];
  for (const change of recorded.changes) {
    if (change.binary || change.oversize) continue;
    const query = `turn_id=${number}&path=${encodeURIComponent(change.path)}`;
    const [before, after] = await Promise.all([
      server.request(`${path}/content?${query}&phase=start`, contentSchema),
      server.request(`${path}/content?${query}&phase=end`, contentSchema),
    ]);
    if (before.content?.binary || after.content?.binary) continue;
    const oldText = before.content?.content ?? (change.status === "added" ? "" : undefined);
    const newText = after.content?.content ?? (change.status === "deleted" ? "" : undefined);
    if (oldText === undefined || newText === undefined) continue;
    changes.push({
      path: change.path,
      kind: change.status === "added" ? "add" : change.status === "deleted" ? "delete" : "update",
      unifiedDiff: createTwoFilesPatch(change.path, change.path, oldText, newText),
      oldText,
      newText,
    });
  }
  return changes.length
    ? [
        {
          item: { type: "fileChange", itemId: hostItemIdSchema.parse(`${turnId}.files`), changes },
          outcome: { status: "succeeded" },
        },
      ]
    : [];
}
