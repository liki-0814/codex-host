import { describe, expect, it, vi } from "vitest";
import { DELEGATION_CREATED_METHOD, delegationCreatedSchema } from "@codexhost/shared-contracts";
import {
  findSidebarScope,
  installRendererDelegatedThreadProject,
  projectForDelegatedThread,
} from "../src/renderer-delegated-thread-project.js";

const created = delegationCreatedSchema.parse({ threadId: "child", cwd: "/work/project" });
function project(projectId: string, cwd: string, hostId = "local") {
  return {
    projectId,
    scope: {
      hostIds: [hostId],
      filter: {
        cwdValues: [cwd],
        cwdPrefixes: [`${cwd}/`],
        includeThreadIds: [] as string[],
        excludeThreadIds: [] as string[],
      },
    },
  };
}

describe("delegated thread project membership", () => {
  it("uses the most specific native project filter and respects Host and assignment exclusions", () => {
    const parent = project("parent", "/work");
    const child = project("child-project", "/work/project");
    expect(
      projectForDelegatedThread(
        [parent, child, project("remote", "/work/project", "remote")],
        "local",
        created,
      ),
    ).toBe("child-project");
    child.scope.filter.excludeThreadIds.push("child");
    expect(projectForDelegatedThread([parent, child], "local", created)).toBe("parent");
    expect(projectForDelegatedThread([parent], "remote", created)).toBeNull();
    expect(projectForDelegatedThread([parent, project("duplicate", "/work")], "local", created)).toBeNull();
    parent.scope.filter.includeThreadIds.push("child");
    expect(projectForDelegatedThread([parent], "local", { ...created, cwd: "/elsewhere" })).toBe("parent");
  });

  it("finds only the committed coordinator scope", () => {
    const scope = { get: vi.fn(), query: {} };
    const coordinator = { appScope: scope, service: {}, getEntries: vi.fn() };
    const current = { memoizedState: { memoizedState: coordinator } };
    const stale = { stateNode: { current } };
    const root = {
      querySelectorAll: () => [{ __reactFiber$test: stale }],
    } as unknown as ParentNode;
    expect(findSidebarScope(root)).toBe(scope);
    expect(findSidebarScope({ querySelectorAll: () => [] } as unknown as ParentNode)).toBeNull();
  });

  it("registers only new delegation notifications once, in order, and unsubscribes", async () => {
    let receive!: (value: unknown) => void;
    const unsubscribe = vi.fn();
    const register = vi.fn(async () => {});
    const install = installRendererDelegatedThreadProject(
      {
        getHostId: () => "local",
        addNotificationCallback: (method, callback) => {
          expect(method).toBe(DELEGATION_CREATED_METHOD);
          receive = callback;
          return unsubscribe;
        },
      },
      async () => ({ register }),
    );
    receive({ method: "thread/started", params: created });
    receive({ method: DELEGATION_CREATED_METHOD, params: { threadId: "bad" } });
    receive({ method: DELEGATION_CREATED_METHOD, params: created });
    receive({ method: DELEGATION_CREATED_METHOD, params: created });
    receive({ method: DELEGATION_CREATED_METHOD, params: { ...created, threadId: "second" } });
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(register.mock.calls).toEqual([
      ["local", created],
      ["local", { ...created, threadId: "second" }],
    ]);
    install?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not mutate after disposal or let an unsupported Desktop break later events", async () => {
    let receive!: (value: unknown) => void;
    const register = vi.fn(async () => {});
    const diagnose = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("unsupported"))
      .mockResolvedValue({ register });
    const dispose = installRendererDelegatedThreadProject(
      {
        hostId: "local",
        addNotificationCallback: (_method, callback) => {
          receive = callback;
          return () => {};
        },
      },
      load,
      diagnose,
    );
    receive({ method: DELEGATION_CREATED_METHOD, params: created });
    await vi.waitFor(() => expect(diagnose).toHaveBeenCalledOnce());
    receive({ method: DELEGATION_CREATED_METHOD, params: { ...created, threadId: "second" } });
    dispose?.();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(register).not.toHaveBeenCalled();
  });
});
