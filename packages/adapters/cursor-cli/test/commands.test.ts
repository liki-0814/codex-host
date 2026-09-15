import { expect, it } from "vitest";
import { cursorCommands } from "../src/commands.js";
it("uses only native advertised commands and omits clipboard-only actions", () => {
  expect(
    cursorCommands({
      sessionId: "session",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "verify", description: "Verify" },
          { name: "verify", description: "duplicate" },
          { name: "copy-request-id", description: "copy" },
        ],
      },
    })?.commands.map((c) => c.invocation),
  ).toEqual(["/verify"]);
});
