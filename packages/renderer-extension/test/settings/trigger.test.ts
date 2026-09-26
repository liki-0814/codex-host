import { describe, expect, it, vi } from "vitest";

import {
  type RendererSettingsBounds,
  installRendererSettingsHeaderTrigger,
  mountRendererSettingsTrigger,
  selectRendererSettingsHeaderSlot,
} from "../../src/settings/trigger.js";

function bounds(left: number, top: number, width: number, height: number): RendererSettingsBounds {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
  };
}

class FakeHeaderElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeHeaderElement[] = [];
  readonly listeners = new Map<string, (event: { stopPropagation(): void }) => void>();
  className = "";
  readonly classList = {
    add: vi.fn(),
    contains: (name: string): boolean => this.className.split(/\s+/u).includes(name),
  };
  readonly style: Record<string, string | ((name: string, value: string) => void)> = {};
  disabled = false;
  isConnected = true;
  parentElement: FakeHeaderElement | null = null;
  title = "";
  type = "";

  constructor(
    readonly left = 0,
    readonly width = 80,
  ) {
    this.style.setProperty = (name: string, value: string) => {
      this.style[name] = value;
    };
  }

  get firstChild(): FakeHeaderElement | null {
    return this.children[0] ?? null;
  }
  get nextSibling(): FakeHeaderElement | null {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] ?? null;
  }
  addEventListener(name: string, listener: (event: { stopPropagation(): void }) => void): void {
    this.listeners.set(name, listener);
  }
  append(...children: FakeHeaderElement[]): void {
    for (const child of children) this.insertBefore(child, null);
  }
  appendChild(child: FakeHeaderElement): FakeHeaderElement {
    return this.insertBefore(child, null);
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) ?? "") : null;
  }
  getBoundingClientRect(): DOMRect {
    return {
      left: this.left,
      right: this.left + this.width,
      top: 0,
      bottom: 46,
      width: this.width,
      height: 46,
    } as DOMRect;
  }
  insertBefore(child: FakeHeaderElement, before: FakeHeaderElement | null): FakeHeaderElement {
    child.remove();
    child.parentElement = this;
    child.isConnected = true;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  matches(selector: string): boolean {
    const attribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (!attribute) return false;
    const [, name, value] = attribute;
    return name !== undefined && this.attributes.get(name) === value;
  }
  querySelector(selector: string): FakeHeaderElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeHeaderElement[] {
    const scoped = selector.startsWith(":scope > ");
    const target = scoped ? selector.slice(":scope > ".length) : selector;
    if (scoped) return this.children.filter((child) => child.matches(target));
    return this.children.flatMap((child) => [
      ...(child.matches(target) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  remove(): void {
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
    this.isConnected = false;
  }
  removeEventListener(name: string): void {
    this.listeners.delete(name);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
}

interface FakeHeader {
  header: FakeHeaderElement;
  startSlot: FakeHeaderElement;
  surface: FakeHeaderElement;
  pageHeader: FakeHeaderElement;
  actionGroup: FakeHeaderElement | null;
  endSlot: FakeHeaderElement;
}

// Mirrors Codex Desktop 0.153.4: both shell slots carry the obstacle attribute, and the native
// action group is the trailing obstacle child of the header context menu surface.
function createFakeHeader(options: { nativeActions: boolean }): FakeHeader {
  const header = new FakeHeaderElement(0, 1510);
  const startSlot = new FakeHeaderElement(0, 216);
  startSlot.setAttribute("data-test-id", "header-shell-slot");
  startSlot.setAttribute("data-app-shell-header-obstacle", "true");
  const surface = new FakeHeaderElement(216, 1119);
  surface.setAttribute("data-testid", "app-shell-header-context-menu-surface");
  const pageHeader = new FakeHeaderElement(223, 1071);
  pageHeader.setAttribute("data-app-shell-page-header", "true");
  surface.append(pageHeader);
  let actionGroup: FakeHeaderElement | null = null;
  if (options.nativeActions) {
    actionGroup = new FakeHeaderElement(1299, 31);
    actionGroup.setAttribute("data-app-shell-header-obstacle", "true");
    surface.append(actionGroup);
  }
  const endSlot = new FakeHeaderElement(1447, 63);
  endSlot.setAttribute("data-test-id", "header-shell-slot");
  endSlot.setAttribute("data-app-shell-header-obstacle", "true");
  header.append(startSlot, surface, endSlot);
  return { header, startSlot, surface, pageHeader, actionGroup, endSlot };
}

function stubHeaderDocument(current: () => FakeHeaderElement): Document {
  const document = {
    createElement: () => new FakeHeaderElement(),
    createElementNS: () => new FakeHeaderElement(),
    querySelector: (selector: string) =>
      selector === 'header[data-pip-obstacle="app-shell-header"]' ? current() : null,
    querySelectorAll: () => [],
  } as unknown as Document;
  vi.stubGlobal("document", document);
  return document;
}

describe("Renderer settings header trigger", () => {
  const header = bounds(240, 36, 942, 46);

  it("selects the right-side group containing Open Location and the context menu", () => {
    expect(
      selectRendererSettingsHeaderSlot(header, [
        { value: "open-location", bounds: bounds(1018, 45, 128, 28), visibleButtonCount: 1 },
        { value: "actions", bounds: bounds(1018, 36, 164, 46), visibleButtonCount: 2 },
        { value: "context-menu", bounds: bounds(1154, 45, 28, 28), visibleButtonCount: 1 },
      ]),
    ).toBe("actions");
  });

  it("selects the structural action group when a blank thread has no native actions", () => {
    expect(
      selectRendererSettingsHeaderSlot(header, [
        {
          value: "empty-actions",
          bounds: bounds(1176, 59, 0, 0),
          visibleButtonCount: 0,
          structuralActionGroup: true,
        },
      ]),
    ).toBe("empty-actions");
  });

  it("shows a dedicated update button and opens the Updates page directly", () => {
    class FakeElement {
      readonly attributes = new Map<string, string>();
      readonly children: FakeElement[] = [];
      readonly listeners = new Map<string, (event: { stopPropagation(): void }) => void>();
      readonly classList = { add: vi.fn() };
      readonly style: Record<string, string | ((name: string, value: string) => void)> = {};
      disabled = false;
      isConnected = true;
      title = "";
      type = "";

      constructor() {
        this.style.setProperty = (name: string, value: string) => {
          this.style[name] = value;
        };
      }

      addEventListener(name: string, listener: (event: { stopPropagation(): void }) => void): void {
        this.listeners.set(name, listener);
      }
      append(...children: FakeElement[]): void {
        this.children.push(...children);
      }
      appendChild(child: FakeElement): FakeElement {
        this.children.push(child);
        return child;
      }
      dispatch(name: string): void {
        this.listeners.get(name)?.({ stopPropagation: vi.fn() });
      }
      getAttribute(name: string): string | null {
        return this.attributes.has(name) ? (this.attributes.get(name) ?? "") : null;
      }
      hasAttribute(name: string): boolean {
        return this.attributes.has(name);
      }
      remove(): void {
        this.isConnected = false;
      }
      removeEventListener(name: string): void {
        this.listeners.delete(name);
      }
      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }
      toggleAttribute(name: string, force: boolean): void {
        if (force) this.attributes.set(name, "");
        else this.attributes.delete(name);
      }
    }

    const document = {
      createElement: () => new FakeElement(),
      createElementNS: () => new FakeElement(),
    } as unknown as Document;
    vi.stubGlobal("document", document);
    const opened = vi.fn();
    const control = mountRendererSettingsTrigger(
      "test",
      true,
      (opener, pageId) => opened(opener, pageId),
      document,
    );

    expect(control.button.title).toBe("CodexHost");
    expect(control.button.children).toHaveLength(1);
    const brandIcon = control.button.children[0] as unknown as FakeElement;
    expect(brandIcon.attributes.get("viewBox")).toBe("0 0 20 20");
    expect(brandIcon.attributes.get("fill")).toBe("none");
    expect(control.button.getAttribute("aria-expanded")).toBe("false");
    expect(control.button.style.width).toBe("28px");
    expect(control.button.style.padding).toBe("0");
    expect(control.updateButton.style.display).toBe("none");
    control.setUpdateAvailable(true);
    expect(control.updateButton.style.display).toBe("inline-flex");
    expect(control.updateButton.style.background).toBe("transparent");
    expect(control.updateButton.style.color).toBe("#3b82f6");
    expect(control.updateButton.children).toHaveLength(1);
    expect(control.updateButton.title).toBe("A new version is available.");
    expect(control.root.hasAttribute("data-update-available")).toBe(true);
    (control.updateButton as unknown as FakeElement).dispatch("click");
    expect(opened).toHaveBeenCalledWith(control.updateButton, "updates");
    control.setUpdateAvailable(false);
    expect(control.updateButton.style.display).toBe("none");
    control.dispose();
    vi.unstubAllGlobals();
  });

  it("mounts an icon directly under the plugin destination in the navigation rail", () => {
    const shell = createFakeHeader({ nativeActions: true });
    const rail = new FakeHeaderElement(0, 52);
    rail.setAttribute("data-app-navigation-rail", "true");
    const column = new FakeHeaderElement(6, 40);
    column.className = "flex flex-col gap-2";
    const plugin = new FakeHeaderElement(8, 36);
    plugin.setAttribute("data-sidebar-destination", "builtin:customize");
    const more = new FakeHeaderElement(8, 36);
    more.setAttribute("data-slot", "popover-trigger");
    column.append(plugin, more);
    rail.append(column);
    const document = {
      createElement: () => new FakeHeaderElement(),
      createElementNS: () => new FakeHeaderElement(),
      querySelector: (selector: string) => {
        if (selector === '[data-app-navigation-rail="true"]') return rail;
        if (selector === 'header[data-pip-obstacle="app-shell-header"]') return shell.header;
        return null;
      },
      querySelectorAll: () => [],
    } as unknown as Document;
    vi.stubGlobal("document", document);

    try {
      const control = installRendererSettingsHeaderTrigger({
        available: true,
        onOpen: vi.fn(),
        ownerDocument: document,
      });

      expect(column.children).toEqual([plugin, control.root, more]);
      expect(control.refresh()).toBe(true);
      expect(column.children).toEqual([plugin, control.root, more]);
      const button = (control.root as unknown as FakeHeaderElement).children[0];
      expect(button?.style.width).toBe("36px");
      expect(button?.style.color).toBe("color-mix(in srgb, currentColor 49.4%, transparent)");
      const brandIcon = button?.children[0];
      expect(brandIcon?.querySelector('[data-codexhost-mark="line"]')?.style.display).toBe("");
      expect(brandIcon?.querySelector('[data-codexhost-mark="solid"]')?.style.display).toBe("none");
      control.setSelected(true);
      expect(button?.getAttribute("aria-expanded")).toBe("true");
      expect(button?.style.color).toBe("inherit");
      expect(brandIcon?.querySelector('[data-codexhost-mark="line"]')?.style.display).toBe("none");
      expect(brandIcon?.querySelector('[data-codexhost-mark="solid"]')?.style.display).toBe("");
      control.setSelected(false);
      expect(button?.style.color).toBe("color-mix(in srgb, currentColor 49.4%, transparent)");
      expect(shell.surface.children).toEqual([shell.pageHeader, shell.actionGroup]);
      control.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("mounts directly before the native header action group", () => {
    const shell = createFakeHeader({ nativeActions: true });
    const document = stubHeaderDocument(() => shell.header);

    try {
      const control = installRendererSettingsHeaderTrigger({
        available: true,
        onOpen: vi.fn(),
        ownerDocument: document,
      });

      expect(control.root).not.toBeNull();
      expect(shell.surface.children).toEqual([shell.pageHeader, control.root, shell.actionGroup]);
      expect(shell.header.children).toEqual([shell.startSlot, shell.surface, shell.endSlot]);
      control.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("mounts directly before the application header end slot without Thread actions", () => {
    const shell = createFakeHeader({ nativeActions: false });
    const document = stubHeaderDocument(() => shell.header);

    try {
      const control = installRendererSettingsHeaderTrigger({
        available: true,
        onOpen: vi.fn(),
        ownerDocument: document,
      });

      expect(control.root).not.toBeNull();
      expect(shell.header.children).toEqual([
        shell.startSlot,
        shell.surface,
        control.root,
        shell.endSlot,
      ]);
      expect(shell.surface.children).toEqual([shell.pageHeader]);
      control.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("remounts before the native action group when Codex replaces the application header", () => {
    const shell = createFakeHeader({ nativeActions: true });
    let current = shell.header;
    const document = stubHeaderDocument(() => current);

    try {
      const control = installRendererSettingsHeaderTrigger({
        available: true,
        onOpen: vi.fn(),
        ownerDocument: document,
      });
      expect(shell.surface.children).toEqual([shell.pageHeader, control.root, shell.actionGroup]);

      const replacement = createFakeHeader({ nativeActions: true });
      current = replacement.header;

      expect(control.refresh()).toBe(true);
      expect(shell.surface.children).toEqual([shell.pageHeader, shell.actionGroup]);
      expect(replacement.surface.children).toEqual([
        replacement.pageHeader,
        control.root,
        replacement.actionGroup,
      ]);
      control.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stays put when another injected control mounts before the owned trigger", () => {
    const shell = createFakeHeader({ nativeActions: true });
    const document = stubHeaderDocument(() => shell.header);

    try {
      const control = installRendererSettingsHeaderTrigger({
        available: true,
        onOpen: vi.fn(),
        ownerDocument: document,
      });
      const foreign = new FakeHeaderElement(1200, 24);
      shell.surface.insertBefore(foreign, control.root as unknown as FakeHeaderElement);

      expect(control.refresh()).toBe(true);
      expect(shell.surface.children).toEqual([
        shell.pageHeader,
        foreign,
        control.root,
        shell.actionGroup,
      ]);
      control.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed without a visible or structural bounded action group", () => {
    expect(
      selectRendererSettingsHeaderSlot(header, [
        { value: "open-location", bounds: bounds(1018, 45, 128, 28), visibleButtonCount: 1 },
        { value: "hidden", bounds: bounds(1018, 36, 164, 46), visibleButtonCount: 0 },
        {
          value: "outside",
          bounds: bounds(1184, 59, 0, 0),
          visibleButtonCount: 0,
          structuralActionGroup: true,
        },
      ]),
    ).toBeNull();
  });
});
