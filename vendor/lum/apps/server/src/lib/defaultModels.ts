import conf from "@/utils/conf";

export function withDefaultModels<T extends {providerId: string; modelId: string; type?: string; operation?: "generate" | "edit" | "upscale"}>(models: T[], kind?: "language") {
  const stored = conf.get("settings", {}).modelDefaults;
  const defaults = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  return models.map(model => {
    const operation = model.operation ?? "generate";
    const defaultKind = operation === "generate" ? model.type : model.type ? `${model.type}${operation === "edit" ? "Edit" : "Upscale"}` : "";
    const value = defaults[kind ?? defaultKind ?? ""];
    const selected = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {...model, isDefault: selected.providerId === model.providerId && selected.modelId === model.modelId};
  }).sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}
