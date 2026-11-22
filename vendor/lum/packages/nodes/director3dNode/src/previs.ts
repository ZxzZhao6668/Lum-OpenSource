import { stageBakeMotionSignature } from "@lum/node-shared/stageBake";
import { z } from "@lum/nodes-scaffold/runtime";
import { CatmullRomCurve3, Euler, Quaternion, Vector3 } from "three";
import { cameraViewSchema, sceneSchema, type SceneDocument } from "./scene";
import { directorPlanSchema, type DirectorPlan } from "./sceneAnimation";
import { terrainSetSchema, type TerrainRequest } from "./previsTerrain";
import { cameraFollowSchema, cameraKeyframeSchema, sampleCameraView } from "./previsCamera";
import { isMocapKind, mocapKinds, sampleMocap } from "./previsMocap";
import { mannequinJoints } from "./mannequin";
import { actionProgress } from "./previsClips";

const vector = sceneSchema.shape.objectList.element.shape.position;
const timing = { start: z.number().min(0).max(300), duration: z.number().min(0.2).max(300) };
export const actionKinds = ["stand", "walk", "turn", "lookBack", "gesture", ...mocapKinds] as const;
const pathSchema = z.strictObject({ id: z.string().min(1), objectId: z.string().optional(), cameraId: z.string().optional(), points: z.array(vector).min(2).max(60), locked: z.boolean().optional(), smoothing: z.number().min(0).max(1).optional(), orientation: z.enum(["along", "fixed"]).optional(), lookAt: vector.optional(), ...timing });
const actionSchema = z.strictObject({ id: z.string().min(1), objectId: z.string().min(1), kind: z.enum(actionKinds), sourceRange: z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]).refine(range=>range[1]>range[0],"动作源范围必须递增").optional(), ...timing });
export const previsStateSchema = z.strictObject({
  version: z.literal(1),
  cameras: z.array(z.strictObject({ id: z.string().min(1), name: z.string().min(1).max(100), view: cameraViewSchema, locked: z.boolean().optional(), targetId: z.string().optional(), follow: cameraFollowSchema.optional(), keyframes:z.array(cameraKeyframeSchema).min(1).max(60).optional() })).min(1).max(30),
  shots: z.array(z.strictObject({ id: z.string().min(1), cameraId: z.string().min(1), start: timing.start })).min(1).max(60),
  paths: z.array(pathSchema).max(60),
  actions: z.array(actionSchema).max(60),
  shotOverrides: z.array(z.strictObject({ shotId: z.string(), object: sceneSchema.shape.objectList.element, tracks: directorPlanSchema.shape.tracks, baseTracks: directorPlanSchema.shape.tracks.optional(), paths: z.array(pathSchema).optional(), actions: z.array(actionSchema).optional() })).max(60).optional(),
  cameraEdited: z.boolean(),
  basePlan: directorPlanSchema.optional(),
  terrainSets: z.array(terrainSetSchema).max(8).optional(),
});
export type PrevisState = z.infer<typeof previsStateSchema>;
export const previsSnapshotSchema = z.strictObject({ scene: sceneSchema, plan: directorPlanSchema, state: previsStateSchema });
export type PrevisSnapshot = z.infer<typeof previsSnapshotSchema>;
export interface PrevisAiRequest { snapshot: PrevisSnapshot; instruction: string; scenario?: boolean; objectId?: string; cameraId?: string; time: number; scope?: "shot" | "scene"; shotId?: string; start?: number; end?: number; readOnly?: boolean; lookReference?: import("./previsTerrain").TerrainReference; signal?: AbortSignal; terrain?: TerrainRequest }
export function normalizePrevisSnapshot(value: { scene: SceneDocument; plan: DirectorPlan; state?: unknown }): PrevisSnapshot {
  const scene = sceneSchema.parse(value.scene);
  const plan = directorPlanSchema.parse(value.plan);
  // 老工程没有机位 metadata 时保留原运镜，直到用户明确编辑机位或剪辑。
  const legacyFrames = plan.cameraFrames.filter((_, index) => index % Math.ceil(plan.cameraFrames.length / 30) === 0);
  const cameras = legacyFrames.map((frame, index) => ({ id: `legacyCamera${index}`, name: `机位 ${index + 1}`, view: frame.view }));
  const state = previsStateSchema.parse(value.state ?? { version: 1, cameras, shots: cameras.map((camera, index) => ({ id: `legacyShot${index}`, cameraId: camera.id, start: legacyFrames[index]!.time })).filter(shot => shot.start < plan.duration), paths: [], actions: [], cameraEdited: false, basePlan: plan });
  state.basePlan ??= structuredClone(plan);
  const cameraIds = new Set(state.cameras.map(camera => camera.id));
  const objectIds = new Set(scene.objectList.map(object => object.threeJsonId));
  for (const object of scene.objectList) if (object.attachment) {
    if (state.paths.some(path => path.objectId === object.threeJsonId) || plan.tracks.some(track => track.objectId === object.threeJsonId) || state.basePlan?.tracks.some(track => track.objectId === object.threeJsonId)) throw new Error("已挂接的道具随人物手部运动，请先移除道具的独立路线和轨道");
    // ACT: 首版挂接以整场为单位，防止镜头覆盖复制人物后道具仍跟随被隐藏的原人物。
    if (state.shotOverrides?.some(entry => [object.threeJsonId,object.attachment!.objectId].includes(entry.object.threeJsonId))) throw new Error("持物人物与道具请使用整场编辑；先移除其当前镜头覆盖再挂接");
  }
  const terrainIds = (state.terrainSets ?? []).flatMap(entry => entry.objectIds);
  if (new Set((state.terrainSets ?? []).map(entry => entry.id)).size !== (state.terrainSets?.length ?? 0) || new Set(terrainIds).size !== terrainIds.length || terrainIds.some(id => !objectIds.has(id))) throw new Error("场地来源记录重复或引用了不存在的部件");
  if (cameraIds.size !== state.cameras.length || new Set(state.shots.map(shot => shot.id)).size !== state.shots.length || new Set(state.paths.map(path => path.id)).size !== state.paths.length || new Set(state.actions.map(action => action.id)).size !== state.actions.length) throw new Error("预演 ID 重复");
  const shots = [...state.shots].sort((a, b) => a.start - b.start);
  if (shots[0]?.start !== 0 || shots.some((shot, index) => !cameraIds.has(shot.cameraId) || shot.start >= plan.duration || (index > 0 && shot.start === shots[index - 1]!.start))) throw new Error("镜头必须从 0 开始、时间不能重复且需要有效机位");
  for (const path of state.paths) {
    if (!!path.objectId === !!path.cameraId || (path.objectId && !objectIds.has(path.objectId)) || (path.cameraId && !cameraIds.has(path.cameraId)) || path.start + path.duration > plan.duration) throw new Error("路线对象或时间范围无效");
  }
  for (const camera of state.cameras) if (camera.targetId && !objectIds.has(camera.targetId)) throw new Error("机位跟随目标不存在");
  for (const camera of state.cameras) if (camera.keyframes?.length) {
    if (camera.follow || state.paths.some(path=>path.cameraId===camera.id)) throw new Error("关键帧运镜与跟拍或路线互斥，请先转换或清除当前运镜");
    if (camera.keyframes.some((frame,index)=>frame.time>plan.duration || (index>0 && frame.time<=camera.keyframes![index-1]!.time))) throw new Error("机位关键帧时间需要递增、不能重复或超出片场时长");
  }
  for (const camera of state.cameras) if (camera.follow) {
    if (!scene.objectList.some(object => object.threeJsonId === camera.targetId && object.objType === "mannequin")) throw new Error("人物跟拍需要选择有效的人物目标");
    if (state.paths.some(path => path.cameraId === camera.id)) throw new Error("跟拍与固定运镜路线不能同时启用，请先切换模式");
  }
  for (const action of state.actions) if (!scene.objectList.some(object => object.threeJsonId === action.objectId && object.objType === "mannequin") || action.start + action.duration > plan.duration) throw new Error("动作需要人偶和有效时间范围");
  for (const list of [state.paths.map(path => ({ ...path, owner: path.objectId ?? path.cameraId })), state.actions.map(action => ({ ...action, owner: action.objectId }))]) {
    const ordered = [...list].sort((a, b) => a.start - b.start);
    if (ordered.some((entry, index) => ordered.slice(0, index).some(previous => previous.owner === entry.owner && previous.start + previous.duration > entry.start + 1e-8))) throw new Error("同一对象的路线或动作片段不能重叠");
  }
  return { scene, plan, state };
}

// ACT: 首版使用按弧长匀速的折线路径，不自动平滑穿墙；前端与 Blender 共用烘焙轨道。
export function samplePrevisPath(path: PrevisState["paths"][number], time: number) {
  let points = path.points.map(point => new Vector3(point.x, point.y, point.z));
  if (path.smoothing) points = new CatmullRomCurve3(points, false, "catmullrom", path.smoothing).getPoints(120);
  const lengths = points.slice(1).map((point, index) => point.distanceTo(points[index]!));
  let distance = lengths.reduce((sum, length) => sum + length, 0) * Math.min(1, Math.max(0, (time - path.start) / path.duration));
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (distance <= length || index === lengths.length - 1) {
      const direction = points[index + 1]!.clone().sub(points[index]!);
      const position = points[index]!.clone().lerp(points[index + 1]!, length ? distance / length : 0);
      return { position: { x: position.x, y: position.y, z: position.z }, yaw: Math.atan2(direction.x, direction.z) };
    }
    distance -= length;
  }
  return { position: path.points[0]!, yaw: 0 };
}

function budgetTimes(candidates:number[],required:number[]) {
  const chosen=new Set(required);if(chosen.size>120)throw new Error("片段边界和原有关键帧超过单轨120帧，请减少片段或拆成多个胶卷");
  const rest=[...new Set(candidates)].filter(time=>!chosen.has(time)).sort((a,b)=>a-b),count=Math.min(120-chosen.size,rest.length);
  for(let index=0;index<count;index++)chosen.add(rest[Math.floor(index*rest.length/count)]!);
  return [...chosen].sort((a,b)=>a-b);
}

export function compilePrevisPlan(input: PrevisSnapshot): DirectorPlan {
  const { scene, plan, state } = normalizePrevisSnapshot(input);
  const result: DirectorPlan = structuredClone(state.basePlan ?? plan);
  result.duration = plan.duration;
  result.name = plan.name;
  const zero = () => ({ x: 0, y: 0, z: 0 });
  const times = new Set([0, plan.duration]);
  const boundaries = new Set([0,plan.duration]);
  // 镜头覆盖会在根轨添加可见性切点，先为这些帧预留预算，避免后续遮罩超过120帧。
  for(const shot of state.shots){boundaries.add(shot.start);if(shot.start>.001)boundaries.add(shot.start-.001);}
  for (const item of [...state.paths, ...state.actions]) {
    boundaries.add(item.start); boundaries.add(item.start + item.duration);
    if (item.start + item.duration + .001 < plan.duration) boundaries.add(item.start + item.duration + .001);
    if (item.start > 0.001) boundaries.add(item.start - 0.001);
    const samples = Math.min(96, Math.max(2, Math.ceil(item.duration * 12)));
    for (let index = 1; index < samples; index++) times.add(item.start + item.duration * index / samples);
  }
  const sampleTimes = budgetTimes([...times], [...boundaries]);
  const controlled = new Set([...state.paths.flatMap(path => path.objectId ? [path.objectId] : []), ...state.actions.map(action => action.objectId)]);
  for (const id of controlled) {
    const object = scene.objectList.find(object => object.threeJsonId === id)!;
    const paths = state.paths.filter(path => path.objectId === id).sort((a, b) => a.start - b.start);
    const actions = state.actions.filter(action => action.objectId === id).sort((a, b) => a.start - b.start);
    const baseTracks = result.tracks.filter(track => track.objectId === id);
    const sampleBase = (time: number, joint?: DirectorPlan["tracks"][number]["joint"]) => {
      const track = baseTracks.find(track => track.joint === joint);
      const fallback = joint ? { time, rotation: object.pose?.[joint] ?? zero() } : { time, position: object.position, rotation: { x: object.rotation?.rotationX ?? 0, y: object.rotation?.rotationY ?? 0, z: object.rotation?.rotationZ ?? 0 }, scale: { x: object.scale?.scaleX ?? 1, y: object.scale?.scaleY ?? 1, z: object.scale?.scaleZ ?? 1 } };
      if (!track) return fallback;
      const a = track.frames.findLast(frame => frame.time <= time) ?? track.frames[0]!;
      const b = track.frames.find(frame => frame.time > time) ?? a;
      const alpha = a === b ? 0 : (time - a.time) / (b.time - a.time);
      const q = (v: typeof a.rotation) => new Quaternion().setFromEuler(new Euler(v.x, v.y, v.z));
      const e = new Euler().setFromQuaternion(q(a.rotation).slerp(q(b.rotation), alpha));
      const blend = (key: "position" | "scale") => { const first = a[key] ?? fallback[key as keyof typeof fallback]; const last = b[key] ?? fallback[key as keyof typeof fallback]; return first && typeof first === "object" && last && typeof last === "object" ? { x: first.x + (last.x-first.x)*alpha, y: first.y + (last.y-first.y)*alpha, z: first.z + (last.z-first.z)*alpha } : undefined; };
      return { time, rotation: { x: e.x, y: e.y, z: e.z }, ...(joint ? {} : { position: blend("position"), scale: blend("scale") }) };
    };
    const objectTimes = budgetTimes(sampleTimes,[...boundaries,...baseTracks.flatMap(track=>track.frames.map(frame=>frame.time))]);
    const hasMocap=actions.some(action=>isMocapKind(action.kind));
    const joints: readonly typeof mannequinJoints[number][] = hasMocap ? mannequinJoints : ["leftHip", "rightHip", "leftKnee", "rightKnee", "leftShoulder", "rightShoulder", "head"];
    result.tracks = result.tracks.filter(track => track.objectId !== id || (track.joint ? !actions.length || !joints.includes(track.joint as typeof joints[number]) : !paths.length && !hasMocap && !actions.some(action => action.kind === "turn")));
    const rotation = { x: object.rotation?.rotationX ?? 0, y: object.rotation?.rotationY ?? 0, z: object.rotation?.rotationZ ?? 0 };
    if (paths.length || hasMocap || actions.some(action => action.kind === "turn")) result.tracks.push({ objectId: id, frames: objectTimes.map(time => {
      const base = sampleBase(time);
      const path = paths.findLast(path => time >= path.start);
      const pose = path ? samplePrevisPath(path, time) : { position: base.position ?? object.position, yaw: base.rotation.y };
      let yaw = path?.orientation === "fixed" ? base.rotation.y : pose.yaw;
      for (const action of actions) if (action.kind === "turn" && time >= action.start) yaw += Math.PI * actionProgress(action,time).turn;
      const mocap=actions.find(action=>isMocapKind(action.kind)&&time>=action.start&&time<=action.start+action.duration);
      const position={...pose.position};if(mocap&&isMocapKind(mocap.kind)){const {progress,envelope}=actionProgress(mocap,time);position.y+=sampleMocap(mocap.kind,progress).rootY*envelope;}
      return { ...base, time, position, rotation: { ...base.rotation, y: yaw } };
    }) });
    if (!actions.length) continue;
    for (const joint of joints) {
      result.tracks.push({ objectId: id, joint, frames: objectTimes.map(time => {
        const rotation = { ...sampleBase(time, joint).rotation };
        const action = actions.find(action => time >= action.start && time <= action.start + action.duration);
        if (action) {
          const {progress,envelope,elapsed}=actionProgress(action,time);
          if(isMocapKind(action.kind)){
            const pose=sampleMocap(action.kind,progress,joint).rotation;
            const blended=new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(rotation.x,rotation.y,rotation.z)).slerp(new Quaternion().setFromEuler(new Euler(pose.x,pose.y,pose.z)),envelope));
            rotation.x=blended.x;rotation.y=blended.y;rotation.z=blended.z;
          }
          if (action.kind === "walk") {
            const path = paths.find(path => time >= path.start && time < path.start + path.duration);
            const speed = path ? new Vector3().copy(samplePrevisPath(path, Math.min(path.start + path.duration, time + .01)).position).distanceTo(new Vector3().copy(samplePrevisPath(path, Math.max(path.start, time - .01)).position)) / (Math.min(path.start + path.duration, time + .01) - Math.max(path.start, time - .01)) : paths.length ? 0 : 1;
            const swing = Math.sin(elapsed * speed * Math.PI * 2) * envelope;
            if (joint.includes("Hip")) rotation.x += swing * (joint.startsWith("left") ? 0.55 : -0.55);
            if (joint.includes("Knee")) rotation.x += Math.max(0, swing * (joint.startsWith("left") ? -1 : 1)) * 0.65;
            if (joint.includes("Shoulder")) rotation.x += swing * (joint.startsWith("left") ? -0.3 : 0.3);
          }
          if (action.kind === "lookBack" && joint === "head") rotation.y += Math.sin(progress * Math.PI) * 1.4;
          if (action.kind === "gesture" && joint === "rightShoulder") rotation.z -= Math.sin(progress * Math.PI) * 1.8;
        }
        return { time, rotation };
      }) });
    }
  }
  if (state.cameraEdited || state.cameras.some(camera=>camera.keyframes?.length)) {
    const cameraTimes = new Set([0, ...state.shots.map(shot => shot.start)]);
    const keyTimes = state.cameras.flatMap(camera=>(camera.keyframes ?? []).flatMap(frame=>frame.easing==="cut" && frame.time>.001 ? [frame.time-.001,frame.time] : [frame.time]));
    keyTimes.forEach(time=>cameraTimes.add(time));
    if (keyTimes.length) for (let index=0;index<=90;index++) cameraTimes.add(plan.duration*index/90);
    state.shots.filter(shot=>shot.start>.001).forEach(shot=>cameraTimes.add(shot.start-.001));
    if (state.cameras.some(camera => camera.follow)) for(let index=0; index<=60; index++) cameraTimes.add(plan.duration*index/60);
    if (state.paths.some(path => path.cameraId) || state.cameras.some(camera => camera.targetId)) sampleTimes.forEach(time => cameraTimes.add(time));
    for (const camera of state.cameras) if (camera.targetId) result.tracks.find(track => track.objectId === camera.targetId && !track.joint)?.frames.forEach(frame => cameraTimes.add(frame.time));
    for (const override of state.shotOverrides ?? []) override.tracks.forEach(track => track.frames.forEach(frame => cameraTimes.add(frame.time)));
    result.cameraFrames = budgetTimes([...cameraTimes,plan.duration],[0,plan.duration,...keyTimes,...state.shots.flatMap(shot=>shot.start>.001?[shot.start-.001,shot.start]:[shot.start])]).map(time => {
      const shot = [...state.shots].sort((a, b) => a.start - b.start).findLast(shot => shot.start <= time)!;
      const view = sampleCameraView({scene,plan,state},result,shot.cameraId,time,samplePrevisPath);
      return { time, view, easing: state.shots.some(shot => shot.start === time) ? "cut" as const : "linear" as const };
    });
  }
  for (const override of state.shotOverrides ?? []) {
    const shots = [...state.shots].sort((a,b) => a.start-b.start);
    const index = shots.findIndex(shot => shot.id === override.shotId);
    if (index < 0) continue;
    const start = shots[index]!.start, end = shots[index+1]?.start ?? plan.duration;
    const original = scene.objectList.find(object => object.threeJsonId === override.object.threeJsonId)!;
    const id = overrideInstanceId(override.shotId, original.threeJsonId);
    const baseRoot = result.tracks.find(track => track.objectId === original.threeJsonId && !track.joint);
    const rotation = { x: original.rotation?.rotationX ?? 0, y: original.rotation?.rotationY ?? 0, z: original.rotation?.rotationZ ?? 0 };
    const scale = { x: original.scale?.scaleX ?? 1, y: original.scale?.scaleY ?? 1, z: original.scale?.scaleZ ?? 1 };
    const root = baseRoot ?? { objectId: original.threeJsonId, frames: [{ time: 0, rotation, position: original.position, scale }, { time: plan.duration, rotation, position: original.position, scale }] };
    if (!baseRoot) result.tracks.push(root);
    const mask = (track: typeof root, visibleInside: boolean, fallback: typeof scale, initialPosition: typeof original.position) => {
      const originalFrames = structuredClone(track.frames);
      const times = [...new Set([...originalFrames.map(frame => frame.time), 0, plan.duration, start, end, ...(start > 0 ? [Math.max(0,start-.001)] : []), ...(end < plan.duration ? [Math.max(start,end-.001)] : [])])].sort((a,b) => a-b);
      track.frames = times.map(time => {
        const a = originalFrames.findLast(frame => frame.time <= time) ?? originalFrames[0]!;
        const b = originalFrames.find(frame => frame.time > time) ?? a;
        const alpha = a === b ? 0 : (time-a.time)/(b.time-a.time);
        const lerp = (a: typeof scale, b: typeof scale) => ({x:a.x+(b.x-a.x)*alpha,y:a.y+(b.y-a.y)*alpha,z:a.z+(b.z-a.z)*alpha});
        const qa = new Quaternion().setFromEuler(new Euler(a.rotation.x,a.rotation.y,a.rotation.z)), qb = new Quaternion().setFromEuler(new Euler(b.rotation.x,b.rotation.y,b.rotation.z));
        const e = new Euler().setFromQuaternion(qa.slerp(qb,alpha));
        const visible = (time >= start && time < end) === visibleInside;
        return { time, position: lerp(a.position ?? initialPosition,b.position ?? initialPosition), rotation: {x:e.x,y:e.y,z:e.z}, scale: visible ? lerp(a.scale ?? fallback,b.scale ?? fallback) : zero() };
      });
    };
    mask(root,false,scale,original.position);
    const tracks = structuredClone(override.tracks).map(track => ({...track,objectId:id}));
    let replacementRoot = tracks.find(track => !track.joint);
    if (!replacementRoot) { replacementRoot = {objectId:id,frames:[{time:0,position:override.object.position,rotation:{x:override.object.rotation?.rotationX??0,y:override.object.rotation?.rotationY??0,z:override.object.rotation?.rotationZ??0}},{time:plan.duration,position:override.object.position,rotation:{x:override.object.rotation?.rotationX??0,y:override.object.rotation?.rotationY??0,z:override.object.rotation?.rotationZ??0}}]}; tracks.push(replacementRoot); }
    mask(replacementRoot,true,{x:override.object.scale?.scaleX??1,y:override.object.scale?.scaleY??1,z:override.object.scale?.scaleZ??1},override.object.position);
    result.tracks.push(...tracks);
  }
  return directorPlanSchema.parse(result);
}

export function overrideInstanceId(shotId: string, objectId: string) { return `shot${shotId.slice(0,32)}_${objectId.slice(0,60)}`; }
export function compilePrevisScene(snapshot: PrevisSnapshot): SceneDocument {
  const scene = structuredClone(snapshot.scene);
  for (const entry of snapshot.state.shotOverrides ?? []) if (snapshot.state.shots.some(shot => shot.id === entry.shotId)) scene.objectList.push({...structuredClone(entry.object), threeJsonId:overrideInstanceId(entry.shotId,entry.object.threeJsonId)});
  return sceneSchema.parse(scene);
}

export function applyPrevisCameraPath(view: PrevisState["cameras"][number]["view"], path: PrevisState["paths"][number], time: number) {
  const pose = samplePrevisPath(path,time);
  const offset = new Vector3().copy(view.controls.target).sub(new Vector3().copy(view.camera.position));
  view.camera.position = pose.position;
  view.controls.target = path.orientation === "fixed" ? {x:pose.position.x+offset.x,y:pose.position.y+offset.y,z:pose.position.z+offset.z} : {x:pose.position.x+Math.sin(pose.yaw),y:pose.position.y,z:pose.position.z+Math.cos(pose.yaw)};
  if(path.lookAt) view.controls.target={...path.lookAt};
}
