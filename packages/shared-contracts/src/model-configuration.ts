import {
  harnessModelRefSchema,
  type HarnessModelRef,
  type HarnessModelCatalog,
} from "./harness-models.js";

const PREFIX = "configured.";
/** A Host-owned envelope around an opaque Adapter Model Ref and advertised choices. */
export function configuredModelRef(
  model: HarnessModelRef,
  values: Record<string, string>,
): HarnessModelRef {
  const payload = JSON.stringify([
    model.id,
    Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))),
  ]);
  const encoded = encodeURIComponent(payload)
    .replace(/[!'()*~]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
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
    !Object.values(value[1]).every((v) => typeof v === "string")
  )
    throw new Error("Invalid Model configuration");
  return { model: harnessModelRefSchema.parse({ id: value[0] }), values: value[1] };
}
/** Pure local draft selection. No native request or interpretation of parameter names. */
export function selectModelConfiguration(
  catalog: HarnessModelCatalog,
  ref: HarnessModelRef,
): HarnessModelCatalog {
  const decoded = readConfiguredModelRef(ref);
  const base = decoded?.model ?? ref;
  const model = catalog.models.find(
    (m) => (readConfiguredModelRef(m.ref)?.model ?? m.ref).id === base.id,
  );
  if (!model || model.selectable === false) throw new Error("Model is not selectable");
  const definitions =
    model.configurationOptions ??
    (catalog.defaultModel?.id === model.ref.id ? catalog.configurationOptions : undefined) ??
    [];
  const values = Object.fromEntries(
    definitions.map((o) => [o.id, decoded?.values[o.id] ?? o.currentValue]),
  );
  const configurationOptions = definitions.map((o) => {
    const currentValue = values[o.id] ?? o.currentValue;
    if (!o.options.some((v) => v.value === currentValue))
      throw new Error("Model parameter is not selectable");
    return {
      ...o,
      currentValue,
      options: o.options.map((v) => ({
        ...v,
        model: configuredModelRef(base, { ...values, [o.id]: v.value }),
      })),
    };
  });
  const selected = definitions.length ? configuredModelRef(base, values) : base;
  return {
    ...catalog,
    defaultModel: selected,
    configurationOptions,
    models: catalog.models.map((m) =>
      m === model ? { ...m, ref: selected, configurationOptions } : m,
    ),
  };
}
