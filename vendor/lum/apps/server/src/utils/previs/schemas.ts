import { isStageBake, withStageBake, type StageBake } from "@lum/node-shared/stageBake";
import { isStageMesh } from "@lum/node-shared/stageMesh";
import presetCatalog from "../../../../../packages/nodes/director3dNode/src/presets/catalog.json";
import { virtualStageAssets } from "@lum/node-shared/virtualStageAssets";
import { z } from "zod";
export const joints = ["hips", "spine", "neck", "head", "leftShoulder", "leftElbow", "leftWrist", "rightShoulder", "rightElbow", "rightWrist", "leftHip", "leftKnee", "leftAnkle", "rightHip", "rightKnee", "rightAnkle"] as const;
const number = z.number().min(-10000).max(10000);
const vector = z.strictObject({ x: number, y: number, z: number });
const color = z.string().regex(/^#[\da-f]{6}$/i);
const camera = z.strictObject({ position: vector, fov: z.number().min(10).max(120), near: z.number().min(0.01).max(10), far: z.number().min(20).max(10000) });
const view = z.strictObject({ camera, controls: z.strictObject({ target: vector }) });
export const sceneSchema = z.strictObject({ version: z.literal("next"),
  studio: z.strictObject({ bake: z.custom<StageBake>(isStageBake, "烘焙缓存无效或超过几何上限").optional(), clayEnvironment: z.boolean(), materialMode: z.enum(["clay","color","pbr"]).optional(), pbrRoughness: z.number().min(0).max(1).optional(), pbrMetalness: z.number().min(0).max(1).optional(), lighting: z.enum(["daylight","soft","evening"]), renderer: z.enum(["eevee","workbench"]) }).optional(),
  sceneConfig: z.strictObject({ scene: z.strictObject({ background: color }), camera, controls: view.shape.controls, lights: z.array(z.strictObject({ type: z.enum(["ambient", "directional", "point", "spot", "hemisphere"]), color, intensity: z.number().min(0).max(100), position: vector.optional(), target: vector.optional() })).max(16) }),
  objectList: z.array(z.strictObject({ threeJsonId: z.string().trim().min(1).max(100), name: z.string().max(100).optional(), objType: z.enum(["box", "sphere", "cylinder", "cone", "ring", "torus", "capsule", "plane", "mannequin", "preset", "mesh"]),
    stageRole: z.enum(["environment","character","prop"]).optional(),
    locked: z.boolean().optional(),
    attachment: z.strictObject({ objectId: z.string().min(1).max(100), joint: z.enum(["leftWrist", "rightWrist"]), offset: vector, rotation: vector }).optional(),
    appearance: z.strictObject({ style: z.enum(["robe", "modern"]), skin: color, hair: color, accent: color }).optional(),
    librarySource: z.strictObject({ id: z.string().max(80), name: z.string().max(100), source: z.string().max(500), license: z.string().max(100) }).optional(),
    meshParts: z.array(z.strictObject({ positions: z.array(z.number().finite().min(-10000).max(10000)).min(9).max(180000), indices: z.array(z.number().int().nonnegative()).min(3).max(60000), color: z.string().regex(/^#[\da-f]{6}$/i), ao: z.array(z.number().min(0).max(1)).max(60000).optional() })).min(1).max(64).refine(isStageMesh, "静态模型网格无效或超过 2 万三角面上限").optional(),
    presetId: z.string().refine(id=>[...presetCatalog,...virtualStageAssets].some(item=>item.id===id)).optional(),
    geometry: z.record(z.string().regex(/^[a-zA-Z]+$/), z.union([z.number().min(0).max(10000), z.boolean()])).refine(value => Object.entries(value).every(([key, value]) => !/segments/i.test(key) || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 64)),
    position: vector, rotation: z.strictObject({ rotationX: number, rotationY: number, rotationZ: number }).optional(), scale: z.strictObject({ scaleX: number, scaleY: number, scaleZ: number }).optional(), pose: z.partialRecord(z.enum(joints), vector).optional(), hiddenParts: z.array(z.enum(joints)).max(16).optional(),
    material: z.strictObject({ type: z.enum(["standard", "basic", "phong", "lambert"]), color, roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional(), opacity: z.number().min(0).max(1).optional(), transparent: z.boolean().optional(), wireframe: z.boolean().optional() }),
  }).refine(object=>object.objType==="mesh"?!!object.meshParts:!object.meshParts,"静态模型必须提供有效网格").refine(object=>object.objType==="preset"?!!object.presetId:!object.presetId).refine(object => object.objType === "mannequin" || !object.pose && !object.hiddenParts && !object.appearance)).max(200).refine(objects => new Set(objects.map(object => object.threeJsonId)).size === objects.length),
}).superRefine((scene, context) => {
  if(scene.objectList.reduce((sum,object)=>sum+(object.meshParts?.reduce((total,part)=>total+part.positions.length/3,0)??0),0)>240000)context.addIssue({code:"custom",message:"片场导入模型总计最多24万个顶点，请简化模型"});
  if(scene.objectList.reduce((sum,object)=>sum+(object.meshParts?.reduce((total,part)=>total+part.indices.length/3,0)??0),0)>80000)context.addIssue({code:"custom",message:"片场导入模型总计最多 8 万三角面，请简化模型"});
  for (const object of scene.objectList) if (object.attachment && (object.objType === "mannequin" || !scene.objectList.some(parent => parent.threeJsonId === object.attachment!.objectId && parent.objType === "mannequin"))) context.addIssue({ code: "custom", message: "道具需要绑定到有效人物的手部" });
});
export const planSchema = z.strictObject({ name: z.string().trim().min(1).max(80), duration: z.number().min(0.2).max(300),
  tracks: z.array(z.strictObject({ objectId: z.string().trim().min(1).max(100), joint: z.enum(joints).optional(), frames: z.array(z.strictObject({ time: z.number().min(0).max(300), position: vector.optional(), rotation: vector, scale: vector.optional() })).min(2).max(120) })).max(200),
  cameraFrames: z.array(z.strictObject({ time: z.number().min(0).max(300), view, easing: z.enum(["linear", "smooth", "cut"]) })).min(1).max(120),
}).superRefine((plan, context) => {
  const ordered = (frames: { time: number }[]) => frames[0]?.time === 0 && frames.every((frame, index) => frame.time <= plan.duration && (!index || frame.time > frames[index - 1]!.time));
  if (!ordered(plan.cameraFrames) || plan.tracks.some(track => !ordered(track.frames) || track.joint && track.frames.some(frame => frame.position || frame.scale)) || plan.tracks.reduce((sum, track) => sum + track.frames.length, 0) > 12000 || new Set(plan.tracks.map(track => JSON.stringify([track.objectId, track.joint]))).size !== plan.tracks.length) context.addIssue({ code: "custom", message: "动画关键帧时间、数量或关节轨道无效" });
});
export const jobFields = { directory: z.string().min(1).max(4096), nodeId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) };
export const identityFields = { ...jobFields, jobId: z.uuid() };
export const bakeOptionsSchema = z.strictObject({ samples: z.union([z.literal(16),z.literal(32),z.literal(64)]), distance: z.number().min(.05).max(10) });
export const submitFields = { bake: bakeOptionsSchema.optional(), ...jobFields, requestId: z.uuid().optional(), revision: z.number().int().nonnegative().optional(), frameTime: z.number().min(0).max(300).optional(), scene: sceneSchema, plan: planSchema, width: z.number().int().min(64).max(1920).multipleOf(2).optional(), height: z.number().int().min(64).max(1920).multipleOf(2).optional(), fps: z.number().int().min(1).max(60).optional() };


