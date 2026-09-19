import { describe, expect, it } from "vitest";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  cursorCatalog,
  cursorConfiguredModelRef,
  cursorModelRef,
  cursorModelSelection,
  cursorNativeModel,
} from "../src/models.js";
import type { CursorSessionInfo } from "../src/transport.js";

const select = (
  id: string,
  currentValue: string,
  values: string[],
  category = "thought_level",
): SessionConfigOption & { type: "select" } => ({
  id,
  name: id,
  type: "select",
  currentValue,
  category,
  options: values.map((value) => ({ value, name: value })),
});

function info(): CursorSessionInfo {
  const thinking = select("thinking", "true", ["false", "true"]);
  const effort = select("effort", "high", ["low", "high"]);
  const context = select("context", "200k", ["200k", "1m"], "model_config");
  const model = select("model", "opus", ["opus", "composer"], "model");
  return {
    sessionId: "native",
    configOptions: [model, thinking, effort, context],
    nativeModels: [
      { value: "opus", name: "Opus", configOptions: [thinking, effort, context] },
      { value: "composer", name: "Composer", configOptions: [] },
    ],
  };
}

describe("Cursor native model catalog", () => {
  it("keeps thinking combinations separate from model-config parameters", () => {
    const catalog = cursorCatalog(info());
    expect(catalog.thinkingOptions).toHaveLength(4);
    expect(catalog.models[0]?.label).toBe("opus");
    expect(cursorConfiguredModelRef("opus", info().configOptions).id).toBe(
      cursorModelRef("opus[context=200k]").id,
    );
  });

  it("selects a native model and its persisted config parameters", () => {
    expect(cursorModelSelection(info(), cursorModelRef("opus[context=1m]").id)).toEqual([
      ["model", "opus"],
      ["context", "1m"],
    ]);
    expect(cursorNativeModel(info(), cursorModelRef("opus").id)).toBe("opus");
  });
});
