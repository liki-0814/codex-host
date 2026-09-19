import { describe, expect, it, vi } from "vitest";
import {
  createInstallationManager,
  fetchInstallationText,
  newerInstallationVersion,
  runInstallationCommand,
} from "../src/installation.js";

const old = {
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  canUpdate: true,
  updateAvailable: true,
};
describe("native installation maintenance", () => {
  it("coalesces clicks and checks during an update, then verifies the executable version", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const check = vi
      .fn()
      .mockResolvedValueOnce(old)
      .mockResolvedValue({ ...old, currentVersion: "1.1.0", updateAvailable: false });
    const update = vi.fn(() => gate);
    const installation = createInstallationManager({ check, update });
    const first = installation("update");
    const second = installation("update");
    expect(first).toBe(second);
    expect(installation("check")).toBe(first);
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    finish();
    await expect(first).resolves.toMatchObject({ currentVersion: "1.1.0", updateAvailable: false });
    expect(check).toHaveBeenCalledTimes(2);
    await installation("update");
    expect(update).toHaveBeenCalledOnce();
  });
  it("rejects unsupported installs and successful commands that did not change versions", async () => {
    const update = vi.fn(async () => {});
    const unsupported = createInstallationManager({
      check: async () => ({ ...old, canUpdate: false }),
      update,
    });
    await expect(unsupported("update")).rejects.toThrow("cannot be updated");
    expect(update).not.toHaveBeenCalled();
    const unchanged = createInstallationManager({ check: async () => old, update });
    await expect(unchanged("update")).rejects.toThrow("version did not change");
  });
  it("does not downgrade a newer local release", () => {
    expect(newerInstallationVersion("1.2.0", "1.1.0")).toBe(false);
    expect(newerInstallationVersion("1.1.0", "1.1.0")).toBe(false);
    expect(newerInstallationVersion("1.1.0-beta.1", "1.1.0")).toBe(true);
  });
  it("passes arguments literally and bounds commands without leaking stderr", async () => {
    const text = await runInstallationCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", "$(echo secret)"],
      process.env,
    );
    expect(text).toBe("$(echo secret)");
    await expect(
      runInstallationCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.env, 50),
    ).rejects.toThrow("timed out");
    await expect(
      runInstallationCommand(
        process.execPath,
        ["-e", "console.error('secret');process.exit(1)"],
        process.env,
      ),
    ).rejects.not.toThrow("secret");
  });
  it("retries a cold latest-version fetch once", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("1.2.3"));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(fetchInstallationText("https://example.test/latest")).resolves.toBe("1.2.3");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
