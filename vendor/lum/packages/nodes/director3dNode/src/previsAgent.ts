import { z } from "@lum/nodes-scaffold/runtime";
import { normalizePrevisSnapshot, compilePrevisPlan, type PrevisSnapshot, type PrevisAiRequest } from "./previs";
const segment = z.union([z.string().max(100).refine(value => !["__proto__", "prototype", "constructor"].includes(value)), z.number().int().min(0).max(2000)]);
const operationSchema = z.object({ section: z.enum(["scene", "plan", "state"]), path: z.array(segment).min(1).max(20), op: z.enum(["add", "replace", "remove"]), value: z.json().optional() });
export const editSchema = z.object({ requestId: z.string().optional(), expectedRevision: z.number().int().nonnegative(), operations: z.array(operationSchema).min(1).max(100) });
export function applyPrevisEdits(base: PrevisSnapshot, operations: z.infer<typeof editSchema>["operations"]): PrevisSnapshot {
  if (JSON.stringify(operations).length > 1000000) throw new Error("AI修改指令过大，请分步修改");
  const draft = JSON.parse(JSON.stringify(base));
  if (operations.some(operation => operation.section === "plan")) draft.plan = structuredClone(base.state.basePlan ?? base.plan);
  for (const operation of operations) {
    if (operation.section === "state" && ["basePlan", "version"].includes(String(operation.path[0]))) throw new Error("请使用plan区修改基础轨道，不能修改状态版本");
    const keys = [...operation.path];
    const key = keys.pop()!;
    let target = draft[operation.section];
    for (const part of keys) {
      if (!target || typeof target !== "object" || !Object.hasOwn(target, part)) throw new Error("编辑路径不存在");
      target = target[part];
    }
    if (!target || typeof target !== "object") throw new Error("编辑路径无效");
    if (operation.op !== "remove" && !Object.hasOwn(operation, "value")) throw new Error("缺少编辑值");
    if (Array.isArray(target)) {
      const index = key === "-" ? target.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= target.length + Number(operation.op === "add")) throw new Error("数组编辑位置无效");
      if (operation.op === "remove") target.splice(index, 1);
      else if (operation.op === "add") target.splice(index, 0, operation.value);
      else target[index] = operation.value;
    } else {
      if (operation.op !== "add" && !Object.hasOwn(target, key)) throw new Error("编辑字段不存在");
      if (operation.op === "remove") delete target[key]; else target[key] = operation.value;
    }
  }
  if (operations.some(operation => operation.section === "plan")) draft.state.basePlan = { ...draft.plan, tracks: draft.plan.tracks.filter((track: { objectId: string }) => draft.scene.objectList.some((object: { threeJsonId: string }) => object.threeJsonId === track.objectId)) };
  // Local geometry is validated by sceneSchema's triangle/vertex budget; it is not AI text.
  if (JSON.stringify(draft, (key, value) => ["meshParts","bake"].includes(key) ? undefined : value).length > 1000000 || JSON.stringify(draft).length > 60000000) throw new Error("预演草稿过大，请简化模型或动画后重试");
  const result = normalizePrevisSnapshot(draft);
  // 镜头覆盖的 tracks 是动作/路线的派生数据，提交语义轨道后必须同步重编译。
  for (const entry of result.state.shotOverrides ?? []) {
    const previous=base.state.shotOverrides?.find(item=>item.shotId===entry.shotId&&item.object.threeJsonId===entry.object.threeJsonId);
    const motion=(item:typeof entry|undefined)=>JSON.stringify(item&&{actions:item.actions,paths:item.paths,baseTracks:item.baseTracks});
    if(motion(previous)===motion(entry))continue;
    const source=structuredClone(result);
    source.state.shotOverrides=source.state.shotOverrides?.filter(item=>item.object.threeJsonId!==entry.object.threeJsonId||item.shotId===entry.shotId);
    const materialized=materializePrevisObject(source,entry.shotId,entry.object.threeJsonId);
    entry.tracks=materialized.plan.tracks.filter(track=>track.objectId===entry.object.threeJsonId);
  }
  if (JSON.stringify(base.scene.studio?.bake) !== JSON.stringify(result.scene.studio?.bake)) throw new Error("AI 不得修改或删除烘焙缓存，请使用烘焙面板操作");
  validatePrevisLocks(base, result);
  result.plan = compilePrevisPlan(result);
  return result;
}
export function validatePrevisScope(base: PrevisSnapshot, next: PrevisSnapshot, request: PrevisAiRequest) {
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const { objectId, cameraId } = request;
  if (request.lookReference) {
    const protectedData = (snapshot: PrevisSnapshot) => {
      const copy = structuredClone(snapshot);
      copy.scene.sceneConfig.lights = [];
      if (copy.scene.studio) { delete copy.scene.studio.pbrRoughness; delete copy.scene.studio.pbrMetalness; copy.scene.studio.lighting = "daylight"; copy.scene.studio.renderer = "eevee"; }
      return copy;
    };
    if (!equal(protectedData(base),protectedData(next))) throw new Error("参考图匹配只能调整灯光与 PBR 参数，不能改变模型、人物、材质模式、烘焙缓存、机位或动画");
    return;
  }
  if (request.scenario) {
    const protectedData=(snapshot:PrevisSnapshot)=>({scene:snapshot.scene,terrainSets:snapshot.state.terrainSets,duration:snapshot.plan.duration,planName:snapshot.plan.name});
    if(!equal(protectedData(base),protectedData(next))) throw new Error("文案编排只能修改动作、路线、机位和切镜，不能改动原场地、人物资产或场次时长");
    for(const entry of next.state.shotOverrides??[]){
      const previous=base.state.shotOverrides?.find(item=>item.shotId===entry.shotId&&item.object.threeJsonId===entry.object.threeJsonId);
      const allowed=previous?[previous.object]:[base.scene.objectList.find(object=>object.threeJsonId===entry.object.threeJsonId),...(base.state.shotOverrides??[]).filter(item=>item.object.threeJsonId===entry.object.threeJsonId).map(item=>item.object)];
      if(!allowed.some(object=>equal(object,entry.object)))throw new Error("文案编排不能通过镜头覆盖修改原人物资产，请使用所选对象编辑");
    }
    return;
  }
  if (!objectId && !cameraId) return;
  if (objectId && !next.scene.objectList.some(object => object.threeJsonId === objectId)) throw new Error("原选中对象已删除");
  if (cameraId && !next.state.cameras.some(camera => camera.id === cameraId)) throw new Error("原选中机位已删除");
  const outside = (snapshot: PrevisSnapshot) => ({
    sceneConfig: snapshot.scene.sceneConfig,
    objects: snapshot.scene.objectList.filter(object => object.threeJsonId !== objectId),
    terrainSets: snapshot.state.terrainSets,
    tracks: (snapshot.state.basePlan ?? snapshot.plan).tracks.filter(track => track.objectId !== objectId),
    overrides: snapshot.state.shotOverrides?.filter(entry => entry.object.threeJsonId !== objectId),
    cameras: snapshot.state.cameras.filter(camera => camera.id !== cameraId),
    shots: snapshot.state.shots,
    paths: snapshot.state.paths.filter(path => !(objectId && path.objectId === objectId) && !(cameraId && path.cameraId === cameraId)),
    actions: snapshot.state.actions.filter(action => action.objectId !== objectId),
    duration: snapshot.plan.duration,
    cameraFrames: cameraId || snapshot.state.cameraEdited ? undefined : snapshot.state.basePlan?.cameraFrames,
  });
  if (!equal(outside(base), outside(next))) throw new Error("修改超出原选择范围：请只修改所选对象、机位及其路线/轨道");
}

export function validatePrevisLocks(base: PrevisSnapshot, next: PrevisSnapshot, allowUnlock = false) {
  for (const object of base.scene.objectList) {
    if (!object.locked) continue;
    const changed = next.scene.objectList.find(item => item.threeJsonId === object.threeJsonId);
    if (allowUnlock && changed && !changed.locked && JSON.stringify({ ...changed, locked: true }) === JSON.stringify(object)) continue;
    const related = (value: PrevisSnapshot) => JSON.stringify({
      paths: value.state.paths.filter(item => item.objectId === object.threeJsonId),
      actions: value.state.actions.filter(item => item.objectId === object.threeJsonId),
      overrides: value.state.shotOverrides?.filter(item => item.object.threeJsonId === object.threeJsonId),
      tracks: value.state.basePlan?.tracks.filter(item => item.objectId === object.threeJsonId),
    });
    if (JSON.stringify(object) !== JSON.stringify(changed) || related(base) !== related(next)) throw new Error(`「${object.name || object.threeJsonId}」已锁定，请先解锁`);
  }
  for (const override of base.state.shotOverrides ?? []) for (const path of override.paths ?? []) {
    if (!path.locked) continue;
    const changed = next.state.shotOverrides?.find(entry => entry.shotId === override.shotId && entry.object.threeJsonId === override.object.threeJsonId)?.paths?.find(entry => entry.id === path.id);
    if (allowUnlock && changed && !changed.locked && JSON.stringify({...changed,locked:true}) === JSON.stringify(path)) continue;
    if (JSON.stringify(path) !== JSON.stringify(changed)) throw new Error("当前镜头覆盖中的路线已锁定，请先解锁");
  }
  for (const key of ["cameras", "paths"] as const) for (const entry of base.state[key]) {
    if (!entry.locked) continue;
    const changed = next.state[key].find(item => item.id === entry.id);
    if (allowUnlock && changed && !changed.locked && JSON.stringify({ ...changed, locked: true }) === JSON.stringify(entry)) continue;
    if (key === "cameras" && JSON.stringify(base.state.paths.filter(path => path.cameraId === entry.id)) !== JSON.stringify(next.state.paths.filter(path => path.cameraId === entry.id))) throw new Error("锁定机位的路线不能修改");
    if (JSON.stringify(entry) !== JSON.stringify(changed)) throw new Error("已锁定的机位或路线不能修改；请先解锁");
  }
}

export function scopePrevisDraft(base: PrevisSnapshot, next: PrevisSnapshot, request: PrevisAiRequest): PrevisSnapshot {
  if (request.scope !== "shot" || !request.shotId) return next;
  const shot = base.state.shots.find(shot => shot.id === request.shotId);
  if (!shot || shot.start !== request.start || ([...base.state.shots].sort((a,b) => a.start-b.start).find(entry => entry.start > shot.start)?.start ?? base.plan.duration) !== request.end) throw new Error("原镜头范围已变化");
  const result = structuredClone(base);
  if (request.objectId) {
    const object = next.scene.objectList.find(object => object.threeJsonId === request.objectId)!;
    result.state.shotOverrides = [...(result.state.shotOverrides ?? []).filter(entry => !(entry.shotId === request.shotId && entry.object.threeJsonId === request.objectId)), { shotId: request.shotId, object: structuredClone(object), tracks: structuredClone(next.plan.tracks.filter(track => track.objectId === request.objectId)), baseTracks: structuredClone((next.state.basePlan ?? next.plan).tracks.filter(track => track.objectId === request.objectId)), paths: structuredClone(next.state.paths.filter(path => path.objectId === request.objectId)), actions: structuredClone(next.state.actions.filter(action => action.objectId === request.objectId)) }];
  } else if (request.cameraId) {
    const camera = structuredClone(next.state.cameras.find(camera => camera.id === request.cameraId)!);
    camera.id = `shotCamera${request.shotId}`;
    result.state.cameras = [...result.state.cameras.filter(entry => entry.id !== camera.id), camera];
    result.state.shots.find(entry => entry.id === request.shotId)!.cameraId = camera.id;
    result.state.paths = [...result.state.paths.filter(path => path.cameraId !== camera.id), ...next.state.paths.filter(path => path.cameraId === request.cameraId).map(path => ({ ...structuredClone(path), id: `${path.id}Shot${request.shotId}`, cameraId: camera.id }))];
    result.state.cameraEdited = true;
  }
  result.plan = compilePrevisPlan(result);
  return result;
}

export function materializePrevisObject(source: PrevisSnapshot, shotId?: string, objectId?: string): PrevisSnapshot {
  const draft = structuredClone(source);
  const override = draft.state.shotOverrides?.find(entry => entry.shotId === shotId && entry.object.threeJsonId === objectId);
  if (!override) return draft;
  draft.scene.objectList = draft.scene.objectList.map(object => object.threeJsonId === objectId ? structuredClone(override.object) : object);
  draft.state.basePlan!.tracks = [...draft.state.basePlan!.tracks.filter(track => track.objectId !== objectId), ...structuredClone(override.baseTracks ?? override.tracks)];
  draft.state.paths = [...draft.state.paths.filter(path => path.objectId !== objectId), ...structuredClone(override.paths ?? [])];
  draft.state.actions = [...draft.state.actions.filter(action => action.objectId !== objectId), ...structuredClone(override.actions ?? [])];
  draft.state.shotOverrides = draft.state.shotOverrides?.filter(entry => entry !== override);
  draft.plan = compilePrevisPlan(draft);
  return draft;
}
