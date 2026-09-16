import { describe, expect, it, vi } from "vitest";
import { runInstallationCommand } from "@codexhost/harness-discovery";
import { createGrokInstallation } from "../src/installation.js";
vi.mock("@codexhost/harness-discovery", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstallationCommand: vi.fn(),
}));
vi.mock("../src/command.js", () => ({ resolveGrokExecutable: () => "/cli/grok" }));
describe("Grok native updates", () => {
  it("honors native channel results and reports failed checks", async () => {
    const run = vi.mocked(runInstallationCommand);
    const state = {
      currentVersion: "1.0.30",
      latestVersion: "1.0.30",
      updateAvailable: false,
      installer: "internal",
      channel: "stable",
      error: null,
    };
    run.mockResolvedValueOnce(JSON.stringify(state));
    const installation = createGrokInstallation({});
    await expect(installation("check")).resolves.toMatchObject({
      currentVersion: "1.0.30",
      updateAvailable: false,
    });
    expect(run.mock.calls[0]?.[1]).toEqual(["update", "--check", "--json"]);
    run.mockResolvedValueOnce(JSON.stringify({ ...state, error: "offline" }));
    await expect(installation("check")).rejects.toThrow("failed");
  });
});
