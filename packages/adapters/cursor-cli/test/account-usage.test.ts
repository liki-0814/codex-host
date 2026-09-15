import { describe, expect, it, vi } from "vitest";
import { fetchCursorAccount, projectCursorAccountUsage } from "../src/account-usage.js";

describe("Cursor native account quota", () => {
  it("uses native percentages rather than spend ratios and preserves monthly buckets", () => {
    const result = projectCursorAccountUsage(
      {
        billingCycleEnd: "1789973888000",
        planUsage: {
          totalSpend: 97138,
          limit: 40000,
          totalPercentUsed: 28,
          autoPercentUsed: 27,
          apiPercentUsed: 30,
        },
      },
      { email: "test@example.com" },
      { planInfo: { planName: "Ultra" } },
    );
    expect(result).toMatchObject({
      email: "test@example.com",
      plan: "Ultra",
      credits: {
        usedPercent: 27,
        label: "Auto · monthly",
        periodType: "monthly",
        resetsAt: new Date(1789973888000).toISOString(),
        productUsage: [{ product: "API · monthly", usagePercent: 30 }],
      },
    });
  });
  it("does not invent zero usage for missing or malformed native fields", () => {
    for (const value of [
      undefined,
      null,
      {},
      { planUsage: { totalSpend: 4, limit: 10 } },
      { planUsage: { autoPercentUsed: -1 } },
      { planUsage: { autoPercentUsed: "20" } },
    ])
      expect(projectCursorAccountUsage(value, {}, {})).toBeNull();
    expect(
      projectCursorAccountUsage({ planUsage: { autoPercentUsed: 0 } }, {}, {})?.credits.usedPercent,
    ).toBe(0);
  });
  it("does not read saved OAuth or make requests for an API-key or memory session", async () => {
    const readAccessToken = vi.fn(async () => "secret");
    const fetchMock = vi.fn();
    for (const environment of [{ CURSOR_API_KEY: "key" }, { AGENT_CLI_CREDENTIAL_STORE: "memory" }])
      expect(
        await fetchCursorAccount({ environment, readAccessToken, fetch: fetchMock }),
      ).toBeNull();
    expect(readAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps quota when optional account metadata fails and suppresses authorization failures", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("GetCurrentPeriodUsage")
        ? new Response(JSON.stringify({ planUsage: { autoPercentUsed: 42 } }))
        : new Response("", { status: 401 }),
    );
    expect(
      await fetchCursorAccount({
        environment: {},
        readAccessToken: async () => "secret",
        fetch: fetchMock,
      }),
    ).toEqual({ credits: { usedPercent: 42, periodType: "monthly", label: "Auto · monthly" } });
    expect(
      await fetchCursorAccount({
        environment: {},
        readAccessToken: async () => "secret",
        fetch: async () => new Response("", { status: 401 }),
      }),
    ).toBeNull();
  });
});
