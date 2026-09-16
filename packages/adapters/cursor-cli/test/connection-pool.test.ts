import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CursorConnectionPool } from "../src/connection.js";
import { CursorTransport, type CursorCallbacks } from "../src/transport.js";

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

const SESSION_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const pools: CursorConnectionPool[] = [];
const transports: CursorTransport[] = [];

function pool(idleMs = 10_000): CursorConnectionPool {
  const created = new CursorConnectionPool(idleMs);
  pools.push(created);
  return created;
}

function transport(
  shared: CursorConnectionPool,
  overrides: { cwd?: string; force?: boolean; timeoutMs?: number } = {},
): CursorTransport {
  const created = new CursorTransport({
    cwd: overrides.cwd ?? process.cwd(),
    environment: process.env,
    pool: shared,
    timeoutMs: overrides.timeoutMs ?? 2_000,
    ...(overrides.force === undefined ? {} : { force: overrides.force }),
  });
  transports.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(transports.splice(0).map((entry) => entry.close()));
  await Promise.all(pools.splice(0).map((entry) => entry.close()));
  state.scenario = "normal";
  state.spawns = 0;
});

const callbacks: CursorCallbacks = {
  update: () => {},
  permission: async () => ({ outcome: { outcome: "selected", optionId: "deny" } }),
  extension: async () => ({ outcome: { outcome: "cancelled" } }),
};

describe("Cursor connection pooling", () => {
  it("serves Sessions sharing a working directory and mode from one CLI process", async () => {
    const shared = pool();
    const first = transport(shared);
    const second = transport(shared);

    await first.open(SESSION_A);
    await second.open(SESSION_B);

    expect(state.spawns).toBe(1);
    expect(first.sessionId).toBe(SESSION_A);
    expect(second.sessionId).toBe(SESSION_B);
  });

  it("does not share a process across working directories", async () => {
    // Cursor resolves project instructions from the process working directory,
    // so a shared process would hand a Session the wrong project context.
    const shared = pool();
    await transport(shared, { cwd: process.cwd() }).open(SESSION_A);
    await transport(shared, { cwd: path.resolve("packages") }).open(SESSION_B);

    expect(state.spawns).toBe(2);
  });

  it("does not share a process across execution modes", async () => {
    // `--force` is a process argument, not a Session option.
    const shared = pool();
    await transport(shared, { force: false }).open(SESSION_A);
    await transport(shared, { force: true }).open(SESSION_B);

    expect(state.spawns).toBe(2);
  });

  it("delivers replayed history only to the Session that asked for it", async () => {
    const shared = pool();
    const first = transport(shared);
    const second = transport(shared);

    await first.open(SESSION_A);
    await second.open(SESSION_B);

    const replayed = (entry: CursorTransport) =>
      entry.replay.map((notification) => notification.sessionId);
    expect(new Set(replayed(first))).toEqual(new Set([SESSION_A]));
    expect(new Set(replayed(second))).toEqual(new Set([SESSION_B]));
  });

  it("keeps the process alive for the next Session in the same directory", async () => {
    const shared = pool();
    const first = transport(shared);
    await first.open(SESSION_A);
    await first.close();

    await transport(shared).open(SESSION_B);

    expect(state.spawns).toBe(1);
  });

  it("retires a connection once its last Session has been idle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const shared = pool(50);
      const first = transport(shared);
      await first.open(SESSION_A);
      await first.close();
      await vi.advanceTimersByTimeAsync(200);

      await transport(shared).open(SESSION_B);
      expect(state.spawns).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("poisons only the Session whose request timed out", async () => {
    state.scenario = "hang-config";
    const shared = pool();
    const stuck = transport(shared, { timeoutMs: 200 });
    const healthy = transport(shared);
    await stuck.open(SESSION_A);
    await healthy.open(SESSION_B);

    await expect(stuck.configure("mode", "plan")).rejects.toThrow(/timed out/u);
    await expect(stuck.prompt("must not run", callbacks)).rejects.toThrow();

    // The shared process is untouched, so the other Session still works.
    expect(state.spawns).toBe(1);
    await expect(healthy.prompt("synthetic", callbacks)).resolves.toEqual({
      stopReason: "end_turn",
    });
  });

  it("does not reuse a connection whose startup failed", async () => {
    state.scenario = "hang-startup";
    const shared = pool();
    const first = transport(shared, { timeoutMs: 150 });

    await expect(first.open(SESSION_A)).rejects.toThrow(/timed out|closed/u);
    await expect(first.open(SESSION_A)).rejects.toThrow("reopened");

    state.scenario = "normal";
    await transport(shared).open(SESSION_B);
    expect(state.spawns).toBe(2);
  });
});
