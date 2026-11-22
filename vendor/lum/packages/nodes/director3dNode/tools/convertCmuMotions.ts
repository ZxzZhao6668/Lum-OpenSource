// 生产用动作资料转换入口：bun tools/convertCmuMotions.ts <包含cmu*.bvh的目录>
// 只读取动作数据，输出插件随附的已重定向动作目录；不执行BVH/压缩包中的代码。
import { readFile, writeAtomic } from "@lum/file";
import { resolve } from "node:path";
import { AnimationMixer, Euler, LoopOnce, Quaternion, Vector3 } from "three";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import { createMannequin, mannequinJoints } from "../src/mannequin";

const folder=process.argv[2];if(!folder)throw new Error("请传入动作源文件目录");
const entries=[
  ["cmuWalk","自然行走","07_01",8], ["cmuSlowWalk","慢走","07_04",8], ["cmuRun","跑步","09_01",8],
  ["cmuJump","向前跳跃","13_11",8], ["cmuBoxing","击打出拳","02_05",8], ["cmuBend","弯腰拾取","02_06",10],
  ["cmuSword","挥剑","02_07",8], ["cmuSitStand","坐下与起身","13_01",12], ["cmuDrink","喝水","13_09",10],
  ["cmuWave","挥手指引","13_27",10], ["cmuLaugh","大笑","13_14",8], ["cmuClimbSteps","上台阶","13_35",8],
] as const;
const mapping={hips:"Hips",spine:"Spine1",neck:"Neck1",head:"Head",leftShoulder:"LeftArm",leftElbow:"LeftForeArm",leftWrist:"LeftHand",rightShoulder:"RightArm",rightElbow:"RightForeArm",rightWrist:"RightHand",leftHip:"LeftUpLeg",leftKnee:"LeftLeg",leftAnkle:"LeftFoot",rightHip:"RightUpLeg",rightKnee:"RightLeg",rightAnkle:"RightFoot"};
const rounded=(value:number)=>Math.round(value*100000)/100000;
const motions=[];
for(const [id,name,sourceId,maxDuration] of entries){
  const text=await readFile(resolve(folder,`${id}.bvh`),"utf8");if(text.length>20000000||!text.startsWith("HIERARCHY"))throw new Error(`${id}不是有效BVH`);
  const {skeleton,clip}=new BVHLoader().parse(text), source=skeleton.bones[0]!;
  const mixer=new AnimationMixer(source), action=mixer.clipAction(clip).setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(0);source.updateMatrixWorld(true);
  const target=createMannequin(id);target.getObjectByName("leftShoulder")!.rotation.z=Math.PI/2;target.getObjectByName("rightShoulder")!.rotation.z=-Math.PI/2;target.updateMatrixWorld(true);
  const correction=new Map<string,Quaternion>();
  for(const joint of mannequinJoints){const bone=skeleton.bones.find(bone=>bone.name===mapping[joint]);if(!bone)throw new Error(`${id}缺少骨骼${mapping[joint]}`);correction.set(joint,bone.getWorldQuaternion(new Quaternion()).invert().multiply(target.getObjectByName(joint)!.getWorldQuaternion(new Quaternion())));}
  const sourceHip=source.getWorldPosition(new Vector3()).y;
  const feet=["LeftFoot","RightFoot"].map(name=>skeleton.bones.find(bone=>bone.name===name)!.getWorldPosition(new Vector3()).y);
  const sourceFloor=Math.min(...feet),scale=.85/(sourceHip-sourceFloor);if(!Number.isFinite(scale)||scale<=0||scale>2)throw new Error(`${id}骨架比例无效`);
  const skip=1/120,duration=Math.min(maxDuration,clip.duration-skip),count=Math.min(100,Math.max(2,Math.ceil(duration*12)+1));
  action.paused=false;mixer.setTime(skip);source.updateMatrixWorld(true);
  const initialForward=new Vector3(0,0,1).applyQuaternion(source.getWorldQuaternion(new Quaternion()).multiply(correction.get("hips")!));
  const heading=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-Math.atan2(initialForward.x,initialForward.z));
  const frames=[];
  for(let index=0;index<count;index++){
    const time=duration*index/(count-1);action.paused=false;mixer.setTime(skip+time);source.updateMatrixWorld(true);
    target.position.set(0,0,0);
    for(const joint of mannequinJoints){const bone=skeleton.bones.find(bone=>bone.name===mapping[joint])!,part=target.getObjectByName(joint)!;
      const world=heading.clone().multiply(bone.getWorldQuaternion(new Quaternion())).multiply(correction.get(joint)!);
      part.quaternion.copy(part.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));part.updateMatrixWorld(true);
    }
    let rootY=(source.getWorldPosition(new Vector3()).y-sourceHip)*scale;target.position.y=rootY;target.updateMatrixWorld(true);
    const minFoot=Math.min(...["leftAnkle","rightAnkle"].flatMap(name=>{const foot=target.getObjectByName(name)!;return [[0,-.10,.18],[0,-.10,-.08]].map(([x,y,z])=>foot.localToWorld(new Vector3(x,y,z)).y);}));
    if(minFoot<0)rootY-=minFoot;
    frames.push({time:rounded(time),rootY:rounded(rootY),rotations:mannequinJoints.map(joint=>{const rotation=new Euler().setFromQuaternion(target.getObjectByName(joint)!.quaternion);return [rounded(rotation.x),rounded(rotation.y),rounded(rotation.z)];})});
  }
  mixer.stopAllAction();mixer.uncacheRoot(source);target.traverse((object:any)=>{object.geometry?.dispose();object.material?.dispose();});
  motions.push({id,name,sourceId,duration:rounded(duration),sourceDuration:rounded(clip.duration-skip),frames});
  console.log(`${id}: ${duration.toFixed(2)}秒 / ${frames.length}采样`);
}
await writeAtomic(resolve(import.meta.dir,"../src/previsMotions.json"),JSON.stringify({version:1,source:"CMU Graphics Lab / cgspeed MotionBuilder 2010 BVH",motions}));
