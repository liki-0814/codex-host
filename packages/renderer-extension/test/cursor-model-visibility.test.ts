import { describe, expect, it } from "vitest";

import {
  CURSOR_HIDDEN_MODELS_STORAGE_KEY,
  isCursorModelHidden,
  readCursorHiddenModelIds,
  setCursorModelHidden,
} from "../src/cursor-model-visibility.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
  };
}

describe("cursor model visibility", () => {
  it("hides models except the current selection", () => {
    const storage = memoryStorage();
    setCursorModelHidden("cursor.a", true, storage, null);
    expect(isCursorModelHidden("cursor.a", "cursor.b", storage)).toBe(true);
    expect(isCursorModelHidden("cursor.a", "cursor.a", storage)).toBe(false);
    expect([...readCursorHiddenModelIds(storage)]).toEqual(["cursor.a"]);
    expect(JSON.parse(storage.getItem(CURSOR_HIDDEN_MODELS_STORAGE_KEY) ?? "[]")).toEqual([
      "cursor.a",
    ]);
  });
});
