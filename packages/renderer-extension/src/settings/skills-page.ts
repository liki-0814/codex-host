import type {
  HarnessSkill,
  HarnessSkillCatalog,
  HarnessSkillTarget,
} from "@codexhost/shared-contracts";

import { KNOWN_RENDERER_AGENTS, type RendererAgent } from "../agent-selection-state.js";
import { createRendererAgentIcon, RENDERER_AGENT_LABELS } from "../renderer-agent-icon.js";
import type { RendererConnectionDiagnostics } from "./connections-page.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";

export interface RendererSkillsClient {
  inspectSkills(): Promise<HarnessSkillCatalog>;
  linkSkill(input: {
    skill: string;
    harnessId: string;
    action: "link" | "unlink";
  }): Promise<HarnessSkillCatalog>;
}

function rendererAgent(id: string): RendererAgent | null {
  const index = (KNOWN_RENDERER_AGENTS as readonly string[]).indexOf(id);
  return index === -1 ? null : (KNOWN_RENDERER_AGENTS[index] ?? null);
}

function harnessLabel(id: string): string {
  const agent = rendererAgent(id);
  return agent ? RENDERER_AGENT_LABELS[agent] : id;
}

export function skillMatchesQuery(skill: HarnessSkill, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    skill.name.toLowerCase().includes(trimmed) || skill.description.toLowerCase().includes(trimmed)
  );
}

/**
 * Codex is always listed. Every other Harness has to be connected. Directory
 * existence is not a substitute: codexhost writes a delegation Skill into
 * `~/.claude/skills` itself.
 */
export function connectedSkillTargets(
  catalog: HarnessSkillCatalog,
  connected: ReadonlySet<string>,
): readonly HarnessSkillTarget[] {
  return catalog.targets.filter(
    ({ harnessId }) => harnessId === "codex" || connected.has(harnessId),
  );
}

/** Hide a Harness whose copy of this Skill is not the file in `~/.agents/skills`. */
export function skillLinkTargets(
  skill: HarnessSkill,
  targets: readonly HarnessSkillTarget[],
): readonly HarnessSkillTarget[] {
  const local = new Set(skill.localHarnessIds);
  return targets.filter((target) => !local.has(target.harnessId));
}

function connectedAgents(diagnostics: RendererConnectionDiagnostics | null): ReadonlySet<string> {
  const connected = new Set<string>();
  for (const host of diagnostics?.snapshot().hosts ?? []) {
    for (const agent of host.agents) {
      if (agent.availability === "ready") connected.add(agent.agent);
    }
  }
  return connected;
}

export function createSkillsSettingsPage(
  messages: RendererSettingsMessages,
  getClient: () => RendererSkillsClient | null,
  getDiagnostics: () => RendererConnectionDiagnostics | null = () => null,
): RendererSettingsPageDefinition {
  return Object.freeze({
    id: "skills",
    label: messages.pageLabels.skills,
    icon: "skills",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const heading = document.createElement("div");
      heading.className = "settings-section-label";
      heading.textContent = messages.pageLabels.skills;
      const description = document.createElement("p");
      description.className = "settings-page-description";
      description.textContent = messages.skillsDescription;
      const native = document.createElement("p");
      native.className = "settings-skill-native";
      const searchRow = document.createElement("div");
      searchRow.className = "settings-skill-search";
      searchRow.append(createRendererSettingsIcon("search", 16));
      const search = document.createElement("input");
      search.type = "search";
      search.className = "settings-skill-search__input";
      search.placeholder = messages.skillsSearchPlaceholder;
      search.setAttribute("aria-label", messages.skillsSearchPlaceholder);
      searchRow.append(search);
      const list = document.createElement("div");
      list.className = "settings-skill-list";
      list.setAttribute("aria-live", "polite");
      const status = document.createElement("p");
      status.className = "settings-skill-status";
      status.setAttribute("role", "status");
      context.content.append(heading, description, native, searchRow, list, status);

      let catalog: HarnessSkillCatalog | null = null;
      let busy = false;
      const setStatus = (text: string): void => {
        status.textContent = text;
        status.hidden = text.length === 0;
      };
      const run = (
        operation: (client: RendererSkillsClient) => Promise<HarnessSkillCatalog>,
      ): void => {
        const client = getClient();
        if (!client) {
          list.replaceChildren();
          setStatus(messages.runtimeCapabilityNotInstalled);
          return;
        }
        if (busy) return;
        busy = true;
        render();
        void context.runLatest(() => operation(client), {
          success(result) {
            busy = false;
            catalog = result;
            setStatus("");
            render();
          },
          failure(error) {
            busy = false;
            setStatus(error instanceof Error ? error.message : String(error));
            render();
          },
        });
      };
      const createTargetToggle = (
        skill: HarnessSkill,
        target: HarnessSkillTarget,
      ): HTMLButtonElement => {
        const linked = (skill.linkedHarnessIds as readonly string[]).includes(target.harnessId);
        const button = document.createElement("button");
        button.type = "button";
        button.className = linked ? "settings-skill-toggle is-linked" : "settings-skill-toggle";
        button.disabled = busy;
        button.setAttribute("aria-pressed", linked ? "true" : "false");
        const label = harnessLabel(target.harnessId);
        const agent = rendererAgent(target.harnessId);
        button.setAttribute("aria-label", `${label} · ${target.directory}`);
        button.title = button.getAttribute("aria-label") ?? label;
        button.append(
          agent
            ? createRendererAgentIcon(agent, 16, document)
            : createRendererSettingsIcon("link", 16),
        );
        button.addEventListener("click", () =>
          run((client) =>
            client.linkSkill({
              skill: skill.name,
              harnessId: target.harnessId,
              action: linked ? "unlink" : "link",
            }),
          ),
        );
        return button;
      };
      const createSkillRow = (
        skill: HarnessSkill,
        targets: readonly HarnessSkillTarget[],
      ): HTMLElement => {
        const row = document.createElement("div");
        row.className = "settings-skill-row";
        const copy = document.createElement("div");
        copy.className = "settings-skill-row__copy";
        const name = document.createElement("strong");
        name.textContent = skill.name;
        const detail = document.createElement("span");
        detail.className = "settings-skill-row__description";
        detail.textContent = skill.description;
        detail.title = skill.path;
        copy.append(name, detail);
        const actions = document.createElement("div");
        actions.className = "settings-skill-row__targets";
        for (const target of targets) actions.append(createTargetToggle(skill, target));
        row.append(copy, actions);
        return row;
      };
      const createBrokenRow = (harnessId: string, name: string): HTMLElement => {
        const row = document.createElement("div");
        row.className = "settings-skill-row is-broken";
        const copy = document.createElement("div");
        copy.className = "settings-skill-row__copy";
        const title = document.createElement("strong");
        title.textContent = name;
        const detail = document.createElement("span");
        detail.className = "settings-skill-row__description";
        detail.textContent = `${harnessLabel(harnessId)} · ${messages.skillsBrokenLink}`;
        copy.append(title, detail);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "settings-command-button settings-command-button--secondary";
        remove.disabled = busy;
        remove.append(createRendererSettingsIcon("trash", 14), messages.skillsRemoveBrokenLink);
        remove.addEventListener("click", () =>
          run((client) => client.linkSkill({ skill: name, harnessId, action: "unlink" })),
        );
        row.append(copy, remove);
        return row;
      };
      const render = (): void => {
        if (!catalog) return;
        const current = catalog;
        const available = connectedSkillTargets(current, connectedAgents(getDiagnostics()));
        const linkTargets = available.filter((target) => target.access === "link");
        const nativeLabels = available
          .filter((target) => target.access === "native")
          .map((target) => harnessLabel(target.harnessId));
        native.textContent = nativeLabels.length
          ? `${nativeLabels.join("、")} ${messages.skillsNativeAccess}`
          : "";
        native.hidden = nativeLabels.length === 0;
        const query = search.value;
        const matched = current.skills.filter((skill) => skillMatchesQuery(skill, query));
        const broken = query.trim()
          ? []
          : current.brokenLinks.filter(({ harnessId }) =>
              available.some((target) => target.harnessId === harnessId),
            );
        list.replaceChildren();
        for (const skill of matched) {
          list.append(createSkillRow(skill, skillLinkTargets(skill, linkTargets)));
        }
        for (const link of broken) list.append(createBrokenRow(link.harnessId, link.name));
        if (matched.length === 0 && broken.length === 0) {
          const empty = document.createElement("p");
          empty.className = "settings-skill-empty";
          empty.textContent = query.trim() ? messages.skillsNoMatches : messages.skillsEmpty;
          list.append(empty);
        }
      };
      search.addEventListener("input", () => render());
      setStatus("");
      run((client) => client.inspectSkills());
      return undefined;
    },
  });
}
