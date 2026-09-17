import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  harnessAccountSnapshotSchema,
  type AccountCreditsSnapshot,
  type HarnessAccountSnapshot,
} from "@codexhost/shared-contracts";
import { z } from "zod";

export const KIMI_USAGES_ENDPOINT = "https://api.kimi.com/coding/v1/usages";
const REQUEST_TIMEOUT_MS = 8_000;

const credentialSchema = z.object({ access_token: z.string().min(1) });

function kimiHome(environment: NodeJS.ProcessEnv): string {
  return environment.KIMI_CODE_HOME ?? join(environment.HOME ?? homedir(), ".kimi-code");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quantity(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isFiveHourWindow(window: unknown): boolean {
  if (!isRecord(window)) return false;
  const duration = quantity(window.duration);
  const unit = String(window.timeUnit ?? "").toLowerCase();
  return duration === 300 && unit.includes("minute");
}

function usageShare(detail: unknown): { usedPercent: number; resetsAt?: string } | undefined {
  if (!isRecord(detail)) return undefined;
  const limit = quantity(detail.limit);
  const remaining = quantity(detail.remaining);
  const used =
    quantity(detail.used) ??
    (limit !== undefined && remaining !== undefined ? Math.max(0, limit - remaining) : undefined);
  if (limit === undefined || limit <= 0 || used === undefined || used < 0) return undefined;
  const resetsAt =
    typeof detail.resetTime === "string" && detail.resetTime ? detail.resetTime : undefined;
  return {
    usedPercent: Math.min(100, (used / limit) * 100),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function membershipPlan(user: unknown): string | undefined {
  if (!isRecord(user) || !isRecord(user.membership) || typeof user.membership.level !== "string") {
    return undefined;
  }
  const plan = user.membership.level.replace(/^LEVEL_/u, "").trim();
  return plan || undefined;
}

function nickname(user: unknown): string | undefined {
  if (!isRecord(user) || typeof user.nickname !== "string") return undefined;
  return user.nickname.trim() || undefined;
}

/** Project the public coding-plan usages payload. Never accepts a token. */
export function projectKimiUsages(payload: unknown): HarnessAccountSnapshot | null {
  if (!isRecord(payload)) return null;
  const weekly = usageShare(payload.usage);
  if (!weekly) return null;
  const productUsage = (Array.isArray(payload.limits) ? payload.limits : []).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const share = usageShare(entry.detail);
    if (!share || !isFiveHourWindow(entry.window)) return [];
    return [
      {
        product: "Kimi Code · 5-hour window",
        usagePercent: share.usedPercent,
        ...(share.resetsAt ? { resetsAt: share.resetsAt } : {}),
      },
    ];
  });
  const credits: AccountCreditsSnapshot = {
    usedPercent: weekly.usedPercent,
    periodType: "weekly",
    ...(weekly.resetsAt ? { resetsAt: weekly.resetsAt } : {}),
    ...(productUsage.length ? { productUsage } : {}),
  };
  const plan = membershipPlan(payload.user);
  const label = nickname(payload.user);
  return harnessAccountSnapshotSchema.parse({
    label: label || "Kimi Code",
    ...(plan ? { plan } : {}),
    credits,
  });
}

async function readAccessToken(
  environment: NodeJS.ProcessEnv,
  readAuthFile: (path: string) => Promise<string>,
): Promise<string | undefined> {
  const fromEnv = environment.KIMI_CODE_API_KEY?.trim() || environment.KIMI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const parsed = credentialSchema.safeParse(
      JSON.parse(await readAuthFile(join(kimiHome(environment), "credentials", "kimi-code.json"))),
    );
    return parsed.success ? parsed.data.access_token : undefined;
  } catch {
    return undefined;
  }
}

export interface FetchKimiAccountInput {
  environment?: NodeJS.ProcessEnv;
  readAuthFile?(path: string): Promise<string>;
  fetch?(url: string, init: RequestInit): Promise<Response>;
  signal?: AbortSignal;
}

/** Read-only coding-plan quota. Uses the native token; does not start `kimi web`. */
export async function fetchKimiAccount(
  input: FetchKimiAccountInput = {},
): Promise<HarnessAccountSnapshot | null> {
  try {
    const environment = input.environment ?? process.env;
    const token = await readAccessToken(
      environment,
      input.readAuthFile ?? ((path) => readFile(path, "utf8")),
    );
    if (!token) return null;
    const fetchImpl = input.fetch ?? fetch;
    const response = await fetchImpl(KIMI_USAGES_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: input.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return projectKimiUsages(await response.json());
  } catch {
    return null;
  }
}
