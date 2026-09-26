import { z } from "zod";
import { harnessIdSchema } from "./ids.js";

export const HARNESS_INSTALLATION_METHOD = "codexhost/harness/installation";
export const harnessInstallationParamsSchema = z
  .object({
    harnessId: harnessIdSchema,
    action: z.enum(["check", "update"]),
  })
  .strict();
export const harnessInstallationStateSchema = z
  .object({
    currentVersion: z.string().min(1),
    latestVersion: z.string().min(1),
    updateAvailable: z.boolean(),
    canUpdate: z.boolean(),
    message: z.string().optional(),
  })
  .strict();
export type HarnessInstallationParams = z.infer<typeof harnessInstallationParamsSchema>;
export type HarnessInstallationState = z.infer<typeof harnessInstallationStateSchema>;
