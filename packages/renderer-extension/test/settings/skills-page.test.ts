import { describe, expect, it, vi } from "vitest";

import { harnessSkillCatalogSchema, type HarnessSkillCatalog } from "@codexhost/shared-contracts";

import type * as rendererAgentIcon from "../../src/renderer-agent-icon.js";

type RendererAgentIconModule = typeof rendererAgentIcon;

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
  isRendererSettingsIconName: () => true,
}));

vi.mock("../../src/renderer-agent-icon.js", async (importOriginal) => {
  const actual = await importOriginal<RendererAgentIconModule>();
  return { ...actual, createRendererAgentIcon: (agent: string) => `icon:${agent}` };
});

import { RendererSettingsPageScope } from "../../src/settings/core.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";
import {
  connectedSkillTargets,
  createSkillsSettingsPage,
  skillMatchesQuery,
  type RendererSkillsClient,
} from "../../src/settings/skills-page.js";
import type { RendererConnectionDiagnostics } from "../../src/settings/connections-page.js";

class FakeElement {
  readonly children: unknown[] = [];
  readonly attributes = new Map<string, string>();
  readonly #listeners = new Map<string, (event?: unknown) => void>();
  className = "";
  textContent = "";
  title = "";
  type = "";
  value = "";
  placeholder = "";
  hidden = false;
  disabled = false;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  addEventListener(name: string, listener: (event?: unknown) => void): void {
    this.#listeners.set(name, listener);
  }

  append(...children: unknown[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: unknown[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  dispatch(name: string, event?: unknown): void {
    this.#listeners.get(name)?.(event);
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

function descendants(root: FakeElement): FakeElement[] {
  return [
    root,
    ...root.children.flatMap((child) => (child instanceof FakeElement ? descendants(child) : [])),
  ];
}

function text(root: FakeElement): string {
  return descendants(root)
    .flatMap((element) => [
      element.textContent,
      ...element.children.filter((child) => typeof child === "string"),
    ])
    .join(" ");
}

function catalog(overrides: Partial<HarnessSkillCatalog> = {}): HarnessSkillCatalog {
  return harnessSkillCatalogSchema.parse({
    sharedDirectory: "/home/u/.agents/skills",
    sharedDirectoryPresent: true,
    skills: [
      {
        name: "yuque-kit",
        description: "Yuque documents.",
        path: "/home/u/.agents/skills/yuque-kit",
        linkedHarnessIds: ["codex"],
      },
      {
        name: "sql-style",
        description: "SQL review rules.",
        path: "/home/u/.agents/skills/sql-style",
        linkedHarnessIds: [],
      },
    ],
    targets: [
      { harnessId: "codex", directory: "/home/u/.codex/skills", access: "link", present: true },
      { harnessId: "pi", directory: "/home/u/.pi/agent/skills", access: "link", present: true },
      { harnessId: "grok", directory: "/home/u/.grok/skills", access: "native", present: true },
      {
        harnessId: "claude-code",
        directory: "/home/u/.claude/skills",
        access: "link",
        present: true,
      },
    ],
    brokenLinks: [
      {
        harnessId: "codex",
        name: "removed",
        path: "/home/u/.codex/skills/removed",
        target: "/gone",
      },
    ],
    ...overrides,
  });
}

function diagnostics(...ready: readonly string[]): RendererConnectionDiagnostics {
  return {
    snapshot: () => ({
      adapter: { state: "ready" },
      hosts: [
        {
          hostId: "local",
          active: true,
          agents: ready.map((agent) => ({
            agent,
            availability: "ready",
            error: null,
          })),
        },
      ],
    }),
    refresh: async () => undefined,
    subscribe: () => () => undefined,
  } as unknown as RendererConnectionDiagnostics;
}

function fakeClient(linkSkill: RendererSkillsClient["linkSkill"] = async () => catalog()) {
  return {
    inspectSkills: vi.fn<RendererSkillsClient["inspectSkills"]>(async () => catalog()),
    linkSkill: vi.fn<RendererSkillsClient["linkSkill"]>(linkSkill),
  };
}

function mount(client: RendererSkillsClient | null, connections = diagnostics("pi", "grok")) {
  const page = createSkillsSettingsPage(
    rendererSettingsMessages("zh-CN"),
    () => client,
    () => connections,
  );
  const document = new FakeDocument();
  const content = document.createElement("main");
  const scope = new RendererSettingsPageScope();
  page.mount({
    content: content as unknown as HTMLElement,
    signal: scope.signal,
    runLatest: (operation, handlers) => scope.runLatest(operation, handlers),
  });
  return content;
}

function toggles(content: FakeElement): FakeElement[] {
  return descendants(content).filter((element) =>
    element.className.startsWith("settings-skill-toggle"),
  );
}

describe("Skill targets", () => {
  it("keeps Codex and connected Harnesses, and drops disconnected ones", () => {
    const available = connectedSkillTargets(catalog(), new Set(["pi", "grok"]));

    expect(available.map(({ harnessId }) => harnessId)).toEqual(["codex", "pi", "grok"]);
  });

  it("drops a Harness whose directory exists only because codexhost wrote to it", () => {
    // ~/.claude/skills holds the delegation Skill even without Claude Code.
    const available = connectedSkillTargets(catalog(), new Set(["pi"]));

    expect(available.some(({ harnessId }) => harnessId === "claude-code")).toBe(false);
  });
});

describe("Skill filtering", () => {
  it("matches on name and description, and keeps everything for an empty query", () => {
    const skill = catalog().skills[0];
    if (!skill) throw new Error("Fixture Skill is missing");
    expect(skillMatchesQuery(skill, "")).toBe(true);
    expect(skillMatchesQuery(skill, "YUQUE")).toBe(true);
    expect(skillMatchesQuery(skill, "documents")).toBe(true);
    expect(skillMatchesQuery(skill, "nothing")).toBe(false);
  });
});

describe("Skills settings page", () => {
  it("is registered with a localized label", () => {
    const page = createSkillsSettingsPage(rendererSettingsMessages("zh-CN"), () => null);
    expect(page.id).toBe("skills");
    expect(page.label).toBe("技能");
  });

  it("reports the Host capability as missing instead of rendering an empty panel", () => {
    expect(text(mount(null))).toContain("运行时尚未安装该项能力");
  });

  it("offers a control only for connected Harnesses that need a link", async () => {
    const client = fakeClient();
    const content = mount(client);
    await vi.waitFor(() => expect(client.inspectSkills).toHaveBeenCalled());

    // Two Skills; Codex and Pi need links, Grok reads the shared directory and
    // Claude Code is not connected.
    expect(toggles(content)).toHaveLength(4);
    const labels = toggles(content).map((toggle) => toggle.getAttribute("aria-label") ?? "");
    expect(labels.some((label) => label.startsWith("Codex"))).toBe(true);
    expect(labels.some((label) => label.startsWith("Pi"))).toBe(true);
    expect(labels.some((label) => label.startsWith("Grok"))).toBe(false);
    expect(labels.some((label) => label.startsWith("Claude"))).toBe(false);
  });

  it("explains that a natively supported Harness needs no link", async () => {
    const client = fakeClient();
    const content = mount(client);
    await vi.waitFor(() => expect(client.inspectSkills).toHaveBeenCalled());

    expect(text(content)).toContain("Grok");
    expect(text(content)).toContain("原生读取该目录");
  });

  it("renders each control as the Harness icon rather than a text label", async () => {
    const client = fakeClient();
    const content = mount(client);
    await vi.waitFor(() => expect(client.inspectSkills).toHaveBeenCalled());

    for (const toggle of toggles(content)) {
      expect(toggle.textContent).toBe("");
      expect(toggle.children).toContain(
        toggle.getAttribute("aria-label")?.startsWith("Codex") ? "icon:codex" : "icon:pi",
      );
    }
  });

  it("links an unlinked Skill and unlinks a linked one through the same control", async () => {
    const client = fakeClient();
    const content = mount(client);
    await vi.waitFor(() => expect(client.inspectSkills).toHaveBeenCalled());

    const linked = toggles(content).find(
      (toggle) => toggle.getAttribute("aria-pressed") === "true",
    );
    const unlinked = toggles(content).find(
      (toggle) => toggle.getAttribute("aria-pressed") === "false",
    );
    if (!linked || !unlinked) throw new Error("Skill toggles are not rendered");

    unlinked.dispatch("click");
    await vi.waitFor(() => expect(client.linkSkill).toHaveBeenCalled());
    expect(client.linkSkill.mock.calls[0]?.[0]).toMatchObject({ action: "link" });

    linked.dispatch("click");
    await vi.waitFor(() => expect(client.linkSkill).toHaveBeenCalledTimes(2));
    expect(client.linkSkill.mock.calls[1]?.[0]).toMatchObject({
      action: "unlink",
      harnessId: "codex",
    });
  });

  it("offers removal for a link whose source Skill is gone", async () => {
    const client = fakeClient();
    const content = mount(client);
    await vi.waitFor(() => expect(client.inspectSkills).toHaveBeenCalled());

    const broken = descendants(content).find((element) => element.className.includes("is-broken"));
    if (!broken) throw new Error("Broken link row is not rendered");
    expect(text(broken)).toContain("链接指向的技能已不存在");

    const remove = descendants(broken).find((element) =>
      element.className.includes("settings-command-button"),
    );
    if (!remove) throw new Error("Broken link removal is not offered");
    remove.dispatch("click");
    await vi.waitFor(() => expect(client.linkSkill).toHaveBeenCalled());
    expect(client.linkSkill.mock.calls[0]?.[0]).toMatchObject({
      skill: "removed",
      harnessId: "codex",
      action: "unlink",
    });
  });

  it("surfaces a link failure without dropping the rendered catalog", async () => {
    const client = fakeClient(async () => {
      throw new Error("codex has no local Skill directory");
    });
    const content = mount(client);
    await vi.waitFor(() => expect(client.inspectSkills).toHaveBeenCalled());

    const toggle = toggles(content)[0];
    if (!toggle) throw new Error("Skill toggle is not rendered");
    toggle.dispatch("click");

    await vi.waitFor(() => expect(text(content)).toContain("codex has no local Skill directory"));
    expect(text(content)).toContain("yuque-kit");
  });
});
