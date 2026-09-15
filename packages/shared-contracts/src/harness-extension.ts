import { z } from "zod";
import { harnessIdSchema } from "./ids.js";

export const harnessExtensionParamsSchema = z
  .object({
    harnessId: harnessIdSchema,
    extensionId: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(64),
    action: z.enum(["inspect", "install"]),
  })
  .strict();
export const harnessExtensionStateSchema = z
  .object({
    installed: z.boolean(),
    available: z.boolean().optional(),
    updateAvailable: z.boolean().optional(),
  })
  .strict();
export type HarnessExtensionParams = z.infer<typeof harnessExtensionParamsSchema>;
export type HarnessExtensionState = z.infer<typeof harnessExtensionStateSchema>;
