import { lstat, readdir, readFile, readlink, rm, symlink } from "node:fs/promises";
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

/**
 * Where each Harness reads user-scope Skills, and whether it already reads the
 * shared directory itself. Both facts come from the Harness, never from a
 * guess: a Harness without evidence is absent here rather than assumed.
 */
interface SkillDirectoryDefinition {
  readonly harnessId: string;
  /** Path segments below the home directory. */
  readonly segments: readonly string[];
  readonly access: HarnessSkillAccess;
}

export const SKILL_DIRECTORIES: readonly SkillDirectoryDefinition[] = Object.freeze([
  // Codex reads only its own directory.
  { harnessId: "codex", segments: [".codex", "skills"], access: "link" },
  // Pi's user scope is its agent directory; the `.agents/skills` it also scans
  // is walked from the working directory up to the repository root, so it does
  // not cover the shared user directory.
  { harnessId: "pi", segments: [".pi", "agent", "skills"], access: "link" },
  // Claude Code reads only its own directory. Note that this directory exists
  // even without Claude Code, because delegation-skill.ts writes into it.
  { harnessId: "claude-code", segments: [".claude", "skills"], access: "link" },
  // grok 1.0.34 scans `.agents/skills` at every tier, including the user tier
  // next to `~/.grok/skills`.
  { harnessId: "grok", segments: [".grok", "skills"], access: "native" },
  // Kimi joins `os.homedir()` with `USER_GENERIC_DIRS = [".agents/skills"]`.
  { harnessId: "kimi-code", segments: [".kimi-code", "skills"], access: "native" },
  // cursor-agent joins `userHomeDirectory` with `.agents/skills` as user scope.
  { harnessId: "cursor-cli", segments: [".cursor", "skills"], access: "native" },
  // Qoder always loads `~/.qoder/skills`. qodercli 1.1.59 treats `~/.agents/skills`
  // as a compatibility path: the interactive CLI enables it by default, but SDK
  // mode — how codexhost launches the CLI — leaves it off unless the setting is
  // explicit. A link is what the hosted session reads.
  { harnessId: "qoder", segments: [".qoder", "skills"], access: "link" },
  // agy 1.2.7 reads workspace `<root>/.agents/skills` and global
  // `~/.gemini/config/skills`. That workspace walk does not include the shared
  // user directory, so a link is required.
  { harnessId: "antigravity", segments: [".gemini", "config", "skills"], access: "link" },
]);

const SKILL_MANIFEST = "SKILL.md";
const MAX_MANIFEST_BYTES = 16_384;

function homeDirectory(home?: string): string {
  return home ?? os.homedir();
}

/**
 * Read the `description` of a SKILL.md front matter block. Supports the plain
 * and folded (`>`) scalar forms the Skill format uses; anything else is
 * reported as empty rather than guessed at.
 */
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
  /** Present when the entry is a symbolic link, resolved against its directory. */
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

export async function readSkillCatalog(input: SkillCatalogInput = {}): Promise<HarnessSkillCatalog> {
  const home = homeDirectory(input.homeDirectory);
  const sharedDirectory = path.join(home, ...SHARED_SEGMENTS);
  const sharedEntries = await readDirectoryEntries(sharedDirectory);

  const scanned = await Promise.all(
    SKILL_DIRECTORIES.map(async (definition) => {
      const directory = path.join(home, ...definition.segments);
      return { definition, directory, entries: await readDirectoryEntries(directory) };
    }),
  );

  // A shared Skill counts as linked into a Harness when that Harness directory
  // holds a symbolic link resolving to it. Copies are deliberately not counted:
  // the Host only reports links it can also remove.
  const linkedBySkill = new Map<string, string[]>();
  const brokenLinks: { harnessId: string; name: string; path: string; target: string }[] = [];
  for (const { definition, entries } of scanned) {
    for (const entry of entries ?? []) {
      if (!entry.linkTarget) continue;
      if (entry.manifest === null) {
        brokenLinks.push({
          harnessId: definition.harnessId,
          name: entry.name,
          path: entry.path,
          target: entry.linkTarget,
        });
        continue;
      }
      if (path.dirname(entry.linkTarget) !== sharedDirectory) continue;
      const name = path.basename(entry.linkTarget);
      linkedBySkill.set(name, [...(linkedBySkill.get(name) ?? []), definition.harnessId]);
    }
  }

  const skills = (sharedEntries ?? [])
    .filter((entry) => entry.manifest !== null)
    .map((entry) => ({
      name: entry.name,
      description: skillDescription(entry.manifest ?? ""),
      path: entry.path,
      linkedHarnessIds: Object.freeze([...(linkedBySkill.get(entry.name) ?? [])]),
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
  if ((await readDirectoryEntries(directory)) === null) {
    throw new Error(`${params.harnessId} has no local Skill directory`);
  }
  const linkPath = path.join(directory, params.skill);

  if (params.action === "unlink") {
    // Only ever remove a link the Host could have created. A real directory in
    // the Harness's own Skill folder is the user's content, not ours to delete.
    const stats = await lstat(linkPath).catch(() => null);
    if (stats && !stats.isSymbolicLink()) {
      throw new Error(`${params.skill} is not a link in ${params.harnessId}`);
    }
    if (stats) await rm(linkPath);
    return readSkillCatalog(input);
  }

  if (definition.access === "native") {
    throw new Error(`${params.harnessId} already reads the shared Skill directory`);
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
