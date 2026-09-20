import { createHarnessInstallation } from "./harness-installation.js";
import { createRendererSettingsIcon } from "./icons.js";
import { createPiPermissionSetup, PI_EXTENSION_CHANGED } from "./pi-permission-setup.js";
import { harnessIdSchema, type HarnessModelCatalog } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";
import {
  MODEL_VISIBILITY_CHANGED,
  modelVisibilityId,
  readHiddenModels,
  writeHiddenModels,
} from "../renderer-model-visibility.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import type { RendererSettingsMessages } from "./localization.js";

export type RendererModelsClient = Pick<
  RendererModelClient,
  "inspectHarness" | "extension" | "installation"
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
      // Harness Model catalogs are read once and cached. A Model added natively
      // is only picked up when the user asks for a fresh read.
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = restore.className;
      reload.append(
        createRendererSettingsIcon("refresh", 14),
        zh ? "重新识别模型" : "Reload models",
      );
      const toolbar = document.createElement("div");
      toolbar.className = "settings-model-toolbar";
      toolbar.append(search, count, reload, hideAll, restore);
      const status = document.createElement("p");
      status.className = "settings-model-status";
      status.setAttribute("role", "status");
      const list = document.createElement("div");
      list.className = "settings-model-list";
      context.content.append(heading, description, tabs, toolbar, status, list);
      const permissionSetup = createPiPermissionSetup(document, context.signal, getClient, zh);
      context.content.insertBefore(permissionSetup, toolbar);
      const fastSetup = createPiPermissionSetup(
        document,
        context.signal,
        getClient,
        zh,
        "codex-fast",
      );
      context.content.insertBefore(fastSetup, toolbar);
      const installations = new Map<string, HTMLElement>();
      let harness: string = "pi";
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
        const shown = models.filter((m) => !hidden.has(modelVisibilityId(m.ref))).length;
        count.textContent = zh
          ? `${shown} / ${models.length} 已显示`
          : `${shown} / ${models.length} visible`;
        restore.disabled = !hidden.size;
        hideAll.disabled = shown === 0;
        const query = search.value.trim().toLowerCase();
        // Visible Models lead, each group keeping the Harness catalog order.
        // The list is not otherwise reordered: the catalog order is the
        // Harness's own, and this page does not own a ranking of its own.
        const matches = models
          .filter((m) => m.label.toLowerCase().includes(query))
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
            const visible = models.filter((m) => !next.has(modelVisibilityId(m.ref))).length;
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
          context.content.insertBefore(panel, permissionSetup);
        }
        for (const [key, panel] of installations) panel.hidden = key !== id;
        permissionSetup.style.display = fastSetup.style.display = id === "pi" ? "" : "none";
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
        // runLatest also cancels stale results when a cached tab is selected.
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
              // Bypass the Host catalog cache so a natively added Model appears.
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
      for (const [id, label] of HARNESSES) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => select(id));
        buttons.set(id, button);
        tabs.append(button);
      }
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
      ownerWindow.addEventListener(
        PI_EXTENSION_CHANGED,
        () => {
          cache.delete("pi");
          if (harness === "pi") select("pi");
        },
        { signal: context.signal },
      );
      select(harness);
      return undefined;
    },
  });
}
