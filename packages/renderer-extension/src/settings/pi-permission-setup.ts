import { harnessIdSchema } from "@codexhost/shared-contracts";

import type { RendererModelClient } from "../renderer-model-client.js";

export const PI_EXTENSION_CHANGED = "codexhost-pi-extension-changed";

export function createPiPermissionSetup(
  document: Document,
  signal: AbortSignal,
  getClient: () => Pick<RendererModelClient, "extension"> | null,
  zh: boolean,
  extensionId: "permissions" | "codex-fast" = "permissions",
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "settings-preference-row";
  const copy = document.createElement("span");
  copy.className = "settings-preference-row__copy";
  const title = document.createElement("strong");
  const fast = extensionId === "codex-fast";
  title.textContent = fast ? "Pi Codex Fast" : zh ? "Pi 工具审批" : "Pi tool approval";
  const detail = document.createElement("span");
  detail.textContent = fast
    ? zh
      ? "为支持的 Codex 模型启用 Fast 开关，默认关闭；开启后用量增加。安装后用于新会话。"
      : "Adds a Fast switch for supported Codex models. Off by default; increased usage when enabled. Available in new sessions."
    : zh
      ? "安装后可在新建 Pi 会话中选择审批方式，不修改 Pi 全局配置。"
      : "Install to choose approval modes in new Pi sessions. Leaves global Pi settings unchanged.";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  copy.append(title, detail, status);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-command-button settings-command-button--secondary";
  button.textContent = zh ? "检查中…" : "Checking…";
  button.disabled = true;
  panel.append(copy, button);
  let nextAction: "inspect" | "install" = "inspect";
  const run = async (action: "inspect" | "install"): Promise<void> => {
    button.disabled = true;
    status.textContent = "";
    try {
      const client = getClient();
      if (!client?.extension)
        throw new Error(
          zh ? "当前 Host 不支持扩展安装" : "Extension installation is unavailable on this Host",
        );
      const result = await client.extension({
        harnessId: harnessIdSchema.parse("pi"),
        extensionId,
        action,
      });
      if (signal.aborted) return;
      nextAction = "install";
      if (result.available === false && !result.installed) {
        button.textContent = zh ? "暂无支持的 Codex 模型" : "No supported Codex models";
        button.disabled = true;
        return;
      }
      button.textContent = result.updateAvailable
        ? zh
          ? "更新扩展"
          : "Update extension"
        : result.installed
          ? zh
            ? "已安装"
            : "Installed"
          : zh
            ? fast
              ? "安装 Fast 扩展"
              : "安装审批扩展"
            : fast
              ? "Install Fast extension"
              : "Install approval extension";
      button.disabled = result.installed && !result.updateAvailable;
      if (action === "install" && result.installed)
        document.defaultView?.dispatchEvent(new Event(PI_EXTENSION_CHANGED));
    } catch (error) {
      if (signal.aborted) return;
      nextAction = action;
      status.textContent = error instanceof Error ? error.message : String(error);
      button.textContent = zh ? "重试" : "Retry";
      button.disabled = false;
    }
  };
  button.addEventListener("click", () => void run(nextAction));
  void run("inspect");
  return panel;
}
