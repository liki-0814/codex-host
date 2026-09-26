import { describe, expect, it, vi } from "vitest";
import type { AccountCreditsSnapshot } from "@codexhost/shared-contracts";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
}));

import {
  renderAccountResetCredits,
  renderAccountUsage as renderUsage,
  resetCreditDetailLine,
  type AccountUsageViewState,
} from "../../src/settings/accounts-usage.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";

class FakeElement {
  readonly children: unknown[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, () => void>();
  className = "";
  textContent = "";
  title = "";
  type = "";
  disabled = false;
  constructor(readonly tagName: string) {}
  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener);
  }
  append(...children: unknown[]): void {
    this.children.push(...children);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const document = {
  createElement: (tagName: string) => new FakeElement(tagName),
} as unknown as Document;
const messages = rendererSettingsMessages("zh-CN");
function descendants(root: FakeElement): FakeElement[] {
  return [
    root,
    ...root.children.flatMap((child) => (child instanceof FakeElement ? descendants(child) : [])),
  ];
}
function elements(root: HTMLElement): FakeElement[] {
  return descendants(root as unknown as FakeElement);
}
function text(root: HTMLElement): string {
  return elements(root)
    .map((el) => el.textContent)
    .join(" ");
}
const credits = {
  usedPercent: 91,
  periodType: "five_hour" as const,
  resetsAt: "2026-09-10T03:12:00.000Z",
};

function renderAccountUsage(
  document: Document,
  state: AccountUsageViewState | undefined,
  messages: ReturnType<typeof rendererSettingsMessages>,
  display: "used" | "remaining",
  onRetry: () => void,
): HTMLElement {
  const result = renderUsage(document, state, messages, display, onRetry);
  const root = document.createElement("div");
  root.append(...result.cells);
  if (result.additional) root.append(result.additional);
  return root;
}

function usage(snapshot: AccountCreditsSnapshot = credits, display: "used" | "remaining" = "used") {
  const result = renderAccountUsage(
    document,
    { status: "ready", credits: snapshot, freshness: "live", observedAt: null },
    messages,
    display,
    vi.fn(),
  );
  if (!result) throw new Error("Expected limits");
  return result;
}

describe("Account limit windows", () => {
  it("does not synthesize a 5h window for weekly-only accounts", () => {
    const result = renderAccountUsage(
      document,
      {
        status: "ready",
        credits: { usedPercent: 9, periodType: "seven_day" },
        freshness: "live",
        observedAt: null,
      },
      messages,
      "used",
      vi.fn(),
    );
    if (!result) throw new Error("Expected limits");
    expect(text(result)).toContain("7 天");
    expect(text(result)).not.toContain("5 小时");
    expect(text(result)).not.toContain("—");
    expect(elements(result).filter((el) => el.attributes.get("role") === "meter")).toHaveLength(1);
  });

  it("preserves primary and product windows without summing or deduplicating them", () => {
    const result = renderAccountUsage(
      document,
      {
        status: "ready",
        freshness: "live",
        observedAt: null,
        credits: {
          ...credits,
          productUsage: [
            { product: "7-day window", usagePercent: 0 },
            { product: "GPT-5.3-Codex-Spark", usagePercent: 25 },
          ],
        },
      },
      messages,
      "used",
      vi.fn(),
    );
    if (!result) throw new Error("Expected limits");
    expect(
      elements(result)
        .filter((el) => el.attributes.get("role") === "meter")
        .map((el) => el.attributes.get("aria-valuenow")),
    ).toEqual(["91", "0", "25"]);
    expect(text(result)).toContain("7 天");
    expect(text(result)).toContain("GPT-5.3-Codex-Spark");
    expect(
      elements(result).filter((el) => el.className === "settings-account-usage__sub"),
    ).toHaveLength(1);
  });

  it("keeps the display mode accessible and warnings based on used usage", () => {
    const result = usage(credits, "remaining");
    expect(text(result)).toContain("9%");
    const meter = elements(result).find((el) => el.attributes.get("role") === "meter");
    expect(meter?.attributes.get("aria-valuenow")).toBe("9");
    expect(meter?.attributes.get("aria-label")).toBe("5 小时 · 剩余");
    expect(meter?.className).toContain("--hot");
    expect((meter?.children[0] as FakeElement).style.width).toBe("9%");
  });

  it.each([0, 100])("renders the %i percent boundary in either display mode", (usedPercent) => {
    for (const display of ["used", "remaining"] as const) {
      const result = usage({ ...credits, usedPercent }, display);
      expect(
        elements(result)
          .find((el) => el.attributes.get("role") === "meter")
          ?.attributes.get("aria-valuenow"),
      ).toBe(String(display === "used" ? usedPercent : 100 - usedPercent));
    }
  });

  it("keeps unavailable, loading, empty, and failed states distinct from zero usage", () => {
    expect(
      elements(renderAccountUsage(document, undefined, messages, "used", vi.fn())).some(
        (el) => el.attributes.get("role") === "meter",
      ),
    ).toBe(false);
    for (const status of ["loading", "empty", "error"] as const) {
      const retry = vi.fn();
      const result = renderAccountUsage(document, { status }, messages, "used", retry);
      if (!result) throw new Error("Expected state");
      expect(elements(result).some((el) => el.attributes.get("role") === "meter")).toBe(false);
      if (status === "error") {
        elements(result)
          .find((el) => el.tagName === "button")
          ?.listeners.get("click")?.();
        expect(retry).toHaveBeenCalledOnce();
      } else expect(elements(result).some((el) => el.tagName === "button")).toBe(false);
      if (status === "loading")
        expect(elements(result).some((el) => el.attributes.get("aria-busy") === "true")).toBe(true);
    }
  });
});

describe("Quota grid", () => {
  function grid(snapshot: AccountCreditsSnapshot) {
    return renderUsage(
      document,
      { status: "ready", credits: snapshot, freshness: "live", observedAt: null },
      messages,
      "remaining",
      vi.fn(),
    );
  }

  function quotaCell(snapshot: AccountCreditsSnapshot): HTMLElement {
    const cell = grid(snapshot).cells[0];
    if (!cell) throw new Error("Expected the quota cell");
    return cell;
  }

  it("places weekly zero usage in the single quota cell", () => {
    const result = grid({ usedPercent: 0, periodType: "weekly" });
    expect(result.cells).toHaveLength(1);
    expect(
      elements(quotaCell({ usedPercent: 0, periodType: "weekly" }))
        .find((el) => el.attributes.get("role") === "meter")
        ?.attributes.get("aria-valuenow"),
    ).toBe("100");
    expect(result.additional).toBeNull();
    expect(
      elements(quotaCell({ usedPercent: 0, periodType: "weekly" })).find((element) =>
        element.className.includes("settings-account-usage__meter"),
      )?.style.gridColumn,
    ).toBe("1 / -1");
  });

  it("keeps duplicate windows in the same cell", () => {
    const snapshot = {
      ...credits,
      productUsage: [
        { product: "7-day window", usagePercent: 20 },
        { product: "7-day window", usagePercent: 35 },
      ],
    };
    const rendered = text(quotaCell(snapshot));
    expect(rendered).toContain("9%");
    expect(rendered).toContain("80%");
    expect(rendered).toContain("65%");
    expect(grid(snapshot).additional).toBeNull();
  });

  it("prints the provider amount under the meter", () => {
    expect(text(quotaCell({ ...credits, used: 91, limit: 100, unit: "credits" }))).toContain(
      "9 / 100 credits",
    );
  });

  function meters(root: HTMLElement): FakeElement[] {
    const grid = elements(root).find((el) => el.className === "settings-account-quota-grid");
    return (grid?.children ?? []).filter(
      (child): child is FakeElement => child instanceof FakeElement,
    );
  }

  it("keeps the 5-hour window in the left column beside a weekly limit", () => {
    const cell = quotaCell({
      usedPercent: 4,
      periodType: "weekly",
      productUsage: [{ product: "Kimi Code · 5-hour window", usagePercent: 12 }],
    });
    const placed = meters(cell);
    expect(placed.map((meter) => meter.style.gridColumn)).toEqual(["1", "2"]);
    expect(placed.map((meter) => meter.style.gridRow)).toEqual(["1", "1"]);
    expect(
      elements(placed[0] ?? cell)
        .find((el) => el.attributes.get("role") === "meter")
        ?.attributes.get("aria-label"),
    ).toContain("5 小时");
    expect(text(placed[1] ?? cell)).toContain("周额度");
    expect(text(placed[0] ?? cell)).not.toContain("周额度");
  });

  it("places each model group's 5-hour window on the left of its 7-day window", () => {
    const placed = meters(
      quotaCell({
        label: "Gemini Models · 5-hour window",
        usedPercent: 1,
        periodType: "five_hour",
        productUsage: [
          { product: "Gemini Models · 7-day window", usagePercent: 2 },
          { product: "Claude and GPT models · 5-hour window", usagePercent: 3 },
          { product: "Claude and GPT models · 7-day window", usagePercent: 4 },
        ],
      }),
    );
    expect(placed.map((meter) => `${meter.style.gridRow}:${meter.style.gridColumn}`)).toEqual([
      "1:1",
      "1:2",
      "2:1",
      "2:2",
    ]);
    const claude = placed[2];
    if (!claude) throw new Error("Expected the Claude 5-hour meter");
    expect(
      elements(claude).some(
        (el) => el.className === "settings-account-usage__period" && el.textContent === "5 小时",
      ),
    ).toBe(true);
    expect(
      elements(claude).some(
        (el) =>
          el.className === "settings-account-usage__scope" &&
          el.textContent === "Claude and GPT models",
      ),
    ).toBe(true);
  });

  it("shows an empty plan cap as zero instead of a full remaining bar", () => {
    const cell = quotaCell({
      label: "Plan credits",
      usedPercent: 0,
      periodType: "unknown",
      used: 0,
      limit: 0,
      unit: "credits",
      productUsage: [
        {
          product: "Shared resource credits",
          usagePercent: 1,
          used: 3,
          limit: 26000,
          unit: "credits",
        },
      ],
    });
    const placed = meters(cell);
    expect(placed.map((meter) => meter.style.gridColumn)).toEqual(["1", "2"]);
    expect(text(placed[0] ?? cell)).toContain("套餐 Credits");
    expect(text(placed[0] ?? cell)).toContain("0 / 0 credits");
    expect(text(placed[0] ?? cell)).toContain("—");
    expect(text(placed[0] ?? cell)).not.toContain("100%");
    expect(text(placed[1] ?? cell)).toContain("25,997 / 26,000 credits");
    expect(text(placed[1] ?? cell)).toContain("99%");
  });
});

describe("Account reset-card details", () => {
  it("formats each available card's expiry", () => {
    const now = new Date(2026, 8, 10, 12, 0, 0);
    const expires = new Date(2026, 8, 10, 16, 12, 0);
    const line = resetCreditDetailLine(1, expires.toISOString(), messages, now);
    expect(line.startsWith("第 1 张 · ")).toBe(true);
    expect(line).toContain("今天");
    expect(line.endsWith("到期")).toBe(true);
  });

  it("does not invent a zero card count when no reset snapshot is provided", () => {
    expect(renderAccountResetCredits(document, credits, messages)).toBeNull();
  });

  it("shows only a count without per-card expiry data", () => {
    const result = renderAccountResetCredits(
      document,
      { ...credits, resetCredits: { availableCount: 2 } },
      messages,
    );
    if (!result) throw new Error("Expected reset details");
    expect(text(result.summary)).toContain("2 张");
    expect(elements(result.details).some((el) => el.tagName === "ul")).toBe(false);
    expect(elements(result.details).some((el) => el.tagName === "button")).toBe(false);
  });

  it("renders every expiry without a consume action", () => {
    const expiresAt = ["2026-09-10T16:12:00.000Z", "2026-09-18T08:00:00.000Z"];
    const result = renderAccountResetCredits(
      document,
      { ...credits, resetCredits: { availableCount: 2, nextExpiresAt: expiresAt[0], expiresAt } },
      messages,
    );
    if (!result) throw new Error("Expected reset details");
    expect(elements(result.details).filter((el) => el.tagName === "li")).toHaveLength(2);
    expect(text(result.details)).toContain("第 1 张");
    expect(text(result.details)).toContain("第 2 张");
    expect(elements(result.details).some((el) => el.tagName === "button")).toBe(false);
  });
});
