import {
  createRendererSettingsBrandIcon,
  createRendererSettingsIcon,
  setRendererSettingsBrandIconSelected,
} from "./icons.js";
import {
  DEFAULT_RENDERER_SETTINGS_MESSAGES,
  type RendererSettingsMessages,
} from "./localization.js";

export const SETTINGS_TRIGGER_ATTRIBUTE = "data-codexhost-settings-trigger";
export const SETTINGS_HEADER_SURFACE_SELECTOR =
  '[data-testid="app-shell-header-context-menu-surface"]';
const SETTINGS_APPLICATION_HEADER_SELECTOR = 'header[data-pip-obstacle="app-shell-header"]';
const SETTINGS_HEADER_SLOT_SELECTOR = ':scope > [data-test-id="header-shell-slot"]';
const SETTINGS_HEADER_NATIVE_ACTION_GROUP_SELECTOR =
  ':scope > [data-app-shell-header-obstacle="true"]';
const NAVIGATION_RAIL_SELECTOR = '[data-app-navigation-rail="true"]';
const NAVIGATION_RAIL_PLUGIN_SELECTOR = '[data-sidebar-destination="builtin:customize"]';
const UPDATE_ACCENT = "#3b82f6";
const SETTINGS_TRIGGER_TOOLTIP = "CodexHost";
const SETTINGS_TRIGGER_PLACEMENT_ATTRIBUTE = "data-codexhost-trigger-placement";
// Idle rail icons use this mix of the rail's text color. Selection uses the text color itself.
const RAIL_IDLE_ICON_COLOR = "color-mix(in srgb, currentColor 49.4%, transparent)";

export interface RendererSettingsTriggerControl {
  root: HTMLElement;
  button: HTMLButtonElement;
  updateButton: HTMLButtonElement;
  setUpdateAvailable(available: boolean): void;
  setSelected(selected: boolean): void;
  dispose(): void;
}

export interface RendererSettingsBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface RendererSettingsHeaderSlotCandidate<T> {
  value: T;
  bounds: RendererSettingsBounds;
  visibleButtonCount: number;
  structuralActionGroup?: boolean;
}

export interface RendererSettingsHeaderTriggerControl {
  readonly root: HTMLElement | null;
  refresh(): boolean;
  setUpdateAvailable(available: boolean): void;
  setSelected(selected: boolean): void;
  dispose(): void;
}

interface RendererSettingsHeaderInsertionPoint {
  parent: HTMLElement;
  before: ChildNode | null;
  rail: boolean;
}

export interface RendererSettingsContractInspection {
  headerCount: number;
  visibleHeaderCount: number;
  insertionPointCount: number;
}

function measuredBounds(element: Element): RendererSettingsBounds {
  const bounds = element.getBoundingClientRect();
  return {
    left: bounds.left,
    right: bounds.right,
    top: bounds.top,
    bottom: bounds.bottom,
    width: bounds.width,
    height: bounds.height,
  };
}

export function selectRendererSettingsHeaderSlot<T>(
  header: RendererSettingsBounds,
  candidates: readonly RendererSettingsHeaderSlotCandidate<T>[],
): T | null {
  const midpoint = header.left + header.width / 2;
  const maximumWidth = Math.min(320, header.width / 2);
  const eligible = candidates.filter(
    ({ bounds, visibleButtonCount, structuralActionGroup }) =>
      (visibleButtonCount > 1 || structuralActionGroup === true) &&
      bounds.width >= 0 &&
      bounds.height >= 0 &&
      bounds.width <= maximumWidth &&
      bounds.left >= midpoint &&
      bounds.right <= header.right + 1 &&
      bounds.top >= header.top - 1 &&
      bounds.bottom <= header.bottom + 1,
  );
  eligible.sort(
    (left, right) =>
      Math.abs(header.right - left.bounds.right) - Math.abs(header.right - right.bounds.right) ||
      right.visibleButtonCount - left.visibleButtonCount ||
      left.bounds.left - right.bounds.left,
  );
  return eligible[0]?.value ?? null;
}

export function inspectRendererSettingsContract(
  ownerDocument: Document = document,
): RendererSettingsContractInspection {
  const headers = [
    ...ownerDocument.querySelectorAll<HTMLElement>(SETTINGS_APPLICATION_HEADER_SELECTOR),
  ];
  const visibleHeaders = headers.filter((header) => {
    const bounds = measuredBounds(header);
    return bounds.width > 0 && bounds.height > 0;
  });
  const insertionPointCount = visibleHeaders.filter((header) =>
    [...header.querySelectorAll<HTMLElement>(SETTINGS_HEADER_SLOT_SELECTOR)].some((slot) => {
      const bounds = measuredBounds(slot);
      return bounds.width > 0 && bounds.height > 0;
    }),
  ).length;
  return {
    headerCount: headers.length,
    visibleHeaderCount: visibleHeaders.length,
    insertionPointCount,
  };
}

function measurableElement(value: unknown): HTMLElement | null {
  if (
    value !== null &&
    typeof value === "object" &&
    "children" in value &&
    "classList" in value &&
    "getBoundingClientRect" in value
  ) {
    return value as HTMLElement;
  }
  return null;
}

/** Icon slot directly under the plugin destination in the left navigation rail. */
function findNavigationRailInsertionPoint(
  ownerDocument: Document,
): RendererSettingsHeaderInsertionPoint | null {
  const rail = measurableElement(ownerDocument.querySelector(NAVIGATION_RAIL_SELECTOR));
  if (!rail) return null;
  const bounds = measuredBounds(rail);
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const plugin = rail.querySelector(NAVIGATION_RAIL_PLUGIN_SELECTOR);
  if (!plugin) return null;
  let row: Element = plugin;
  while (
    row.parentElement &&
    row.parentElement !== rail &&
    !String(row.parentElement.className).includes("flex-col")
  ) {
    row = row.parentElement;
  }
  const parent = measurableElement(row.parentElement);
  if (!parent) return null;
  let before = row.nextSibling;
  if (isSettingsTrigger(before)) before = before.nextSibling;
  return { parent, before, rail: true };
}

function isSettingsTrigger(node: ChildNode | null): node is Element {
  if (!node || typeof node !== "object" || !("getAttribute" in node)) return false;
  const read = (node as Element).getAttribute;
  return typeof read === "function" && read.call(node, SETTINGS_TRIGGER_ATTRIBUTE) != null;
}

function applyTriggerPlacement(button: HTMLElement, rail: boolean): void {
  const size = rail ? "36px" : "28px";
  button.style.width = size;
  button.style.height = size;
  button.style.borderRadius = rail ? "12px" : "8px";
  button.setAttribute(SETTINGS_TRIGGER_PLACEMENT_ATTRIBUTE, rail ? "rail" : "header");
  const icon = button.children[0];
  if (icon instanceof Object && "style" in icon) {
    const iconSize = rail ? "20px" : "16px";
    const style = (icon as HTMLElement).style;
    style.width = iconSize;
    style.height = iconSize;
  }
  applyTriggerColor(button, rail);
}

function applyTriggerColor(button: HTMLElement, rail: boolean): void {
  const selected = button.getAttribute("aria-expanded") === "true";
  button.style.color = rail && !selected ? RAIL_IDLE_ICON_COLOR : "inherit";
  button.style.background = "transparent";
}

function setTriggerSelected(button: HTMLElement, selected: boolean): void {
  button.setAttribute("aria-expanded", selected ? "true" : "false");
  const icon = button.children[0];
  if (icon) setRendererSettingsBrandIconSelected(icon, selected);
  applyTriggerColor(button, button.getAttribute(SETTINGS_TRIGGER_PLACEMENT_ATTRIBUTE) === "rail");
}

function findNativeHeaderActionGroup(header: HTMLElement): HTMLElement | null {
  const surface = header.querySelector<HTMLElement>(SETTINGS_HEADER_SURFACE_SELECTOR);
  if (!surface) return null;
  const groups = [
    ...surface.querySelectorAll<HTMLElement>(SETTINGS_HEADER_NATIVE_ACTION_GROUP_SELECTOR),
  ];
  return groups.at(-1) ?? null;
}

function findRendererSettingsHeaderInsertionPoint(
  ownerDocument: Document,
): RendererSettingsHeaderInsertionPoint | null {
  const rail = findNavigationRailInsertionPoint(ownerDocument);
  if (rail) return rail;

  const header = ownerDocument.querySelector<HTMLElement>(SETTINGS_APPLICATION_HEADER_SELECTOR);
  if (!header) return null;

  const headerBounds = measuredBounds(header);
  if (headerBounds.width <= 0 || headerBounds.height <= 0) return null;

  const nativeActionGroup = findNativeHeaderActionGroup(header);
  if (nativeActionGroup?.parentElement) {
    return { parent: nativeActionGroup.parentElement, before: nativeActionGroup, rail: false };
  }

  const endSlot = [...header.querySelectorAll<HTMLElement>(SETTINGS_HEADER_SLOT_SELECTOR)]
    .filter((slot) => {
      const bounds = measuredBounds(slot);
      return bounds.width > 0 && bounds.height > 0;
    })
    .toSorted((left, right) => measuredBounds(right).left - measuredBounds(left).left)[0];
  return endSlot ? { parent: header, before: endSlot, rail: false } : null;
}

export function mountRendererSettingsTrigger(
  triggerId: string,
  available: boolean,
  onOpen: (opener: HTMLButtonElement, pageId?: "updates") => void,
  ownerDocument: Document = document,
  messages: RendererSettingsMessages = DEFAULT_RENDERER_SETTINGS_MESSAGES,
): RendererSettingsTriggerControl {
  const root = ownerDocument.createElement("div");
  root.setAttribute(SETTINGS_TRIGGER_ATTRIBUTE, triggerId);
  root.style.display = "inline-flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.alignSelf = "center";
  root.style.flex = "0 0 auto";
  root.style.marginRight = "0";
  root.style.color = "inherit";
  root.style.pointerEvents = "auto";
  root.style.setProperty("-webkit-app-region", "no-drag");

  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.disabled = !available;
  button.setAttribute("aria-label", messages.openSettings);
  button.setAttribute("aria-expanded", "false");
  button.title = available ? SETTINGS_TRIGGER_TOOLTIP : messages.settingsUnavailableTitle;
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.width = "28px";
  button.style.height = "28px";
  button.style.padding = "0";
  button.style.border = "0";
  button.style.borderRadius = "8px";
  button.style.background = "transparent";
  button.style.color = "inherit";
  button.style.cursor = available ? "pointer" : "not-allowed";
  button.style.opacity = available ? "1" : "0.5";
  button.style.outlineOffset = "2px";
  button.style.setProperty("-webkit-app-region", "no-drag");
  button.append(createRendererSettingsBrandIcon(16));

  const updateButton = ownerDocument.createElement("button");
  updateButton.type = "button";
  updateButton.disabled = !available;
  updateButton.setAttribute("aria-label", messages.updateAvailable);
  updateButton.title = messages.updateAvailable;
  updateButton.style.display = "none";
  updateButton.style.alignItems = "center";
  updateButton.style.justifyContent = "center";
  updateButton.style.width = "28px";
  updateButton.style.height = "28px";
  updateButton.style.padding = "0";
  updateButton.style.border = "0";
  updateButton.style.borderRadius = "8px";
  updateButton.style.background = "transparent";
  // One accent that reads on both light and dark title bars; the icon alone
  // signals the update, the accessible name and tooltip carry the wording.
  updateButton.style.color = UPDATE_ACCENT;
  updateButton.style.cursor = available ? "pointer" : "not-allowed";
  updateButton.style.opacity = available ? "1" : "0.5";
  updateButton.style.outlineOffset = "2px";
  updateButton.style.setProperty("-webkit-app-region", "no-drag");
  updateButton.append(createRendererSettingsIcon("updates", 16));

  const onPointerEnter = (): void => {
    if (button.disabled || button.getAttribute("aria-expanded") === "true") return;
    button.style.background = "rgba(127, 127, 127, 0.16)";
  };
  const onPointerLeave = (): void => {
    applyTriggerColor(button, button.getAttribute(SETTINGS_TRIGGER_PLACEMENT_ATTRIBUTE) === "rail");
  };
  const onClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (!button.disabled) onOpen(button);
  };
  const onUpdatePointerEnter = (): void => {
    if (!updateButton.disabled) updateButton.style.background = "rgba(59, 130, 246, 0.14)";
  };
  const onUpdatePointerLeave = (): void => {
    updateButton.style.background = "transparent";
  };
  const onUpdateClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (!updateButton.disabled) onOpen(updateButton, "updates");
  };
  button.addEventListener("pointerenter", onPointerEnter);
  button.addEventListener("pointerleave", onPointerLeave);
  button.addEventListener("click", onClick);
  updateButton.addEventListener("pointerenter", onUpdatePointerEnter);
  updateButton.addEventListener("pointerleave", onUpdatePointerLeave);
  updateButton.addEventListener("click", onUpdateClick);
  root.append(button, updateButton);

  return {
    root,
    button,
    updateButton,
    setUpdateAvailable(updateAvailable) {
      root.toggleAttribute("data-update-available", updateAvailable);
      updateButton.style.display = updateAvailable ? "inline-flex" : "none";
    },
    setSelected(selected) {
      setTriggerSelected(button, selected);
    },
    dispose() {
      button.removeEventListener("pointerenter", onPointerEnter);
      button.removeEventListener("pointerleave", onPointerLeave);
      button.removeEventListener("click", onClick);
      updateButton.removeEventListener("pointerenter", onUpdatePointerEnter);
      updateButton.removeEventListener("pointerleave", onUpdatePointerLeave);
      updateButton.removeEventListener("click", onUpdateClick);
      root.remove();
    },
  };
}

export function installRendererSettingsHeaderTrigger(options: {
  available: boolean;
  onOpen(opener: HTMLButtonElement, pageId?: "updates"): void;
  messages?: RendererSettingsMessages;
  ownerDocument?: Document;
}): RendererSettingsHeaderTriggerControl {
  const ownerDocument = options.ownerDocument ?? document;
  let trigger: RendererSettingsTriggerControl | null = null;
  let updateAvailable = false;
  let selected = false;
  let disposed = false;

  const refresh = (): boolean => {
    if (disposed) return false;
    const insertionPoint = findRendererSettingsHeaderInsertionPoint(ownerDocument);
    if (!insertionPoint) {
      trigger?.root.remove();
      return false;
    }
    if (!trigger) {
      for (const duplicate of ownerDocument.querySelectorAll(`[${SETTINGS_TRIGGER_ATTRIBUTE}]`)) {
        duplicate.remove();
      }
      trigger = mountRendererSettingsTrigger(
        "application-header",
        options.available,
        options.onOpen,
        ownerDocument,
        options.messages,
      );
      trigger.setUpdateAvailable(updateAvailable);
    }
    if (
      trigger.root.parentElement !== insertionPoint.parent ||
      trigger.root.nextSibling !== insertionPoint.before
    ) {
      insertionPoint.parent.insertBefore(trigger.root, insertionPoint.before);
    }
    applyTriggerPlacement(trigger.button, insertionPoint.rail);
    trigger.setSelected(selected);
    return true;
  };

  refresh();
  return {
    get root() {
      return trigger?.root ?? null;
    },
    refresh,
    setUpdateAvailable(available) {
      updateAvailable = available;
      trigger?.setUpdateAvailable(available);
    },
    setSelected(next) {
      selected = next;
      trigger?.setSelected(next);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      trigger?.dispose();
      trigger = null;
    },
  };
}
