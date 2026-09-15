import { z } from "zod";
import {
  configuredModelRef,
  readConfiguredModelRef,
  harnessIdSchema,
  harnessModelRefSchema,
  harnessModelCatalogSchema,
  harnessPermissionModeCatalogSchema,
  type HarnessModelRef,
} from "@codexhost/shared-contracts";
import { KimiError } from "./server.js";

export const kimiId = harnessIdSchema.parse("kimi-code");
export const nativeModelsSchema = z.object({
  items: z.array(
    z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
      display_name: z.string().optional(),
      max_context_size: z.number().int().positive(),
      support_efforts: z.array(z.string()).default([]),
      default_effort: z.string().optional(),
      capabilities: z.array(z.string()).default([]),
    }),
  ),
});
export type NativeModel = z.infer<typeof nativeModelsSchema>["items"][number];
export const alias = (model: NativeModel): string => model.model;
export const modelRef = (name: string): HarnessModelRef =>
  harnessModelRefSchema.parse({ id: Buffer.from(name).toString("base64url") });
export function selection(
  ref: HarnessModelRef,
  models: NativeModel[],
): { model: string; thinking?: string } {
  const decoded = readConfiguredModelRef(ref);
  const name = Buffer.from((decoded?.model ?? ref).id, "base64url").toString("utf8");
  const model = models.find((m) => alias(m) === name);
  if (!model) throw new KimiError("invalidRequest", "Kimi Model is not available");
  if (decoded && Object.keys(decoded.values).some((k) => k !== "effort"))
    throw new KimiError("invalidRequest", "Unknown Kimi Model parameter");
  const thinking = decoded?.values.effort ?? model.default_effort;
  if (thinking && !model.support_efforts.includes(thinking))
    throw new KimiError("invalidRequest", "Kimi effort is not supported by this Model");
  return { model: name, ...(thinking ? { thinking } : {}) };
}
export function modelCatalog(models: NativeModel[], selected?: string, effort?: string) {
  const entries = models.map((m) => {
    const base = modelRef(alias(m));
    const current =
      (alias(m) === selected ? effort : undefined) || m.default_effort || m.support_efforts[0];
    const configurationOptions =
      current && m.support_efforts.length
        ? [
            {
              id: "effort",
              label: "Effort",
              currentValue: current,
              options: m.support_efforts.map((value) => ({
                value,
                label: value.charAt(0).toUpperCase() + value.slice(1),
                model: configuredModelRef(base, { effort: value }),
              })),
            },
          ]
        : [];
    return {
      ref:
        current && configurationOptions.length
          ? configuredModelRef(base, { effort: current })
          : base,
      label: m.display_name ?? alias(m),
      // Effort is carried by the model configuration envelope, not a second Thinking picker.
      supportedThinkingOptionIds: [],
      configurationOptions,
    };
  });
  const index = models.findIndex((m) => alias(m) === selected);
  const entry = entries[index];
  return harnessModelCatalogSchema.parse({
    models: entries,
    ...(!entry
      ? {}
      : {
          defaultModel: entry.ref,
          configurationOptions: entry.configurationOptions,
        }),
    thinkingOptions: [],
  });
}
export const permissions = harnessPermissionModeCatalogSchema.parse({
  dimensions: [
    { id: "mode", label: "执行模式" },
    { id: "approval", label: "审批方式" },
  ],
  modes: [false, true].flatMap((plan) =>
    ["manual", "yolo", "auto"].map((permission) => ({
      id: `${plan ? "plan" : "agent"}.${permission}`,
      label: `${plan ? "计划模式" : "Agent"} · ${permission === "manual" ? "需要审批" : permission === "yolo" ? "按需审批" : "自动执行"}`,
      dangerous: permission === "auto",
      values: {
        mode: plan ? "计划模式" : "Agent",
        approval:
          permission === "manual" ? "需要审批" : permission === "yolo" ? "按需审批" : "自动执行",
      },
    })),
  ),
  defaultModeId: "agent.manual",
});
export function permissionProfile(id: string) {
  if (!permissions.modes.some((m) => m.id === id))
    throw new KimiError("invalidRequest", "Invalid Kimi Permission Mode");
  const [mode, permission_mode] = id.split(".");
  return { plan_mode: mode === "plan", permission_mode: permission_mode ?? "manual" };
}
