import { z } from "zod";
import { harnessIdSchema } from "./ids.js";
import { accountCreditsSnapshotSchema } from "./thread-usage.js";

/**
 * Remaining prepaid funds on a pay-as-you-go Account. This is not a quota:
 * there is no allowance, no consumed share and no reset, so it cannot be
 * expressed as `credits` without inventing a percentage.
 */
export const accountBalanceSnapshotSchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    /** ISO 4217 code as reported by the provider, for example `CNY`. */
    currency: z.string().trim().min(1).max(8),
    /** Native label when the Harness exposes several billing sources. */
    label: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
export type AccountBalanceSnapshot = z.infer<typeof accountBalanceSnapshotSchema>;

/** Read-only telemetry for the Harness's current native authentication, never a login record. */
export const harnessAccountSnapshotSchema = z
  .object({
    email: z.string().trim().min(1).max(320).optional(),
    label: z.string().trim().min(1).max(256).optional(),
    plan: z.string().trim().min(1).max(128).optional(),
    /** Omitted by Accounts billed from a balance rather than an allowance. */
    credits: accountCreditsSnapshotSchema.optional(),
    balance: accountBalanceSnapshotSchema.optional(),
  })
  .strict()
  .refine(({ credits, balance }) => credits !== undefined || balance !== undefined, {
    message: "Account must report either credits or a balance",
  });
export type HarnessAccountSnapshot = z.infer<typeof harnessAccountSnapshotSchema>;

const harnessAccountIdentityShape = {
  harnessId: harnessIdSchema,
  harnessName: z.string().trim().min(1).max(128),
};

export const harnessAccountSourceSchema = z.object(harnessAccountIdentityShape).strict();
export type HarnessAccountSource = z.infer<typeof harnessAccountSourceSchema>;

export const harnessAccountSourceListParamsSchema = z.object({}).strict();
export const harnessAccountSourceListResultSchema = z
  .object({ sources: z.array(harnessAccountSourceSchema).max(128) })
  .strict();
export type HarnessAccountSourceListResult = z.infer<typeof harnessAccountSourceListResultSchema>;

export const harnessAccountInspectParamsSchema = z
  .object({ harnessId: harnessIdSchema, refresh: z.boolean().optional() })
  .strict();
export type HarnessAccountInspectParams = z.infer<typeof harnessAccountInspectParamsSchema>;

export const harnessAccountInspectResultSchema = z
  .object({
    ...harnessAccountIdentityShape,
    account: harnessAccountSnapshotSchema.nullable(),
  })
  .strict();
export type HarnessAccountInspectResult = z.infer<typeof harnessAccountInspectResultSchema>;

export const harnessAccountListParamsSchema = z
  .object({ refresh: z.boolean().optional() })
  .strict();
export type HarnessAccountListParams = z.infer<typeof harnessAccountListParamsSchema>;
export const harnessAccountListResultSchema = z
  .object({
    accounts: z.array(harnessAccountSnapshotSchema.extend(harnessAccountIdentityShape)).max(128),
  })
  .strict();
export type HarnessAccountListResult = z.infer<typeof harnessAccountListResultSchema>;
