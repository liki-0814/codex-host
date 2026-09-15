import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { grokImportCandidates } from "../src/session-import.js";
it("discovers native metadata only when ID and workspace match", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "grok-import-"));
  try {
    const directory = path.join(
      home,
      "sessions",
      encodeURIComponent("/original"),
      "native-session",
    );
    await mkdir(directory, { recursive: true });
    const summary = {
      info: { id: "native-session", cwd: "/original" },
      updated_at: "2026-09-16T00:00:00Z",
      generated_title: "History",
      num_chat_messages: 2,
    };
    await writeFile(path.join(directory, "summary.json"), JSON.stringify(summary));
    expect(await grokImportCandidates({ GROK_HOME: home })).toMatchObject([
      { nativeSessionId: "native-session", cwd: "/original", title: "History", running: null },
    ]);
    await writeFile(
      path.join(directory, "summary.json"),
      JSON.stringify({ ...summary, info: { id: "other", cwd: "/original" } }),
    );
    expect(await grokImportCandidates({ GROK_HOME: home })).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
