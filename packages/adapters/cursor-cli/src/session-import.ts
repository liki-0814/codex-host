import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readCursorNativeTurns } from "./native-history.js";

/** Only the native ACP store can be resumed by this adapter's ACP transport. */
export async function cursorImportCandidates(
  environment: NodeJS.ProcessEnv,
  signal?: { throwIfAborted(): void },
) {
  const root = path.join(
    environment.HOME ?? environment.USERPROFILE ?? os.homedir(),
    ".cursor",
    "acp-sessions",
  );
  const sessions = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  signal?.throwIfAborted();
  const candidates = [];
  for (const session of sessions) {
    signal?.throwIfAborted();
    if (!session.isDirectory() || !/^[0-9a-f-]{36}$/iu.test(session.name)) continue;
    const directory = path.join(root, session.name);
    try {
      const meta = JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8"));
      if (typeof meta.cwd !== "string" || !path.isAbsolute(meta.cwd)) continue;
      const turns = readCursorNativeTurns(session.name, meta.cwd, environment);
      if (!turns.length) continue;
      const metadata = await stat(path.join(directory, "store.db"));
      candidates.push({
        nativeSessionId: session.name,
        cwd: meta.cwd,
        title: turns[0]?.text.trim().slice(0, 4096) || null,
        updatedAt: Math.floor(metadata.mtimeMs),
        running: null,
      });
    } catch {
      /* Skip incomplete or unsupported native stores; never rewrite them. */
    }
  }
  return candidates;
}
