import {
  readThreadPermissionModePreference,
  writeThreadPermissionModePreference,
} from "../src/renderer-permission-mode-preference.js";
import {
  harnessPermissionModeCatalogSchema,
  harnessPermissionModeIdSchema,
} from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";

import {
  CLAUDE_PERMISSION_MODE_PREFERENCE_KEY,
  readClaudePermissionModePreference,
  writeClaudePermissionModePreference,
  type PermissionModePreferenceStorage,
} from "../src/index.js";

const catalog = harnessPermissionModeCatalogSchema.parse({
  defaultModeId: "default",
  modes: [
    { id: "default", label: "Default" },
    { id: "plan", label: "Plan" },
  ],
});

function memoryStorage(): PermissionModePreferenceStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("Claude Permission Mode preference", () => {
  it("persists the last selected catalog mode for a new Session", () => {
    const storage = memoryStorage();
    const plan = harnessPermissionModeIdSchema.parse("plan");

    writeClaudePermissionModePreference(plan, storage);

    expect(storage.values.get(CLAUDE_PERMISSION_MODE_PREFERENCE_KEY)).toBe("plan");
    expect(readClaudePermissionModePreference(catalog, storage)).toBe(plan);
  });

  it("ignores a stored mode that is absent from the current catalog", () => {
    const storage = memoryStorage();
    storage.values.set(CLAUDE_PERMISSION_MODE_PREFERENCE_KEY, "removed-mode");

    expect(readClaudePermissionModePreference(catalog, storage)).toBeUndefined();
  });
});

describe("deferred Thread Permission Mode preference", () => {
  const target = { hostId: "local", threadId: "kimi-thread", agent: "kimi-code" };
  const modes = harnessPermissionModeCatalogSchema.parse({
    defaultModeId: "agent.manual",
    modes: [
      { id: "agent.manual", label: "Manual" },
      { id: "agent.auto", label: "Auto" },
    ],
  });
  const auto = harnessPermissionModeIdSchema.parse("agent.auto");

  it("restores the choice after a Composer is discarded without changing another Thread or Host", () => {
    const storage = memoryStorage();
    writeThreadPermissionModePreference(target, auto, storage);
    const remountedStorage = { getItem: storage.getItem, setItem: storage.setItem };
    expect(readThreadPermissionModePreference({ ...target }, modes, remountedStorage)).toBe(auto);
    for (const other of [
      { ...target, threadId: "other-thread" },
      { ...target, hostId: "remote" },
      { ...target, agent: "cursor-cli" },
    ])
      expect(readThreadPermissionModePreference(other, modes, remountedStorage)).toBeUndefined();
  });

  it("ignores removed modes and tolerates unavailable storage", () => {
    const storage = memoryStorage();
    writeThreadPermissionModePreference(target, auto, storage);
    expect(readThreadPermissionModePreference(target, catalog, storage)).toBeUndefined();
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeThreadPermissionModePreference(target, auto, unavailable)).not.toThrow();
    expect(readThreadPermissionModePreference(target, modes, unavailable)).toBeUndefined();
  });
});
