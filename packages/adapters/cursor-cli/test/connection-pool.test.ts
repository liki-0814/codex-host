import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CursorConnectionPool } from "../src/connection.js";

const state = vi.hoisted(() => ({ scenario: "normal", spawns: 0 }));
vi.mock("../src/command.js", () => ({
  cursorInvocation: () => {
    state.spawns += 1;
    return {
      command: process.execPath,
      arguments: [
        path.resolve("packages/adapters/cursor-cli/test/fixtures/acp.mjs"),
        state.scenario,
      ],
      windowsVerbatimArguments: false,
    };
  },
}));

const pools: CursorConnectionPool[] = [];

function pool(idleMs = 10_000): CursorConnectionPool {
  const created = new CursorConnectionPool(idleMs);
  pools.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((entry) => entry.close()));
  state.scenario = "normal";
  state.spawns = 0;
});

describe("Cursor connection pooling", () => {
  it("reuses one CLI process for the same working directory and mode", async () => {
    const shared = pool();
    const first = await shared.acquire(
      { cwd: process.cwd(), force: false },
      process.env,
      undefined,
      2_000,
    );
    const second = await shared.acquire(
      { cwd: process.cwd(), force: false },
      process.env,
      undefined,
      2_000,
    );
    expect(state.spawns).toBe(1);
    expect(first).toBe(second);
  });

  it("does not share a process across working directories", async () => {
    const shared = pool();
    await shared.acquire({ cwd: process.cwd(), force: false }, process.env, undefined, 2_000);
    await shared.acquire(
      { cwd: path.resolve("packages"), force: false },
      process.env,
      undefined,
      2_000,
    );
    expect(state.spawns).toBe(2);
  });

  it("does not share a process across execution modes", async () => {
    const shared = pool();
    await shared.acquire({ cwd: process.cwd(), force: false }, process.env, undefined, 2_000);
    await shared.acquire({ cwd: process.cwd(), force: true }, process.env, undefined, 2_000);
    expect(state.spawns).toBe(2);
  });

  it("does not reuse a connection whose startup failed", async () => {
    state.scenario = "hang-startup";
    const shared = pool();
    await expect(
      shared.acquire({ cwd: process.cwd(), force: false }, process.env, undefined, 150),
    ).rejects.toThrow(/timed out|closed/u);
    state.scenario = "normal";
    await shared.acquire({ cwd: process.cwd(), force: false }, process.env, undefined, 2_000);
    expect(state.spawns).toBe(2);
  });
});
