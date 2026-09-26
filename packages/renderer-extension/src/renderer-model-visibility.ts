import { modelConfigurationBase, type HarnessModelRef } from "@codexhost/shared-contracts";

export const MODEL_VISIBILITY_CHANGED = "codexhost:model-visibility-changed";
const PREFIX = "codexhost.hidden-models.v1.";

export function modelVisibilityId(ref: HarnessModelRef): string {
  return modelConfigurationBase(ref).id;
}

export function readHiddenModels(
  storage: Pick<Storage, "getItem"> | undefined,
  harness: string,
): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(PREFIX + harness) ?? "[]");
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenModels(
  storage: Pick<Storage, "setItem">,
  harness: string,
  ids: Iterable<string>,
): void {
  storage.setItem(PREFIX + harness, JSON.stringify([...new Set(ids)]));
}
