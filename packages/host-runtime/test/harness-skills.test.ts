import { lstat, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { harnessIdSchema } from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";

import { applySkillLink, readSkillCatalog, skillDescription } from "../src/harness-skills.js";

async function home(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "codexhost-skills-test-"));
}

async function writeSkill(directory: string, name: string, description = "Does a thing.") {
  const skill = path.join(directory, name);
  await mkdir(skill, { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8",
  );
  return skill;
}

function target(catalog: Awaited<ReturnType<typeof readSkillCatalog>>, harnessId: string) {
  const found = catalog.targets.find((entry) => entry.harnessId === harnessId);
  if (!found) throw new Error(`Missing target ${harnessId}`);
  return found;
}

describe("Skill front matter", () => {
  it("reads a plain description", () => {
    expect(skillDescription("---\nname: a\ndescription: Plain text.\n---\n")).toBe("Plain text.");
  });

  it("joins a folded description", () => {
    expect(skillDescription("---\ndescription: >\n  First line\n  second line\n---\n")).toBe(
      "First line second line",
    );
  });

  it("reports no description rather than guessing at an unknown shape", () => {
    expect(skillDescription("# Not front matter\n")).toBe("");
  });
});

describe("Skill catalog", () => {
  it("lists the shared directory as a flat set of Skills", async () => {
    const root = await home();
    await writeSkill(path.join(root, ".agents", "skills"), "shared-one");
    await writeSkill(path.join(root, ".agents", "skills"), "shared-two");

    const catalog = await readSkillCatalog({ homeDirectory: root });

    expect(catalog.skills.map((skill) => skill.name)).toEqual(["shared-one", "shared-two"]);
    expect(catalog.skills[0]?.description).toBe("Does a thing.");
    expect(catalog.sharedDirectoryPresent).toBe(true);
  });

  it("reports an absent shared directory without failing", async () => {
    const catalog = await readSkillCatalog({ homeDirectory: await home() });

    expect(catalog.sharedDirectoryPresent).toBe(false);
    expect(catalog.skills).toEqual([]);
  });

  it("separates Harnesses that read the shared directory from those needing a link", async () => {
    const catalog = await readSkillCatalog({ homeDirectory: await home() });

    expect(target(catalog, "codex").access).toBe("link");
    expect(target(catalog, "pi").access).toBe("link");
    expect(target(catalog, "claude-code").access).toBe("link");
    expect(target(catalog, "grok").access).toBe("native");
    expect(target(catalog, "kimi-code").access).toBe("native");
    expect(target(catalog, "cursor-cli").access).toBe("native");
    expect(target(catalog, "qoder").access).toBe("native");
    expect(target(catalog, "antigravity").access).toBe("native");
  });

  it("reports whether each Harness directory exists locally", async () => {
    const root = await home();
    await mkdir(path.join(root, ".codex", "skills"), { recursive: true });

    const catalog = await readSkillCatalog({ homeDirectory: root });

    expect(target(catalog, "codex").present).toBe(true);
    expect(target(catalog, "pi").present).toBe(false);
  });

  it("reports a link whose source Skill is gone as broken instead of as a Skill", async () => {
    const root = await home();
    const shared = path.join(root, ".agents", "skills");
    await mkdir(shared, { recursive: true });
    const codex = path.join(root, ".codex", "skills");
    await mkdir(codex, { recursive: true });
    await symlink(path.join(shared, "removed"), path.join(codex, "removed"), "dir");

    const catalog = await readSkillCatalog({ homeDirectory: root });

    expect(catalog.skills).toEqual([]);
    expect(catalog.brokenLinks).toEqual([
      {
        harnessId: "codex",
        name: "removed",
        path: path.join(codex, "removed"),
        target: path.join(shared, "removed"),
      },
    ]);
  });
});

describe("Skill linking", () => {
  it("links a shared Skill into a Harness and reports it as linked", async () => {
    const root = await home();
    await writeSkill(path.join(root, ".agents", "skills"), "shared-one");
    await mkdir(path.join(root, ".codex", "skills"), { recursive: true });

    const catalog = await applySkillLink(
      { skill: "shared-one", harnessId: harnessIdSchema.parse("codex"), action: "link" },
      { homeDirectory: root },
    );

    expect(catalog.skills[0]?.linkedHarnessIds).toEqual(["codex"]);
    expect((await lstat(path.join(root, ".codex", "skills", "shared-one"))).isSymbolicLink()).toBe(
      true,
    );
  });

  it("links into Pi's agent directory rather than its config root", async () => {
    const root = await home();
    await writeSkill(path.join(root, ".agents", "skills"), "shared-one");
    await mkdir(path.join(root, ".pi", "agent", "skills"), { recursive: true });

    await applySkillLink(
      { skill: "shared-one", harnessId: harnessIdSchema.parse("pi"), action: "link" },
      { homeDirectory: root },
    );

    expect(
      (await lstat(path.join(root, ".pi", "agent", "skills", "shared-one"))).isSymbolicLink(),
    ).toBe(true);
  });

  it("unlinks without touching the shared source", async () => {
    const root = await home();
    await writeSkill(path.join(root, ".agents", "skills"), "shared-one");
    await mkdir(path.join(root, ".codex", "skills"), { recursive: true });
    const codexId = harnessIdSchema.parse("codex");
    await applySkillLink(
      { skill: "shared-one", harnessId: codexId, action: "link" },
      { homeDirectory: root },
    );

    const catalog = await applySkillLink(
      { skill: "shared-one", harnessId: codexId, action: "unlink" },
      { homeDirectory: root },
    );

    expect(catalog.skills[0]?.linkedHarnessIds).toEqual([]);
    await expect(lstat(path.join(root, ".agents", "skills", "shared-one"))).resolves.toBeDefined();
  });

  it("removes a broken link through the same unlink path", async () => {
    const root = await home();
    await mkdir(path.join(root, ".agents", "skills"), { recursive: true });
    const codex = path.join(root, ".codex", "skills");
    await mkdir(codex, { recursive: true });
    await symlink(path.join(root, ".agents", "skills", "gone"), path.join(codex, "gone"), "dir");

    const catalog = await applySkillLink(
      { skill: "gone", harnessId: harnessIdSchema.parse("codex"), action: "unlink" },
      { homeDirectory: root },
    );

    expect(catalog.brokenLinks).toEqual([]);
  });

  it("refuses to delete a real directory the Host never linked", async () => {
    const root = await home();
    await mkdir(path.join(root, ".agents", "skills"), { recursive: true });
    await writeSkill(path.join(root, ".codex", "skills"), "codex-own");

    await expect(
      applySkillLink(
        { skill: "codex-own", harnessId: harnessIdSchema.parse("codex"), action: "unlink" },
        { homeDirectory: root },
      ),
    ).rejects.toThrow(/not a link/u);
  });

  it("refuses to link into a Harness that already reads the shared directory", async () => {
    const root = await home();
    await writeSkill(path.join(root, ".agents", "skills"), "shared-one");
    await mkdir(path.join(root, ".grok", "skills"), { recursive: true });

    await expect(
      applySkillLink(
        { skill: "shared-one", harnessId: harnessIdSchema.parse("grok"), action: "link" },
        { homeDirectory: root },
      ),
    ).rejects.toThrow(/already reads the shared/u);
  });

  it("refuses a Harness with no local directory", async () => {
    const root = await home();
    await writeSkill(path.join(root, ".agents", "skills"), "shared-one");

    await expect(
      applySkillLink(
        { skill: "shared-one", harnessId: harnessIdSchema.parse("codex"), action: "link" },
        { homeDirectory: root },
      ),
    ).rejects.toThrow(/no local Skill directory/u);
  });

  it("rejects a Skill name that escapes the shared directory", async () => {
    const root = await home();
    await mkdir(path.join(root, ".agents", "skills"), { recursive: true });
    await mkdir(path.join(root, ".codex", "skills"), { recursive: true });

    await expect(
      applySkillLink(
        { skill: "../escape", harnessId: harnessIdSchema.parse("codex"), action: "link" },
        { homeDirectory: root },
      ),
    ).rejects.toThrow(/Invalid Skill name/u);
  });
});
