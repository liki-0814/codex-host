import { configuredModelRef, harnessModelRefSchema } from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";
import {
  modelVisibilityId,
  readHiddenModels,
  writeHiddenModels,
} from "../src/renderer-model-visibility.js";

describe("front-end model visibility", () => {
  it("persists independently per Harness and restores without touching catalogs", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    for (const harness of ["pi", "qoder", "cursor-cli", "grok"]) {
      writeHiddenModels(storage, harness, [harness, harness]);
      expect([...readHiddenModels(storage, harness)]).toEqual([harness]);
    }
    writeHiddenModels(storage, "pi", []);
    expect(readHiddenModels(storage, "pi").size).toBe(0);
    expect([...readHiddenModels(storage, "qoder")]).toEqual(["qoder"]);
  });
  it("hides all parameter selections of the same model", () => {
    const ref = harnessModelRefSchema.parse({ id: "cursor.model" });
    expect(modelVisibilityId(configuredModelRef(ref, { fast: "true" }))).toBe(ref.id);
    expect(modelVisibilityId(configuredModelRef(ref, { fast: "false" }))).toBe(ref.id);
  });
  it("ignores corrupt preferences", () => {
    for (const raw of ["not json", "null", "{}", "[5,null]"])
      expect(readHiddenModels({ getItem: () => raw }, "pi").size).toBe(0);
  });
});
