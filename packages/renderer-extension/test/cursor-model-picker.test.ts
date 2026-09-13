import { describe, expect, it } from "vitest";

import { harnessModelCatalogSchema, harnessModelRefSchema } from "@codexhost/shared-contracts";

import { cursorModelPickerPresentation } from "../src/cursor-model-picker.js";

describe("cursor model picker presentation", () => {
  it("exposes Fast separately and does not repeat Fast in the thinking label", () => {
    const model = harnessModelRefSchema.parse({ id: "cursor.composer" });
    const off = "g.fast~false";
    const on = "g.fast~true";
    const catalog = harnessModelCatalogSchema.parse({
      models: [{ ref: model, label: "Composer 2.5", supportedThinkingOptionIds: [off, on] }],
      defaultModel: model,
      thinkingOptions: [
        { id: off, label: "Off" },
        { id: on, label: "Fast" },
      ],
    });
    const view = cursorModelPickerPresentation({
      status: "ready",
      catalog,
      selected: model,
      selectedThinkingOptionId: on,
      thinkingSelectionSupported: true,
    });
    expect(view.modelLabel).toBe("Composer 2.5");
    expect(view.thinkingLabel).toBeUndefined();
    expect(view.fast).toEqual({ enabled: true, nextThinkingOptionId: off });
    expect(view.groups).toEqual([]);
  });

  it("lists Reasoning independently from Fast", () => {
    const model = harnessModelRefSchema.parse({ id: "cursor.gpt" });
    const medium = "g.fast~false.reasoning~medium";
    const mediumFast = "g.fast~true.reasoning~medium";
    const high = "g.fast~false.reasoning~high";
    const highFast = "g.fast~true.reasoning~high";
    const catalog = harnessModelCatalogSchema.parse({
      models: [
        {
          ref: model,
          label: "GPT-5.6 Sol",
          supportedThinkingOptionIds: [medium, mediumFast, high, highFast],
        },
      ],
      defaultModel: model,
      thinkingOptions: [
        { id: medium, label: "Medium" },
        { id: mediumFast, label: "Medium · Fast" },
        { id: high, label: "High" },
        { id: highFast, label: "High · Fast" },
      ],
    });
    const view = cursorModelPickerPresentation({
      status: "ready",
      catalog,
      selected: model,
      selectedThinkingOptionId: medium,
      thinkingSelectionSupported: true,
    });
    expect(view.groups.map((group) => group.id)).toEqual(["reasoning"]);
    expect(view.thinkingLabel).toBe("Medium");
    expect(view.fast?.enabled).toBe(false);
  });
});
