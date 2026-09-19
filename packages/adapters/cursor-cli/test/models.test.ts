import { describe, expect, it, vi } from "vitest";
import { selectModelConfiguration, readConfiguredModelRef } from "@codexhost/shared-contracts";
import {
  CURSOR_MODES,
  configureCursorModel,
  cursorCatalog,
  cursorModelRef,
  cursorSessionState,
  withConfigOptions,
} from "../src/models.js";
import type { CursorSessionInfo, CursorTransport } from "../src/transport.js";

function info(): CursorSessionInfo {
  return {
    sessionId: "native",
    configOptions: [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "opus",
        options: [
          { value: "opus", name: "Opus" },
          { value: "composer", name: "Composer" },
        ],
      },
      {
        id: "thinking",
        name: "Thinking",
        type: "select",
        currentValue: "true",
        options: [
          { value: "true", name: "On" },
          { value: "false", name: "Off" },
        ],
      },
      {
        id: "fast",
        name: "Fast",
        type: "select",
        currentValue: "false",
        options: [
          { value: "true", name: "Fast" },
          { value: "false", name: "Off" },
        ],
      },
      {
        id: "context",
        name: "Context",
        type: "select",
        currentValue: "300k",
        options: [
          { value: "300k", name: "300K" },
          { value: "1m", name: "1M" },
        ],
      },
      {
        id: "effort",
        name: "Effort",
        type: "select",
        currentValue: "high",
        options: [
          { value: "high", name: "High" },
          { value: "low", name: "Low" },
        ],
      },
    ],
  };
}
function transport(initial: CursorSessionInfo) {
  let state = structuredClone(initial);
  const configure = vi.fn(async (id: string, value: string) => {
    state = {
      ...state,
      configOptions: (state.configOptions ?? []).map((option) =>
        option.id === id && option.type === "select" ? { ...option, currentValue: value } : option,
      ),
    };
    return { configOptions: state.configOptions ?? [] };
  });
  return { configure, native: { configure } as unknown as CursorTransport };
}

describe("Cursor parameterized ACP configuration", () => {
  it("exposes native parameter definitions separately from Thinking and model names", () => {
    const catalog = cursorCatalog(info());
    expect(catalog.configurationOptions?.map((o) => o.id)).toEqual([
      "thinking",
      "fast",
      "context",
      "effort",
    ]);
    expect(catalog.thinkingOptions).toEqual([]);
    expect(catalog.models[0]?.label).toBe("Opus");
    expect(cursorSessionState(info(), "native").resolvedModelLabel).toBe("On · Off · 300K · High");
    expect(cursorSessionState(info(), "native").effectivePermissionModeId).toBe("agent");
    expect(cursorSessionState(info(), "native", true).effectivePermissionModeId).toBe("agent-auto");
    expect(CURSOR_MODES.modes.map((mode) => mode.id)).toEqual([
      "agent",
      "agent-auto",
      "plan",
      "plan-auto",
      "ask",
      "ask-auto",
    ]);
  });
  it.each([
    ["thinking", "false"],
    ["fast", "true"],
    ["context", "1m"],
    ["effort", "low"],
  ])("submits %s independently without changing other parameters", async (id, value) => {
    const initial = info(),
      fake = transport(initial);
    const choice = (cursorCatalog(initial).configurationOptions ?? [])
      .find((o) => o.id === id)
      ?.options.find((o) => o.value === value);
    if (!choice) throw new Error("Missing native choice");
    const next = await configureCursorModel(fake.native, initial, choice.model.id);
    expect(fake.configure).toHaveBeenCalledExactlyOnceWith(id, value);
    expect(
      (cursorCatalog(next).configurationOptions ?? []).find((o) => o.id === id)?.currentValue,
    ).toBe(value);
  });
  it("removes old parameter controls when the returned configuration omits them", () => {
    const initial = info();
    const next = withConfigOptions(
      initial,
      (initial.configOptions ?? []).filter((o) => o.id === "model"),
    );
    expect(cursorCatalog(next).configurationOptions).toEqual([]);
  });
  it("migrates a saved bracketed Model Ref through native parameter requests", async () => {
    const initial = info(),
      fake = transport(initial);
    await configureCursorModel(
      fake.native,
      initial,
      cursorModelRef("opus[thinking=false,context=1m,effort=low,fast=true]").id,
    );
    expect(fake.configure.mock.calls).toEqual([
      ["thinking", "false"],
      ["context", "1m"],
      ["effort", "low"],
      ["fast", "true"],
    ]);
  });
  it("combines rapid local changes and only writes the final differences on submission", async () => {
    const initial = info(),
      fake = transport(initial);
    let catalog = cursorCatalog(initial);
    const choose = (id: string, value: string) => {
      const choice = catalog.configurationOptions
        ?.find((o) => o.id === id)
        ?.options.find((o) => o.value === value);
      if (!choice) throw new Error("Missing choice");
      catalog = selectModelConfiguration(catalog, choice.model);
    };
    choose("fast", "true");
    choose("context", "1m");
    choose("fast", "false");
    choose("effort", "low");
    expect(fake.configure).not.toHaveBeenCalled();
    if (!catalog.defaultModel) throw new Error("Missing selection");
    expect(readConfiguredModelRef(catalog.defaultModel)?.values).toEqual({
      thinking: "true",
      fast: "false",
      context: "1m",
      effort: "low",
    });
    await configureCursorModel(fake.native, initial, catalog.defaultModel.id);
    expect(fake.configure.mock.calls).toEqual([
      ["context", "1m"],
      ["effort", "low"],
    ]);
  });
  it("switches model definitions locally and keeps each model's draft choices", () => {
    const initial = info();
    initial.nativeModels = [{ value: "composer", name: "Composer", configOptions: [] }];
    let catalog = cursorCatalog(initial);
    const fast = catalog.configurationOptions
      ?.find((o) => o.id === "fast")
      ?.options.find((o) => o.value === "true");
    if (!fast) throw new Error("Missing Fast");
    catalog = selectModelConfiguration(catalog, fast.model);
    const opus = catalog.defaultModel;
    catalog = selectModelConfiguration(catalog, cursorModelRef("composer"));
    expect(catalog.configurationOptions).toEqual([]);
    if (!opus) throw new Error("Missing Opus");
    catalog = selectModelConfiguration(catalog, opus);
    expect(catalog.configurationOptions?.find((o) => o.id === "fast")?.currentValue).toBe("true");
  });
  it("rejects values absent from native definitions", async () => {
    const initial = info(),
      fake = transport(initial);
    await expect(
      configureCursorModel(fake.native, initial, cursorModelRef("opus[context=9m]").id),
    ).rejects.toThrow("does not advertise");
    expect(fake.configure).not.toHaveBeenCalled();
  });
});
