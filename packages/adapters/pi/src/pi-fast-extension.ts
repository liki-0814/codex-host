import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  configuredModelRef,
  readConfiguredModelRef,
  type HarnessModelCatalog,
  type HarnessModelRef,
} from "@codexhost/shared-contracts";

import { decodePiModelRef } from "./pi-model-catalog.js";
import {
  installPiExtension,
  piExtensionPath,
  piExtensionState,
  verifiedPiExtension,
} from "./pi-extension-storage.js";

export const PI_FAST_COMMAND = "codexhost-fast-mode";

/** Public Pi provider API. Fast only adds the priority service tier for Codex models. */
export const PI_FAST_EXTENSION = `import { streamOpenAICodexResponses, clampThinkingLevel } from "@earendil-works/pi-ai";
export default function(pi) {
  let enabled = false;
  pi.registerCommand("${PI_FAST_COMMAND}", {
    description: "Codex Host Fast mode",
    handler: async (value) => {
      if (value !== "on" && value !== "off") throw new Error("Invalid Fast mode");
      enabled = value === "on";
    }
  });
  pi.registerProvider("codexhost-fast-runtime", {
    api: "openai-codex-responses",
    streamSimple: (model, context, options) => {
      const level = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
      return streamOpenAICodexResponses(model, context, {
        ...options,
        reasoningEffort: level === "off" ? undefined : level,
        ...(enabled && model.provider === "openai-codex" ? { serviceTier: "priority" } : {})
      });
    }
  });
}
`;

export function installedPiFastExtension(environment?: NodeJS.ProcessEnv): string | undefined {
  return verifiedPiExtension(piExtensionPath("pi-codex-fast", environment), PI_FAST_EXTENSION);
}

/** Read the installed Codex model cache. Do not guess model names or read credentials. */
export function piFastModels(environment: NodeJS.ProcessEnv = process.env): Set<string> {
  try {
    const home =
      environment.CODEX_HOME ??
      path.join(environment.HOME ?? environment.USERPROFILE ?? homedir(), ".codex");
    const value: unknown = JSON.parse(readFileSync(path.join(home, "models_cache.json"), "utf8"));
    if (!value || typeof value !== "object" || !("models" in value) || !Array.isArray(value.models))
      return new Set();
    return new Set(
      value.models
        .filter(
          (model) =>
            typeof model.slug === "string" &&
            Array.isArray(model.service_tiers) &&
            model.service_tiers.some((tier: { id?: string }) => tier?.id === "priority"),
        )
        .map((model) => model.slug),
    );
  } catch {
    return new Set();
  }
}

export async function installPiFastExtension(environment?: NodeJS.ProcessEnv): Promise<void> {
  await installPiExtension(piExtensionPath("pi-codex-fast", environment), PI_FAST_EXTENSION);
}

export function piFastValue(ref: HarnessModelRef, supported: ReadonlySet<string>): boolean {
  const config = readConfiguredModelRef(ref);
  if (!config) return false;
  const native = decodePiModelRef(config.model);
  if (
    Object.keys(config.values).some((key) => key !== "fast") ||
    !["true", "false"].includes(config.values.fast ?? "")
  )
    throw new Error("Invalid Pi Fast configuration");
  if (config.values.fast !== "true") return false;
  if (native.provider !== "openai-codex" || !supported.has(native.id))
    throw new Error("Fast is unavailable for this Pi Model");
  return true;
}

export function withPiFast(
  catalog: HarnessModelCatalog,
  supported: ReadonlySet<string>,
): HarnessModelCatalog {
  const models = catalog.models.map((model) => {
    const native = decodePiModelRef(model.ref);
    const configurationOptions =
      native.provider === "openai-codex" && supported.has(native.id)
        ? [
            {
              id: "fast",
              label: "Fast",
              description: "Priority service; increased usage",
              currentValue: "false",
              options: ["false", "true"].map((value) => ({
                value,
                label: value === "true" ? "On" : "Off",
                model: configuredModelRef(model.ref, { fast: value }),
              })),
            },
          ]
        : [];
    return configurationOptions.length ? { ...model, configurationOptions } : model;
  });
  const selected = models.find((model) => model.ref.id === catalog.defaultModel?.id);
  return {
    ...catalog,
    models,
    ...(selected?.configurationOptions
      ? { configurationOptions: selected.configurationOptions }
      : {}),
  };
}

export function piFastExtensionState(environment?: NodeJS.ProcessEnv) {
  return piExtensionState(piExtensionPath("pi-codex-fast", environment), PI_FAST_EXTENSION);
}
