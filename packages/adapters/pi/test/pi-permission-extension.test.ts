import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  installedPiPermissionExtension,
  managePiPermissionExtension,
  PI_PERMISSION_EXTENSION,
} from "../src/pi-permission-extension.js";

describe("Pi optional approval extension", () => {
  it("installs only explicitly into Host storage and can be verified", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "pi-permissions-"));
    try {
      const env = { HOME: home };
      expect(await managePiPermissionExtension("permissions", "inspect", env)).toEqual({
        installed: false,
      });
      expect(await managePiPermissionExtension("permissions", "install", env)).toEqual({
        installed: true,
      });
      expect(installedPiPermissionExtension(env)).toContain(".codexhost");
      const installed = installedPiPermissionExtension(env);
      if (!installed) throw new Error("Missing installed extension");
      await writeFile(installed, "// earlier bundled version\n");
      expect(await managePiPermissionExtension("permissions", "inspect", env)).toEqual({
        installed: true,
        updateAvailable: true,
      });
      expect(installedPiPermissionExtension(env)).toBeUndefined();
      expect(await managePiPermissionExtension("permissions", "install", env)).toEqual({
        installed: true,
      });
      await expect(managePiPermissionExtension("unknown", "install", env)).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("blocks by default, switches instantly and never overrides another extension", async () => {
    const module = await import(
      `data:text/javascript,${encodeURIComponent(PI_PERMISSION_EXTENSION)}`
    );
    let gate: (event: unknown, ctx: unknown) => Promise<unknown> = async () => undefined;
    let select: (mode: string) => Promise<void> = async () => undefined;
    module.default({
      registerCommand: (_: string, value: { handler: typeof select }) => {
        select = value.handler;
      },
      on: (_: string, handler: typeof gate) => {
        gate = handler;
      },
    });
    const confirm = vi.fn(async () => false);
    const event = { toolName: "bash", input: { command: "printf test" } };
    expect(await gate(event, { hasUI: true, ui: { confirm } })).toMatchObject({ block: true });
    await select("auto");
    confirm.mockClear();
    expect(await gate(event, { hasUI: true, ui: { confirm } })).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
    await select("approve");
    expect(await gate(event, { hasUI: false })).toMatchObject({ block: true });
    expect(
      await gate(event, {
        hasUI: true,
        ui: {
          confirm: async () => {
            throw new Error("closed");
          },
        },
      }),
    ).toMatchObject({ block: true });
    expect(await gate(event, { hasUI: true, ui: { confirm: async () => true } })).toBeUndefined();
  });
});
