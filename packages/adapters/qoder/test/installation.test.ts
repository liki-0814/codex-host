import { describe, expect, it, vi } from "vitest";
import { runInstallationCommand } from "@codexhost/harness-discovery";
import { createQoderInstallation } from "../src/installation.js";
vi.mock("@codexhost/harness-discovery", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstallationCommand: vi.fn(),
}));
vi.mock("../src/qoder-command.js", () => ({ resolveQoderExecutable: () => "/cli/qodercli" }));
describe("Qoder native updates", () => {
  it("checks without installing and refuses an unknown check response", async () => {
    const run = vi.mocked(runInstallationCommand);
    run
      .mockResolvedValueOnce("1.1.51")
      .mockResolvedValueOnce("Qoder CLI update (check only)\nUpdate available: 1.1.51 -> 1.1.53");
    const installation = createQoderInstallation({ HOME: "/home" });
    await expect(installation("check")).resolves.toMatchObject({
      currentVersion: "1.1.51",
      latestVersion: "1.1.53",
      updateAvailable: true,
    });
    expect(run.mock.calls.map((call) => call[1])).toEqual([["--version"], ["update", "--check"]]);
    run
      .mockResolvedValueOnce("1.1.51")
      .mockResolvedValueOnce("Cannot reach latest version service");
    await expect(installation("check")).rejects.toThrow("unknown response");
  });

  it("recognizes the native up-to-date response", async () => {
    const run = vi.mocked(runInstallationCommand);
    run
      .mockResolvedValueOnce("1.1.53")
      // Verbatim output of `qodercli update --check` on a current install.
      .mockResolvedValueOnce(
        "Qoder CLI update (check only)\n\nChecking for updates...\nAlready at the latest version (1.1.53).",
      );
    const installation = createQoderInstallation({ HOME: "/home" });

    await expect(installation("check")).resolves.toMatchObject({
      currentVersion: "1.1.53",
      latestVersion: "1.1.53",
      updateAvailable: false,
      canUpdate: true,
    });
  });
});
