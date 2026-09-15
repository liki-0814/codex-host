import { CURSOR_MODES, cursorPermission } from "./permission-modes.js";
import type {
  HarnessModelCatalog,
  HarnessSessionCapabilities,
  HarnessSessionState,
} from "@codexhost/harness-adapter";
import {
  configuredModelRef,
  readConfiguredModelRef,
  harnessModelCatalogSchema,
  harnessModelRefSchema,
  nativeSessionRefSchema,
  type HarnessModelRef,
} from "@codexhost/shared-contracts";
import type { CursorSessionInfo, CursorTransport } from "./transport.js";

export const CURSOR_CAPABILITIES: HarnessSessionCapabilities = {
  configuration: {
    selectModel: true,
    selectThinkingOption: false,
    selectPermissionMode: true,
    permissionModeScope: "turn",
  },
  history: { fork: false, forkAcrossCwd: false, rollbackLastTurn: false },
  subagents: { observe: true, readTranscript: false },
};
export { CURSOR_MODES } from "./permission-modes.js";
export const configString = (value: unknown): string => (typeof value === "string" ? value : "");
export const cursorModelRef = (native: string): HarnessModelRef =>
  harnessModelRefSchema.parse({ id: `cursor.${Buffer.from(native).toString("base64url")}` });
export function decodeCursorModelRef(ref: string): string {
  if (!ref.startsWith("cursor.")) throw new Error("Unknown Cursor Model Ref");
  return Buffer.from(ref.slice(7), "base64url").toString("utf8");
}

// Only the Adapter understands selection payloads. They preserve a model and its
// native parameter values across draft submission and native session restoration.
function selectionRef(model: string, parameters: Record<string, string>): HarnessModelRef {
  if (!Object.keys(parameters).length) return cursorModelRef(model);
  return configuredModelRef(cursorModelRef(model), parameters);
}
function selection(ref: string): { model: string; parameters: Record<string, string> } {
  const configured = readConfiguredModelRef(harnessModelRefSchema.parse({ id: ref }));
  if (configured)
    return { model: decodeCursorModelRef(configured.model.id), parameters: configured.values };
  if (ref.startsWith("cursor-config.")) {
    const value: unknown = JSON.parse(Buffer.from(ref.slice(14), "base64url").toString("utf8"));
    if (
      !Array.isArray(value) ||
      typeof value[0] !== "string" ||
      !value[1] ||
      typeof value[1] !== "object" ||
      Array.isArray(value[1]) ||
      !Object.values(value[1]).every((v) => typeof v === "string")
    )
      throw new Error("Invalid Cursor configuration Ref");
    return { model: value[0], parameters: value[1] };
  }
  const native = decodeCursorModelRef(ref);
  // Migration from the previous full-variant refs; parameters are still validated
  // against the fresh native config before they are submitted individually.
  const match = /^([^\[\]]+)\[(.*)\]$/u.exec(native);
  if (!match) return { model: native, parameters: {} };
  const parameters: Record<string, string> = {};
  for (const part of (match[2] ?? "").split(",")) {
    const index = part.indexOf("=");
    if (index > 0) parameters[part.slice(0, index)] = part.slice(index + 1);
  }
  return { model: match[1] ?? native, parameters };
}
export function cursorSelects(info: CursorSessionInfo) {
  return (info.configOptions ?? []).flatMap((option) =>
    option.type === "select"
      ? [
          {
            ...option,
            options: option.options.flatMap((entry) =>
              "value" in entry ? [entry] : entry.options,
            ),
          },
        ]
      : [],
  );
}
function modelSelect(info: CursorSessionInfo) {
  const model = cursorSelects(info).find((option) => option.id === "model");
  if (!model) throw new Error("Cursor returned no model configuration");
  return model;
}
function parameters(info: CursorSessionInfo) {
  return cursorSelects(info).filter((option) => option.id !== "model" && option.id !== "mode");
}
export function cursorCapabilities(): HarnessSessionCapabilities {
  return CURSOR_CAPABILITIES;
}
export function cursorCatalog(info: CursorSessionInfo): HarnessModelCatalog {
  const model = modelSelect(info);
  const current = configString(model.currentValue);
  const configs = parameters(info);
  const values = Object.fromEntries(
    configs.map((option) => [option.id, configString(option.currentValue)]),
  );
  const currentRef = selectionRef(current, values);
  const options = model.options.some((option) => option.value === current)
    ? model.options
    : [{ value: current, name: current }, ...model.options];
  return harnessModelCatalogSchema.parse({
    models: options.map((option) => ({
      ref: option.value === current ? currentRef : cursorModelRef(option.value),
      label: option.name,
      configurationOptions:
        option.value === current
          ? configCatalog(current, configs)
          : configCatalog(
              option.value,
              parameters({
                configOptions:
                  info.availableModels?.find((m) => m.value === option.value)?.configOptions ?? [],
              }),
            ),
      ...(option.value === current && !model.options.some((entry) => entry.value === current)
        ? { selectable: false }
        : {}),
    })),
    defaultModel: currentRef,
    thinkingOptions: [],
    configurationOptions: configCatalog(current, configs),
  });
}
function configCatalog(current: string, configs: ReturnType<typeof parameters>) {
  const values = Object.fromEntries(configs.map((o) => [o.id, configString(o.currentValue)]));
  return configs.map((option) => ({
    id: option.id,
    label: option.name,
    currentValue: configString(option.currentValue),
    ...(option.description ? { description: option.description } : {}),
    options: option.options.map((value) => ({
      value: value.value,
      label: value.name,
      model: selectionRef(current, { ...values, [option.id]: value.value }),
    })),
  }));
}
export function cursorNativeModel(info: CursorSessionInfo, ref: string): string {
  const legacy = ref.startsWith("cursor.")
    ? modelSelect(info).options.find((option) => cursorModelRef(option.value).id === ref)
    : undefined;
  if (legacy) return legacy.value;
  const selected = selection(ref);
  const exact = modelSelect(info).options.find((option) => option.value === selected.model);
  if (!exact) throw new Error("Model is not in this Cursor session's native catalog");
  return exact.value;
}
export function withConfigOptions(
  info: CursorSessionInfo,
  configOptions: CursorSessionInfo["configOptions"],
): CursorSessionInfo {
  // ACP returns a full replacement, including removal of unsupported parameters.
  return { ...info, configOptions: configOptions ?? [] };
}
export async function configureCursorModel(
  transport: CursorTransport,
  info: CursorSessionInfo,
  ref: string,
): Promise<CursorSessionInfo> {
  const requested = selection(ref);
  const native = cursorNativeModel(info, ref);
  let next = info;
  if (
    modelSelect(next).currentValue !== native ||
    (ref.startsWith("cursor.") && native.includes("["))
  ) {
    next = withConfigOptions(next, (await transport.configure("model", native)).configOptions);
    if (!modelSelect(next).currentValue) throw new Error("Cursor did not confirm Model selection");
  }
  for (const [id, value] of Object.entries(native.includes("[") ? {} : requested.parameters)) {
    const option = parameters(next).find((option) => option.id === id);
    if (!option || !option.options.some((entry) => entry.value === value))
      throw new Error(`Cursor does not advertise ${id}=${value}`);
    if (option.currentValue === value) continue;
    next = withConfigOptions(next, (await transport.configure(id, value)).configOptions);
    if (parameters(next).find((option) => option.id === id)?.currentValue !== value)
      throw new Error(`Cursor did not confirm ${id}`);
  }
  return next;
}
export function cursorSessionState(
  info: CursorSessionInfo,
  nativeSessionId: string,
  force = false,
): HarnessSessionState {
  const catalog = cursorCatalog(info);
  if (!catalog.defaultModel) throw new Error("Cursor returned no current Model");
  const mode =
    cursorSelects(info).find((option) => option.id === "mode")?.currentValue ??
    info.modes?.currentModeId ??
    "agent";
  const permissionMode = CURSOR_MODES.modes.find(
    (option) => option.id === cursorPermission(mode, force),
  );
  const summary = parameters(info)
    .map((option) => option.options.find((value) => value.value === option.currentValue)?.name)
    .filter(Boolean)
    .join(" · ");
  return {
    nativeRef: nativeSessionRefSchema.parse({
      harnessId: "cursor-cli",
      nativeSessionId,
      formatVersion: 1,
    }),
    effectiveModel: catalog.defaultModel,
    modelCatalog: catalog,
    ...(summary ? { resolvedModelLabel: summary } : {}),
    availableThinkingOptions: [],
    ...(permissionMode ? { effectivePermissionModeId: permissionMode.id } : {}),
  };
}
