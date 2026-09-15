import { z } from "zod";
import { parseHostUsage } from "@codexhost/harness-adapter";
import type { KimiServer } from "./server.js";
import { type statusSchema, statusUsage } from "./projection.js";

export async function readUsage(
  server: KimiServer,
  path: string,
  status: z.infer<typeof statusSchema>,
) {
  const { usage } = await server.request(
    path,
    z.object({
      usage: z
        .object({
          input_tokens: z.number().int().nonnegative(),
          output_tokens: z.number().int().nonnegative(),
          cache_read_tokens: z.number().int().nonnegative(),
          cache_creation_tokens: z.number().int().nonnegative(),
        })
        .optional(),
    }),
  );
  return parseHostUsage({
    ...statusUsage(status),
    ...(usage
      ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedInputTokens: usage.cache_read_tokens,
          cacheWriteInputTokens: usage.cache_creation_tokens,
        }
      : {}),
  });
}
