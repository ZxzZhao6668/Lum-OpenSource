import type { NodeAiModel } from "@lum/nodes-scaffold/nodeAi";

export function groupNodeModels<T extends Pick<NodeAiModel, "providerId" | "providerLabel" | "isDefault">>(models: readonly T[]) {
  return [...Map.groupBy([...models].sort((left,right)=>Number(!!right.isDefault)-Number(!!left.isDefault)), item => item.providerId)].map(([id, items]) => ({
    id, label: items[0]!.providerLabel, models: items,
  })).sort((left, right) => Number(right.models.some(model=>model.isDefault))-Number(left.models.some(model=>model.isDefault))||Number(right.id.toLowerCase() === "lum") - Number(left.id.toLowerCase() === "lum"));
}
