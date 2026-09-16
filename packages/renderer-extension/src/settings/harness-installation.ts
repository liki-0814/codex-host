import { harnessIdSchema, type HarnessInstallationState } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";

/** One panel per tab, so late checks and updates never overwrite another Harness. */
export function createHarnessInstallation(
  document: Document,
  signal: AbortSignal,
  getClient: () => Pick<RendererModelClient, "installation"> | null,
  id: string,
  label: string,
  zh: boolean,
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "settings-preference-row";
  const copy = document.createElement("span");
  copy.className = "settings-preference-row__copy";
  const title = document.createElement("strong");
  title.textContent = zh ? `${label} 版本` : `${label} version`;
  const detail = document.createElement("span");
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  copy.append(title, detail, status);
  const actions = document.createElement("div");
  actions.className = "settings-model-toolbar";
  const check = document.createElement("button");
  check.type = "button";
  check.className = "settings-command-button settings-command-button--secondary";
  check.textContent = zh ? "检查更新" : "Check for updates";
  const update = document.createElement("button");
  update.type = "button";
  update.className = check.className;
  update.disabled = true;
  actions.append(check, update);
  panel.append(copy, actions);
  let state: HarnessInstallationState | undefined;
  let busy = false;
  const render = () => {
    detail.textContent = zh
      ? `当前版本：${state?.currentVersion ?? "—"} · 最新版本：${state?.latestVersion ?? "—"}`
      : `Current: ${state?.currentVersion ?? "—"} · Latest: ${state?.latestVersion ?? "—"}`;
    check.disabled = busy;
    update.disabled = busy || !state?.canUpdate || !state.updateAvailable;
    update.textContent =
      state && !state.updateAvailable ? (zh ? "已是最新" : "Up to date") : zh ? "更新" : "Update";
  };
  const run = async (action: "check" | "update") => {
    if (busy || signal.aborted) return;
    busy = true;
    status.textContent =
      action === "update" ? (zh ? "正在更新…" : "Updating…") : zh ? "正在检查…" : "Checking…";
    render();
    try {
      const client = getClient();
      if (!client?.installation)
        throw new Error(
          zh ? "当前 Host 不支持版本管理" : "Version management is unavailable on this Host",
        );
      const result = await client.installation({ harnessId: harnessIdSchema.parse(id), action });
      if (signal.aborted) return;
      state = result;
      status.textContent =
        result.message ??
        (action === "update"
          ? zh
            ? "更新完成，新会话将使用新版本。"
            : "Updated. New sessions will use the new version."
          : "");
    } catch (error) {
      if (signal.aborted) return;
      status.textContent = error instanceof Error ? error.message : String(error);
      // Keep known version labels, but require a successful fresh check before retrying update.
      if (state) state = { ...state, canUpdate: false };
    } finally {
      busy = false;
      if (!signal.aborted) render();
    }
  };
  check.addEventListener("click", () => void run("check"));
  update.addEventListener("click", () => void run("update"));
  const owner = document.defaultView;
  const timer = owner?.setInterval(() => {
    if (!panel.hidden && document.visibilityState !== "hidden") void run("check");
  }, 300_000);
  signal.addEventListener(
    "abort",
    () => {
      if (timer !== undefined) owner?.clearInterval(timer);
    },
    { once: true },
  );
  render();
  void run("check");
  return panel;
}
