import settingsCss from "./shell.css";
import accountsCss from "./accounts.css";
import tailwindCss from "./tailwind.css";
import {
  RendererSettingsNavigationState,
  RendererSettingsPageScope,
  createRendererSettingsPageRegistry,
  type RendererSettingsPageDefinition,
  type RendererSettingsPageRegistry,
} from "./core.js";
import { createRendererSettingsBrandIcon, createRendererSettingsIcon } from "./icons.js";
import {
  DEFAULT_RENDERER_SETTINGS_MESSAGES,
  type RendererSettingsMessages,
} from "./localization.js";
import { CODEXHOST_GITHUB_REPOSITORY_URL, createDefaultRendererSettingsRegistry } from "./pages.js";

export const SETTINGS_SHELL_ATTRIBUTE = "data-codexhost-settings-shell";
export const RENDERER_SETTINGS_COLOR_SCHEME = "inherit";
const NAVIGATION_RAIL_SELECTOR = '[data-app-navigation-rail="true"]';
const NATIVE_RAIL_SELECTED_ATTRIBUTE = "data-selected";

export interface RendererSettingsShell {
  readonly root: HTMLElement;
  readonly registry: RendererSettingsPageRegistry;
  readonly supported: boolean;
  readonly activePageId: string;
  readonly open: boolean;
  openSettings(opener?: HTMLElement, pageId?: string): boolean;
  close(): void;
  dispose(): void;
}

declare global {
  interface Window {
    __codexhostSettingsShellV1?: RendererSettingsShell;
  }
}

export function isRendererSettingsDialogSupported(
  dialog: Pick<HTMLDialogElement, "showModal" | "close">,
): boolean {
  return typeof dialog.showModal === "function" && typeof dialog.close === "function";
}

function setActiveNavigation(
  buttons: ReadonlyMap<string, HTMLButtonElement>,
  activePageId: string,
): void {
  for (const [pageId, button] of buttons) {
    if (pageId === activePageId) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

export function mountRendererSettingsShell(
  registry?: RendererSettingsPageRegistry,
  ownerDocument: Document = document,
  messages: RendererSettingsMessages = DEFAULT_RENDERER_SETTINGS_MESSAGES,
): RendererSettingsShell {
  const resolvedRegistry = registry ?? createDefaultRendererSettingsRegistry(messages);
  if (!ownerDocument.body) throw new Error("Renderer document body is unavailable");
  if (ownerDocument.querySelector(`[${SETTINGS_SHELL_ATTRIBUTE}]`)) {
    throw new Error("A codexhost settings shell is already mounted");
  }

  const root = ownerDocument.createElement("div");
  root.setAttribute(SETTINGS_SHELL_ATTRIBUTE, "v1");
  root.lang = messages.locale;
  root.style.colorScheme = RENDERER_SETTINGS_COLOR_SCHEME;
  const shadow = root.attachShadow({ mode: "open" });
  const style = ownerDocument.createElement("style");
  // Tailwind declares the cascade layer order, so it must precede the unlayered settings CSS.
  style.textContent = `${tailwindCss}\n${settingsCss}\n${accountsCss}`;

  const surface = ownerDocument.createElement("div");
  surface.className = "codexhost-settings-page";
  surface.hidden = true;
  surface.setAttribute("role", "region");
  const frame = ownerDocument.createElement("div");
  frame.className = "settings-frame";

  const header = ownerDocument.createElement("header");
  header.className = "settings-header";
  const brand = ownerDocument.createElement("div");
  brand.className = "settings-brand";
  const brandMark = ownerDocument.createElement("span");
  brandMark.className = "settings-brand__mark";
  brandMark.append(createRendererSettingsBrandIcon(32));
  const brandCopy = ownerDocument.createElement("span");
  brandCopy.className = "settings-brand__copy";
  const brandName = ownerDocument.createElement("span");
  brandName.className = "settings-brand__name";
  brandName.textContent = "CodexHost";
  const brandTitle = ownerDocument.createElement("span");
  brandTitle.className = "settings-brand__title";
  brandTitle.id = "codexhost-settings-page-title";
  brandTitle.textContent = messages.title;
  brandCopy.append(brandName, brandTitle);
  brand.append(brandMark, brandCopy);

  const headerActions = ownerDocument.createElement("div");
  headerActions.className = "settings-header-actions";
  const closeButton = ownerDocument.createElement("button");
  closeButton.type = "button";
  closeButton.className = "settings-icon-button";
  closeButton.setAttribute("aria-label", messages.close);
  closeButton.title = messages.close;
  closeButton.append(createRendererSettingsIcon("close", 18));
  headerActions.append(closeButton);
  header.append(brand, headerActions);

  const layout = ownerDocument.createElement("div");
  layout.className = "settings-layout";
  const sidebar = ownerDocument.createElement("aside");
  sidebar.className = "settings-sidebar";

  const navigation = ownerDocument.createElement("nav");
  navigation.className = "settings-nav";
  navigation.setAttribute("aria-label", messages.sectionsLabel);
  const page = ownerDocument.createElement("main");
  page.className = "settings-page";
  const pageContent = ownerDocument.createElement("div");
  pageContent.className = "settings-page__content";
  page.append(pageContent);
  sidebar.append(navigation);
  layout.append(sidebar, page);
  frame.append(header, layout);
  surface.append(frame);
  surface.setAttribute("aria-labelledby", brandTitle.id);
  shadow.append(style, surface);
  ownerDocument.body.append(root);

  const navigationState = new RendererSettingsNavigationState(resolvedRegistry);
  const navigationButtons = new Map<string, HTMLButtonElement>();
  let activeScope: RendererSettingsPageScope | null = null;
  let activeCleanup: (() => void) | null = null;
  let opener: HTMLElement | null = null;
  let lifecycleGeneration = 0;
  let disposed = false;

  const disposeActivePage = (): void => {
    activeScope?.dispose();
    activeScope = null;
    const cleanup = activeCleanup;
    activeCleanup = null;
    try {
      cleanup?.();
    } catch {
      // A contributed page cannot block shell navigation or disposal.
    }
  };

  const renderMountFailure = (): void => {
    pageContent.replaceChildren();
    const error = ownerDocument.createElement("div");
    error.className = "settings-page-error";
    error.textContent = messages.pageUnavailable;
    pageContent.append(error);
  };

  const activatePage = (pageId: string): void => {
    const definition = resolvedRegistry.getPage(pageId);
    if (!definition) throw new Error(`Unknown settings page: ${pageId}`);
    navigationState.select(pageId);
    disposeActivePage();
    setActiveNavigation(navigationButtons, pageId);
    pageContent.replaceChildren();
    const scope = new RendererSettingsPageScope();
    activeScope = scope;
    try {
      activeCleanup =
        definition.mount({
          content: pageContent,
          signal: scope.signal,
          runLatest: (operation, handlers) => scope.runLatest(operation, handlers),
        }) ?? null;
    } catch {
      scope.dispose();
      activeScope = null;
      renderMountFailure();
    }
  };

  const appendNavigationSection = (label: string): void => {
    const section = ownerDocument.createElement("div");
    section.className = "settings-nav-section-label";
    section.textContent = label;
    navigation.append(section);
  };
  let otherSectionAdded = false;
  appendNavigationSection(messages.generalSection);
  for (const definition of resolvedRegistry.pages) {
    if (definition.id === "about" && !otherSectionAdded) {
      appendNavigationSection(messages.otherSection);
      otherSectionAdded = true;
    }
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "settings-nav-button";
    button.dataset.pageId = definition.id;
    button.append(createRendererSettingsIcon(definition.icon, 17));
    const label = ownerDocument.createElement("span");
    label.textContent = definition.label;
    button.append(label);
    navigationButtons.set(definition.id, button);
    navigation.append(button);
  }
  const starLink = ownerDocument.createElement("a");
  starLink.className = "settings-nav-button settings-nav-star-link";
  starLink.href = CODEXHOST_GITHUB_REPOSITORY_URL;
  starLink.target = "_blank";
  starLink.rel = "noopener noreferrer";
  starLink.setAttribute("aria-label", messages.starOnGitHub);
  starLink.title = messages.starOnGitHub;
  starLink.append(createRendererSettingsIcon("github", 17));
  const starLabel = ownerDocument.createElement("span");
  starLabel.textContent = messages.starOnGitHub;
  starLink.append(starLabel);
  navigation.append(starLink);
  const supported = true;
  let pageOpen = false;
  let restoreNativeSelection = true;
  let suspendedRailSelection: { element: HTMLElement; selected: boolean; current: string | null }[] = [];
  let selectionObserver: MutationObserver | null = null;
  const focusActiveNavigation = (): void => {
    navigationButtons
      .get(navigationState.activePageId)
      ?.focus({ preventScroll: true, focusVisible: false });
  };
  const finishClose = (): void => {
    disposeActivePage();
    navigationState.reset();
    const focusTarget = opener;
    opener = null;
    const closeGeneration = ++lifecycleGeneration;
    const restoreFocus = (): void => {
      if (
        !disposed &&
        closeGeneration === lifecycleGeneration &&
        !pageOpen &&
        focusTarget?.isConnected
      ) {
        focusTarget.focus();
      }
    };
    ownerDocument.defaultView?.setTimeout(restoreFocus, 0);
  };
  const onNavigationClick = (event: MouseEvent): void => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-page-id]")
        : null;
    const pageId = target?.dataset.pageId;
    if (!pageId || pageId === navigationState.activePageId) return;
    activatePage(pageId);
    target.focus();
  };
  const nativeSelectedElements = (): HTMLElement[] =>
    [...ownerDocument.querySelectorAll<HTMLElement>("[data-selected], [aria-current='page']")].filter(
      (element) =>
        !element.closest("[data-codexhost-settings-shell]") &&
        !element.closest("[data-codexhost-settings-trigger]"),
    );
  const clearNativeRailSelection = (): void => {
    for (const element of nativeSelectedElements()) {
      element.removeAttribute(NATIVE_RAIL_SELECTED_ATTRIBUTE);
      if (element.getAttribute("aria-current") === "page") element.removeAttribute("aria-current");
    }
  };
  const suspendNativeRailSelection = (): void => {
    suspendedRailSelection = nativeSelectedElements().map((element) => ({
      element,
      selected: element.hasAttribute(NATIVE_RAIL_SELECTED_ATTRIBUTE),
      current: element.getAttribute("aria-current"),
    }));
    clearNativeRailSelection();
    selectionObserver?.disconnect();
    const Observer = ownerDocument.defaultView?.MutationObserver;
    const root = ownerDocument.documentElement;
    if (!Observer || !root) return;
    selectionObserver = new Observer(() => {
      if (pageOpen) clearNativeRailSelection();
    });
    selectionObserver.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: [NATIVE_RAIL_SELECTED_ATTRIBUTE, "aria-current"],
    });
  };
  const releaseNativeRailSelection = (restore: boolean): void => {
    selectionObserver?.disconnect();
    selectionObserver = null;
    const remembered = suspendedRailSelection;
    suspendedRailSelection = [];
    if (!restore || nativeSelectedElements().length > 0) return;
    for (const { element, selected, current } of remembered) {
      if (!element.isConnected) continue;
      if (selected) element.setAttribute(NATIVE_RAIL_SELECTED_ATTRIBUTE, "");
      if (current) element.setAttribute("aria-current", current);
    }
  };
  const placeSurface = (): void => {
    const rail = ownerDocument.querySelector(NAVIGATION_RAIL_SELECTOR);
    const bounds = rail?.getBoundingClientRect();
    const top = bounds && bounds.height > 0 ? bounds.top : 0;
    const left = bounds && bounds.width > 0 ? bounds.right : 0;
    surface.style.top = `${Math.max(0, top)}px`;
    surface.style.left = `${Math.max(0, left)}px`;
  };
  const onCloseClick = (): void => api.close();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !pageOpen || shadow.querySelector("dialog[open]")) return;
    event.preventDefault();
    api.close();
  };
  const onRailClick = (event: MouseEvent): void => {
    if (!pageOpen || !(event.target instanceof Element)) return;
    const rail = event.target.closest(NAVIGATION_RAIL_SELECTOR);
    if (!rail || event.target.closest("[data-codexhost-settings-trigger]")) return;
    if (!event.target.closest('[data-sidebar-destination], [data-slot="popover-trigger"]')) return;
    restoreNativeSelection = false;
    api.close();
  };
  const onResize = (): void => {
    if (pageOpen) placeSurface();
  };
  let railObserver: ResizeObserver | null = null;
  const watchRail = (): void => {
    railObserver?.disconnect();
    railObserver = null;
    const rail = ownerDocument.querySelector(NAVIGATION_RAIL_SELECTOR);
    const Observer = ownerDocument.defaultView?.ResizeObserver;
    if (!rail || typeof Observer !== "function") return;
    railObserver = new Observer(() => {
      if (pageOpen) placeSurface();
    });
    railObserver.observe(rail);
  };
  const bindPageListeners = (): void => {
    ownerDocument.addEventListener("keydown", onKeyDown);
    ownerDocument.addEventListener("click", onRailClick, true);
    ownerDocument.defaultView?.addEventListener("resize", onResize);
    watchRail();
  };
  const unbindPageListeners = (): void => {
    ownerDocument.removeEventListener("keydown", onKeyDown);
    ownerDocument.removeEventListener("click", onRailClick, true);
    ownerDocument.defaultView?.removeEventListener("resize", onResize);
    railObserver?.disconnect();
    railObserver = null;
  };
  navigation.addEventListener("click", onNavigationClick);
  closeButton.addEventListener("click", onCloseClick);

  const api: RendererSettingsShell = {
    root,
    registry: resolvedRegistry,
    supported,
    get activePageId() {
      return navigationState.activePageId;
    },
    get open() {
      return pageOpen;
    },
    openSettings(nextOpener, pageId = resolvedRegistry.defaultPageId) {
      if (disposed || !supported || !resolvedRegistry.getPage(pageId)) return false;
      lifecycleGeneration += 1;
      opener = nextOpener?.isConnected ? nextOpener : null;
      activatePage(pageId);
      if (!pageOpen) {
        pageOpen = true;
        restoreNativeSelection = true;
        suspendNativeRailSelection();
        placeSurface();
        surface.hidden = false;
        bindPageListeners();
      }
      queueMicrotask(focusActiveNavigation);
      return true;
    },
    close() {
      if (disposed || !pageOpen) return;
      pageOpen = false;
      const restore = restoreNativeSelection;
      restoreNativeSelection = true;
      releaseNativeRailSelection(restore);
      surface.hidden = true;
      unbindPageListeners();
      finishClose();
      root.dispatchEvent(new Event("close"));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      opener = null;
      releaseNativeRailSelection(pageOpen && restoreNativeSelection);
      pageOpen = false;
      unbindPageListeners();
      navigation.removeEventListener("click", onNavigationClick);
      closeButton.removeEventListener("click", onCloseClick);
      disposeActivePage();
      root.remove();
    },
  };
  return api;
}

export function installRendererSettingsShell(
  definitions?: readonly RendererSettingsPageDefinition[],
  messages: RendererSettingsMessages = DEFAULT_RENDERER_SETTINGS_MESSAGES,
  ownerDocument: Document = document,
): RendererSettingsShell {
  const registry = definitions
    ? createRendererSettingsPageRegistry(definitions)
    : createDefaultRendererSettingsRegistry(messages);
  const ownerWindow = ownerDocument.defaultView ?? window;
  ownerWindow.__codexhostSettingsShellV1?.dispose();
  const shell = mountRendererSettingsShell(registry, ownerDocument, messages);
  ownerWindow.__codexhostSettingsShellV1 = shell;
  const dispose = shell.dispose.bind(shell);
  shell.dispose = () => {
    dispose();
    if (ownerWindow.__codexhostSettingsShellV1 === shell) {
      delete ownerWindow.__codexhostSettingsShellV1;
    }
  };
  return shell;
}
