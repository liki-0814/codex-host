import { describe, expect, it } from "vitest";
import { harnessIdSchema } from "@codexhost/shared-contracts";
import { nativeSessionImport } from "../src/session-import.js";

describe("native session import", () => {
  const candidate = {
    nativeSessionId: "native-1",
    title: "History",
    cwd: "/workspace",
    updatedAt: 1,
    running: null,
  };
  it("revalidates discovery and rejects missing, ambiguous and malformed records", async () => {
    let records: unknown[] = [candidate];
    let closed = false;
    const capability = nativeSessionImport(
      harnessIdSchema.parse("qoder"),
      async () => records,
      () => closed,
    );
    expect(await capability.resolveCandidate?.("native-1")).toMatchObject({
      ok: true,
      value: {
        candidate,
        nativeRef: { harnessId: "qoder", nativeSessionId: "native-1", formatVersion: 1 },
      },
    });
    expect(await capability.resolveCandidate?.("../../outside")).toMatchObject({ ok: false });
    records = [candidate, candidate, { ...candidate, nativeSessionId: "bad", cwd: "" }];
    expect(await capability.listCandidates()).toEqual({ ok: true, value: [] });
    records = [];
    expect(await capability.resolveCandidate?.("native-1")).toMatchObject({
      ok: false,
      error: { code: "sessionNotFound" },
    });
    closed = true;
    expect(await capability.listCandidates()).toMatchObject({ ok: false });
  });
});
