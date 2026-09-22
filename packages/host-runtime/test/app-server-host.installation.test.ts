import { describe, expect, it, vi } from "vitest";

import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

describe("AppServerHost Harness installation and extensions", () => {
  it("routes version checks and explicit updates only to the selected adapter", async () => {
    const fixture = createFixture();
    const state = {
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
      canUpdate: true,
    };
    const installation = vi.fn(async () => state);
    Object.assign(fixture.adapter, { installation });
    for (const [id, action] of [
      [1, "check"],
      [2, "update"],
    ] as const) {
      writeRequest(fixture.desktopInput, {
        id,
        method: "codexhost/harness/installation",
        params: { harnessId: "pi", action },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, id)),
      ).resolves.toMatchObject({ result: state });
      expect(installation).toHaveBeenLastCalledWith(action);
    }
    writeRequest(fixture.desktopInput, {
      id: 3,
      method: "codexhost/harness/installation",
      params: { harnessId: "pi", action: "update", command: "arbitrary" },
    });
    await expect(
      fixture.collector.waitFor((message) => requestId(message, 3)),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    expect(installation).toHaveBeenCalledTimes(2);
    expect(fixture.adapter.sessions).toHaveLength(0);
    await stopFixture(fixture);
  });

  it("keeps extension inspection read-only and validates explicit installation", async () => {
    const fixture = createFixture();
    const extension = vi.fn(async (_id: string, action: string) => ({
      installed: action === "install",
    }));
    Object.assign(fixture.adapter, { extension });
    for (const [id, action, installed] of [
      [1, "inspect", false],
      [2, "install", true],
    ] as const) {
      writeRequest(fixture.desktopInput, {
        id,
        method: "codexhost/harness/extension",
        params: { harnessId: "pi", extensionId: "permissions", action },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, id)),
      ).resolves.toMatchObject({ result: { installed } });
      expect(extension).toHaveBeenLastCalledWith("permissions", action);
    }
    writeRequest(fixture.desktopInput, {
      id: 3,
      method: "codexhost/harness/extension",
      params: { harnessId: "pi", extensionId: "../external", action: "install" },
    });
    await expect(
      fixture.collector.waitFor((message) => requestId(message, 3)),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    expect(extension).toHaveBeenCalledTimes(2);
    await stopFixture(fixture);
  });
});
