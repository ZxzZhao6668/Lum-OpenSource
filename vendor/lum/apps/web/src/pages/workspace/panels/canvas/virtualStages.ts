import axios from "axios";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { createPrevisSnapshot } from "./previsMaterials";

export interface VirtualStageEntry { id: string; name: string; objectCount: number; duration: number; error?: string }
export function virtualStagePath(id: string) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) throw new Error("片场标识无效");
  return `virtualStages/${id}.json`;
}
export function isMissingStageDirectory(error: unknown) { return axios.isAxiosError(error) && error.response?.data?.data?.code === "ENOENT"; }
export async function listVirtualStages(directory: string): Promise<VirtualStageEntry[]> {
  const files = useWorkspaceFiles(directory);
  const listing = await files.list("virtualStages").catch(error => { if (isMissingStageDirectory(error)) return { entries: [] }; throw error; });
  const stages: VirtualStageEntry[] = [];
  for (const entry of listing.entries) {
    if (entry.type !== "file" || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.json$/i.test(entry.name)) continue;
    const id = entry.name.slice(0,-5), path = virtualStagePath(id);
    try {
    const value = JSON.parse(await files.readText(path, 8 * 1024 * 1024));
    const node = value?.nodes?.find((item: any) => item.type === "remote-director3dNode" && item.data?.virtualStage === true);
    if ((value?.lumCanvas !== true && value?.toonflowCanvas !== true) || !node || !/^[a-zA-Z0-9_-]{1,100}$/.test(node.id)) throw new Error(`片场文件格式无效：${entry.name}`);
    let model = node.data.modelSnapshot;
    if (node.data.modelPath === `assets/${node.id}/model.json`) model = JSON.parse(await files.readText(node.data.modelPath, 8 * 1024 * 1024));
    stages.push({ id, name: String(node.data.label || "未命名片场").slice(0,80), objectCount: Array.isArray(model?.scene?.objectList) ? model.scene.objectList.length : 0, duration: Number(model?.plans?.[0]?.duration) || 10 });
    } catch (cause) {
      stages.push({ id, name: `无法读取：${entry.name}`, objectCount: 0, duration: 0, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return stages;
}
export async function createVirtualStage(directory: string, name: string) {
  name = name.trim();
  if (!name || name.length > 80) throw new Error("片场名称需要 1～80 个字符");
  const files = useWorkspaceFiles(directory), id = crypto.randomUUID(), nodeId = crypto.randomUUID();
  await files.mkdir("virtualStages").catch(error => { if (!axios.isAxiosError(error) || error.response?.data?.data?.code !== "EEXIST") throw error; });
  const model = createPrevisSnapshot([],10);
  Object.assign(model.scene, { studio: { clayEnvironment: true, lighting: "daylight", renderer: "eevee" } });
  model.plans[0]!.name = name;
  await files.writeJson(virtualStagePath(id), { lumCanvas: true, nodes: [{ id: nodeId, type: "remote-director3dNode", position: { x: 80, y: 80 }, data: { label: name, virtualStage: true, modelSnapshot: model, selectedPlanId: model.plans[0]!.id } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true);
  return id;
}
