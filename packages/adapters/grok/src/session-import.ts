import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function grokImportCandidates(
  environment: NodeJS.ProcessEnv,
  signal?: { throwIfAborted(): void },
) {
  const root = path.join(
    environment.GROK_HOME ??
      path.join(environment.HOME ?? environment.USERPROFILE ?? os.homedir(), ".grok"),
    "sessions",
  );
  const workspaces = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  signal?.throwIfAborted();
  const candidates = [];
  for (const workspace of workspaces) {
    signal?.throwIfAborted();
    if (!workspace.isDirectory()) continue;
    const directory = path.join(root, workspace.name);
    for (const session of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (!session.isDirectory()) continue;
      try {
        const summary = JSON.parse(
          await readFile(path.join(directory, session.name, "summary.json"), "utf8"),
        );
        const cwd = summary.info?.cwd;
        if (
          summary.info?.id !== session.name ||
          typeof cwd !== "string" ||
          !path.isAbsolute(cwd) ||
          encodeURIComponent(path.resolve(cwd)) !== workspace.name
        )
          continue;
        if (summary.num_chat_messages < 1) continue;
        candidates.push({
          nativeSessionId: session.name,
          cwd,
          title:
            typeof summary.generated_title === "string"
              ? summary.generated_title.trim().slice(0, 4096) || null
              : null,
          updatedAt: Date.parse(summary.updated_at),
          running: null,
        });
      } catch {
        /* Incomplete or incompatible native metadata is not importable. */
      }
    }
  }
  return candidates;
}
