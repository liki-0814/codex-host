import { describe, expect, it, vi } from "vitest";
import { runInstallationCommand } from "@codexhost/harness-discovery";
import { createCursorInstallation } from "../src/installation.js";
vi.mock("@codexhost/harness-discovery", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstallationCommand: vi.fn(),
}));
vi.mock("../src/command.js", () => ({
  cursorInvocation: () => ({ command: "/cli/node.exe", arguments: ["/cli/index.js", "acp"] }),
}));
describe("Cursor native updates", () => {
  it("preserves the Windows entrypoint and treats disabled checks as unknown", async () => {
    const run = vi.mocked(runInstallationCommand);
    run.mockResolvedValueOnce(
      JSON.stringify({
        cliVersion: "2026.09.10-fd3934a",
        latestVersion: "2026.09.15-abcd",
        latestStatus: "update_available",
        userEmail: "private@example.com",
      }),
    );
    const installation = createCursorInstallation({});
    const result = await installation("check");
    expect(result).toEqual({
      currentVersion: "2026.09.10-fd3934a",
      latestVersion: "2026.09.15-abcd",
      updateAvailable: true,
      canUpdate: true,
    });
    expect(run.mock.calls[0]?.[1]).toEqual(["/cli/index.js", "about", "--format", "json"]);
    run.mockResolvedValueOnce(JSON.stringify({ latestStatus: "disabled" }));
    await expect(installation("check")).rejects.toThrow("disabled");
  });
});
