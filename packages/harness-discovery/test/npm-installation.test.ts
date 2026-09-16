import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { npmInstallation } from "../src/npm-installation.js";
import { runInstallationCommand } from "../src/installation.js";
vi.mock("../src/resolve.js", () => ({
  resolveHarnessExecutable: () => ({ executable: "/tools/npm" }),
}));
vi.mock("../src/installation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstallationCommand: vi.fn(async () => ""),
  fetchInstallationText: vi.fn(async () => '{"version":"1.1.0"}'),
}));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
describe("npm installation ownership", () => {
  it("updates only the package and prefix behind the actual CLI symlink", async () => {
    const prefix = await mkdtemp(path.join(tmpdir(), "codexhost-installation-"));
    directories.push(prefix);
    const root = path.join(prefix, "lib/node_modules/@vendor/cli");
    await mkdir(path.join(root, "dist"), { recursive: true });
    await mkdir(path.join(prefix, "bin"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@vendor/cli", version: "1.0.0" }),
    );
    await writeFile(path.join(root, "dist/cli.js"), "");
    const command = path.join(prefix, "bin/cli");
    await symlink(path.join(root, "dist/cli.js"), command);
    const local = await npmInstallation(command, ["@vendor/cli"], {});
    expect(local?.canUpdate).toBe(process.platform !== "win32");
    expect(await local?.latest()).toBe("1.1.0");
    if (process.platform !== "win32") {
      await local?.update("1.1.0");
      expect(runInstallationCommand).toHaveBeenCalledWith(
        "/tools/npm",
        ["install", "--global", "--prefix", await realpath(prefix), "@vendor/cli@1.1.0"],
        expect.any(Object),
        300_000,
      );
    }
    expect(await npmInstallation(command, ["@other/cli"], {})).toBeNull();
  });
  it("does not rewrite a source checkout or project dependency as a global install", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codexhost-source-"));
    directories.push(root);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@vendor/cli", version: "1.0.0" }),
    );
    const command = path.join(root, "cli.js");
    await writeFile(command, "");
    const local = await npmInstallation(command, ["@vendor/cli"], {});
    expect(local?.canUpdate).toBe(false);
    await expect(local?.update("1.1.0")).rejects.toThrow("original package manager");
  });
});
