import { z } from "@lum/nodes-scaffold/runtime";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { PrevisSnapshot, PrevisState } from "./previs";
import type { DirectorPlan } from "./sceneAnimation";
import { cameraViewSchema, type CameraView } from "./scene";

export const cameraKeyframeSchema = z.strictObject({ time:z.number().min(0).max(300),view:cameraViewSchema,easing:z.enum(["linear","smooth","cut"]) });
export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;
export function recordCameraKeyframe(camera: PrevisState["cameras"][number], time: number, view: CameraView) {
  time = Math.round(time*1000)/1000;
  const previous = camera.keyframes?.find(frame => Math.abs(frame.time-time)<.001);
  camera.keyframes = [...(camera.keyframes ?? []).filter(frame => frame !== previous),cameraKeyframeSchema.parse({time,view,easing:previous?.easing ?? "smooth"})].sort((a,b)=>a.time-b.time);
}
function sampleCameraKeys(frames: CameraKeyframe[], time: number): CameraView {
  const a = frames.findLast(frame=>frame.time<=time) ?? frames[0]!;
  const b = frames.find(frame=>frame.time>time) ?? a;
  let t = a===b ? 0 : Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
  if (b.easing === "cut") t=0;
  else if (b.easing === "smooth") t=t*t*(3-2*t);
  const position = new Vector3().copy(a.view.camera.position).lerp(b.view.camera.position,t);
  const rotation = (view:CameraView) => new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3().copy(view.camera.position),new Vector3().copy(view.controls.target),new Vector3(0,1,0)));
  const orientation = rotation(a.view).slerp(rotation(b.view),t);
  const distance = (view:CameraView) => new Vector3().copy(view.camera.position).distanceTo(view.controls.target);
  const target = new Vector3(0,0,-1).applyQuaternion(orientation).multiplyScalar(distance(a.view)+(distance(b.view)-distance(a.view))*t).add(position);
  const view = cameraViewSchema.parse(a.view);
  view.camera.position={x:position.x,y:position.y,z:position.z}; view.controls.target={x:target.x,y:target.y,z:target.z};
  for (const field of ["fov","near","far"] as const) view.camera[field]=a.view.camera[field]+(b.view.camera[field]-a.view.camera[field])*t;
  return view;
}

export function moveCameraView(view: CameraView, right: number, up: number, forward: number, keepTarget = false) {
  const position = new Vector3().copy(view.camera.position);
  const direction = new Vector3().copy(view.controls.target).sub(position).normalize();
  const horizontal = new Vector3(-direction.z, 0, direction.x).normalize();
  const delta = horizontal.multiplyScalar(right).add(new Vector3(0, up, 0)).addScaledVector(direction, forward);
  const next = position.add(delta);
  if ([next.x, next.y, next.z].some(value => !Number.isFinite(value) || Math.abs(value) > 9000)) return;
  view.camera.position = { x: next.x, y: next.y, z: next.z };
  if (!keepTarget) {
    const target = new Vector3().copy(view.controls.target).add(delta);
    view.controls.target = { x: target.x, y: target.y, z: target.z };
  }
}

export function turnCameraView(view: CameraView, dx: number, dy: number) {
  const position = new Vector3().copy(view.camera.position);
  const direction = new Vector3().copy(view.controls.target).sub(position);
  const distance = Math.max(1, direction.length()); direction.normalize();
  const yaw = Math.atan2(direction.x, direction.z) - dx * .004;
  const pitch = Math.max(-Math.PI / 2 + .02, Math.min(Math.PI / 2 - .02, Math.asin(Math.max(-1, Math.min(1, direction.y))) - dy * .004));
  const target = position.add(new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance));
  view.controls.target = { x: target.x, y: target.y, z: target.z };
}

export function applyManualCameraView(snapshot: PrevisSnapshot, cameraId: string, time: number, view: CameraView, rotated: boolean, samplePath: Parameters<typeof sampleCameraView>[4]) {
  const camera = snapshot.state.cameras.find(item => item.id === cameraId);
  if (!camera) throw new Error("所选机位已不存在");
  const paths = snapshot.state.paths.filter(path => path.cameraId === cameraId);
  if (camera.locked || paths.some(path => path.locked)) throw new Error("机位或运镜路线已锁定，请先解锁");
  const previous = sampleCameraView(snapshot, snapshot.plan, cameraId, time, samplePath);
  const delta = new Vector3().copy(view.camera.position).sub(new Vector3().copy(previous.camera.position));
  camera.view = cameraViewSchema.parse(view);
  if (camera.keyframes?.length) {
    recordCameraKeyframe(camera,time,view);
    if (rotated) delete camera.targetId;
    snapshot.state.cameraEdited=true;
    return;
  }
  delete camera.follow;
  if (rotated) delete camera.targetId;
  for (const path of paths) {
    for (const point of path.points) { point.x += delta.x; point.y += delta.y; point.z += delta.z; }
    if (rotated) { path.orientation = "fixed"; delete path.lookAt; }
    else if (path.lookAt) { path.lookAt.x += delta.x; path.lookAt.y += delta.y; path.lookAt.z += delta.z; }
  }
  snapshot.state.cameraEdited = true;
}

export const cameraFollowSchema = z.strictObject({ mode: z.enum(["front", "back", "left", "right"]), distance: z.number().min(.5).max(100), height: z.number().min(.1).max(50) });
export const cameraPresetNames = { push: "推近", pull: "拉远", truckLeft: "向左横移", truckRight: "向右横移", rise: "升高", descend: "降低", orbitRight: "顺时针环绕", orbitLeft: "逆时针环绕" } as const;
export type CameraPreset = keyof typeof cameraPresetNames;

export function sampleObjectTransform(snapshot: PrevisSnapshot, plan: DirectorPlan, objectId: string, time: number) {
  const shot = [...snapshot.state.shots].sort((a,b) => a.start-b.start).findLast(shot => shot.start <= time);
  const override = snapshot.state.shotOverrides?.find(entry => entry.shotId === shot?.id && entry.object.threeJsonId === objectId);
  const object = override?.object ?? snapshot.scene.objectList.find(object => object.threeJsonId === objectId);
  if (!object) throw new Error("跟拍目标已不存在，请重新选择人物");
  const track = (override?.tracks ?? plan.tracks).find(track => track.objectId === objectId && !track.joint);
  const a = track?.frames.findLast(frame => frame.time <= time) ?? track?.frames[0];
  const b = track?.frames.find(frame => frame.time > time) ?? a;
  const progress = a && b && a !== b ? (time-a.time)/(b.time-a.time) : 0;
  const baseRotation = {x:object.rotation?.rotationX??0,y:object.rotation?.rotationY??0,z:object.rotation?.rotationZ??0};
  const first = a?.rotation ?? baseRotation, last = b?.rotation ?? first;
  const rotation = new Quaternion().setFromEuler(new Euler(first.x,first.y,first.z)).slerp(new Quaternion().setFromEuler(new Euler(last.x,last.y,last.z)),progress);
  const direction = new Vector3(0,0,1).applyQuaternion(rotation);
  return { position: new Vector3().copy(a?.position ?? object.position).lerp(new Vector3().copy(b?.position ?? a?.position ?? object.position),progress), yaw: Math.atan2(direction.x,direction.z) };
}

// 共用于时间线编译、静止监看和机位图标。跟拍随根节点走位/朝向变化，仰视点固定在人身上方1米。
export function sampleCameraView(snapshot: PrevisSnapshot, plan: DirectorPlan, cameraId: string, time: number, samplePath: (path: PrevisState["paths"][number], time: number) => { position: {x:number;y:number;z:number}; yaw: number }) {
  const camera = snapshot.state.cameras.find(camera => camera.id === cameraId);
  if (!camera) throw new Error("所选机位已不存在");
  const view = camera.keyframes?.length ? sampleCameraKeys(camera.keyframes,time) : cameraViewSchema.parse(camera.view);
  if (camera.follow && !camera.targetId) throw new Error("跟拍模式需要先选择人物");
  const target = camera.targetId ? sampleObjectTransform(snapshot,plan,camera.targetId,time) : undefined;
  if (camera.follow && target) {
    const angles = {front:0,back:Math.PI,left:Math.PI/2,right:-Math.PI/2};
    const angle = target.yaw + angles[camera.follow.mode];
    view.camera.position = {x:target.position.x+Math.sin(angle)*camera.follow.distance,y:target.position.y+camera.follow.height,z:target.position.z+Math.cos(angle)*camera.follow.distance};
  } else {
    const path = snapshot.state.paths.filter(path => path.cameraId === camera.id && time >= path.start).sort((a,b) => a.start-b.start).at(-1);
    if (path) {
      const pose = samplePath(path,time), offset = new Vector3().copy(view.controls.target).sub(new Vector3().copy(view.camera.position));
      view.camera.position = pose.position;
      view.controls.target = path.orientation === "fixed" ? {x:pose.position.x+offset.x,y:pose.position.y+offset.y,z:pose.position.z+offset.z} : {x:pose.position.x+Math.sin(pose.yaw),y:pose.position.y,z:pose.position.z+Math.cos(pose.yaw)};
      if(path.lookAt) view.controls.target={...path.lookAt};
    }
  }
  if (target) view.controls.target = {x:target.position.x,y:target.position.y+1,z:target.position.z};
  return view;
}

export function createCameraPreset(view: PrevisState["cameras"][number]["view"], cameraId: string, preset: CameraPreset, start: number, duration: number, amount: number): PrevisState["paths"][number] {
  if (!Object.hasOwn(cameraPresetNames,preset) || ![start,duration,amount].every(Number.isFinite) || start<0 || duration<.2 || amount<=0 || amount>(preset.startsWith("orbit")?360:100)) throw new Error("请设置有效的运镜开始时间、时长和幅度");
  const position = new Vector3().copy(view.camera.position), target = new Vector3().copy(view.controls.target);
  const forward = target.clone().sub(position); forward.y=0; if (forward.lengthSq()<.001) forward.set(0,0,-1); forward.normalize();
  const right = new Vector3(-forward.z,0,forward.x);
  const points = [position.clone()];
  if (preset.startsWith("orbit")) {
    const offset = position.clone().sub(target); if (Math.hypot(offset.x,offset.z)<.5) throw new Error("环绕机位距离目标过近，请先把相机移远");
    const angle = amount*Math.PI/180*(preset === "orbitRight" ? -1 : 1);
    for(let index=1; index<=24; index++) points.push(offset.clone().applyAxisAngle(new Vector3(0,1,0),angle*index/24).add(target));
  } else {
    const end = position.clone();
    if(preset === "push") end.addScaledVector(forward,Math.min(amount,Math.max(.1,position.distanceTo(target)-.5)));
    if(preset === "pull") end.addScaledVector(forward,-amount);
    if(preset === "truckLeft") end.addScaledVector(right,-amount);
    if(preset === "truckRight") end.addScaledVector(right,amount);
    if(preset === "rise") end.y+=amount;
    if(preset === "descend") end.y=Math.max(.1,end.y-amount);
    points.push(end);
  }
  return {id:crypto.randomUUID(),cameraId,start,duration,orientation:"fixed",smoothing:0,...(preset.startsWith("orbit")?{lookAt:{...view.controls.target}}:{}),points:points.map(point => ({x:point.x,y:point.y,z:point.z}))};
}
