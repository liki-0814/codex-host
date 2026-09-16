import { z } from "zod";
import { hostThreadIdSchema } from "./ids.js";

/** Emitted once for a newly persisted delegation, never for resume or request deduplication. */
export const DELEGATION_CREATED_METHOD = "codexhost/delegation/created";
export const delegationCreatedSchema = z.object({
  threadId: hostThreadIdSchema,
  cwd: z.string().min(1),
});
export type DelegationCreated = z.infer<typeof delegationCreatedSchema>;
