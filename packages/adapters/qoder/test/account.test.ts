import { it, expect } from "vitest";
import { projectQoderAccount } from "../src/qoder-account.js";
it("projects native quota credits without guessing a reset period from subscription expiry", () => {
  const result = projectQoderAccount(
    {
      userType: "teams",
      expiresAt: 1790092800000,
      userQuota: { used: 3781, total: 6000, percentage: 64, unit: "credits" },
    },
    { email: "test@example.com" },
  );
  expect(result?.credits).toEqual({
    usedPercent: 64,
    periodType: "unknown",
    label: "Plan credits",
    used: 3781,
    limit: 6000,
    unit: "credits",
  });
  expect(projectQoderAccount({ session: { total_credits: 3 } }, {})).toBeNull();
});

it("includes available native shared credits without merging them into personal quota", () => {
  const account = projectQoderAccount(
    {
      userQuota: { used: 3783, total: 6000, percentage: 64 },
      orgResourcePackage: {
        available: true,
        used: 0,
        cap: 20000,
        remaining: 20000,
        percentage: 0,
        unit: "credits",
      },
    },
    {},
  );
  expect(account?.credits?.productUsage).toEqual([
    { product: "Shared resource credits", usagePercent: 0, used: 0, limit: 20000, unit: "credits" },
  ]);
  expect(
    projectQoderAccount(
      {
        userQuota: { used: 1, total: 10, percentage: 10 },
        orgResourcePackage: { available: false, used: 0, cap: 20000, percentage: 0 },
      },
      {},
    )?.credits?.productUsage,
  ).toBeUndefined();
});
