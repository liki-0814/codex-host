import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const SUMMARIES_SEGMENTS = [".gemini", "antigravity-cli", "conversation_summaries.db"] as const;

function homeDirectory(environment: NodeJS.ProcessEnv): string {
  return environment.HOME ?? environment.USERPROFILE ?? os.homedir();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function cwdFromWorkspaceUris(raw: unknown): string | null {
  let uris: unknown = raw;
  if (typeof raw === "string") {
    try {
      uris = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(uris)) return null;
  for (const uri of uris) {
    if (typeof uri !== "string" || !uri.startsWith("file:")) continue;
    try {
      const cwd = fileURLToPath(uri);
      if (path.isAbsolute(cwd)) return cwd;
    } catch {
      // Skip malformed file URIs rather than guessing a workspace.
    }
  }
  return null;
}

function updatedAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return Number.isSafeInteger(Math.floor(ms)) ? Math.floor(ms) : null;
  }
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Lists native Antigravity conversations from the CLI summaries database. */
export async function listAntigravityImportCandidates(
  environment: NodeJS.ProcessEnv,
  signal?: { throwIfAborted(): void },
): Promise<unknown[]> {
  signal?.throwIfAborted();
  let DatabaseSync: typeof DatabaseSyncType;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return [];
  }
  const summaries = path.join(homeDirectory(environment), ...SUMMARIES_SEGMENTS);
  let db: InstanceType<typeof DatabaseSyncType>;
  try {
    db = new DatabaseSync(summaries, { readOnly: true });
  } catch {
    return [];
  }
  try {
    signal?.throwIfAborted();
    const rows = db
      .prepare(
        `SELECT conversation_id, title, preview, last_modified_time, workspace_uris, status, not_fully_idle, killed
         FROM conversation_summaries`,
      )
      .all();
    const candidates = [];
    for (const row of rows) {
      signal?.throwIfAborted();
      const nativeSessionId = text(row.conversation_id);
      const cwd = cwdFromWorkspaceUris(row.workspace_uris);
      const updatedAt = updatedAtMs(row.last_modified_time);
      if (!nativeSessionId || !cwd || updatedAt === null || truthy(row.killed)) continue;
      const title = text(row.title) || text(row.preview);
      candidates.push({
        nativeSessionId,
        cwd,
        title: title ? title.slice(0, 4096) : null,
        updatedAt,
        running: truthy(row.not_fully_idle) || (text(row.status) !== "" && !/idle$/iu.test(text(row.status))),
      });
    }
    return candidates;
  } finally {
    db.close();
  }
}
