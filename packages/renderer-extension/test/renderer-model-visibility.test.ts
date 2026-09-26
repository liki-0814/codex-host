import { harnessModelRefSchema } from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";

import { modelVisibilityId, readHiddenModels, writeHiddenModels } from "../src/renderer-model-visibility.js";

describe("model visibility", () => {
  it("stores hidden model ids per Harness and ignores corrupt storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    writeHiddenModels(storage, "pi", ["gpt", "gpt"]);
    expect([...readHiddenModels(storage, "pi")]).toEqual(["gpt"]);
    expect(readHiddenModels(storage, "qoder").size).toBe(0);
    expect(readHiddenModels({ getItem: () => "{" }, "pi").size).toBe(0);
    expect(modelVisibilityId(harnessModelRefSchema.parse({ id: "gpt" }))).toBe("gpt");
  });
});
