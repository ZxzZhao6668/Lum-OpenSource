import { isStageLibraryEntry, isStageLibraryModel, type StageLibraryEntry, type StageLibraryModel } from "@lum/node-shared/stageLibrary";
import type { SceneDocument } from "./scene";

async function libraryRequest(route: string, signal?: AbortSignal, model?: StageLibraryModel) {
  const response = await fetch(`/api/stageLibrary/${route}`, { signal, method: model ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-lum-workspace": "1" }, body: model ? JSON.stringify({ model }) : undefined });
  const result = await response.json();
  if (!response.ok || result.code !== 200) throw new Error(result.message || "本地模型库读取失败");
  return result.data;
}
export async function searchStageLibrary(query = "", category = "", offset = 0, signal?: AbortSignal) {
  const params = new URLSearchParams({ query, offset: String(offset), limit: "40" });
  if (category) params.set("category", category);
  const result = await libraryRequest(`list?${params}`, signal);
  if (!Array.isArray(result.items) || !result.items.every(isStageLibraryEntry) || !Number.isInteger(result.total)) throw new Error("本地模型索引无效");
  return result as { items: StageLibraryEntry[]; total: number; invalid: number; directory: string };
}
export async function readStageLibrary(id: string, signal?: AbortSignal) {
  const result = await libraryRequest(`read?${new URLSearchParams({ id })}`, signal);
  if (!isStageLibraryModel(result)) throw new Error("本地模型数据无效");
  return result;
}
export async function saveStageLibrary(model: StageLibraryModel, signal?: AbortSignal) {
  const result = await libraryRequest("save", signal, model);
  if (!isStageLibraryEntry(result)) throw new Error("保存后的模型索引无效");
  return result;
}
export function stageLibraryObject(model: StageLibraryModel): SceneDocument["objectList"][number] {
  return { threeJsonId: crypto.randomUUID(), name: model.name, objType: "mesh", meshParts: model.meshParts,
    librarySource: { id: model.id, name: model.name, source: model.source, license: model.license },
    stageRole: model.category === "道具" ? "prop" : "environment", geometry: {}, position: { x: 0, y: 0, z: 0 }, material: { type: "standard", color: "#ffffff", roughness: .85 } };
}
