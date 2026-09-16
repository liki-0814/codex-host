import { createKimiInstallation } from "./installation.js";
import type { HarnessPluginContext } from "@codexhost/harness-adapter/plugin";
import { KimiCodeAdapter } from "./adapter.js";
export function createHarnessAdapter(context: HarnessPluginContext): KimiCodeAdapter {
  return Object.assign(new KimiCodeAdapter({ environment: { ...context.environment } }), {
    installation: createKimiInstallation({ ...context.environment }),
  });
}
