import { describe, expect, it, vi } from "vitest";

import {
  GROK_CREDITS_ENDPOINT,
  GROK_OAUTH_TOKEN_ENDPOINT,
  fetchGrokAccount,
  fetchGrokCredits,
  parseGrokCreditsResponse,
} from "../src/grok-credits.js";

// Shape returned by native x.ai/billing for a zero-usage SuperGrok account.
const zeroUsageConfig = {
  currentPeriod: {
    type: "USAGE_PERIOD_TYPE_WEEKLY",
    start: "2026-09-01T00:00:00Z",
    end: "2026-09-08T00:00:00Z",
  },
  onDemandCap: { val: 0 },
  onDemandUsed: { val: 0 },
  isUnifiedBillingUser: true,
  prepaidBalance: { val: 0 },
  billingPeriodStart: "2026-09-01T00:00:00Z",
  billingPeriodEnd: "2026-09-08T00:00:00Z",
};

describe("Grok account discovery", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const auth = {
    "https://auth.x.ai::cli": {
      key: "native-oauth",
      email: "user@example.com",
      user_id: "native-user",
      expires_at: "2026-09-02T00:00:00Z",
    },
  };
  const fixture = () => ({
    environment: {},
    now,
    readAuthFile: vi.fn(async () => JSON.stringify(auth)),
    fetch: vi.fn(
      async () =>
        new Response(
          JSON.stringify({ config: { creditUsagePercent: 0, currentPeriod: { type: "WEEKLY" } } }),
        ),
    ),
  });

  it("returns only public identity and real quota, including zero usage", async () => {
    const input = fixture();
    expect(await fetchGrokAccount(input)).toEqual({
      email: "user@example.com",
      label: "native-user",
      credits: { usedPercent: 0, periodType: "weekly" },
    });
    expect(input.fetch).toHaveBeenCalledOnce();
  });

  it("keeps a native zero-usage account when billing omits the percentage", async () => {
    const input = fixture();
    input.fetch.mockImplementation(
      async () => new Response(JSON.stringify({ config: zeroUsageConfig })),
    );
    expect(await fetchGrokAccount(input)).toEqual({
      email: "user@example.com",
      label: "native-user",
      credits: {
        usedPercent: 0,
        periodType: "weekly",
        resetsAt: zeroUsageConfig.currentPeriod.end,
      },
    });
    expect(await fetchGrokCredits(input)).toEqual({
      usedPercent: 0,
      periodType: "weekly",
      resetsAt: zeroUsageConfig.currentPeriod.end,
      fetchedAt: now.toISOString(),
    });
  });

  it.each([401, 500])("does not turn HTTP %s into zero usage", async (status) => {
    const input = fixture();
    input.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ config: zeroUsageConfig }), { status }),
    );
    expect(await fetchGrokAccount(input)).toBeNull();
  });

  it("does not turn network errors or invalid JSON into zero usage", async () => {
    const input = fixture();
    input.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    input.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    expect(await fetchGrokAccount(input)).toBeNull();
    input.fetch.mockResolvedValueOnce(new Response("not json"));
    expect(await fetchGrokAccount(input)).toBeNull();
  });

  it.each(["XAI_API_KEY", "GROK_API_KEY", "GROK_TOKEN"])(
    "does not use saved OAuth credentials in an explicit %s environment",
    async (key) => {
      const input = fixture();
      expect(await fetchGrokAccount({ ...input, environment: { [key]: "api-secret" } })).toBeNull();
      expect(input.readAuthFile).not.toHaveBeenCalled();
      expect(input.fetch).not.toHaveBeenCalled();
    },
  );

  it("does not send other issuers' tokens to xAI, or use expired credentials", async () => {
    const input = fixture();
    input.readAuthFile.mockResolvedValueOnce(
      JSON.stringify({ "https://other.example": { key: "other-secret" } }),
    );
    expect(await fetchGrokAccount(input)).toBeNull();
    expect(input.fetch).not.toHaveBeenCalled();
    expect(await fetchGrokAccount({ ...input, now: new Date("2027-01-01") })).toBeNull();
  });

  it("does not manufacture quota from a reset date, or reuse a result after logout", async () => {
    const input = fixture();
    expect(await fetchGrokAccount(input)).not.toBeNull();
    input.readAuthFile.mockResolvedValueOnce("{}");
    expect(await fetchGrokAccount(input)).toBeNull();
    expect(
      parseGrokCreditsResponse({ config: { billingPeriodEnd: "2026-09-02T00:00:00Z" } }),
    ).toBeNull();
  });

  it("refreshes an expired native token before reading credits", async () => {
    const writeAuthFile = vi.fn(async (_filePath: string, _contents: string) => undefined);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_OAUTH_TOKEN_ENDPOINT) {
        return new Response(
          JSON.stringify({ access_token: "fresh-access", refresh_token: "rotated", expires_in: 3600 }),
        );
      }
      return new Response(
        JSON.stringify({ config: { creditUsagePercent: 10, currentPeriod: { type: "WEEKLY" } } }),
      );
    });
    await expect(
      fetchGrokAccount({
        environment: {},
        now: new Date("2026-09-03T00:00:00Z"),
        readAuthFile: async () =>
          JSON.stringify({
            "https://auth.x.ai::cli": {
              key: "stale-access",
              refresh_token: "refresh-secret",
              expires_at: "2026-09-02T00:00:00Z",
              email: "user@example.com",
            },
          }),
        writeAuthFile,
        fetch: fetchImpl,
      }),
    ).resolves.toMatchObject({
      email: "user@example.com",
      credits: { usedPercent: 10, periodType: "weekly" },
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      GROK_OAUTH_TOKEN_ENDPOINT,
      GROK_CREDITS_ENDPOINT,
    ]);
    const persisted = JSON.parse(writeAuthFile.mock.calls[0]?.[1] ?? "{}") as {
      "https://auth.x.ai::cli"?: { key?: string };
    };
    expect(persisted["https://auth.x.ai::cli"]?.key).toBe("fresh-access");
  });

  it("retries credits after a 401 once the native token is refreshed", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_OAUTH_TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }));
      }
      if (fetchImpl.mock.calls.filter(([called]) => called === GROK_CREDITS_ENDPOINT).length === 1) {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(
        JSON.stringify({ config: { creditUsagePercent: 4, currentPeriod: { type: "WEEKLY" } } }),
      );
    });
    await expect(
      fetchGrokAccount({
        environment: {},
        now,
        readAuthFile: async () =>
          JSON.stringify({
            "https://auth.x.ai::cli": {
              key: "stale-access",
              refresh_token: "refresh-secret",
              expires_at: "2026-09-02T00:00:00Z",
            },
          }),
        writeAuthFile: async () => undefined,
        fetch: fetchImpl,
      }),
    ).resolves.toMatchObject({ credits: { usedPercent: 4 } });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      GROK_CREDITS_ENDPOINT,
      GROK_OAUTH_TOKEN_ENDPOINT,
      GROK_CREDITS_ENDPOINT,
    ]);
  });

  it("retries a cold credits fetch once", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ config: { creditUsagePercent: 0, currentPeriod: { type: "WEEKLY" } } }),
        ),
      );
    await expect(fetchGrokAccount({ ...fixture(), fetch: fetchImpl })).resolves.toMatchObject({
      credits: { usedPercent: 0 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("Grok credits parsing", () => {
  it("reads the weekly SuperGrok credits payload", () => {
    expect(
      parseGrokCreditsResponse(
        {
          config: {
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              end: "2026-08-20T03:32:07.498525+00:00",
            },
            creditUsagePercent: 33,
            productUsage: [{ product: "GrokBuild", usagePercent: 32 }],
          },
        },
        "2026-08-15T00:00:00.000Z",
      ),
    ).toEqual({
      usedPercent: 33,
      resetsAt: "2026-08-20T03:32:07.498525+00:00",
      periodType: "weekly",
      productUsage: [{ product: "GrokBuild", usagePercent: 32 }],
      fetchedAt: "2026-08-15T00:00:00.000Z",
    });
  });

  it.each([
    ["USAGE_PERIOD_TYPE_WEEKLY", "weekly"],
    ["USAGE_PERIOD_TYPE_MONTHLY", "monthly"],
  ])("uses the native zero default for a valid %s period", (type, periodType) => {
    expect(
      parseGrokCreditsResponse(
        {
          config: {
            ...zeroUsageConfig,
            currentPeriod: { ...zeroUsageConfig.currentPeriod, type },
          },
        },
        "2026-09-01T00:00:00Z",
      ),
    ).toEqual({
      usedPercent: 0,
      periodType,
      resetsAt: zeroUsageConfig.currentPeriod.end,
      fetchedAt: "2026-09-01T00:00:00Z",
    });
  });

  it.each([undefined, 0, 33])(
    "does not substitute on-demand spending for included usage %s",
    (creditUsagePercent) => {
      expect(
        parseGrokCreditsResponse({
          config: {
            ...zeroUsageConfig,
            ...(creditUsagePercent !== undefined ? { creditUsagePercent } : {}),
            onDemandCap: { val: 5000 },
            onDemandUsed: { val: 2500 },
          },
        }),
      ).toMatchObject({ usedPercent: creditUsagePercent ?? 0 });
    },
  );

  it.each([
    { used: { val: 2500 }, expected: 25 },
    { used: { val: 0 }, expected: 0 },
    { used: {}, expected: 0 },
    { used: undefined, expected: 0 },
  ])("falls back to legacy included credit amounts: %j", ({ used, expected }) => {
    expect(
      parseGrokCreditsResponse({
        config: {
          monthlyLimit: { val: 10000 },
          ...(used !== undefined ? { used } : {}),
          onDemandCap: { val: 5000 },
          onDemandUsed: { val: 2500 },
        },
      }),
    ).toMatchObject({ usedPercent: expected });
  });

  it("prefers explicit percentage over legacy included amounts", () => {
    expect(
      parseGrokCreditsResponse({
        config: { creditUsagePercent: 0, monthlyLimit: { val: 10000 }, used: { val: 2500 } },
      }),
    ).toMatchObject({ usedPercent: 0 });
  });

  it.each([null, "0", false, {}, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not default an invalid explicit percentage to zero: %j",
    (creditUsagePercent) => {
      expect(
        parseGrokCreditsResponse({ config: { ...zeroUsageConfig, creditUsagePercent } }),
      ).toBeNull();
    },
  );

  it.each([
    { monthlyLimit: "invalid" },
    { monthlyLimit: { val: "10000" } },
    { used: { val: "0" } },
    { used: { val: -1 } },
    { used: null },
  ])("does not default malformed legacy usage to zero: %j", (legacy) => {
    expect(parseGrokCreditsResponse({ config: { ...zeroUsageConfig, ...legacy } })).toBeNull();
  });

  it.each([
    null,
    {},
    { config: null },
    { config: [] },
    { config: {} },
    { config: { monthlyLimit: { val: 0 } } },
    { config: { billingPeriodEnd: "2026-09-08T00:00:00Z" } },
    { config: { currentPeriod: { type: "WEEKLY" } } },
    { config: { currentPeriod: { type: "WEEKLY", end: "invalid" } } },
    { config: { currentPeriod: { type: "UNKNOWN", end: "2026-09-08T00:00:00Z" } } },
    { config: { onDemandCap: { val: 5000 }, onDemandUsed: { val: 2500 } } },
  ])("rejects absent or unrecognizable quota rather than defaulting to zero: %j", (payload) => {
    expect(parseGrokCreditsResponse(payload)).toBeNull();
  });
});
