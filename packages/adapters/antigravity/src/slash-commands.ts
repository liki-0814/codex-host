import type { HarnessCommandInvocation, HarnessResult } from "@codexhost/harness-adapter";
import {
  harnessCommandCatalogSchema,
  type HarnessCommandCatalog,
  type HarnessCommandDescriptor,
} from "@codexhost/shared-contracts";

/** Planning is a session execution mode (`--mode=plan`), not a Composer slash command. */
export const ANTIGRAVITY_COMMAND_CATALOG: HarnessCommandCatalog = harnessCommandCatalogSchema.parse({
  commands: [],
});

export function findAntigravityCommandDescriptor(
  commandId: string,
): HarnessCommandDescriptor | undefined {
  return ANTIGRAVITY_COMMAND_CATALOG.commands.find(
    (command) =>
      command.id === commandId ||
      command.invocation === commandId ||
      command.id === `antigravity.${commandId}`,
  );
}

export function parseAndFormatAntigravityCommand(
  command: HarnessCommandInvocation,
): HarnessResult<{ prompt: string; descriptor: HarnessCommandDescriptor }> {
  const descriptor = findAntigravityCommandDescriptor(command.commandId);
  if (!descriptor) {
    return {
      ok: false,
      error: {
        code: "unsupported",
        message: `Antigravity does not expose Harness command '${command.commandId}'`,
        retryable: false,
      },
    };
  }

  const args = command.arguments;
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    return {
      ok: false,
      error: {
        code: "invalidRequest",
        message: "Antigravity command arguments must be an object",
        retryable: false,
      },
    };
  }

  if (args) {
    if (Object.keys(args).some((key) => key !== "text")) {
      return {
        ok: false,
        error: {
          code: "invalidRequest",
          message: "Antigravity command has an unknown argument",
          retryable: false,
        },
      };
    }
    if (args.text !== undefined && typeof args.text !== "string") {
      return {
        ok: false,
        error: {
          code: "invalidRequest",
          message: "Antigravity command argument 'text' must be a string",
          retryable: false,
        },
      };
    }
  }

  const text = typeof args?.text === "string" ? args.text.trim() : "";
  const prompt = text.length > 0 ? `${descriptor.invocation} ${text}` : descriptor.invocation;

  return {
    ok: true,
    value: { prompt, descriptor },
  };
}
