import { describe, expect, it, vi } from "vitest";

import { fetchPiAccount, projectDeepSeekBalance } from "../src/account-balance.js";

// Verbatim shape of GET https://api.deepseek.com/user/balance.
const NATIVE_PAYLOAD = {
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "100.00",
      granted_balance: "0.00",
      topped_up_balance: "100.00",
    },
  ],
};

describe("DeepSeek balance projection", () => {
  it("reports the native amount and currency without converting", () => {
    expect(projectDeepSeekBalance(NATIVE_PAYLOAD)).toEqual({
      label: "DeepSeek",
      balance: { amount: 100, currency: "CNY", label: "DeepSeek API" },
    });
  });

  it("reports no Account rather than inventing a usage percentage", () => {
    const projected = projectDeepSeekBalance(NATIVE_PAYLOAD);
    expect(projected?.credits).toBeUndefined();
  });

  it("refuses a payload without a usable balance", () => {
    expect(projectDeepSeekBalance({ is_available: true, balance_infos: [] })).toBeNull();
    expect(projectDeepSeekBalance({})).toBeNull();
    expect(
      projectDeepSeekBalance({ balance_infos: [{ currency: "CNY", total_balance: "n/a" }] }),
    ).toBeNull();
    expect(
      projectDeepSeekBalance({ balance_infos: [{ currency: "", total_balance: "1.00" }] }),
    ).toBeNull();
  });
});

describe("Pi Account inspection", () => {
  it("asks DeepSeek for the balance with the native key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(NATIVE_PAYLOAD)));
    await expect(
      fetchPiAccount({
        fetch: fetchMock as unknown as typeof fetch,
        readApiKey: async () => "sk-secret",
      }),
    ).resolves.toMatchObject({ balance: { amount: 100, currency: "CNY" } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/user/balance");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
  });

  it("makes no request when the provider is not configured", async () => {
    const fetchMock = vi.fn();
    await expect(
      fetchPiAccount({
        fetch: fetchMock as unknown as typeof fetch,
        readApiKey: async () => undefined,
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports no Account instead of surfacing a native failure", async () => {
    await expect(
      fetchPiAccount({
        fetch: (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch,
        readApiKey: async () => "sk-secret",
      }),
    ).resolves.toBeNull();

    await expect(
      fetchPiAccount({
        fetch: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
        readApiKey: async () => "sk-secret",
      }),
    ).resolves.toBeNull();
  });

  it("reads the credential from the configured agent directory", async () => {
    // No PI_CODING_AGENT_DIR on disk, so the read fails and no request is made.
    const fetchMock = vi.fn();
    await expect(
      fetchPiAccount({
        environment: { PI_CODING_AGENT_DIR: "/nonexistent/pi-agent" },
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
