import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
}));
vi.mock("../../src/renderer-agent-icon.js", () => ({
  createRendererAgentIcon: () => "agent",
  RENDERER_AGENT_LABELS: {},
}));

import { skillLinkTargets } from "../../src/settings/skills-page.js";
import type { HarnessSkill, HarnessSkillTarget } from "@codexhost/shared-contracts";

const skill = {
  name: "hatch-pet",
  description: "pets",
  path: "/home/user/.agents/skills/hatch-pet",
  linkedHarnessIds: ["pi"],
  localHarnessIds: ["codex"],
} as HarnessSkill;

const targets = [
  { harnessId: "codex", directory: "/home/user/.codex/skills", access: "link", present: true },
  { harnessId: "pi", directory: "/home/user/.pi/agent/skills", access: "link", present: true },
  { harnessId: "qoder", directory: "/home/user/.qoder/skills", access: "link", present: true },
] as HarnessSkillTarget[];

describe("Skill row targets", () => {
  it("omits a Harness whose copy is not the shared Skill", () => {
    expect(skillLinkTargets(skill, targets).map((target) => target.harnessId)).toEqual([
      "pi",
      "qoder",
    ]);
  });
});
