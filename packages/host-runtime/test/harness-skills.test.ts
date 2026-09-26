import { mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { harnessSkillLinkParamsSchema } from "@codexhost/shared-contracts";

import { applySkillLink, readSkillCatalog } from "../src/harness-skills.js";

const homes: string[] = [];

async function home(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codexhost-skills-"));
  homes.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Harness Skill links", () => {
  it("creates a missing Harness directory when the user links a Skill", async () => {
    const directory = await home();
    const skill = path.join(directory, ".agents", "skills", "demo");
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "---\ndescription: example skill\n---\n");
    const linked = await applySkillLink(
      harnessSkillLinkParamsSchema.parse({ skill: "demo", harnessId: "pi", action: "link" }),
      { homeDirectory: directory },
    );
    expect(linked.skills[0]).toMatchObject({
      name: "demo",
      description: "example skill",
      linkedHarnessIds: ["pi"],
    });
    expect(linked.targets.find((target) => target.harnessId === "pi")).toMatchObject({
      present: true,
      access: "link",
    });
    await expect(readlink(path.join(directory, ".pi", "agent", "skills", "demo"))).resolves.toBe(
      skill,
    );
  });

  it("removes only a symbolic link and reports a broken one", async () => {
    const directory = await home();
    const skill = path.join(directory, ".agents", "skills", "demo");
    const target = path.join(directory, ".codex", "skills");
    await mkdir(skill, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "---\ndescription: demo\n---\n");
    await symlink(
      path.join(directory, ".agents", "skills", "missing"),
      path.join(target, "missing"),
      "dir",
    );
    await applySkillLink(
      harnessSkillLinkParamsSchema.parse({ skill: "demo", harnessId: "codex", action: "link" }),
      { homeDirectory: directory },
    );
    const removed = await applySkillLink(
      harnessSkillLinkParamsSchema.parse({ skill: "demo", harnessId: "codex", action: "unlink" }),
      { homeDirectory: directory },
    );
    expect(removed.skills[0]?.linkedHarnessIds).toEqual([]);
    expect(removed.brokenLinks).toEqual([
      expect.objectContaining({ harnessId: "codex", name: "missing" }),
    ]);
    await mkdir(path.join(target, "owned"), { recursive: true });
    await expect(
      applySkillLink(
        harnessSkillLinkParamsSchema.parse({
          skill: "owned",
          harnessId: "codex",
          action: "unlink",
        }),
        { homeDirectory: directory },
      ),
    ).rejects.toThrow("not a link");
  });

  it("hides a Harness icon when its copy is not the shared Skill", async () => {
    const directory = await home();
    const shared = path.join(directory, ".agents", "skills", "hatch-pet");
    const codexCopy = path.join(directory, ".codex", "skills", "hatch-pet");
    await mkdir(shared, { recursive: true });
    await mkdir(codexCopy, { recursive: true });
    await writeFile(path.join(shared, "SKILL.md"), "---\ndescription: shared pet\n---\n");
    await writeFile(path.join(codexCopy, "SKILL.md"), "---\ndescription: local pet\n---\n");
    const catalog = await readSkillCatalog({ homeDirectory: directory });
    expect(catalog.skills.map((skill) => skill.name)).toEqual(["hatch-pet"]);
    expect(catalog.skills[0]).toMatchObject({
      linkedHarnessIds: [],
      localHarnessIds: ["codex"],
    });
  });
});
