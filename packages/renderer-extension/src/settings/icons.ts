import type { IconNode } from "lucide";
import createElement from "lucide/dist/esm/createElement.mjs";
import Boxes from "lucide/dist/esm/icons/boxes.mjs";
import Check from "lucide/dist/esm/icons/circle-check.mjs";
import ChevronDown from "lucide/dist/esm/icons/chevron-down.mjs";
import ChevronLeft from "lucide/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide/dist/esm/icons/chevron-right.mjs";
import ChevronUp from "lucide/dist/esm/icons/chevron-up.mjs";
import CircleArrowUp from "lucide/dist/esm/icons/circle-arrow-up.mjs";
import CircleOff from "lucide/dist/esm/icons/circle-off.mjs";
import Copy from "lucide/dist/esm/icons/copy.mjs";
import Download from "lucide/dist/esm/icons/download.mjs";
import ExternalLink from "lucide/dist/esm/icons/external-link.mjs";
import Ellipsis from "lucide/dist/esm/icons/ellipsis.mjs";
import FolderInput from "lucide/dist/esm/icons/folder-input.mjs";
import GripVertical from "lucide/dist/esm/icons/grip-vertical.mjs";
import Info from "lucide/dist/esm/icons/info.mjs";
import Languages from "lucide/dist/esm/icons/languages.mjs";
import Network from "lucide/dist/esm/icons/network.mjs";
import PlugZap from "lucide/dist/esm/icons/plug-zap.mjs";
import Puzzle from "lucide/dist/esm/icons/puzzle.mjs";
import Link from "lucide/dist/esm/icons/link.mjs";
import Unlink from "lucide/dist/esm/icons/unlink.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import RotateCcw from "lucide/dist/esm/icons/rotate-ccw.mjs";
import Route from "lucide/dist/esm/icons/route.mjs";
import Settings from "lucide/dist/esm/icons/settings.mjs";
import Stethoscope from "lucide/dist/esm/icons/stethoscope.mjs";
import Star from "lucide/dist/esm/icons/star.mjs";
import TriangleAlert from "lucide/dist/esm/icons/triangle-alert.mjs";
import Ticket from "lucide/dist/esm/icons/ticket.mjs";
import Trash from "lucide/dist/esm/icons/trash-2.mjs";
import Terminal from "lucide/dist/esm/icons/terminal.mjs";
import Search from "lucide/dist/esm/icons/search.mjs";
import CircleHelp from "lucide/dist/esm/icons/circle-question-mark.mjs";
import X from "lucide/dist/esm/icons/x.mjs";
import Users from "lucide/dist/esm/icons/users.mjs";
import Plus from "lucide/dist/esm/icons/plus.mjs";

export const RENDERER_SETTINGS_ICON_NAMES = [
  "settings",
  "close",
  "star",
  "github",
  "language",
  "connections",
  "accounts",
  "session-import",
  "add",
  "model-pool",
  "routes",
  "gateway",
  "updates",
  "about",
  "info",
  "external-link",
  "refresh",
  "unavailable",
  "alert",
  "check",
  "diagnose",
  "copy",
  "download",
  "chevron-left",
  "chevron-right",
  "chevron-down",
  "chevron-up",
  "grip-vertical",
  "undo",
  "ticket",
  "trash",
  "terminal",
  "search",
  "help",
  "ellipsis",
  "skills",
  "link",
  "unlink",
] as const;

export type RendererSettingsIconName = (typeof RENDERER_SETTINGS_ICON_NAMES)[number];

const iconNodes = {
  settings: Settings,
  close: X,
  star: Star,
  github: [
    [
      "path",
      {
        fill: "currentColor",
        stroke: "none",
        d: "M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.467-1.334-5.467-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3-.405c1.02.005 2.045.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
      },
    ],
  ],
  language: Languages,
  connections: PlugZap,
  accounts: Users,
  "session-import": FolderInput,
  add: Plus,
  "model-pool": Boxes,
  routes: Route,
  gateway: Network,
  updates: CircleArrowUp,
  about: Info,
  info: Info,
  "external-link": ExternalLink,
  refresh: RefreshCw,
  unavailable: CircleOff,
  alert: TriangleAlert,
  check: Check,
  diagnose: Stethoscope,
  copy: Copy,
  download: Download,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "grip-vertical": GripVertical,
  undo: RotateCcw,
  ticket: Ticket,
  trash: Trash,
  terminal: Terminal,
  search: Search,
  help: CircleHelp,
  ellipsis: Ellipsis,
  skills: Puzzle,
  link: Link,
  unlink: Unlink,
} satisfies Record<RendererSettingsIconName, IconNode>;

export function isRendererSettingsIconName(value: string): value is RendererSettingsIconName {
  return (RENDERER_SETTINGS_ICON_NAMES as readonly string[]).includes(value);
}

export function createRendererSettingsIcon(name: RendererSettingsIconName, size = 18): SVGElement {
  const icon = createElement(iconNodes[name], {
    width: size,
    height: size,
    "aria-hidden": "true",
    focusable: "false",
  });
  icon.classList.add("codexhost-settings-icon");
  return icon;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// 20px rail slot. The resting mark is a stroked C; selection swaps in the filled mark.
const CODEXHOST_LINE_RING = "M 15.67 5.57 A 7.2 7.2 0 1 0 15.67 14.43";
const CODEXHOST_SOLID_RING =
  "M 16.30 5.07 A 8 8 0 1 0 16.30 14.93 L 15.04 13.94 A 6.4 6.4 0 1 1 15.04 6.06 Z";

export function createRendererSettingsBrandIcon(size = 22): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.style.width = `${size}px`;
  icon.style.height = `${size}px`;
  icon.style.display = "block";
  icon.classList.add("codexhost-settings-icon");

  const line = document.createElementNS(SVG_NS, "g");
  line.setAttribute("data-codexhost-mark", "line");
  const lineRing = document.createElementNS(SVG_NS, "path");
  lineRing.setAttribute("d", CODEXHOST_LINE_RING);
  lineRing.setAttribute("fill", "none");
  lineRing.setAttribute("stroke", "currentColor");
  lineRing.setAttribute("stroke-width", "1.6");
  lineRing.setAttribute("stroke-linecap", "round");
  const lineSquare = document.createElementNS(SVG_NS, "rect");
  lineSquare.setAttribute("x", "7.8");
  lineSquare.setAttribute("y", "7.8");
  lineSquare.setAttribute("width", "4.4");
  lineSquare.setAttribute("height", "4.4");
  lineSquare.setAttribute("rx", "1");
  lineSquare.setAttribute("fill", "none");
  lineSquare.setAttribute("stroke", "currentColor");
  lineSquare.setAttribute("stroke-width", "1.6");
  line.append(lineRing, lineSquare);

  const solid = document.createElementNS(SVG_NS, "g");
  solid.setAttribute("data-codexhost-mark", "solid");
  solid.style.display = "none";
  const solidRing = document.createElementNS(SVG_NS, "path");
  solidRing.setAttribute("d", CODEXHOST_SOLID_RING);
  solidRing.setAttribute("fill", "currentColor");
  solidRing.setAttribute("stroke", "none");
  const solidSquare = document.createElementNS(SVG_NS, "rect");
  solidSquare.setAttribute("x", "7");
  solidSquare.setAttribute("y", "7");
  solidSquare.setAttribute("width", "6");
  solidSquare.setAttribute("height", "6");
  solidSquare.setAttribute("rx", "1.4");
  solidSquare.setAttribute("fill", "currentColor");
  solidSquare.setAttribute("stroke", "none");
  solid.append(solidRing, solidSquare);

  icon.append(line, solid);
  return icon;
}

export function setRendererSettingsBrandIconSelected(icon: Element, selected: boolean): void {
  if (typeof icon.querySelector !== "function") return;
  const line = icon.querySelector('[data-codexhost-mark="line"]');
  const solid = icon.querySelector('[data-codexhost-mark="solid"]');
  if (line && "style" in line) (line as HTMLElement).style.display = selected ? "none" : "";
  if (solid && "style" in solid) (solid as HTMLElement).style.display = selected ? "" : "none";
}
