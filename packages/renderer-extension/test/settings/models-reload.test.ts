import { describe, expect, it, vi } from "vitest";

import { harnessIdSchema, type HarnessModelCatalog } from "@codexhost/shared-contracts";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
  isRendererSettingsIconName: () => true,
}));
vi.mock("../../src/settings/harness-installation.js", () => ({
  createHarnessInstallation: (document: { createElement(tag: string): unknown }) =>
    document.createElement("section"),
}));
vi.mock("../../src/settings/pi-permission-setup.js", () => ({
  PI_EXTENSION_CHANGED: "codexhost:pi-extension-changed",
  createPiPermissionSetup: (document: { createElement(tag: string): unknown }) =>
    document.createElement("section"),
}));

import { RendererSettingsPageScope } from "../../src/settings/core.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";
import {
  createModelsSettingsPage,
  type RendererModelsClient,
} from "../../src/settings/models-page.js";

class FakeElement {
  readonly children: unknown[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly #listeners = new Map<string, (event?: unknown) => void>();
  className = "";
  textContent = "";
  title = "";
  type = "";
  value = "";
  placeholder = "";
  hidden = false;
  disabled = false;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  addEventListener(name: string, listener: (event?: unknown) => void): void {
    this.#listeners.set(name, listener);
  }

  append(...children: unknown[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: unknown[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  insertBefore(node: unknown): unknown {
    this.children.unshift(node);
    return node;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  dispatch(name: string, event?: unknown): void {
    this.#listeners.get(name)?.(event);
  }
}

class FakeDocument {
  readonly defaultView = {
    localStorage: {
      store: new Map<string, string>(),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
      removeItem(key: string) {
        this.store.delete(key);
      },
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as Window;

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

function mountPage(client: RendererModelsClient, hidden: readonly string[] = []) {
  const document = new FakeDocument();
  if (hidden.length)
    document.defaultView.localStorage.setItem(
      "codexhost.hidden-models.v1.pi",
      JSON.stringify(hidden),
    );
  const page = createModelsSettingsPage(rendererSettingsMessages("zh-CN"), () => client);
  const content = document.createElement("main");
  const scope = new RendererSettingsPageScope();
  page.mount({
    content: content as unknown as HTMLElement,
    signal: scope.signal,
    runLatest: (operation, handlers) => scope.runLatest(operation, handlers),
  });
  return content;
}

function rowLabels(content: FakeElement): string[] {
  return descendants(content)
    .filter((element) => element.className === "settings-model-row")
    .map((row) => {
      const name = row.children.find(
        (child): child is FakeElement => child instanceof FakeElement && child.tagName === "span",
      );
      return name?.textContent ?? "";
    });
}

function descendants(root: FakeElement): FakeElement[] {
  return [
    root,
    ...root.children.flatMap((child) => (child instanceof FakeElement ? descendants(child) : [])),
  ];
}

function catalog(...ids: readonly string[]): HarnessModelCatalog {
  return {
    models: ids.map((id) => ({ ref: { id: harnessIdSchema.parse(id) }, label: id })),
    thinkingOptions: [],
  } as unknown as HarnessModelCatalog;
}

type Inspection = Awaited<ReturnType<RendererModelsClient["inspectHarness"]>>;

function ready(...ids: readonly string[]): Inspection {
  return {
    status: "ready",
    catalog: catalog(...ids),
    capabilities: {
      configuration: { selectModel: true, selectThinkingOption: false, selectPermissionMode: false },
    },
  } as unknown as Inspection;
}

function reloadButton(content: FakeElement): FakeElement {
  const button = descendants(content).find((element) =>
    element.children.includes("重新识别模型"),
  );
  if (!button) throw new Error("Reload control is not rendered");
  return button;
}

describe("Models page ordering", () => {
  it("lists visible Models first, keeping the Harness catalog order within each group", async () => {
    const inspectHarness = vi.fn<RendererModelsClient["inspectHarness"]>(async () =>
      ready("alpha", "bravo", "charlie", "delta"),
    );
    const content = mountPage({ inspectHarness } as unknown as RendererModelsClient, [
      "alpha",
      "charlie",
    ]);

    await vi.waitFor(() => expect(rowLabels(content)).toHaveLength(4));
    expect(rowLabels(content)).toEqual(["bravo", "delta", "alpha", "charlie"]);
  });

  it("keeps the catalog order when nothing is hidden", async () => {
    const inspectHarness = vi.fn<RendererModelsClient["inspectHarness"]>(async () =>
      ready("alpha", "bravo", "charlie"),
    );
    const content = mountPage({ inspectHarness } as unknown as RendererModelsClient);

    await vi.waitFor(() => expect(rowLabels(content)).toHaveLength(3));
    expect(rowLabels(content)).toEqual(["alpha", "bravo", "charlie"]);
  });
});

describe("Models page catalog reload", () => {
  it("re-reads the catalog past the Host cache when the user asks", async () => {
    const inspectHarness = vi.fn<RendererModelsClient["inspectHarness"]>(async () =>
      ready("model-a"),
    );
    const client = { inspectHarness } as unknown as RendererModelsClient;
    const page = createModelsSettingsPage(rendererSettingsMessages("zh-CN"), () => client);
    const document = new FakeDocument();
    const content = document.createElement("main");
    const scope = new RendererSettingsPageScope();
    page.mount({
      content: content as unknown as HTMLElement,
      signal: scope.signal,
      runLatest: (operation, handlers) => scope.runLatest(operation, handlers),
    });

    await vi.waitFor(() => expect(inspectHarness).toHaveBeenCalledTimes(1));
    // The initial read uses whatever the Host already has.
    expect(inspectHarness.mock.calls[0]?.[0]).not.toHaveProperty("refresh");

    reloadButton(content).dispatch("click");

    await vi.waitFor(() => expect(inspectHarness).toHaveBeenCalledTimes(2));
    expect(inspectHarness.mock.calls[1]?.[0]).toMatchObject({ harnessId: "pi", refresh: true });
  });

  it("surfaces a failed reload without leaving the control disabled", async () => {
    let attempt = 0;
    const inspectHarness = vi.fn<RendererModelsClient["inspectHarness"]>(async () => {
      attempt += 1;
      if (attempt === 1) return ready("model-a");
      throw new Error("Pi is unavailable");
    });
    const client = { inspectHarness } as unknown as RendererModelsClient;
    const page = createModelsSettingsPage(rendererSettingsMessages("zh-CN"), () => client);
    const document = new FakeDocument();
    const content = document.createElement("main");
    const scope = new RendererSettingsPageScope();
    page.mount({
      content: content as unknown as HTMLElement,
      signal: scope.signal,
      runLatest: (operation, handlers) => scope.runLatest(operation, handlers),
    });
    await vi.waitFor(() => expect(inspectHarness).toHaveBeenCalledTimes(1));

    const reload = reloadButton(content);
    reload.dispatch("click");
    await vi.waitFor(() => expect(inspectHarness).toHaveBeenCalledTimes(2));

    await vi.waitFor(() => expect(reload.disabled).toBe(false));
    expect(descendants(content).some((element) => element.textContent === "Pi is unavailable")).toBe(
      true,
    );
  });
});
