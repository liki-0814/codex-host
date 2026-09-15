import { harnessPermissionModeCatalogSchema } from "@codexhost/shared-contracts";

const EXECUTION = [
  { id: "agent", label: "Agent" },
  { id: "plan", label: "Plan" },
  { id: "ask", label: "Ask" },
] as const;
export function cursorPermission(mode: string, force = false) {
  return `${mode}${force ? "-auto" : ""}`;
}
export function decodeCursorPermission(id: string) {
  const force = id.endsWith("-auto");
  const mode = force ? id.slice(0, -5) : id;
  if (!EXECUTION.some((v) => v.id === mode))
    throw new Error("Unknown Cursor execution/approval mode");
  return { mode, force };
}
export const CURSOR_MODES = harnessPermissionModeCatalogSchema.parse({
  defaultModeId: "agent",
  dimensions: [
    { id: "execution", label: "执行模式" },
    { id: "approval", label: "审批方式" },
  ],
  modes: EXECUTION.flatMap((mode) =>
    [false, true].map((force) => ({
      id: cursorPermission(mode.id, force),
      label: `${mode.label} · ${force ? "自动执行" : "需要审批"}`,
      description: force
        ? "使用 Cursor 原生 --force；显式拒绝规则仍生效。"
        : "由 Cursor 原生权限规则决定何时请求审批。",
      values: { execution: mode.label, approval: force ? "自动执行" : "需要审批" },
      dangerous: force,
    })),
  ),
});
