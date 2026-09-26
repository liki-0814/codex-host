import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { encodePiModelRef } from "../src/pi-model-catalog.js";
import {
  installedPiPermissionExtension,
  managePiPermissionExtension,
} from "../src/pi-permission-extension.js";
import { piFastValue, withPiFast } from "../src/pi-fast-extension.js";
import { harnessModelCatalogSchema } from "@codexhost/shared-contracts";

describe("Pi bundled extensions", () => {
  it("installs the approval extension only into Host storage", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "pi-permissions-"));
    try {
      const environment = { HOME: home };
      expect(await managePiPermissionExtension("permissions", "inspect", environment)).toEqual({
        installed: false,
      });
      expect(await managePiPermissionExtension("permissions", "install", environment)).toEqual({
        installed: true,
      });
      expect(installedPiPermissionExtension(environment)).toContain(".codexhost");
      const installed = installedPiPermissionExtension(environment);
      if (!installed) throw new Error("Missing installed extension");
      await writeFile(installed, "// earlier bundled version\n");
      expect(await managePiPermissionExtension("permissions", "inspect", environment)).toEqual({
        installed: true,
        updateAvailable: true,
      });
      expect(installedPiPermissionExtension(environment)).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("adds a Fast choice only for a Codex model the cache says supports priority", () => {
    const model = encodePiModelRef({ provider: "openai-codex", id: "future-model" });
    const catalog = withPiFast(
      harnessModelCatalogSchema.parse({
        models: [{ ref: model, label: "Future", supportedThinkingOptionIds: ["high"] }],
        defaultModel: model,
        thinkingOptions: [{ id: "high", label: "High" }],
        defaultThinkingOptionId: "high",
      }),
      new Set(["future-model"]),
    );
    const option = catalog.models[0]?.configurationOptions?.[0];
    expect(option?.currentValue).toBe("false");
    const enabled = option?.options.find((choice) => choice.value === "true")?.model;
    if (!enabled) throw new Error("Missing Fast model");
    expect(piFastValue(enabled, new Set(["future-model"]))).toBe(true);
    expect(() => piFastValue(enabled, new Set())).toThrow("unavailable");
    const disabled = option?.options.find((choice) => choice.value === "false")?.model;
    if (!disabled) throw new Error("Missing Fast off model");
    expect(piFastValue(disabled, new Set())).toBe(false);
  });
});
