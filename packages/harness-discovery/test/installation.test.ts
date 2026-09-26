import { describe, expect, it } from "vitest";

import {
  createInstallationManager,
  installationVersion,
  newerInstallationVersion,
} from "../src/installation.js";

describe("Harness installation versions", () => {
  it("accepts a stable semver and ignores a local prerelease when latest is older", () => {
    expect(installationVersion("v1.2.3")).toBe("1.2.3");
    expect(newerInstallationVersion("1.2.3", "1.2.2")).toBe(false);
    expect(newerInstallationVersion("1.2.3-dev", "1.2.3")).toBe(true);
    expect(() => installationVersion("latest")).toThrow("invalid version");
  });

  it("shares one update and skips it when the check is already current", async () => {
    let checks = 0;
    let updates = 0;
    const installation = createInstallationManager({
      async check() {
        checks += 1;
        return {
          currentVersion: "1.0.0",
          latestVersion: updates ? "1.1.0" : "1.0.0",
          updateAvailable: updates === 0 ? false : true,
          canUpdate: true,
        };
      },
      async update() {
        updates += 1;
      },
    });
    await expect(installation("update")).resolves.toMatchObject({ updateAvailable: false });
    expect(updates).toBe(0);
    expect(checks).toBe(1);
  });
});
