import { describe, expect, it, vi } from "vitest";
import { fetchInstallationText, runInstallationCommand } from "@codexhost/harness-discovery";
import { createPiInstallation } from "../src/installation.js";
vi.mock("@codexhost/harness-discovery", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchInstallationText: vi.fn(),
  runInstallationCommand: vi.fn(),
}));
vi.mock("../src/command.js", () => ({ resolvePiExecutable: () => "/actual/bin/pi" }));
describe("Pi native updates", () => {
  it("checks Pi's own release endpoint and updates with pi update", async () => {
    const run = vi.mocked(runInstallationCommand);
    const fetchText = vi.mocked(fetchInstallationText);
    let version = "0.60.0";
    run.mockImplementation(async (_command, args) => {
      if (args[0] === "--version") return version;
      if (args[0] === "update") {
        version = "0.61.0";
        return "";
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    fetchText.mockResolvedValue(
      JSON.stringify({ version: "0.61.0", packageName: "@earendil-works/pi-coding-agent" }),
    );
    const installation = createPiInstallation({});
    await expect(installation("check")).resolves.toMatchObject({
      currentVersion: "0.60.0",
      latestVersion: "0.61.0",
      updateAvailable: true,
      canUpdate: true,
    });
    expect(fetchText).toHaveBeenCalledWith("https://pi.dev/api/latest-version");
    expect(run).not.toHaveBeenCalledWith("/actual/bin/pi", ["update"], {}, 300_000);
    await expect(installation("update")).resolves.toMatchObject({
      currentVersion: "0.61.0",
      updateAvailable: false,
    });
    expect(run).toHaveBeenCalledWith("/actual/bin/pi", ["update"], {}, 300_000);
  });
});
