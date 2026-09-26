import { harnessPermissionModeCatalogSchema } from "@codexhost/shared-contracts";

import {
  installPiExtension,
  piExtensionPath,
  piExtensionState,
  verifiedPiExtension,
} from "./pi-extension-storage.js";

export const PI_PERMISSION_COMMAND = "codexhost-permission-mode";
export const PI_PERMISSION_MODES = harnessPermissionModeCatalogSchema.parse({
  defaultModeId: "auto",
  modes: [
    {
      id: "approve",
      label: "需要审批",
      description: "Pi 工具执行前逐次确认",
    },
    {
      id: "auto",
      label: "自动执行",
      description: "不添加额外审批；保留其他 Pi 扩展的限制",
    },
  ],
});

/** Installed only after the user presses Install. The extension starts in approve until Host selects a mode. */
export const PI_PERMISSION_EXTENSION = `export default function(pi) {
  let mode = "approve";
  pi.registerCommand("${PI_PERMISSION_COMMAND}", {
    description: "Codex Host permission mode",
    handler: async (args) => {
      if (args !== "auto" && args !== "approve") throw new Error("Invalid permission mode");
      mode = args;
    }
  });
  pi.on("tool_call", async (event, ctx) => {
    if (mode === "auto") return;
    try {
      if (ctx.hasUI && await ctx.ui.confirm("允许 Pi 执行 " + event.toolName + "？", JSON.stringify(event.input))) return;
    } catch {}
    return { block: true, reason: "Tool execution was not approved" };
  });
}
`;

export function piPermissionExtensionPath(environment: NodeJS.ProcessEnv = process.env): string {
  return piExtensionPath("pi-permissions", environment);
}

export function installedPiPermissionExtension(
  environment?: NodeJS.ProcessEnv,
): string | undefined {
  return verifiedPiExtension(piPermissionExtensionPath(environment), PI_PERMISSION_EXTENSION);
}

export async function managePiPermissionExtension(
  id: string,
  action: "inspect" | "install",
  environment?: NodeJS.ProcessEnv,
): Promise<{ installed: boolean; updateAvailable?: boolean }> {
  if (id !== "permissions") throw new Error("Unknown Pi extension");
  const file = piPermissionExtensionPath(environment);
  if (action === "install") await installPiExtension(file, PI_PERMISSION_EXTENSION);
  return piExtensionState(file, PI_PERMISSION_EXTENSION);
}
