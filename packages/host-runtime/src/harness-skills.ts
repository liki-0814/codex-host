import { lstat, mkdir, readdir, readFile, readlink, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  harnessSkillCatalogSchema,
  type HarnessSkillAccess,
  type HarnessSkillCatalog,
  type HarnessSkillLinkParams,
} from "@codexhost/shared-contracts";

/** The cross-Harness Skill directory, below the home directory. */
const SHARED_SEGMENTS = [".agents", "skills"] as const;

interface SkillDirectoryDefinition {
  readonly harnessId: string;
  /** Path segments below the home directory. */
  readonly segments: readonly string[];
  readonly access: HarnessSkillAccess;
}

export const SKILL_DIRECTORIES: readonly SkillDirectoryDefinition[] = Object.freeze([
  { harnessId: "codex", segments: [".codex", "skills"], access: "link" },
  // Pi also scans `.agents/skills` upward from the working directory, which does
  // not cover the shared user directory.
  { harnessId: "pi", segments: [".pi", "agent", "skills"], access: "link" },
  // This directory exists even without Claude Code, because delegation writes into it.
  { harnessId: "claude-code", segments: [".claude", "skills"], access: "link" },
  { harnessId: "grok", segments: [".grok", "skills"], access: "native" },
  { harnessId: "kimi-code", segments: [".kimi-code", "skills"], access: "native" },
  { harnessId: "cursor-cli", segments: [".cursor", "skills"], access: "native" },
  // SDK launches leave `loadFromAgentsDirectory` off, so a link is what the session reads.
  { harnessId: "qoder", segments: [".qoder", "skills"], access: "link" },
  { harnessId: "antigravity", segments: [".gemini", "config", "skills"], access: "link" },
]);

const SKILL_MANIFEST = "SKILL.md";
const MAX_MANIFEST_BYTES = 16_384;

function homeDirectory(home?: string): string {
  return home ?? os.homedir();
}

/** Read a plain or folded `description` scalar. Anything else is reported empty. */
export function skillDescription(manifest: string): string {
  const normalized = manifest.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith("---\n")) return "";
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return "";
  const lines = normalized.slice(4, end).split("\n");
  const index = lines.findIndex((line) => /^description:/u.test(line));
  if (index === -1) return "";
  const first = (lines[index] ?? "").slice("description:".length).trim();
  if (first && first !== ">" && first !== "|" && first !== ">-" && first !== "|-") {
    return first.replace(/^["']|["']$/gu, "");
  }
  const folded: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (!/^\s/u.test(line) || line.trim().length === 0) break;
    folded.push(line.trim());
  }
  return folded.join(" ");
}

async function readManifest(skillPath: string): Promise<string | null> {
  try {
    return (await readFile(path.join(skillPath, SKILL_MANIFEST), "utf8")).slice(
      0,
      MAX_MANIFEST_BYTES,
    );
  } catch {
    return null;
  }
}

interface DirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly linkTarget: string | null;
  readonly manifest: string | null;
}

async function readDirectoryEntries(directory: string): Promise<DirectoryEntry[] | null> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return null;
  }
  const entries: DirectoryEntry[] = [];
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (name.startsWith(".")) continue;
    const entryPath = path.join(directory, name);
    let linkTarget: string | null = null;
    try {
      if ((await lstat(entryPath)).isSymbolicLink()) {
        linkTarget = path.resolve(directory, await readlink(entryPath));
      }
    } catch {
      continue;
    }
    entries.push({ name, path: entryPath, linkTarget, manifest: await readManifest(entryPath) });
  }
  return entries;
}

export interface SkillCatalogInput {
  readonly homeDirectory?: string;
}

export async function readSkillCatalog(
  input: SkillCatalogInput = {},
): Promise<HarnessSkillCatalog> {
  const home = homeDirectory(input.homeDirectory);
  const sharedDirectory = path.join(home, ...SHARED_SEGMENTS);
  const sharedEntries = await readDirectoryEntries(sharedDirectory);
  const scanned = await Promise.all(
    SKILL_DIRECTORIES.map(async (definition) => {
      const directory = path.join(home, ...definition.segments);
      return { definition, directory, entries: await readDirectoryEntries(directory) };
    }),
  );

  // Copies are not links: the Host only reports links it can also remove.
  const linkedBySkill = new Map<string, string[]>();
  const localBySkill = new Map<string, string[]>();
  const brokenLinks: { harnessId: string; name: string; path: string; target: string }[] = [];
  for (const { definition, entries } of scanned) {
    for (const entry of entries ?? []) {
      const sharedLink =
        entry.linkTarget !== null &&
        entry.manifest !== null &&
        path.dirname(entry.linkTarget) === sharedDirectory;
      if (sharedLink) {
        const name = path.basename(entry.linkTarget ?? "");
        linkedBySkill.set(name, [...(linkedBySkill.get(name) ?? []), definition.harnessId]);
        continue;
      }
      if (entry.linkTarget && entry.manifest === null) {
        brokenLinks.push({
          harnessId: definition.harnessId,
          name: entry.name,
          path: entry.path,
          target: entry.linkTarget,
        });
      }
      // A real directory or a link to somewhere else is not the shared source.
      if (definition.access === "link") {
        localBySkill.set(entry.name, [
          ...(localBySkill.get(entry.name) ?? []),
          definition.harnessId,
        ]);
      }
    }
  }

  const skills = (sharedEntries ?? [])
    .filter((entry) => entry.manifest !== null)
    .map((entry) => ({
      name: entry.name,
      description: skillDescription(entry.manifest ?? ""),
      path: entry.path,
      linkedHarnessIds: Object.freeze([...(linkedBySkill.get(entry.name) ?? [])]),
      localHarnessIds: Object.freeze([...(localBySkill.get(entry.name) ?? [])]),
    }));

  return harnessSkillCatalogSchema.parse({
    sharedDirectory,
    sharedDirectoryPresent: sharedEntries !== null,
    skills,
    targets: scanned.map(({ definition, directory, entries }) => ({
      harnessId: definition.harnessId,
      directory,
      access: definition.access,
      present: entries !== null,
    })),
    brokenLinks,
  });
}

function assertSkillName(name: string): void {
  if (name !== path.basename(name) || name === "." || name === "..") {
    throw new Error(`Invalid Skill name: ${name}`);
  }
}

export async function applySkillLink(
  params: HarnessSkillLinkParams,
  input: SkillCatalogInput = {},
): Promise<HarnessSkillCatalog> {
  const home = homeDirectory(input.homeDirectory);
  assertSkillName(params.skill);
  const definition = SKILL_DIRECTORIES.find(({ harnessId }) => harnessId === params.harnessId);
  if (!definition) throw new Error(`No known Skill directory for ${params.harnessId}`);
  const directory = path.join(home, ...definition.segments);
  const linkPath = path.join(directory, params.skill);
  if (params.action === "link" && definition.access === "native") {
    throw new Error(`${params.harnessId} already reads the shared Skill directory`);
  }
  // The skills folder is created on the first real skill, not when the Harness is installed.
  if ((await readDirectoryEntries(directory)) === null) {
    if (params.action === "unlink") return readSkillCatalog(input);
    await mkdir(directory, { recursive: true });
  }

  if (params.action === "unlink") {
    const stats = await lstat(linkPath).catch(() => null);
    if (stats && !stats.isSymbolicLink()) {
      throw new Error(`${params.skill} is not a link in ${params.harnessId}`);
    }
    if (stats) await rm(linkPath);
    return readSkillCatalog(input);
  }

  const source = path.join(home, ...SHARED_SEGMENTS, params.skill);
  if ((await readManifest(source)) === null) {
    throw new Error(`${params.skill} is not a Skill in the shared directory`);
  }
  const existing = await lstat(linkPath).catch(() => null);
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`${params.skill} already exists in ${params.harnessId}`);
    }
    await rm(linkPath);
  }
  await symlink(source, linkPath, "dir");
  return readSkillCatalog(input);
}
