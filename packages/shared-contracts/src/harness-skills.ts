import { z } from "zod";
import { harnessIdSchema } from "./ids.js";

export const HARNESS_SKILLS_INSPECT_METHOD = "codexhost/harness/skills/inspect";
export const HARNESS_SKILLS_LINK_METHOD = "codexhost/harness/skills/link";

/**
 * How a Harness reaches the shared Skill directory.
 *
 * `native` means the Harness reads `~/.agents/skills` itself, so a link would
 * be redundant. `link` means it only reads its own directory and needs one.
 */
export const harnessSkillAccessSchema = z.enum(["native", "link"]);

export const harnessSkillSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    path: z.string().min(1),
    /** Harnesses whose own directory currently links to this Skill. */
    linkedHarnessIds: z.array(harnessIdSchema).readonly(),
  })
  .strict();

/** A link in a Harness directory whose source Skill no longer exists. */
export const harnessSkillBrokenLinkSchema = z
  .object({
    harnessId: harnessIdSchema,
    name: z.string().min(1),
    path: z.string().min(1),
    target: z.string().min(1),
  })
  .strict();

export const harnessSkillTargetSchema = z
  .object({
    harnessId: harnessIdSchema,
    /** The Harness's own user-scope Skill directory. */
    directory: z.string().min(1),
    access: harnessSkillAccessSchema,
    /** Whether the directory exists, which gates linking. */
    present: z.boolean(),
  })
  .strict();

export const harnessSkillCatalogSchema = z
  .object({
    sharedDirectory: z.string().min(1),
    sharedDirectoryPresent: z.boolean(),
    skills: z.array(harnessSkillSchema).readonly(),
    targets: z.array(harnessSkillTargetSchema).readonly(),
    brokenLinks: z.array(harnessSkillBrokenLinkSchema).readonly(),
  })
  .strict();

export const harnessSkillLinkParamsSchema = z
  .object({
    /** Entry name inside the shared directory, or inside the target for `unlink`. */
    skill: z.string().min(1),
    harnessId: harnessIdSchema,
    action: z.enum(["link", "unlink"]),
  })
  .strict();

export type HarnessSkillAccess = z.infer<typeof harnessSkillAccessSchema>;
export type HarnessSkill = z.infer<typeof harnessSkillSchema>;
export type HarnessSkillBrokenLink = z.infer<typeof harnessSkillBrokenLinkSchema>;
export type HarnessSkillTarget = z.infer<typeof harnessSkillTargetSchema>;
export type HarnessSkillCatalog = z.infer<typeof harnessSkillCatalogSchema>;
export type HarnessSkillLinkParams = z.infer<typeof harnessSkillLinkParamsSchema>;
