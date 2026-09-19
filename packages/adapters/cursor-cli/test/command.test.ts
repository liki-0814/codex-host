import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cursorInvocation } from "../src/command.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function executable(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "#!/bin/sh\n");
  await chmod(filePath, 0o755);
  return filePath;
}

describe("Cursor executable discovery", () => {
  it("prefers the rolling shim over a stale versions/ directory on PATH", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "codexhost-cursor-"));
    directories.push(home);
    const pinned = await executable(
      path.join(home, ".local/share/cursor-agent/versions/2026.09.10-fd3934a/cursor-agent"),
    );
    const shim = await executable(path.join(home, ".local/bin/cursor-agent"));
    const invocation = cursorInvocation({
      HOME: home,
      PATH: path.dirname(pinned),
    });
    expect(invocation.command).toBe(shim);
  });

  it("keeps an explicit versioned command", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "codexhost-cursor-"));
    directories.push(home);
    const pinned = await executable(
      path.join(home, ".local/share/cursor-agent/versions/2026.09.10-fd3934a/cursor-agent"),
    );
    await executable(path.join(home, ".local/bin/cursor-agent"));
    const invocation = cursorInvocation(
      { HOME: home, PATH: path.dirname(pinned) },
      pinned,
    );
    expect(invocation.command).toBe(pinned);
  });
});
