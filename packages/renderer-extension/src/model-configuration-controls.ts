import type { HarnessModelCatalog } from "@codexhost/shared-contracts";
import { rendererModelPickerBottomAlignedMenuPlacement } from "./renderer-model-picker-positioning.js";

type Config = NonNullable<HarnessModelCatalog["configurationOptions"]>[number];
const ROW =
  "flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm text-token-foreground outline-none enabled:hover:bg-token-list-hover-background focus-visible:bg-token-list-hover-background disabled:opacity-40";
const isBoolean = (config: Config) =>
  config.options.length === 2 &&
  config.options.some((o) => o.value === "true") &&
  config.options.some((o) => o.value === "false");

export function mountModelConfigurationControls(
  parent: HTMLElement,
  selectModel: (id: string) => void,
  closeOther: () => void,
) {
  const menu = document.createElement("div");
  menu.setAttribute("popover", "manual");
  menu.setAttribute("role", "menu");
  menu.className =
    "fixed z-50 overflow-auto rounded-xl border border-token-border bg-token-dropdown-background text-token-foreground shadow-lg";
  Object.assign(menu.style, {
    position: "fixed",
    inset: "auto",
    margin: "0",
    padding: "4px",
    width: "220px",
  });
  document.body.append(menu);
  let anchor: HTMLButtonElement | undefined;
  const close = () => {
    if (menu.matches(":popover-open")) menu.hidePopover();
    anchor?.setAttribute("aria-expanded", "false");
    anchor = undefined;
  };
  const position = () => {
    if (!menu.matches(":popover-open")) return;
    const rect = parent.getBoundingClientRect();
    const placement = rendererModelPickerBottomAlignedMenuPlacement(rect, {
      width: innerWidth,
      height: innerHeight,
    });
    const width = Math.min(220, placement.width);
    menu.style.width = `${width}px`;
    menu.style.left = `${placement.left < rect.left ? rect.left - width - 4 : placement.left}px`;
    menu.style.top = "auto";
    menu.style.bottom = `${placement.bottom}px`;
    menu.style.maxHeight = `${placement.maxHeight}px`;
  };
  function open(button: HTMLButtonElement, config: Config, focus = false) {
    if (button.disabled || !parent.matches(":popover-open")) return;
    closeOther();
    anchor?.setAttribute("aria-expanded", "false");
    anchor = button;
    button.setAttribute("aria-expanded", "true");
    menu.setAttribute("aria-label", config.label);
    menu.replaceChildren();
    for (const option of config.options) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = ROW;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(option.value === config.currentValue));
      const label = document.createElement("span");
      label.textContent = option.label;
      const check = document.createElement("span");
      check.textContent = "✓";
      check.setAttribute("aria-hidden", "true");
      check.style.visibility = option.value === config.currentValue ? "visible" : "hidden";
      item.append(label, check);
      item.addEventListener("click", () => {
        close();
        selectModel(option.model.id);
      });
      menu.append(item);
    }
    if (!menu.matches(":popover-open")) menu.showPopover();
    position();
    if (focus) menu.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
  }
  menu.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const previous = anchor;
      close();
      previous?.focus();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  return {
    menu,
    close,
    position,
    render(catalog: HarnessModelCatalog | undefined) {
      close();
      const configs = [...(catalog?.configurationOptions ?? [])];
      // Group switches before value selectors while preserving native order within each group.
      configs.sort((a, b) => Number(isBoolean(b)) - Number(isBoolean(a)));
      for (const config of configs) {
        if (config.options.length < 2) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = ROW;
        button.dataset.modelConfiguration = config.id;
        button.setAttribute("aria-label", config.label);
        if (config.description) button.title = config.description;
        const label = document.createElement("span");
        label.textContent = config.label;
        button.append(label);
        if (isBoolean(config)) {
          const on = config.currentValue === "true";
          button.setAttribute("role", "switch");
          button.setAttribute("aria-checked", String(on));
          const track = document.createElement("span");
          track.setAttribute("aria-hidden", "true");
          Object.assign(track.style, {
            width: "30px",
            height: "18px",
            borderRadius: "999px",
            padding: "2px",
            flexShrink: "0",
            background: on ? "#00804c" : "rgba(127,127,127,.28)",
          });
          const thumb = document.createElement("span");
          Object.assign(thumb.style, {
            display: "block",
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            background: "white",
            transform: on ? "translateX(12px)" : "translateX(0)",
          });
          track.append(thumb);
          button.append(track);
          button.addEventListener("mouseenter", () => {
            close();
            closeOther();
          });
          button.addEventListener("click", () => {
            const next = config.options.find((o) => o.value !== config.currentValue);
            if (next) selectModel(next.model.id);
          });
        } else {
          button.setAttribute("role", "menuitem");
          button.setAttribute("aria-haspopup", "menu");
          button.setAttribute("aria-expanded", "false");
          const trailing = document.createElement("span");
          trailing.className = "flex items-center gap-2 text-token-text-tertiary";
          const value = document.createElement("span");
          value.textContent =
            config.options.find((o) => o.value === config.currentValue)?.label ??
            config.currentValue;
          const chevron = document.createElement("span");
          chevron.textContent = "›";
          chevron.setAttribute("aria-hidden", "true");
          trailing.append(value, chevron);
          button.append(trailing);
          button.addEventListener("mouseenter", () => open(button, config));
          button.addEventListener("click", () => open(button, config, true));
          button.addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              open(button, config, true);
            }
          });
        }
        parent.append(button);
      }
      if (configs.length) {
        const divider = document.createElement("div");
        divider.className = "my-1 h-px bg-token-border";
        divider.setAttribute("role", "separator");
        parent.append(divider);
      }
    },
    dispose() {
      close();
      menu.remove();
    },
  };
}
