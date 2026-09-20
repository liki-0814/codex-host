import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it } from "vitest";

import { AntigravityAdapter } from "../src/antigravity-adapter.js";
import { listAntigravityImportCandidates } from "../src/session-import.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function summariesHome(): Promise<{
  home: string;
  idleCwd: string;
  busyCwd: string;
}> {
  const home = await mkdtemp(path.join(os.tmpdir(), "codexhost-agy-import-"));
  roots.push(home);
  const idleCwd = path.join(home, "idle-project");
  const busyCwd = path.join(home, "busy-project");
  await mkdir(idleCwd, { recursive: true });
  await mkdir(busyCwd, { recursive: true });
  const directory = path.join(home, ".gemini", "antigravity-cli");
  await mkdir(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "conversation_summaries.db"));
  db.exec(`CREATE TABLE conversation_summaries (
    conversation_id text,
    title text NOT NULL DEFAULT "",
    preview text NOT NULL DEFAULT "",
    last_modified_time datetime NOT NULL,
    workspace_uris text NOT NULL,
    status text NOT NULL DEFAULT "",
    not_fully_idle numeric NOT NULL DEFAULT false,
    killed numeric NOT NULL DEFAULT false
  )`);
  const insert = db.prepare(
    `INSERT INTO conversation_summaries
      (conversation_id, title, preview, last_modified_time, workspace_uris, status, not_fully_idle, killed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    "d12c15f3-f592-485d-bc06-4109b08284af",
    "Model Identity Inquiry",
    "preview",
    "2026-09-20 02:10:44.647252+00:00",
    JSON.stringify([pathToFileURL(idleCwd).href]),
    "CASCADE_RUN_STATUS_IDLE",
    0,
    0,
  );
  insert.run(
    "killed-session",
    "Gone",
    "",
    "2026-09-20 02:11:00+00:00",
    JSON.stringify([pathToFileURL(path.join(home, "gone-project")).href]),
    "",
    0,
    1,
  );
  insert.run(
    "busy-session",
    "Busy",
    "",
    "2026-09-20 02:12:00+00:00",
    JSON.stringify([pathToFileURL(busyCwd).href]),
    "CASCADE_RUN_STATUS_RUNNING",
    1,
    0,
  );
  db.close();
  return { home, idleCwd, busyCwd };
}

it("lists idle Antigravity conversations and marks running ones", async () => {
  const { home, idleCwd, busyCwd } = await summariesHome();
  await expect(listAntigravityImportCandidates({ HOME: home })).resolves.toEqual([
    {
      nativeSessionId: "d12c15f3-f592-485d-bc06-4109b08284af",
      cwd: idleCwd,
      title: "Model Identity Inquiry",
      updatedAt: Date.parse("2026-09-20 02:10:44.647252+00:00"),
      running: false,
    },
    {
      nativeSessionId: "busy-session",
      cwd: busyCwd,
      title: "Busy",
      updatedAt: Date.parse("2026-09-20 02:12:00+00:00"),
      running: true,
    },
  ]);
});

it("exposes listed conversations through sessionImport and rejects removed ids", async () => {
  const { home } = await summariesHome();
  const adapter = new AntigravityAdapter({ environment: { HOME: home } });
  const listed = await adapter.sessionImport.listCandidates();
  expect(listed).toMatchObject({ ok: true });
  if (!listed.ok) throw new Error("expected candidates");
  expect(listed.value.map((candidate) => candidate.nativeSessionId)).toEqual([
    "d12c15f3-f592-485d-bc06-4109b08284af",
    "busy-session",
  ]);
  expect(await adapter.sessionImport.resolveCandidate?.("missing")).toMatchObject({ ok: false });
  await adapter.close();
});
