import {
  harnessPermissionModeCatalogSchema,
  harnessPermissionModeIdSchema,
  type HarnessPermissionModeCatalog,
  type HarnessPermissionModeId,
} from "@codexhost/shared-contracts";

export type AntigravityPermissionMode = "accept-edits" | "plan";

export const ANTIGRAVITY_DEFAULT_PERMISSION_MODE_ID = harnessPermissionModeIdSchema.parse(
  "accept-edits",
);

export const ANTIGRAVITY_PERMISSION_MODE_CATALOG: HarnessPermissionModeCatalog =
  harnessPermissionModeCatalogSchema.parse({
    modes: [
      {
        id: "accept-edits",
        label: "Agent",
        description:
          "Run Antigravity with --mode=accept-edits and --dangerously-skip-permissions. Files are written without Host review.",
        dangerous: true,
      },
      {
        id: "plan",
        label: "Plan",
        description:
          "Run Antigravity with --mode=plan and --dangerously-skip-permissions. The CLI plans first; headless does not wait for Host approval and may still write files.",
        dangerous: true,
      },
    ],
    defaultModeId: ANTIGRAVITY_DEFAULT_PERMISSION_MODE_ID,
  });

export function decodeAntigravityPermissionModeId(
  value: HarnessPermissionModeId,
): AntigravityPermissionMode {
  const parsed = harnessPermissionModeIdSchema.parse(value);
  if (parsed === "plan") return "plan";
  if (parsed === "accept-edits" || parsed === "dangerously-skip-permissions") return "accept-edits";
  throw new Error(
    "Antigravity execution modes are Agent and Plan. Explicitly select Agent or Plan to continue; both use native Skip permissions and codexhost does not enforce tool approvals.",
  );
}

export function antigravityPermissionModeId(
  mode: AntigravityPermissionMode,
): HarnessPermissionModeId {
  return harnessPermissionModeIdSchema.parse(mode);
}

/** Session launch flags for the selected execution mode. Skip is always required in headless. */
export function antigravityModeArguments(mode: AntigravityPermissionMode): string[] {
  return ["--mode", mode, "--dangerously-skip-permissions"];
}
