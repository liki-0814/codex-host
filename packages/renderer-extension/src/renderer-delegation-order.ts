import {
  DELEGATION_CREATED_METHOD,
  delegationCreatedSchema,
  type DelegationCreated,
} from "@codexhost/shared-contracts";

interface RequestManager {
  getHostId?: () => unknown;
  hostId?: unknown;
  addNotificationCallback?: (
    method: string,
    callback: (notification: unknown) => void,
  ) => () => void;
}
interface DesktopScope {
  get(atom: unknown, key?: string): unknown;
}
interface ProjectScope {
  hostIds?: string[];
  filter?: {
    includeThreadIds: string[];
    excludeThreadIds: string[];
    cwdValues: string[];
    cwdPrefixes: string[];
  };
}
export interface DesktopOrderBinding {
  register(hostId: string, created: DelegationCreated): Promise<void>;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Use the committed catalog coordinator's AppScope, not a stale Composer hook. */
export function findSidebarScope(root: ParentNode): DesktopScope | null {
  const element = [...root.querySelectorAll("*")].find((element) =>
    Object.getOwnPropertyNames(element).some((name) => name.startsWith("__reactFiber$")),
  );
  const key =
    element && Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = element && key ? Object.getOwnPropertyDescriptor(element, key)?.value : null;
  const parents = new Set();
  while (record(fiber) && fiber.return && !parents.has(fiber)) {
    parents.add(fiber);
    fiber = fiber.return;
  }
  const state = record(fiber) ? fiber.stateNode : null;
  const pending: unknown[] = [record(state) ? state.current : null];
  const visited = new Set();
  const scopes = new Set<DesktopScope>();
  const inspect = (value: unknown) => {
    if (!record(value) || typeof value.getEntries !== "function" || !value.service) return;
    const scope = value.appScope;
    if (record(scope) && typeof scope.get === "function" && record(scope.query))
      scopes.add(scope as unknown as DesktopScope);
  };
  while (pending.length && visited.size < 20_000) {
    const current = pending.pop();
    if (!record(current) || visited.has(current)) continue;
    visited.add(current);
    pending.push(current.child, current.sibling);
    let hook = current.memoizedState;
    for (let i = 0; record(hook) && i < 120; i++, hook = hook.next) {
      inspect(hook.memoizedState);
      if (record(hook.memoizedState)) inspect(hook.memoizedState.current);
      if (Array.isArray(hook.memoizedState)) hook.memoizedState.forEach(inspect);
    }
    const queue = current.updateQueue;
    const cache = record(queue) ? queue.memoCache : null;
    if (record(cache) && Array.isArray(cache.data))
      for (const row of cache.data) if (Array.isArray(row)) row.forEach(inspect);
  }
  return scopes.size === 1 ? ([...scopes][0] ?? null) : null;
}

/** Apply Desktop's project filters; ambiguous ownership must not reorder another project. */
export function delegationProject(
  projects: readonly { projectId: string; scope: ProjectScope | null }[],
  hostId: string,
  created: DelegationCreated,
): string | null {
  const matches = projects
    .flatMap(({ projectId, scope }) => {
      const filter = scope?.filter;
      if (
        !filter ||
        !scope?.hostIds?.includes(hostId) ||
        filter.excludeThreadIds.includes(created.threadId)
      )
        return [];
      const explicit = filter.includeThreadIds.includes(created.threadId);
      const lengths = [
        ...filter.cwdValues.filter((path) => path === created.cwd).map((path) => path.length),
        ...filter.cwdPrefixes
          .filter((path) => created.cwd.startsWith(path))
          .map((path) => path.length),
      ];
      return explicit || lengths.length
        ? [{ projectId, score: explicit ? Infinity : Math.max(...lengths) }]
        : [];
    })
    .sort((a, b) => b.score - a.score);
  const [first, second] = matches;
  return first && (!second || first.score > second.score) ? first.projectId : null;
}

async function loadDesktopOrderBinding(): Promise<DesktopOrderBinding> {
  // Private Desktop contract verified against this asset. Unknown versions fail closed;
  // never substitute a direct global-state write that bypasses Desktop's cache/serialization.
  const url = "app://-/assets/app-initial-4d7ea7f81c2d.js";
  const native = await import(/* @vite-ignore */ url);
  if (
    typeof native.I4 !== "function" ||
    !native.I4.toString().includes("projectSortMode") ||
    !native.I4.toString().includes("Failed to save sidebar project thread order") ||
    !native.att ||
    !native.ttt ||
    !native.Tnt
  )
    throw new Error("Desktop project order binding is unsupported");
  return {
    async register(hostId, created) {
      const scope = findSidebarScope(document);
      if (!scope) throw new Error("Desktop sidebar scope is unavailable");
      const preferences = scope.get(native.Tnt);
      if (!record(preferences) || preferences.projectSortMode !== "manual") return;
      const projects = scope.get(native.att);
      if (!Array.isArray(projects)) throw new Error("Desktop projects are unavailable");
      const projectId = delegationProject(
        projects.map(({ projectId }: { projectId: string }) => ({
          projectId,
          scope: scope.get(native.ttt, projectId) as ProjectScope | null,
        })),
        hostId,
        created,
      );
      if (projectId) await native.I4(scope, projectId, created.threadId);
    },
  };
}

export function installRendererDelegationOrder(
  manager: RequestManager,
  load: () => Promise<DesktopOrderBinding> = loadDesktopOrderBinding,
  diagnose: () => void = () =>
    console.warn("codexhost: delegation sidebar registration unavailable"),
): (() => void) | null {
  if (!manager.addNotificationCallback) return null;
  const hostId = manager.getHostId?.() ?? manager.hostId;
  if (typeof hostId !== "string") return null;
  const seen = new Set<string>();
  let disposed = false;
  let tail = Promise.resolve();
  const unsubscribe = manager.addNotificationCallback(DELEGATION_CREATED_METHOD, (notification) => {
    if (!record(notification) || notification.method !== DELEGATION_CREATED_METHOD) return;
    const result = delegationCreatedSchema.safeParse(notification.params);
    if (!result.success || seen.has(result.data.threadId)) return;
    seen.add(result.data.threadId);
    // Preserve creation order even when loading the native module is asynchronous.
    tail = tail
      .then(async () => {
        const binding = await load();
        if (!disposed) await binding.register(hostId, result.data);
      })
      .catch(diagnose);
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
