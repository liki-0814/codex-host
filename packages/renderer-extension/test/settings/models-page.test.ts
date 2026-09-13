import { describe, expect, it } from "vitest";

import { rendererSettingsMessages } from "../../src/settings/localization.js";
import { createModelsSettingsPage } from "../../src/settings/models-page.js";

describe("models settings page", () => {
  it("registers a Cursor model visibility page", () => {
    const page = createModelsSettingsPage(rendererSettingsMessages("zh-CN"));
    expect(page.id).toBe("models");
    expect(page.label).toBe("模型");
    expect(page.icon).toBe("model-pool");
  });
});

