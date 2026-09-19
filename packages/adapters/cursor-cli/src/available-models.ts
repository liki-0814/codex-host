import type { CursorNativeModel } from "./transport.js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Cursor model metadata");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid Cursor model metadata string");
  return value;
}
/** Cursor's native ACP extension provides every Model's independent parameter definitions. */
export function parseCursorAvailableModels(value: unknown): CursorNativeModel[] {
  const models = record(value).models;
  if (!Array.isArray(models)) throw new Error("Cursor returned no available Models");
  return models.map((raw) => {
    const model = record(raw);
    if (!Array.isArray(model.configOptions)) throw new Error("Cursor returned no Model parameters");
    return {
      value: text(model.value),
      name: text(model.name),
      configOptions: model.configOptions.map((rawOption) => {
        const option = record(rawOption);
        if (option.type !== "select" || !Array.isArray(option.options))
          throw new Error("Unsupported Cursor parameter type");
        return {
          id: text(option.id),
          name: text(option.name),
          type: "select" as const,
          currentValue: text(option.currentValue),
          ...(typeof option.description === "string" ? { description: option.description } : {}),
          options: option.options.map((rawValue) => {
            const entry = record(rawValue);
            return { value: text(entry.value), name: text(entry.name) };
          }),
        };
      }),
    };
  });
}
