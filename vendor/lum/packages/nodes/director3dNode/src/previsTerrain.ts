import { z } from "@lum/nodes-scaffold/runtime";
import { sceneSchema, type SceneDocument } from "./scene";
import type { PrevisSnapshot } from "./previs";
import { virtualStageAssets } from "@lum/node-shared/virtualStageAssets";
import type { StageLibraryModel } from "@lum/node-shared/stageLibrary";
import { stageLibraryObject } from "./stageLibrary";

const point = z.strictObject({ x: z.number().finite().min(-500).max(500), y: z.number().finite().min(-500).max(500), z: z.number().finite().min(-500).max(500) });
export const terrainReferenceSchema = z.strictObject({
  path: z.string().max(600).refine(value => /^assets\/.+\.(png|jpe?g|webp)$/i.test(value) && !value.includes("\\") && !value.split("/").some(part => ["", ".", ".."].includes(part)), "请选择工作区内的PNG、JPEG或WebP图片"),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), label: z.string().min(1).max(150), sourceKey: z.string().min(1).max(200).optional(),
});
export type TerrainReference = z.infer<typeof terrainReferenceSchema>;
export const terrainRequestSchema = z.strictObject({ reference: terrainReferenceSchema, width: z.number().min(3).max(200), maxParts: z.union([z.literal(24), z.literal(48), z.literal(80)]) });
export type TerrainRequest = z.infer<typeof terrainRequestSchema>;
export const terrainSetSchema = z.strictObject({
  id: z.string().min(1).max(70), reference: terrainReferenceSchema, width: z.number().min(3).max(200), depth: z.number().min(1).max(400),
  anchor: sceneSchema.shape.objectList.element.shape.position, objectIds: z.array(z.string().min(1).max(100)).min(2).max(81), summary: z.string().max(1500), assumptions: z.array(z.string().max(300)).max(10), observations: z.array(z.string().max(300)).min(1).max(12),
});
export type TerrainSet = z.infer<typeof terrainSetSchema>;
const size = z.strictObject({ x: z.number().min(0.02).max(400), y: z.number().min(0.02).max(400), z: z.number().min(0.02).max(400) });
export const terrainLayoutSchema = z.strictObject({
  depth: z.number().min(1).max(400).describe("场地前后深度，米；宽度由用户指定"),
  summary: z.string().min(1).max(1500).describe("描述图中空间如何对应生成的场地"),
  observations: z.array(z.string().min(1).max(300)).min(1).max(12).describe("实际查看图片后观察到的空间特征；看不到图片时不要调用此工具"),
  assumptions: z.array(z.string().min(1).max(300)).max(10).describe("图片未显示的区域、尺寸与高度估计"),
  objects: z.array(z.strictObject({
    name: z.string().min(1).max(80), shape: z.enum(["box", "sphere", "cylinder", "cone", "preset", "library"]),
    libraryId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/).optional().describe("shape=library 时使用 searchStageLibrary 返回的真实 id；只提交标识，不提交网格"),
    presetId: z.string().refine(id => virtualStageAssets.some(asset => asset.id === id)).optional().describe("shape=preset 时必填。stagePalaceWall宫墙、stageMoonGate月亮门、stagePlaneTree梧桐、stagePaving石板路、stageColumn廊柱、stageTable桌、stageChair椅"),
    size: size.describe("x宽、y高、z深；球体也按这三个维度缩放，圆柱/圆锥的轴沿y"),
    position: point.describe("基础几何体使用中心坐标，落地中心y为高度一半；preset使用底部坐标，落地y=0。场地中心x/z=0，单位米"),
    rotation: point.optional().describe("XYZ弧度，可用于旋转屋顶/山坡/道路；省略为0"),
  }).refine(part => (part.shape === "preset" ? !!part.presetId : !part.presetId) && (part.shape === "library" ? !!part.libraryId : !part.libraryId), "预设需要presetId，本地库需要libraryId，基础几何体不填写模型标识")).min(1).max(80).describe("只生成地形建筑，不生成图中的人物或摄影机；地面由宿主自动建立，不重复造整块地面"),
});
export const terrainSubmitSchema = z.strictObject({ requestId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), layout: terrainLayoutSchema });

export function terrainKey(reference: TerrainReference) { return reference.sourceKey ?? reference.path; }

export function terrainObjectReferences(snapshot: PrevisSnapshot) {
  return [...snapshot.plan.tracks.map(track => track.objectId), ...(snapshot.state.basePlan?.tracks.map(track => track.objectId) ?? []), ...snapshot.state.paths.flatMap(path => path.objectId ? [path.objectId] : []), ...snapshot.state.actions.map(action => action.objectId), ...snapshot.state.cameras.flatMap(camera => camera.targetId ? [camera.targetId] : []), ...(snapshot.state.shotOverrides?.flatMap(entry => [entry.object.threeJsonId, ...entry.tracks.map(track => track.objectId), ...(entry.baseTracks?.map(track => track.objectId) ?? []), ...(entry.paths?.flatMap(path => path.objectId ? [path.objectId] : []) ?? []), ...(entry.actions?.map(action => action.objectId) ?? [])]) ?? [])];
}

export function applyTerrainLayout(base: PrevisSnapshot, request: TerrainRequest, input: z.infer<typeof terrainLayoutSchema>, groupId: string, otherSnapshots: PrevisSnapshot[] = [], library = new Map<string, StageLibraryModel>()): PrevisSnapshot {
  const options = terrainRequestSchema.parse(request), layout = terrainLayoutSchema.parse(input);
  if (layout.objects.length > options.maxParts) throw new Error(`场地部件超过所选${options.maxParts}个上限，请精简后提交`);
  if (layout.depth > options.width * 3) throw new Error("场地深度超过宽度的3倍，请按参考图重新估计比例");
  const existing = base.state.terrainSets?.find(entry => terrainKey(entry.reference) === terrainKey(options.reference));
  const linked = base.scene.objectList.find(object => object.threeJsonId === options.reference.sourceKey);
  if (linked && linked.objType !== "plane" && !existing) throw new Error("所选图片关联的是人物或道具，请改选地点图片");
  const groundId = existing?.objectIds[0] ?? linked?.threeJsonId ?? `${groupId}:ground`;
  const ground = base.scene.objectList.find(object => object.threeJsonId === groundId);
  const anchor = ground?.position ?? existing?.anchor ?? { x: 0, y: -0.02, z: 0 };
  const owned = new Set(existing?.objectIds ?? (linked ? [linked.threeJsonId] : []));
  const material = { type: "standard" as const, color: "#c9cdd0", roughness: 0.85 };
  const objects: SceneDocument["objectList"] = [{ threeJsonId: groundId, name: (linked?.name ?? `${options.reference.label} · 地面`).slice(0,100), objType: "plane", geometry: { width: options.width, height: layout.depth }, position: { ...anchor }, rotation: { rotationX: -Math.PI / 2, rotationY: 0, rotationZ: 0 }, material: { ...material, color: "#b4b9bd" } }];
  for (const [index, part] of layout.objects.entries()) {
    if (Math.abs(part.position.x) > options.width || Math.abs(part.position.z) > layout.depth || part.position.y < -0.5 || part.position.y > options.width || Math.max(part.size.x, part.size.y, part.size.z) > Math.max(options.width, layout.depth) * 1.5) throw new Error(`部件“${part.name}”超出场地范围，请检查尺寸与中心坐标`);
    if (part.shape === "library") {
      const model = library.get(part.libraryId!);
      if (!model) throw new Error(`本地库未找到“${part.libraryId}”，请先检索真实模型`);
      const object = stageLibraryObject(model);
      object.threeJsonId = `${groupId}:part${index}`; object.name = part.name; object.stageRole = "environment";
      object.position = { x: anchor.x + part.position.x, y: anchor.y + part.position.y, z: anchor.z + part.position.z };
      object.rotation = { rotationX: part.rotation?.x ?? 0, rotationY: part.rotation?.y ?? 0, rotationZ: part.rotation?.z ?? 0 };
      object.scale = { scaleX: part.size.x / model.dimensions.x, scaleY: part.size.y / model.dimensions.y, scaleZ: part.size.z / model.dimensions.z };
      objects.push(object); continue;
    }
    if (part.shape === "preset") {
      const preset = virtualStageAssets.find(asset => asset.id === part.presetId)!;
      const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
      for (const mesh of preset.parts) mesh.positions.forEach((value,index) => { const axis = index % 3; min[axis] = Math.min(min[axis]!,value); max[axis] = Math.max(max[axis]!,value); });
      objects.push({ threeJsonId: `${groupId}:part${index}`, name: part.name, objType: "preset", presetId: part.presetId, stageRole: "environment", geometry: {},
        position: { x: anchor.x + part.position.x, y: anchor.y + part.position.y, z: anchor.z + part.position.z },
        rotation: { rotationX: part.rotation?.x ?? 0, rotationY: part.rotation?.y ?? 0, rotationZ: part.rotation?.z ?? 0 },
        scale: { scaleX: part.size.x / Math.max(.01,max[0]! - min[0]!), scaleY: part.size.y / Math.max(.01,max[1]! - min[1]!), scaleZ: part.size.z / Math.max(.01,max[2]! - min[2]!) }, material: { ...material },
      });
      continue;
    }
    const geometry: Record<string, number | boolean> = part.shape === "box" ? { width: part.size.x, height: part.size.y, depth: part.size.z }
      : part.shape === "sphere" ? { radius: 0.5, widthSegments: 16, heightSegments: 12 }
      : part.shape === "cylinder" ? { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 16 }
      : { radius: 0.5, height: 1, radialSegments: 16 };
    objects.push({ threeJsonId: `${groupId}:part${index}`, name: part.name, objType: part.shape, geometry,
      position: { x: anchor.x + part.position.x, y: anchor.y + part.position.y, z: anchor.z + part.position.z },
      rotation: { rotationX: part.rotation?.x ?? 0, rotationY: part.rotation?.y ?? 0, rotationZ: part.rotation?.z ?? 0 },
      ...(part.shape === "box" ? {} : { scale: { scaleX: part.size.x, scaleY: part.size.y, scaleZ: part.size.z } }), material: { ...material },
    });
  }
  for (const object of objects) object.stageRole = "environment";
  const ids = new Set(objects.map(object => object.threeJsonId));
  for (const object of base.scene.objectList) if (!owned.has(object.threeJsonId) && ids.has(object.threeJsonId)) throw new Error("场地部件ID与已有对象冲突，请重新生成");
  // 生成部件可能被用户做过动画或作为机位跟随目标，不能静默破坏这些引用。
  const removed = new Set([...owned].filter(id => !ids.has(id)));
  const used = [base, ...otherSnapshots].flatMap(terrainObjectReferences);
  if (used.some(id => removed.has(id))) throw new Error("旧场地部件仍被当前或其他方案的动画、路线、机位引用，请先解除相关引用再重新生成");
  if (used.some(id => owned.has(id) && (base.scene.objectList.find(object => object.threeJsonId === id)?.name !== objects.find(object => object.threeJsonId === id)?.name || base.scene.objectList.find(object => object.threeJsonId === id)?.objType !== objects.find(object => object.threeJsonId === id)?.objType))) throw new Error("重建会改变已被引用的场地部件，请保留原部件顺序、名称和类型，或先解除各方案中的动画和机位引用");
  if ((base.state.terrainSets ?? []).some(entry => entry !== existing && entry.objectIds.some(id => ids.has(id)))) throw new Error("该地点已被其他场地组使用");
  const next = structuredClone(base);
  next.scene.objectList = sceneSchema.shape.objectList.parse([...base.scene.objectList.filter(object => !owned.has(object.threeJsonId)), ...objects]);
  const set = terrainSetSchema.parse({ id: groupId, reference: options.reference, width: options.width, depth: layout.depth, anchor, objectIds: [...ids], summary: layout.summary, observations: layout.observations, assumptions: layout.assumptions });
  next.state.terrainSets = [...(next.state.terrainSets ?? []).filter(entry => entry.id !== existing?.id), set];
  if (next.state.terrainSets.length > 8) throw new Error("单个预演最多保存8组图片场地");
  return next;
}
