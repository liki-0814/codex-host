import { describe, expect, it, vi } from "vitest";
import { runInstallationCommand } from "@codexhost/harness-discovery";
import { createKimiInstallation } from "../src/installation.js";
vi.mock("@codexhost/harness-discovery", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstallationCommand: vi.fn(),
  npmInstallation: vi.fn(async () => null),
  fetchInstallationText: vi.fn(async () => "0.42.2"),
}));
vi.mock("../src/command.js", () => ({ resolveKimiExecutable: () => "/native/kimi" }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => "global"),
  open: vi.fn(async () => ({
    read: async (buffer: Buffer) => {
      Buffer.from("cffaedfe", "hex").copy(buffer);
    },
    close: vi.fn(),
  })),
}));
describe("Kimi native updates", () => {
  it("checks without staging, then explicitly stages a manual native update and reads it back", async () => {
    const run = vi.mocked(runInstallationCommand);
    let version = "0.42.1";
    run.mockImplementation(async (_command, args) => {
      if (args[0] === "--version") return version;
      if (args.includes("--help")) return "Usage: kimi __update_download <version> --manual";
      if (args.includes("--manual")) {
        version = "0.42.2";
        return "staged";
      }
      throw new Error("Unexpected native command");
    });
    const installation = createKimiInstallation({});
    await expect(installation("check")).resolves.toMatchObject({
      updateAvailable: true,
      canUpdate: true,
    });
    expect(run.mock.calls.some((call) => call[1].includes("--manual"))).toBe(false);
    await expect(installation("update")).resolves.toMatchObject({
      currentVersion: "0.42.2",
      updateAvailable: false,
    });
    expect(run).toHaveBeenCalledWith(
      "/native/kimi",
      ["__update_download", "0.42.2", "--manual"],
      { KIMI_CODE_NO_AUTO_UPDATE: "1" },
      300_000,
    );
  });
});
