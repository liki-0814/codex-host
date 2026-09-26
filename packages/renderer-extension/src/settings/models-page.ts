import { harnessIdSchema, type HarnessModelCatalog } from "@codexhost/shared-contracts";

import {
  getSharedAgentGroupPreferenceStore,
  mainConnectionAgentOrder,
} from "../agent-group-preference.js";
import type { RendererModelClient } from "../renderer-model-client.js";
import {
  MODEL_VISIBILITY_CHANGED,
  modelVisibilityId,
  readHiddenModels,
  writeHiddenModels,
} from "../renderer-model-visibility.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createHarnessInstallation } from "./harness-installation.js";
import { createRendererSettingsIcon } from "./icons.js";
import { createPiPermissionSetup, PI_EXTENSION_CHANGED } from "./pi-permission-setup.js";
import type { RendererSettingsMessages } from "./localization.js";

export type RendererModelsClient = Pick<
  RendererModelClient,
  "inspectHarness" | "installation" | "extension"
>;

const HARNESSES = [
  ["pi", "Pi"],
  ["qoder", "Qoder"],
  ["kimi-code", "Kimi Code"],
  ["cursor-cli", "Cursor"],
  ["grok", "Grok"],
  ["antigravity", "Antigravity"],
] as const;

export function createModelsSettingsPage(
  messages: RendererSettingsMessages,
  getClient: () => RendererModelsClient | null,
): RendererSettingsPageDefinition {
  const zh = messages.locale === "zh-CN";
  return Object.freeze({
    id: "models",
    label: messages.pageLabels.models,
    icon: "model-pool",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const ownerWindow = document.defaultView;
      if (!ownerWindow) return;
      const heading = document.createElement("div");
      heading.className = "settings-section-label";
      heading.textContent = messages.pageLabels.models;
      const description = document.createElement("p");
      description.className = "settings-page-description";
      description.textContent = zh
        ? "选择模型菜单中显示的模型，或检查并更新 Harness。模型显示设置仅影响 Codex Host，不更改当前会话。"
        : "Choose visible models, or check and update Harnesses. Model visibility only affects Codex Host, not the current conversation.";
      const tabs = document.createElement("div");
      tabs.className = "settings-model-tabs";
      const search = document.createElement("input");
      search.type = "search";
      search.className = "settings-model-search";
      search.placeholder = zh ? "搜索模型…" : "Search models…";
      search.setAttribute("aria-label", search.placeholder);
      const count = document.createElement("span");
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "settings-command-button settings-command-button--secondary";
      restore.textContent = zh ? "全部显示" : "Show all";
      const hideAll = document.createElement("button");
      hideAll.type = "button";
      hideAll.className = restore.className;
      hideAll.textContent = zh ? "全部隐藏" : "Hide all";
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = restore.className;
      reload.append(createRendererSettingsIcon("refresh", 14), zh ? "重新识别模型" : "Reload models");
      const toolbar = document.createElement("div");
      toolbar.className = "settings-model-toolbar";
      toolbar.append(search, count, reload, hideAll, restore);
      const status = document.createElement("p");
      status.className = "settings-model-status";
      status.setAttribute("role", "status");
      const list = document.createElement("div");
      list.className = "settings-model-list";
      const permissionSetup = createPiPermissionSetup(document, context.signal, getClient, zh);
      const fastSetup = createPiPermissionSetup(
        document,
        context.signal,
        getClient,
        zh,
        "codex-fast",
      );
      context.content.append(heading, description, tabs, permissionSetup, fastSetup, toolbar, status, list);
      const installations = new Map<string, HTMLElement>();
      let harness = "";
      let catalog: HarnessModelCatalog | undefined;
      const cache = new Map<string, HarnessModelCatalog>();
      const buttons = new Map<string, HTMLButtonElement>();
      const save = (hidden: Set<string>): boolean => {
        try {
          writeHiddenModels(ownerWindow.localStorage, harness, hidden);
          ownerWindow.dispatchEvent(new Event(MODEL_VISIBILITY_CHANGED));
          return true;
        } catch {
          status.textContent = zh ? "保存失败，请重试。" : "Could not save. Try again.";
          return false;
        }
      };
      const render = (): void => {
        list.replaceChildren();
        const hidden = readHiddenModels(ownerWindow.localStorage, harness);
        const models = catalog?.models ?? [];
        const shown = models.filter((model) => !hidden.has(modelVisibilityId(model.ref))).length;
        count.textContent = zh
          ? `${shown} / ${models.length} 已显示`
          : `${shown} / ${models.length} visible`;
        restore.disabled = !hidden.size;
        hideAll.disabled = shown === 0;
        const query = search.value.trim().toLowerCase();
        const matches = models
          .filter((model) => model.label.toLowerCase().includes(query))
          .sort(
            (left, right) =>
              Number(hidden.has(modelVisibilityId(left.ref))) -
              Number(hidden.has(modelVisibilityId(right.ref))),
          );
        if (catalog)
          status.textContent = !models.length
            ? zh
              ? "暂无可用模型"
              : "No models available"
            : !matches.length
              ? zh
                ? "没有匹配的模型"
                : "No matching models"
              : "";
        for (const model of matches) {
          const row = document.createElement("label");
          row.className = "settings-model-row";
          const name = document.createElement("span");
          name.textContent = model.label;
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.setAttribute("role", "switch");
          checkbox.setAttribute("aria-label", model.label);
          checkbox.checked = !hidden.has(modelVisibilityId(model.ref));
          checkbox.addEventListener("change", () => {
            const next = readHiddenModels(ownerWindow.localStorage, harness);
            const id = modelVisibilityId(model.ref);
            if (checkbox.checked) next.delete(id);
            else next.add(id);
            if (!save(next)) {
              checkbox.checked = !checkbox.checked;
              return;
            }
            status.textContent = "";
            const visible = models.filter((item) => !next.has(modelVisibilityId(item.ref))).length;
            count.textContent = zh
              ? `${visible} / ${models.length} 已显示`
              : `${visible} / ${models.length} visible`;
            restore.disabled = !next.size;
            hideAll.disabled = visible === 0;
          });
          row.append(name, checkbox);
          list.append(row);
        }
      };
      const select = (id: string): void => {
        harness = id;
        if (!installations.has(id)) {
          const label = HARNESSES.find(([key]) => key === id)?.[1] ?? id;
          const panel = createHarnessInstallation(
            document,
            context.signal,
            getClient,
            id,
            label,
            zh,
          );
          installations.set(id, panel);
          context.content.insertBefore(panel, toolbar);
        }
        for (const [key, panel] of installations) panel.hidden = key !== id;
        permissionSetup.hidden = fastSetup.hidden = id !== "pi";
        search.value = "";
        catalog = cache.get(id);
        for (const [key, button] of buttons)
          button.setAttribute("aria-pressed", String(key === id));
        render();
        load(id);
      };
      const load = (id: string, refresh = false): void => {
        if (refresh) {
          cache.delete(id);
          catalog = undefined;
          reload.disabled = true;
        }
        void context.runLatest(
          async () => {
            if (catalog) return catalog;
            const client = getClient();
            if (!client) throw new Error(messages.runtimeCapabilityNotInstalled);
            status.textContent = refresh
              ? zh
                ? "正在重新识别模型…"
                : "Reloading models…"
              : zh
                ? "正在加载模型…"
                : "Loading models…";
            const inspection = await client.inspectHarness({
              harnessId: harnessIdSchema.parse(id),
              ...(refresh ? { refresh: true } : {}),
            });
            if (inspection.status !== "ready") throw new Error(inspection.error.message);
            return inspection.catalog;
          },
          {
            success(value) {
              reload.disabled = false;
              cache.set(id, value);
              catalog = value;
              render();
            },
            failure(error) {
              reload.disabled = false;
              status.textContent = error instanceof Error ? error.message : messages.notAvailable;
            },
          },
        );
      };
      reload.addEventListener("click", () => load(harness, true));
      const visibleHarnesses = (): Array<(typeof HARNESSES)[number]> => {
        const order = mainConnectionAgentOrder(getSharedAgentGroupPreferenceStore());
        return order.flatMap((agent) => {
          const entry = HARNESSES.find(([id]) => id === agent);
          return entry ? [entry] : [];
        });
      };
      const syncTabs = (): void => {
        const visible = visibleHarnesses();
        tabs.replaceChildren();
        for (const [id, label] of visible) {
          let button = buttons.get(id);
          if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.addEventListener("click", () => select(id));
            buttons.set(id, button);
          }
          tabs.append(button);
        }
        if (!visible.some(([id]) => id === harness)) {
          const next = visible[0]?.[0];
          if (next) select(next);
          else {
            harness = "";
            for (const panel of installations.values()) panel.hidden = true;
            permissionSetup.hidden = fastSetup.hidden = true;
            catalog = undefined;
            render();
            status.textContent = zh ? "连接里还没有选用的 Harness。" : "No Harness is kept in Connections.";
          }
          return;
        }
        for (const [key, button] of buttons) {
          button.hidden = !visible.some(([id]) => id === key);
          button.setAttribute("aria-pressed", String(key === harness));
        }
      };
      search.addEventListener("input", render);
      hideAll.addEventListener("click", () => {
        if (!catalog) return;
        const hidden = readHiddenModels(ownerWindow.localStorage, harness);
        for (const model of catalog.models) hidden.add(modelVisibilityId(model.ref));
        if (save(hidden)) render();
      });
      restore.addEventListener("click", () => {
        if (save(new Set())) render();
      });
      context.signal.addEventListener("abort", getSharedAgentGroupPreferenceStore().subscribe(syncTabs), {
        once: true,
      });
      syncTabs();
      ownerWindow.addEventListener(
        PI_EXTENSION_CHANGED,
        () => {
          cache.delete("pi");
          if (harness === "pi") load("pi", true);
        },
        { signal: context.signal },
      );
      return undefined;
    },
  });
}
