import {
  harnessAccountSnapshotSchema,
  type HarnessAccountSnapshot,
} from "@codexhost/shared-contracts";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export function projectQoderAccount(
  usage: unknown,
  identity: unknown,
): HarnessAccountSnapshot | null {
  const data = record(usage),
    account = record(identity),
    quota = record(data.userQuota);
  const shared = record(data.orgResourcePackage);
  const nativePercent = quota.percentage ?? data.totalUsagePercentage;
  const usedPercent = nonnegative(nativePercent)
    ? Math.min(100, nativePercent)
    : nonnegative(quota.used) && nonnegative(quota.total) && quota.total > 0
      ? Math.min(100, (quota.used / quota.total) * 100)
      : undefined;
  if (usedPercent === undefined) return null;
  const result = harnessAccountSnapshotSchema.safeParse({
    ...(typeof account.email === "string" && account.email ? { email: account.email } : {}),
    ...(typeof account.subscriptionType === "string" && account.subscriptionType
      ? { plan: account.subscriptionType }
      : typeof data.userType === "string"
        ? { plan: data.userType }
        : {}),
    credits: {
      usedPercent,
      periodType: "unknown",
      label: "Plan credits",
      ...(shared.available === true &&
      nonnegative(shared.percentage) &&
      nonnegative(shared.used) &&
      nonnegative(shared.cap) &&
      shared.cap > 0
        ? {
            productUsage: [
              {
                product: "Shared resource credits",
                usagePercent: Math.min(100, shared.percentage),
                used: shared.used,
                limit: shared.cap,
                unit: typeof shared.unit === "string" ? shared.unit : "credits",
              },
            ],
          }
        : {}),
      ...(nonnegative(quota.used) && nonnegative(quota.total) && quota.total > 0
        ? {
            used: quota.used,
            limit: quota.total,
            unit: typeof quota.unit === "string" ? quota.unit : "credits",
          }
        : {}),
    },
  });
  return result.success ? result.data : null;
}
