import { readFile, rename, writeFile } from "node:fs/promises";
import type { HarnessAccountSnapshot } from "@codexhost/shared-contracts";
import os from "node:os";
import path from "node:path";

export const GROK_CREDITS_ENDPOINT = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const GROK_OAUTH_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";
const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_SKEW_MS = 60_000;

export interface GrokProductUsage {
  product: string;
  usagePercent: number;
}

export interface GrokCreditsSnapshot {
  usedPercent: number;
  resetsAt?: string;
  periodType: "weekly" | "monthly" | "unknown";
  productUsage?: ReadonlyArray<GrokProductUsage>;
  fetchedAt: string;
}

export interface FetchGrokCreditsInput {
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: Date;
  readAuthFile?(filePath: string): Promise<string>;
  writeAuthFile?(filePath: string, contents: string): Promise<void>;
  fetch?(url: string, init: RequestInit): Promise<Response>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePercent(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

function nonNegativeCentValue(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  // Grok's Cent wrapper can omit val for zero amounts.
  const amount = value.val === undefined ? 0 : value.val;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return undefined;
  return amount;
}

function grokHome(environment: NodeJS.ProcessEnv): string {
  return (
    environment.GROK_HOME ??
    path.join(environment.HOME ?? environment.USERPROFILE ?? os.homedir(), ".grok")
  );
}

function periodTypeFrom(value: unknown): GrokCreditsSnapshot["periodType"] {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toUpperCase();
  if (normalized.includes("WEEKLY")) return "weekly";
  if (normalized.includes("MONTHLY")) return "monthly";
  return "unknown";
}

function productUsageFrom(value: unknown): GrokProductUsage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const products = value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.product !== "string") return [];
    const usagePercent = finitePercent(entry.usagePercent);
    return usagePercent === undefined ? [] : [{ product: entry.product, usagePercent }];
  });
  return products.length > 0 ? products : undefined;
}

export function parseGrokCreditsResponse(
  value: unknown,
  fetchedAt = new Date().toISOString(),
): GrokCreditsSnapshot | null {
  if (!isRecord(value) || !isRecord(value.config)) return null;
  const config = value.config;
  const period = isRecord(config.currentPeriod) ? config.currentPeriod : undefined;
  const periodType = periodTypeFrom(period?.type);
  const resetsAt =
    (typeof period?.end === "string" && period.end.length > 0 ? period.end : undefined) ??
    (typeof config.billingPeriodEnd === "string" && config.billingPeriodEnd.length > 0
      ? config.billingPeriodEnd
      : undefined);
  let usedPercent = finitePercent(config.creditUsagePercent);
  if (config.creditUsagePercent === undefined) {
    const monthlyLimit = nonNegativeCentValue(config.monthlyLimit);
    const used = nonNegativeCentValue(config.used);
    if (
      (config.monthlyLimit !== undefined && monthlyLimit === undefined) ||
      (config.used !== undefined && used === undefined)
    )
      return null;
    // Follow Grok's included-credit calculation, never the separate on-demand spending cap.
    if (monthlyLimit !== undefined && monthlyLimit > 0) {
      usedPercent = Math.min(100, ((used ?? 0) / monthlyLimit) * 100);
    } else if (
      periodType !== "unknown" &&
      resetsAt !== undefined &&
      Number.isFinite(Date.parse(resetsAt))
    ) {
      // Grok defaults omitted usage to zero. Require a recognizable period, not just any config.
      usedPercent = 0;
    }
  }
  if (usedPercent === undefined) return null;
  const productUsage = productUsageFrom(config.productUsage);
  return {
    usedPercent,
    periodType,
    fetchedAt,
    ...(resetsAt ? { resetsAt } : {}),
    ...(productUsage ? { productUsage } : {}),
  };
}

interface SelectedGrokToken {
  issuer: string;
  entry: Record<string, unknown>;
  key: string;
  refreshToken?: string;
  stale: boolean;
  email?: string;
  label?: string;
}

function tokenIdentity(value: Record<string, unknown>): Pick<SelectedGrokToken, "email" | "label"> {
  return {
    ...(typeof value.email === "string" && value.email.trim() ? { email: value.email.trim() } : {}),
    ...(typeof value.user_id === "string" && value.user_id.trim()
      ? { label: value.user_id.trim() }
      : {}),
  };
}

function isExpired(value: Record<string, unknown>, now: Date): boolean {
  if (typeof value.expires_at !== "string") return false;
  const expiresAt = Date.parse(value.expires_at);
  return Number.isFinite(expiresAt) && expiresAt - REFRESH_SKEW_MS <= now.getTime();
}

function selectAccessToken(auth: unknown, now: Date): SelectedGrokToken | null {
  if (!isRecord(auth)) return null;
  const entries = Object.entries(auth)
    .filter(
      ([issuer, value]) =>
        (issuer === "https://auth.x.ai" || issuer.startsWith("https://auth.x.ai::")) &&
        isRecord(value) &&
        typeof value.key === "string" &&
        value.key.length > 0,
    )
    .sort(
      ([left], [right]) =>
        Number(right.startsWith("https://auth.x.ai")) -
        Number(left.startsWith("https://auth.x.ai")),
    );
  const selected: SelectedGrokToken[] = [];
  for (const [issuer, value] of entries) {
    if (!isRecord(value) || typeof value.key !== "string") continue;
    selected.push({
      issuer,
      entry: value,
      key: value.key,
      stale: isExpired(value, now),
      ...(typeof value.refresh_token === "string" && value.refresh_token
        ? { refreshToken: value.refresh_token }
        : {}),
      ...tokenIdentity(value),
    });
  }
  return selected.find((token) => !token.stale) ?? selected.find((token) => token.refreshToken) ?? null;
}

function oauthClientId(issuer: string, entry: Record<string, unknown>): string {
  if (typeof entry.oidc_client_id === "string" && entry.oidc_client_id.trim())
    return entry.oidc_client_id.trim();
  const suffix = issuer.startsWith("https://auth.x.ai::")
    ? issuer.slice("https://auth.x.ai::".length)
    : "";
  return suffix || GROK_OAUTH_CLIENT_ID;
}

function oauthTokenUrl(entry: Record<string, unknown>): string {
  if (typeof entry.oidc_issuer === "string" && entry.oidc_issuer.trim())
    return `${entry.oidc_issuer.replace(/\/$/u, "")}/oauth2/token`;
  return GROK_OAUTH_TOKEN_ENDPOINT;
}

async function refreshNativeToken(
  token: SelectedGrokToken,
  auth: Record<string, unknown>,
  authPath: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  writeAuthFile: (filePath: string, contents: string) => Promise<void>,
  signal: AbortSignal,
  now: Date,
): Promise<string | undefined> {
  if (!token.refreshToken) return undefined;
  const response = await fetchImpl(oauthTokenUrl(token.entry), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthClientId(token.issuer, token.entry),
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    }),
    signal,
  });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || typeof payload.access_token !== "string" || !payload.access_token)
    return undefined;
  const expiresIn =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 3600;
  const refreshToken =
    typeof payload.refresh_token === "string" && payload.refresh_token
      ? payload.refresh_token
      : token.refreshToken;
  const nextEntry = {
    ...token.entry,
    key: payload.access_token,
    refresh_token: refreshToken,
    expires_at: new Date(now.getTime() + expiresIn * 1000).toISOString(),
  };
  auth[token.issuer] = nextEntry;
  token.entry = nextEntry;
  token.key = payload.access_token;
  token.refreshToken = refreshToken;
  token.stale = false;
  await writeAuthFile(authPath, `${JSON.stringify(auth, undefined, 2)}\n`).catch(() => undefined);
  return payload.access_token;
}

export async function fetchGrokAccount(
  input: FetchGrokCreditsInput = {},
): Promise<HarnessAccountSnapshot | null> {
  try {
    const environment = input.environment ?? process.env;
    // Do not attribute a saved OAuth account to an explicitly API-configured environment.
    if (
      [environment.XAI_API_KEY, environment.GROK_API_KEY, environment.GROK_TOKEN].some((value) =>
        value?.trim(),
      )
    )
      return null;
    const now = input.now ?? new Date();
    const authPath = path.join(grokHome(environment), "auth.json");
    const raw = input.readAuthFile
      ? await input.readAuthFile(authPath)
      : await readFile(authPath, "utf8");
    const auth = JSON.parse(raw) as unknown;
    const token = selectAccessToken(auth, now);
    if (!token || !isRecord(auth)) return null;
    const fetchImpl = input.fetch ?? fetch;
    const writeAuthFile =
      input.writeAuthFile ??
      (async (filePath: string, contents: string) => {
        const temporary = `${filePath}.tmp`;
        await writeFile(temporary, contents, "utf8");
        await rename(temporary, filePath);
      });
    const requestSignal = () =>
      input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    if (token.stale) {
      const refreshed = await refreshNativeToken(
        token,
        auth,
        authPath,
        fetchImpl,
        writeAuthFile,
        requestSignal(),
        now,
      );
      if (!refreshed) return null;
    }
    const requestCredits = (accessToken: string) =>
      fetchImpl(GROK_CREDITS_ENDPOINT, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-xai-token-auth": "xai-grok-cli",
          Accept: "application/json",
        },
        signal: requestSignal(),
      });
    let response = await requestCredits(token.key);
    if (response.status === 401 && token.refreshToken) {
      const refreshed = await refreshNativeToken(
        token,
        auth,
        authPath,
        fetchImpl,
        writeAuthFile,
        requestSignal(),
        now,
      );
      if (!refreshed) return null;
      response = await requestCredits(token.key);
    }
    if (!response.ok) return null;
    const snapshot = parseGrokCreditsResponse(await response.json(), now.toISOString());
    if (!snapshot) return null;
    return {
      credits: {
        usedPercent: snapshot.usedPercent,
        periodType: snapshot.periodType,
        ...(snapshot.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
        ...(snapshot.productUsage ? { productUsage: [...snapshot.productUsage] } : {}),
      },
      ...(token.email ? { email: token.email } : {}),
      ...(token.label ? { label: token.label } : {}),
    };
  } catch {
    return null;
  }
}

export async function fetchGrokCredits(
  input: FetchGrokCreditsInput = {},
): Promise<GrokCreditsSnapshot | null> {
  const account = await fetchGrokAccount(input);
  if (!account?.credits) return null;
  const { credits } = account;
  return {
    usedPercent: credits.usedPercent,
    periodType:
      credits.periodType === "weekly" || credits.periodType === "monthly"
        ? credits.periodType
        : "unknown",
    fetchedAt: (input.now ?? new Date()).toISOString(),
    ...(credits.resetsAt ? { resetsAt: credits.resetsAt } : {}),
    ...(credits.productUsage ? { productUsage: credits.productUsage } : {}),
  };
}
