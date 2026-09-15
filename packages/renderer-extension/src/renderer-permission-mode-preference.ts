import {
  harnessPermissionModeIdSchema,
  type HarnessPermissionModeCatalog,
  type HarnessPermissionModeId,
} from "@codexhost/shared-contracts";

export const CLAUDE_PERMISSION_MODE_PREFERENCE_KEY = "codexhost.claude-code.permission-mode.v1";

export interface PermissionModePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function rendererStorage(): PermissionModePreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readClaudePermissionModePreference(
  catalog: HarnessPermissionModeCatalog,
  storage: PermissionModePreferenceStorage | null = rendererStorage(),
): HarnessPermissionModeId | undefined {
  if (!storage) return undefined;
  try {
    const parsed = harnessPermissionModeIdSchema.safeParse(
      storage.getItem(CLAUDE_PERMISSION_MODE_PREFERENCE_KEY),
    );
    return parsed.success && catalog.modes.some(({ id }) => id === parsed.data)
      ? parsed.data
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeClaudePermissionModePreference(
  permissionModeId: HarnessPermissionModeId,
  storage: PermissionModePreferenceStorage | null = rendererStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CLAUDE_PERMISSION_MODE_PREFERENCE_KEY, permissionModeId);
  } catch {
    // Preference persistence must not prevent native mode selection.
  }
}

export interface ThreadPermissionPreferenceTarget {
  hostId: string;
  threadId: string;
  agent: string;
}

function threadPermissionKey(target: ThreadPermissionPreferenceTarget): string {
  return `codexhost.thread-permission.v1:${JSON.stringify([target.hostId, target.threadId, target.agent])}`;
}

/** A deferred selection belongs to the Thread, not its currently mounted Composer. */
export function readThreadPermissionModePreference(
  target: ThreadPermissionPreferenceTarget,
  catalog: HarnessPermissionModeCatalog,
  storage: PermissionModePreferenceStorage | null = rendererStorage(),
): HarnessPermissionModeId | undefined {
  try {
    const parsed = harnessPermissionModeIdSchema.safeParse(
      storage?.getItem(threadPermissionKey(target)),
    );
    return parsed.success && catalog.modes.some(({ id }) => id === parsed.data)
      ? parsed.data
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeThreadPermissionModePreference(
  target: ThreadPermissionPreferenceTarget,
  permissionModeId: HarnessPermissionModeId,
  storage: PermissionModePreferenceStorage | null = rendererStorage(),
): void {
  try {
    storage?.setItem(threadPermissionKey(target), permissionModeId);
  } catch {
    // Keep the current Composer usable when browser storage is unavailable.
  }
}
