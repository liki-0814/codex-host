import { describe, expect, it, vi } from "vitest";

import {
  KIMI_USAGES_ENDPOINT,
  fetchKimiAccount,
  projectKimiUsages,
} from "../src/account-identity.js";

const usages = {
  user: { nickname: "li", membership: { level: "LEVEL_PRO" } },
  usage: {
    limit: "2048",
    used: "512",
    remaining: "1536",
    resetTime: "2026-09-24T00:00:00Z",
  },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: { limit: "200", used: "40", remaining: "160", resetTime: "2026-09-17T10:00:00Z" },
    },
  ],
};

describe("Kimi coding-plan usages", () => {
  it("maps weekly quota and the rolling 5-hour window without inventing zeros", () => {
    expect(projectKimiUsages(usages)).toEqual({
      label: "li",
      plan: "PRO",
      credits: {
        usedPercent: 25,
        periodType: "weekly",
        resetsAt: "2026-09-24T00:00:00Z",
        productUsage: [
          {
            product: "Kimi Code · 5-hour window",
            usagePercent: 20,
            resetsAt: "2026-09-17T10:00:00Z",
          },
        ],
      },
    });
  });

  it("derives used from remaining when the payload omits used", () => {
    expect(
      projectKimiUsages({
        usage: { limit: 100, remaining: 75, resetTime: "2026-09-24T00:00:00Z" },
      }),
    ).toEqual({
      label: "Kimi Code",
      credits: { usedPercent: 25, periodType: "weekly", resetsAt: "2026-09-24T00:00:00Z" },
    });
  });

  it("reads quota from the coding usages API instead of starting kimi web", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(usages), { headers: { "Content-Type": "application/json" } }),
    );
    await expect(
      fetchKimiAccount({
        environment: {},
        readAuthFile: async () => JSON.stringify({ access_token: "secret-must-not-escape" }),
        fetch: fetchImpl,
      }),
    ).resolves.toEqual({
      label: "li",
      plan: "PRO",
      credits: {
        usedPercent: 25,
        periodType: "weekly",
        resetsAt: "2026-09-24T00:00:00Z",
        productUsage: [
          {
            product: "Kimi Code · 5-hour window",
            usagePercent: 20,
            resetsAt: "2026-09-17T10:00:00Z",
          },
        ],
      },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(KIMI_USAGES_ENDPOINT);
  });

  it("does not turn HTTP 401 into a quota row", async () => {
    await expect(
      fetchKimiAccount({
        environment: {},
        readAuthFile: async () => JSON.stringify({ access_token: "expired" }),
        fetch: async () => new Response("unauthorized", { status: 401 }),
      }),
    ).resolves.toBeNull();
  });
});
