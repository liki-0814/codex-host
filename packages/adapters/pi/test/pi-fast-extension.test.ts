import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  configuredModelRef,
  harnessModelCatalogSchema,
  selectModelConfiguration,
} from "@codexhost/shared-contracts";
import { encodePiModelRef, decodePiModelRef } from "../src/pi-model-catalog.js";
import {
  PI_FAST_EXTENSION,
  piFastModels,
  piFastValue,
  withPiFast,
  installedPiFastExtension,
  installPiFastExtension,
} from "../src/pi-fast-extension.js";

describe("Pi optional Codex Fast", () => {
  it("requires explicit installation and native priority capability, without guessing model names", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "pi-fast-"));
    const environment = { HOME: home };
    try {
      expect(installedPiFastExtension(environment)).toBeUndefined();
      expect(piFastModels(environment).size).toBe(0);
      await mkdir(path.join(home, ".codex"));
      await writeFile(
        path.join(home, ".codex", "models_cache.json"),
        JSON.stringify({
          models: [
            { slug: "future-model", service_tiers: [{ id: "priority" }] },
            { slug: "gpt-5.5" },
          ],
        }),
      );
      expect([...piFastModels(environment)]).toEqual(["future-model"]);
      await installPiFastExtension(environment);
      expect(installedPiFastExtension(environment)).toContain(
        ".codexhost/extensions/pi-codex-fast",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("stages Fast separately from reasoning and rejects unsupported configurations", () => {
    const model = encodePiModelRef({ provider: "openai-codex", id: "future-model" });
    const supported = new Set(["future-model"]);
    const catalog = withPiFast(
      harnessModelCatalogSchema.parse({
        models: [{ ref: model, label: "Future", supportedThinkingOptionIds: ["high"] }],
        defaultModel: model,
        thinkingOptions: [{ id: "high", label: "High" }],
        defaultThinkingOptionId: "high",
      }),
      supported,
    );
    expect(catalog.configurationOptions?.[0]?.currentValue).toBe("false");
    const selected = selectModelConfiguration(catalog, configuredModelRef(model, { fast: "true" }));
    expect(selected.defaultThinkingOptionId).toBe("high");
    if (!selected.defaultModel) throw new Error("Missing selected model");
    const selectedModel = selected.defaultModel;
    expect(piFastValue(selectedModel, supported)).toBe(true);
    expect(decodePiModelRef(selected.defaultModel)).toEqual({
      provider: "openai-codex",
      id: "future-model",
    });
    expect(() => piFastValue(selectedModel, new Set())).toThrow("unavailable");
    expect(() => piFastValue(configuredModelRef(model, { fast: "garbage" }), supported)).toThrow(
      "Invalid",
    );
  });
  it("passes priority only when enabled for Codex, retaining native reasoning and pricing options", async () => {
    // Replace only module imports; execute the actual installed extension body.
    const source = PI_FAST_EXTENSION.slice(PI_FAST_EXTENSION.indexOf("export default"));
    const stream = vi.fn();
    const create = new Function(
      "streamOpenAICodexResponses",
      "clampThinkingLevel",
      source.replace("export default function", "return function"),
    );
    let handler!: (mode: string) => Promise<void>;
    let send!: (model: unknown, context: unknown, options: unknown) => void;
    create(
      stream,
      (_: unknown, level: string) => level,
    )({
      registerCommand: (_: string, command: { handler: typeof handler }) => {
        handler = command.handler;
      },
      registerProvider: (_: string, provider: { streamSimple: typeof send }) => {
        send = provider.streamSimple;
      },
    });
    const model = { provider: "openai-codex" };
    const options = { reasoning: "high", apiKey: "fixture" };
    send(model, {}, options);
    expect(stream.mock.lastCall?.[2]).not.toHaveProperty("serviceTier");
    await handler("on");
    send(model, {}, options);
    expect(stream.mock.lastCall?.[2]).toMatchObject({
      serviceTier: "priority",
      reasoningEffort: "high",
      apiKey: "fixture",
    });
    send({ provider: "other" }, {}, options);
    expect(stream.mock.lastCall?.[2]).not.toHaveProperty("serviceTier");
    await handler("off");
    send(model, {}, options);
    expect(stream.mock.lastCall?.[2]).not.toHaveProperty("serviceTier");
    await expect(handler("invalid")).rejects.toThrow();
  });
});
