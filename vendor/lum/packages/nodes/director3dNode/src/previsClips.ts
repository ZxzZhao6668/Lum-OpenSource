import type { PrevisSnapshot, PrevisState } from "./previs";

type Action = PrevisState["actions"][number];
export type TimelineSelection = { kind: "shot"; id: string } | { kind: "action" | "path"; id: string; shotId: string };

export function actionProgress(action: Action, time: number) {
  const [start,end]=action.sourceRange ?? [0,1];
  const progress=start+(end-start)*Math.max(0,Math.min(1,(time-action.start)/action.duration));
  return {progress,elapsed:progress*action.duration/(end-start),turn:(progress-start),envelope:Math.min(1,progress*8,(1-progress)*8)};
}

export function splitAction(actions: Action[], id: string, time: number) {
  const action=actions.find(action=>action.id===id);
  if(!action)throw new Error("请先选择动作片段");
  const end=action.start+action.duration,left=time-action.start,right=end-time;
  if(!Number.isFinite(time)||left<.2-1e-8||right<.2-1e-8)throw new Error("播放头需在动作内部，分割后每段至少0.2秒");
  const [from,to]=action.sourceRange??[0,1],middle=actionProgress(action,time).progress;
  const next={...action,id:crypto.randomUUID(),start:time,duration:Math.max(.2,right),sourceRange:[middle,to] as [number,number]};
  action.duration=Math.max(.2,left);action.sourceRange=[from,middle];actions.push(next);
  return next.id;
}

export function splitShot(snapshot: PrevisSnapshot, id: string, time: number) {
  const shots=[...snapshot.state.shots].sort((a,b)=>a.start-b.start),index=shots.findIndex(shot=>shot.id===id),shot=shots[index];
  if(!shot)throw new Error("请先选择镜头片段");
  const end=shots[index+1]?.start??snapshot.plan.duration;
  if(!Number.isFinite(time)||time-shot.start<.1-1e-8||end-time<.1-1e-8)throw new Error("播放头需在镜头内部，分割后每段至少0.1秒");
  const next={...shot,id:crypto.randomUUID(),start:time};snapshot.state.shots.push(next);
  const overrides=snapshot.state.shotOverrides?.filter(entry=>entry.shotId===id)??[];
  if(overrides.length)snapshot.state.shotOverrides!.push(...structuredClone(overrides).map(entry=>({...entry,shotId:next.id})));
  snapshot.state.cameraEdited=true;
  return next.id;
}

export function deleteShot(snapshot: PrevisSnapshot, id: string) {
  if(!snapshot.state.shots.some(shot=>shot.id===id))throw new Error("所选镜头已不存在");
  if(snapshot.state.shots.length===1)throw new Error("时间线至少保留一个镜头，可先添加另一个镜头");
  snapshot.state.shots=snapshot.state.shots.filter(shot=>shot.id!==id).sort((a,b)=>a.start-b.start);
  snapshot.state.shots[0]!.start=0;
  snapshot.state.shotOverrides=snapshot.state.shotOverrides?.filter(entry=>entry.shotId!==id);
  snapshot.state.cameraEdited=true;
}
