import {
  harnessModelRefSchema,
  type HarnessModelCatalog,
  type HarnessModelRef,
} from "./harness-models.js";

const PREFIX = "configured.";

/** A Host-owned envelope around an opaque Model Ref and advertised choices. */
export function configuredModelRef(
  model: HarnessModelRef,
  values: Record<string, string>,
): HarnessModelRef {
  const payload = JSON.stringify([
    model.id,
    Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))),
  ]);
  const encoded = encodeURIComponent(payload)
    .replace(/[!'()*~]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replaceAll("%", "~");
  return harnessModelRefSchema.parse({ id: PREFIX + encoded });
}

export function readConfiguredModelRef(
  ref: HarnessModelRef,
): { model: HarnessModelRef; values: Record<string, string> } | undefined {
  if (!ref.id.startsWith(PREFIX)) return undefined;
  const value: unknown = JSON.parse(
    decodeURIComponent(ref.id.slice(PREFIX.length).replaceAll("~", "%")),
  );
  if (
    !Array.isArray(value) ||
    typeof value[0] !== "string" ||
    !value[1] ||
    typeof value[1] !== "object" ||
    Array.isArray(value[1]) ||
    !Object.values(value[1]).every((entry) => typeof entry === "string")
  )
    throw new Error("Invalid Model configuration");
  return { model: harnessModelRefSchema.parse({ id: value[0] }), values: value[1] };
}

export function modelConfigurationBase(ref: HarnessModelRef): HarnessModelRef {
  try {
    return readConfiguredModelRef(ref)?.model ?? ref;
  } catch {
    return ref;
  }
}

/** Local draft selection. It does not send a native request or interpret parameter names. */
export function selectModelConfiguration(
  catalog: HarnessModelCatalog,
  ref: HarnessModelRef,
): HarnessModelCatalog {
  const decoded = readConfiguredModelRef(ref);
  const base = decoded?.model ?? ref;
  const model = catalog.models.find((entry) => modelConfigurationBase(entry.ref).id === base.id);
  if (!model || model.selectable === false) throw new Error("Model is not selectable");
  const definitions =
    model.configurationOptions ??
    (catalog.defaultModel?.id === model.ref.id ? catalog.configurationOptions : undefined) ??
    [];
  const values = Object.fromEntries(
    definitions.map((option) => [option.id, decoded?.values[option.id] ?? option.currentValue]),
  );
  const configurationOptions = definitions.map((option) => {
    const currentValue = values[option.id] ?? option.currentValue;
    if (!option.options.some((choice) => choice.value === currentValue))
      throw new Error("Model parameter is not selectable");
    return {
      ...option,
      currentValue,
      options: option.options.map((choice) => ({
        ...choice,
        model: configuredModelRef(base, { ...values, [option.id]: choice.value }),
      })),
    };
  });
  const selected = definitions.length ? configuredModelRef(base, values) : base;
  return {
    ...catalog,
    defaultModel: selected,
    configurationOptions,
    models: catalog.models.map((entry) =>
      entry === model ? { ...entry, ref: selected, configurationOptions } : entry,
    ),
  };
}
