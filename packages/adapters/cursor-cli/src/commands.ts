import {
  harnessCommandCatalogSchema,
  type HarnessCommandCatalog,
} from "@codexhost/shared-contracts";
import type { SessionNotification } from "@agentclientprotocol/sdk";

/** Only native ACP-advertised prompt commands; clipboard-only commands have no persistent Turn. */
export function cursorCommands(
  notification: SessionNotification,
): HarnessCommandCatalog | undefined {
  const update = notification.update;
  if (update.sessionUpdate !== "available_commands_update") return undefined;
  const seen = new Set<string>();
  return {
    commands: update.availableCommands.flatMap((command) => {
      if (command.name === "copy-request-id" || seen.has(command.name)) return [];
      const parsed = harnessCommandCatalogSchema.safeParse({
        commands: [
          {
            id: `cursor.${command.name}`,
            invocation: `/${command.name}`,
            label: command.name,
            ...(command.description ? { description: command.description.slice(0, 512) } : {}),
            argumentMode: "text",
          },
        ],
      });
      if (!parsed.success) return [];
      seen.add(command.name);
      return parsed.data.commands;
    }),
  };
}
