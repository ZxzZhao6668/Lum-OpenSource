import { z } from "@lum/nodes-scaffold/runtime";
import { Euler, Quaternion } from "three";
import catalog from "./previsMotions.json";
import { mannequinJoints } from "./mannequin";

export const mocapKinds=["cmuWalk","cmuSlowWalk","cmuRun","cmuJump","cmuBoxing","cmuBend","cmuSword","cmuSitStand","cmuDrink","cmuWave","cmuLaugh","cmuClimbSteps"] as const;
const angle=z.number().finite().min(-Math.PI*2).max(Math.PI*2);
const motionSchema=z.strictObject({id:z.enum(mocapKinds),name:z.string().min(1).max(80),sourceId:z.string().regex(/^\d+_\d+$/),duration:z.number().min(.1).max(30),sourceDuration:z.number().min(.1).max(300),frames:z.array(z.strictObject({time:z.number().min(0).max(30),rootY:z.number().finite().min(-2).max(10),rotations:z.array(z.tuple([angle,angle,angle])).length(mannequinJoints.length)})).min(2).max(120)}).refine(motion=>motion.frames[0]!.time===0&&Math.abs(motion.frames.at(-1)!.time-motion.duration)<.001&&motion.frames.every((frame,index)=>!index||frame.time>motion.frames[index-1]!.time),"动作库时间轴无效");
const library=z.strictObject({version:z.literal(1),source:z.string(),motions:z.array(motionSchema).length(mocapKinds.length)}).parse(catalog);
if(new Set(library.motions.map(motion=>motion.id)).size!==mocapKinds.length)throw new Error("动作库条目重复或缺失");
export const mocapMotions=library.motions;
export const mocapLabels=Object.fromEntries(mocapMotions.map(motion=>[motion.id,`${motion.name} · CMU`]));
export const isMocapKind=(kind:string):kind is typeof mocapKinds[number]=>mocapKinds.some(id=>id===kind);
export function sampleMocap(kind:typeof mocapKinds[number],progress:number,joint?:typeof mannequinJoints[number]){
  const motion=mocapMotions.find(motion=>motion.id===kind)!,time=Math.max(0,Math.min(1,progress))*motion.duration;
  const a=motion.frames.findLast(frame=>frame.time<=time)??motion.frames[0]!,b=motion.frames.find(frame=>frame.time>time)??a;
  const blend=a===b?0:(time-a.time)/(b.time-a.time),rootY=a.rootY+(b.rootY-a.rootY)*blend;
  if(!joint)return {rootY,rotation:{x:0,y:0,z:0}};
  const index=mannequinJoints.indexOf(joint),first=a.rotations[index]!,last=b.rotations[index]!;
  const rotation=new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...first)).slerp(new Quaternion().setFromEuler(new Euler(...last)),blend));
  return {rootY,rotation:{x:rotation.x,y:rotation.y,z:rotation.z}};
}
