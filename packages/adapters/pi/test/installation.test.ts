import { describe, expect, it, vi } from "vitest";
import { npmInstallation } from "@codexhost/harness-discovery";
import { createPiInstallation } from "../src/installation.js";
vi.mock("@codexhost/harness-discovery", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  npmInstallation: vi.fn(),
}));
vi.mock("../src/command.js", () => ({ resolvePiExecutable: () => "/actual/bin/pi" }));
describe("Pi native updates", () => {
  it("updates its actual package and validates the version after install", async () => {
    let version = "0.60.0";
    const update = vi.fn(async () => {
      version = "0.61.0";
    });
    vi.mocked(npmInstallation).mockImplementation(async () => ({
      currentVersion: version,
      canUpdate: true,
      latest: async () => "0.61.0",
      update,
    }));
    const installation = createPiInstallation({});
    await expect(installation("check")).resolves.toMatchObject({
      currentVersion: "0.60.0",
      updateAvailable: true,
    });
    expect(update).not.toHaveBeenCalled();
    await expect(installation("update")).resolves.toMatchObject({
      currentVersion: "0.61.0",
      updateAvailable: false,
    });
    expect(update).toHaveBeenCalledWith("0.61.0");
    expect(npmInstallation).toHaveBeenCalledWith(
      "/actual/bin/pi",
      ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"],
      {},
    );
  });
});
