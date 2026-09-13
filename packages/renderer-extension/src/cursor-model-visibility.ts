/** Must match the Cursor composer picker's hidden-model localStorage key. */
const HIDDEN_MODELS_KEY = "codexhost.cursor-model-picker-hidden.v1";

function readHiddenIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_MODELS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function isCursorModelHidden(modelId: string): boolean {
  return readHiddenIds().has(modelId);
}

export function setCursorModelHidden(modelId: string, hidden: boolean): void {
  const ids = readHiddenIds();
  if (hidden) ids.add(modelId);
  else ids.delete(modelId);
  try {
    window.localStorage.setItem(HIDDEN_MODELS_KEY, JSON.stringify([...ids]));
  } catch {
    // Private mode or quota.
  }
}
