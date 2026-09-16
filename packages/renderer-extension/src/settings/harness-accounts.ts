import {
  getSharedAgentGroupPreferenceStore,
  type AgentGroupPreferenceStore,
} from "../agent-group-preference.js";
import type {
  HarnessAccountInspectParams,
  HarnessAccountInspectResult,
  HarnessAccountListParams,
  HarnessAccountListResult,
  HarnessAccountSourceListResult,
} from "@codexhost/shared-contracts";

export interface RendererHarnessAccountClient {
  listHarnessAccountSources?(): Promise<HarnessAccountSourceListResult>;
  inspectHarnessAccount?(input: HarnessAccountInspectParams): Promise<HarnessAccountInspectResult>;
  /** Compatibility fallback for Hosts that predate progressive account inspection. */
  listHarnessAccounts?(input?: HarnessAccountListParams): Promise<HarnessAccountListResult>;
}

type HarnessAccount = HarnessAccountListResult["accounts"][number];

/** Read-only telemetry, deliberately separate from Codex Account IDs and mutations. */
export function createHarnessAccounts(
  signal: AbortSignal,
  getClient: () => RendererHarnessAccountClient | null,
  onChange: () => void,
  groupPreference: AgentGroupPreferenceStore = getSharedAgentGroupPreferenceStore(),
) {
  let accounts: HarnessAccount[] = [];
  let refreshing = false;
  const sortedAccounts = (values: Iterable<HarnessAccount>): HarnessAccount[] => {
    const entries = groupPreference.list();
    const order = [
      ...entries.filter((e) => e.section === "main"),
      ...entries.filter((e) => e.section === "more"),
    ].map((e) => e.agent as string);
    const rank = (id: string) => {
      const index = order.indexOf(id);
      return index < 0 ? order.length : index;
    };
    return [...values].sort(
      (a, b) => rank(a.harnessId) - rank(b.harnessId) || a.harnessId.localeCompare(b.harnessId),
    );
  };
  const unsubscribe = groupPreference.subscribe(() => {
    if (!signal.aborted) onChange();
  });
  signal.addEventListener("abort", unsubscribe, { once: true });

  const loadProgressively = async (
    client: Required<
      Pick<RendererHarnessAccountClient, "listHarnessAccountSources" | "inspectHarnessAccount">
    >,
    force: boolean,
  ): Promise<boolean> => {
    let sources: HarnessAccountSourceListResult;
    try {
      sources = await client.listHarnessAccountSources();
    } catch {
      return false;
    }
    if (signal.aborted) return true;
    const byHarnessId = new Map(accounts.map((account) => [account.harnessId, account]));
    await Promise.all(
      sources.sources.map(async (source) => {
        try {
          const result = await client.inspectHarnessAccount({
            harnessId: source.harnessId,
            ...(force ? { refresh: true } : {}),
          });
          if (signal.aborted || result.harnessId !== source.harnessId) return;
          if (result.account) {
            byHarnessId.set(result.harnessId, {
              ...result.account,
              harnessId: result.harnessId,
              harnessName: result.harnessName,
            });
          } else {
            byHarnessId.delete(source.harnessId);
          }
        } catch {
          if (!signal.aborted) byHarnessId.delete(source.harnessId);
        }
        if (!signal.aborted) {
          accounts = sortedAccounts(byHarnessId.values());
          onChange();
        }
      }),
    );
    return true;
  };

  return {
    get accounts(): readonly HarnessAccount[] {
      return sortedAccounts(accounts);
    },
    get refreshing() {
      return refreshing;
    },
    async refresh(force = false): Promise<void> {
      if (refreshing || signal.aborted) return;
      const client = getClient();
      if (!client) return;
      refreshing = true;
      accounts = [];
      onChange();
      try {
        const progressive =
          client.listHarnessAccountSources && client.inspectHarnessAccount
            ? await loadProgressively(
                {
                  listHarnessAccountSources: client.listHarnessAccountSources.bind(client),
                  inspectHarnessAccount: client.inspectHarnessAccount.bind(client),
                },
                force,
              )
            : false;
        if (progressive || signal.aborted) return;
        if (!client.listHarnessAccounts) return;
        const result = await client.listHarnessAccounts(force ? { refresh: true } : {});
        if (!signal.aborted) accounts = sortedAccounts(result.accounts);
      } catch {
        // Do not keep stale identities after authentication changes or a failed query.
        if (!signal.aborted) accounts = [];
      } finally {
        refreshing = false;
        if (!signal.aborted) onChange();
      }
    },
  };
}
