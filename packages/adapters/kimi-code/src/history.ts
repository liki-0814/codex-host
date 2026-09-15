import { z } from "zod";
import type { OpenSessionInput } from "@codexhost/harness-adapter";
import type { KimiServer } from "./server.js";
import { KimiError } from "./server.js";
import {
  nativeRef,
  sessionSchema,
  statusSchema,
  transcriptSchema,
  turnSchema,
  type NativeTurn,
} from "./projection.js";

export async function readTurns(
  server: KimiServer,
  id: string,
  agent = "main",
): Promise<NativeTurn[]> {
  let before = "";
  const turns: NativeTurn[] = [];
  const cursors = new Set<string>();
  for (;;) {
    const page = await server.request(
      `/sessions/${encodeURIComponent(id)}/transcript?agent_id=${encodeURIComponent(agent)}&page_size=100${before ? `&before_turn=${encodeURIComponent(before)}` : ""}`,
      transcriptSchema,
    );
    const items = page.items.flatMap((item) => {
      if (typeof item !== "object" || !item || !("kind" in item) || item.kind !== "turn") return [];
      return [turnSchema.parse(item)];
    });
    turns.unshift(...items);
    if (!page.has_more) return turns;
    const next = items[0]?.turnId;
    if (!next || cursors.has(next))
      throw new KimiError("protocolError", "Kimi transcript pagination did not advance");
    cursors.add(next);
    before = next;
  }
}

/** Derive first, then rewind the copy. The Host still owns the source until its transaction commits. */
export async function deriveSession(
  server: KimiServer,
  input: Extract<OpenSessionInput, { kind: "fork" | "rollbackLastTurn" }>,
) {
  const source = input.sourceRef;
  if (source.harnessId !== nativeRef(source.nativeSessionId).harnessId)
    throw new KimiError("invalidRequest", "Invalid Kimi source");
  const path = `/sessions/${encodeURIComponent(source.nativeSessionId)}`;
  const [turns, status] = await Promise.all([
    readTurns(server, source.nativeSessionId),
    server.request(`${path}/status`, statusSchema),
  ]);
  if (status.busy) throw new KimiError("sessionBusy", "Kimi source is busy");
  let keep = turns.length - 1;
  if (input.kind === "fork") {
    if (
      input.checkpoint.harnessId !== source.harnessId ||
      input.checkpoint.nativeSessionId !== source.nativeSessionId
    )
      throw new KimiError("invalidRequest", "Checkpoint does not belong to the source");
    keep = turns.findIndex((t) => t.turnId === input.checkpoint.checkpointId) + 1;
    if (!keep) throw new KimiError("checkpointNotFound", "Kimi checkpoint no longer exists");
  }
  if (keep < 0) throw new KimiError("invalidState", "Kimi history is empty");
  const derived = await server.request(`${path}:fork`, sessionSchema, {});
  const derivedPath = `/sessions/${encodeURIComponent(derived.id)}`;
  try {
    if (turns.length > keep)
      await server.request(`${derivedPath}:undo`, z.unknown(), { count: turns.length - keep });
    await server.request(`${derivedPath}/profile`, z.unknown(), {
      agent_config: {
        model: status.model,
        thinking: status.thinking_level,
        permission_mode: status.permission,
        plan_mode: status.plan_mode,
      },
    });
    const actual = await readTurns(server, derived.id);
    if (JSON.stringify(actual) !== JSON.stringify(turns.slice(0, keep)))
      throw new KimiError(
        "protocolError",
        "Kimi derived history differs from the requested prefix",
      );
    return derived;
  } catch (error) {
    await server.request(`${derivedPath}:archive`, z.unknown(), {}).catch(() => undefined);
    throw error;
  }
}
