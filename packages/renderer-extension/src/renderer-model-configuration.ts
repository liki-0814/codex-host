import {
  modelConfigurationBase,
  readConfiguredModelRef,
  type HarnessModelCatalog,
  type HarnessModelRef,
} from "@codexhost/shared-contracts";

export interface ConfigurationSwitchState {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly nextModelId: string;
}

/** Match a selected Ref to its catalog row, including a configured Ref for the same Model. */
export function catalogModelForSelection(
  catalog: HarnessModelCatalog | undefined,
  selected: HarnessModelRef | undefined,
) {
  if (!catalog || !selected) return undefined;
  return (
    catalog.models.find((model) => model.ref.id === selected.id) ??
    catalog.models.find(
      (model) => modelConfigurationBase(model.ref).id === modelConfigurationBase(selected).id,
    )
  );
}

/** Resolve a menu id to a catalog Model or one of its advertised configuration choices. */
export function modelRefForPickerId(
  catalog: HarnessModelCatalog,
  modelId: string,
): HarnessModelRef | undefined {
  const direct = catalog.models.find((model) => model.ref.id === modelId);
  if (direct) return direct.ref;
  for (const model of catalog.models) {
    for (const option of model.configurationOptions ?? []) {
      const choice = option.options.find((item) => item.model.id === modelId);
      if (choice) return choice.model;
    }
  }
  return undefined;
}

/**
 * A two-choice configuration becomes one switch. The second advertised choice is on.
 * The Renderer still selects that choice's Model Ref and does not invent parameter values.
 */
export function configurationSwitchForSelection(
  catalog: HarnessModelCatalog | undefined,
  selected: HarnessModelRef | undefined,
): ConfigurationSwitchState | undefined {
  const model = catalogModelForSelection(catalog, selected);
  const option = model?.configurationOptions?.find((entry) => entry.options.length === 2);
  const off = option?.options[0];
  const on = option?.options[1];
  if (!option || !off || !on || !selected) return undefined;
  let current = option.currentValue;
  try {
    const configured = readConfiguredModelRef(selected);
    const configuredValue = configured?.values[option.id];
    if (configuredValue !== undefined) current = configuredValue;
  } catch {
    return undefined;
  }
  if (!option.options.some((choice) => choice.value === current)) return undefined;
  const checked = current === on.value;
  return {
    label: option.label,
    ...(option.description !== undefined ? { description: option.description } : {}),
    checked,
    nextModelId: (checked ? off : on).model.id,
  };
}
