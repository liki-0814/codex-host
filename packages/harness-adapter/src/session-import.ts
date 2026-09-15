import {
  harnessSessionImportCandidateSchema,
  nativeSessionRefSchema,
} from "@codexhost/shared-contracts";
import type { HarnessId } from "@codexhost/shared-contracts";
import type { HarnessSessionImportCapability, HarnessSessionImportSource } from "./text-session.js";

/** Re-read native metadata at import time; never accept a client-supplied path. */
export function nativeSessionImport(
  harnessId: HarnessId,
  read: (signal: { throwIfAborted(): void }) => Promise<readonly unknown[]>,
  closed: () => boolean,
): HarnessSessionImportCapability & { close(): Promise<void> } {
  let stopped = false;
  const signal = {
    throwIfAborted() {
      if (stopped) throw new Error("Adapter is closed");
    },
  };
  const pending = new Set<Promise<readonly unknown[]>>();
  const listCandidates: HarnessSessionImportCapability["listCandidates"] = async () => {
    if (closed() || stopped)
      return {
        ok: false,
        error: { code: "unavailable", message: "Adapter is closed", retryable: false },
      };
    try {
      const request = read(signal);
      pending.add(request);
      let records: readonly unknown[];
      try {
        records = await request;
      } finally {
        pending.delete(request);
      }
      signal.throwIfAborted();
      const candidates = records.flatMap((value) => {
        const parsed = harnessSessionImportCandidateSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      });
      const counts = new Map<string, number>();
      for (const candidate of candidates)
        counts.set(candidate.nativeSessionId, (counts.get(candidate.nativeSessionId) ?? 0) + 1);
      return {
        ok: true,
        value: candidates.filter((candidate) => counts.get(candidate.nativeSessionId) === 1),
      };
    } catch {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "Native session metadata could not be read",
          retryable: true,
        },
      };
    }
  };
  return {
    async close() {
      stopped = true;
      await Promise.allSettled(pending);
    },
    listCandidates,
    async resolveCandidate(id) {
      const listed = await listCandidates();
      if (!listed.ok) return listed;
      const candidate = listed.value.find((value) => value.nativeSessionId === id);
      if (!candidate)
        return {
          ok: false,
          error: {
            code: "sessionNotFound",
            message: "Native session is no longer importable",
            retryable: false,
          },
        };
      const source: HarnessSessionImportSource = {
        candidate,
        nativeRef: nativeSessionRefSchema.parse({
          harnessId,
          nativeSessionId: id,
          formatVersion: 1,
        }),
      };
      return { ok: true, value: source };
    },
  };
}
