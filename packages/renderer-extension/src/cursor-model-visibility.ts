export const CURSOR_HIDDEN_MODELS_STORAGE_KEY = "codexhost.cursor-model-picker-hidden.v1";
export const CURSOR_MODEL_VISIBILITY_CHANGE_EVENT = "codexhost-cursor-model-visibility-change";

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCursorHiddenModelIds(
  storage: PreferenceStorage | null = defaultStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(CURSOR_HIDDEN_MODELS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

export function setCursorModelHidden(
  modelId: string,
  hidden: boolean,
  storage: PreferenceStorage | null = defaultStorage(),
  ownerWindow: Window | null = typeof window === "undefined" ? null : window,
): void {
  const ids = readCursorHiddenModelIds(storage);
  if (hidden) ids.add(modelId);
  else ids.delete(modelId);
  if (!storage) return;
  try {
    storage.setItem(CURSOR_HIDDEN_MODELS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    return;
  }
  ownerWindow?.dispatchEvent(new Event(CURSOR_MODEL_VISIBILITY_CHANGE_EVENT));
}

export function isCursorModelHidden(
  modelId: string,
  selectedId?: string,
  storage: PreferenceStorage | null = defaultStorage(),
): boolean {
  if (modelId === selectedId) return false;
  return readCursorHiddenModelIds(storage).has(modelId);
}
