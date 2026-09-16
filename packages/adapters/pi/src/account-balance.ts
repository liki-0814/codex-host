import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  harnessAccountSnapshotSchema,
  type HarnessAccountSnapshot,
} from "@codexhost/shared-contracts";

/**
 * Pi authenticates each provider separately in its agent directory. Only
 * DeepSeek is read here: it is the one configured provider that bills from a
 * prepaid balance and publishes it, while the others hold OAuth tokens with no
 * comparable native endpoint.
 */
const DEEPSEEK_BALANCE_ENDPOINT = "https://api.deepseek.com/user/balance";
const REQUEST_TIMEOUT_MS = 10_000;

function agentDirectory(environment: NodeJS.ProcessEnv): string {
  const configured = environment.PI_CODING_AGENT_DIR?.trim();
  if (configured) return configured;
  return path.join(environment.HOME ?? environment.USERPROFILE ?? homedir(), ".pi", "agent");
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Reads the native credential without copying it anywhere the Host can log. */
async function deepSeekApiKey(environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  const auth = record(
    JSON.parse(await readFile(path.join(agentDirectory(environment), "auth.json"), "utf8")),
  );
  const deepseek = record(auth.deepseek);
  if (deepseek.type !== "api_key") return undefined;
  return typeof deepseek.key === "string" && deepseek.key.trim() ? deepseek.key : undefined;
}

/**
 * DeepSeek reports one entry per currency. Only the first is projected, because
 * the Host must not add balances across currencies or pick a "primary" one.
 */
export function projectDeepSeekBalance(payload: unknown): HarnessAccountSnapshot | null {
  const data = record(payload);
  if (!Array.isArray(data.balance_infos)) return null;
  const first = record(data.balance_infos[0]);
  const amount = Number(first.total_balance);
  const currency = typeof first.currency === "string" ? first.currency.trim() : "";
  if (!Number.isFinite(amount) || amount < 0 || !currency) return null;
  const parsed = harnessAccountSnapshotSchema.safeParse({
    label: "DeepSeek",
    balance: { amount, currency, label: "DeepSeek API" },
  });
  return parsed.success ? parsed.data : null;
}

export async function fetchPiAccount(
  input: {
    environment?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    fetch?: typeof fetch;
    readApiKey?: () => Promise<string | undefined>;
  } = {},
): Promise<HarnessAccountSnapshot | null> {
  try {
    const environment = input.environment ?? process.env;
    const key = await (input.readApiKey ? input.readApiKey() : deepSeekApiKey(environment));
    if (!key) return null;
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await (input.fetch ?? fetch)(DEEPSEEK_BALANCE_ENDPOINT, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    return projectDeepSeekBalance(await response.json());
  } catch {
    // Credentials and native response bodies must never reach Renderer errors or logs.
    return null;
  }
}
