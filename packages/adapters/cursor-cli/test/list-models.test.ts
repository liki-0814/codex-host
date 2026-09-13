import { describe, expect, it } from "vitest";
import { parseCursorListModelId, parseCursorListModels } from "../src/list-models.js";
import { cursorModelRef } from "../src/models.js";

const SAMPLE = `
Available models

auto - Auto (default)
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast
gpt-5.6-sol-high - GPT-5.6 Sol 1M High
gpt-5.6-sol-high-fast - GPT-5.6 Sol 1M High Fast
gpt-5.6-sol-medium - GPT-5.6 Sol 1M
claude-opus-5-high - Claude Opus 5 1M
claude-opus-5-thinking-high - Claude Opus 5 1M Thinking
claude-opus-5-thinking-high-fast - Claude Opus 5 1M Thinking Fast
kimi-k2.7-code - Kimi K2.7 Code

Tip: use --model <id>
`;

describe("Cursor --list-models catalog", () => {
  it("strips Fast, effort and thinking suffixes from native ids", () => {
    expect(parseCursorListModelId("composer-2.5-fast")).toEqual({
      base: "composer-2.5",
      fast: true,
      thinking: false,
    });
    expect(parseCursorListModelId("gpt-5.6-sol-high-fast")).toEqual({
      base: "gpt-5.6-sol",
      fast: true,
      thinking: false,
      effort: "high",
    });
    expect(parseCursorListModelId("claude-opus-5-thinking-high-fast")).toEqual({
      base: "claude-opus-5",
      fast: true,
      thinking: true,
      effort: "high",
    });
    expect(parseCursorListModelId("claude-4.6-sonnet-medium-thinking")).toEqual({
      base: "claude-4.6-sonnet",
      fast: false,
      thinking: true,
      effort: "medium",
    });
    expect(parseCursorListModelId("kimi-k2.7-code")).toEqual({
      base: "kimi-k2.7-code",
      fast: false,
      thinking: false,
    });
  });

  it("groups variants into one model with Fast and thinking options", () => {
    const { catalog } = parseCursorListModels(SAMPLE);
    expect(catalog.defaultModel).toEqual(cursorModelRef("auto"));
    expect(catalog.models.map((model) => model.label)).toEqual([
      "Auto",
      "Composer 2.5",
      "GPT-5.6 Sol",
      "Claude Opus 5",
      "Kimi K2.7 Code",
    ]);
    expect(
      catalog.models.find((model) => model.label === "Auto")?.supportedThinkingOptionIds,
    ).toBeUndefined();
    expect(
      catalog.models.find((model) => model.label === "Composer 2.5")?.supportedThinkingOptionIds,
    ).toEqual(["g.fast~false", "g.fast~true"]);
    expect(
      catalog.models.find((model) => model.label === "GPT-5.6 Sol")?.supportedThinkingOptionIds
        ?.length,
    ).toBe(3);
    expect(
      catalog.models.find((model) => model.label === "Claude Opus 5")?.supportedThinkingOptionIds
        ?.length,
    ).toBe(3);
  });
});
