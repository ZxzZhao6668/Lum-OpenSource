import { z } from "@lum/nodes-scaffold/runtime";
import { cameraFramingSchema, cameraSamplesSchema, filmFormatKeys, getTopShotFront, maxCameraSamples, minShotSeconds, sampleCameraFrames, toFraming, type CameraFraming, type CameraSamples, type FilmFormat } from "./cameraDocument";
import type { ShootingCameraSettings } from "./shootingCamera";
import type { SceneDocument } from "./sceneDocument";

const identifier = z.string().trim().min(1).max(160);
export const shootingMethodNames = ["固定", "云台", "漂浮", "手持", "跑拍", "航拍", "穿越"] as const;
export const shootingLensValues = [16, 35, 50, 85, 135];
export const shootingApertureValues = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
export const shootingSettingsSchema = z.strictObject({
  method: z.enum(shootingMethodNames),
  focalLength: cameraFramingSchema.shape.focalLength,
  format: z.enum(["16:9", "9:16", "1:1", "21:9"]),
  speed: z.number().finite().min(0.12).max(8),
  shake: z.number().finite().min(0).max(1),
  random: z.number().finite().min(0).max(1).optional(),
  aperture: z.number().refine(value => shootingApertureValues.includes(value)),
  height: z.number().finite().min(0.25).max(100),
  follow: z.boolean(),
});
export type ShootingCue = ShootingCameraSettings & { subject?: string };
const cueSchema = z.strictObject({
  at: z.number().finite().min(0).max(86400),
  state: shootingSettingsSchema.extend({ subject: identifier.optional() }),
});
const takeSchema = z.strictObject({
  id: identifier,
  name: identifier,
  method: z.string().trim().min(1).max(80),
  format: z.enum(filmFormatKeys),
  worldStart: z.number().finite().min(Date.UTC(1900, 0, 1) / 1000).max(Date.UTC(2201, 0, 1) / 1000 - 0.001).optional(),
  duration: z.number().finite().min(minShotSeconds).max(86400),
  startTime: z.number().finite().min(0).max(86400),
  thumbnail: z.string().max(512000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
  samples: cameraSamplesSchema,
  cues: z.array(cueSchema).max(maxCameraSamples).optional(),
}).refine(take => take.startTime + take.duration <= 86400, "拍次超出演绎时间范围")
  .refine(take => !take.cues || take.cues.every((cue, index, cues) => cue.at <= take.duration && (!index || cue.at > cues[index - 1]!.at)), "拍摄参数变化须按拍次时间排列");

export const sceneShootingSchema = z.strictObject({
  takes: z.array(takeSchema).refine(takes => new Set(takes.map(take => take.id)).size === takes.length, "拍次 ID 重复"),
  adoptedId: identifier.optional(),
  cameraId: identifier.optional(),
  shotId: identifier.optional(),
}).refine(shooting => !shooting.adoptedId || shooting.takes.some(take => take.id === shooting.adoptedId), "采用的拍次不存在");

export type ShootingTake = z.infer<typeof takeSchema>;
export type SceneShooting = z.infer<typeof sceneShootingSchema>;
type TakeInfo = { name: string; method: string; format: FilmFormat; thumbnail?: string; startTime?: number; worldStart?: number };

/** 使用单调时钟和不含暂停的时间轴。长镜头按倍数降采样，保留起止画面与真实时长。 */
export function createShootingRecorder() {
  let frames: CameraSamples = [];
  let cues: { at: number; state: ShootingCue }[] = [];
  let runningSince: number | undefined;
  let accumulated = 0;
  let interval = 1 / 24;

  function elapsed(now = performance.now()) {
    return accumulated + (runningSince === undefined ? 0 : Math.max(0, now - runningSince) / 1000);
  }
  function append(frame: CameraFraming, at: number) {
    const last = frames.at(-1);
    if (last && last.at >= at) {
      if (last.at === at) last.frame = toFraming(frame);
      return;
    }
    if (frames.length >= maxCameraSamples) {
      frames = frames.filter((_, index) => index % 2 === 0);
      interval *= 2;
    }
    frames.push({ at, frame: toFraming(frame) });
  }
  function cue(state: ShootingCue | undefined, at: number) {
    if (!state) return;
    const last = cues.at(-1);
    if (last && last.state.subject === state.subject && last.state.method === state.method && last.state.follow === state.follow
      && last.state.format === state.format && last.state.focalLength === state.focalLength && last.state.aperture === state.aperture
      && last.state.speed === state.speed && last.state.shake === state.shake && last.state.height === state.height && last.state.random === state.random) return;
    if (last?.at === at) cues.pop();
    if (cues.length >= maxCameraSamples) cues = cues.filter((_, index) => index % 2 === 0);
    cues.push({ at, state: { ...state } });
  }
  function start(frame: CameraFraming, now = performance.now(), settings?: ShootingCue) {
    frames = [];
    cues = [];
    cue(settings, 0);
    accumulated = 0;
    interval = 1 / 24;
    runningSince = now;
    append(frame, 0);
  }
  function pause(now = performance.now()) {
    accumulated = elapsed(now);
    runningSince = undefined;
  }
  function resume(now = performance.now()) {
    if (frames.length && runningSince === undefined) runningSince = now;
  }
  function sample(frame: CameraFraming, now = performance.now(), settings?: ShootingCue) {
    if (runningSince === undefined) return;
    const at = elapsed(now);
    cue(settings, at);
    if (at - frames[frames.length - 1]!.at >= interval) append(frame, at);
  }
  function finish(frame: CameraFraming, info: TakeInfo, now = performance.now()): ShootingTake {
    if (!frames.length) throw new Error("请先开始拍摄。");
    const startTime = info.startTime ?? 0;
    const limit = Math.min(86400 - startTime, info.worldStart === undefined ? Infinity : Date.UTC(2201, 0, 1) / 1000 - 0.001 - info.worldStart);
    if (limit < minShotSeconds) throw new Error("已到影片或世界时钟末尾，请先回到较早的时刻。");
    const duration = Math.min(limit, Math.max(minShotSeconds, elapsed(now)));
    const cut = frames.findIndex(sample => sample.at > duration);
    if (cut >= 0) frames.length = cut;
    append(runningSince === undefined || elapsed(now) > limit ? frames.at(-1)!.frame : frame, duration);
    const samples = frames.map(({ at, frame }) => ({ at: at / duration, frame }));
    const take = takeSchema.parse({ ...info, startTime, id: crypto.randomUUID(), duration, samples, ...(cues.length ? { cues: cues.filter(cue => cue.at <= duration) } : {}) });
    frames = [];
    cues = [];
    runningSince = undefined;
    accumulated = 0;
    return take;
  }
  return { start, pause, resume, sample, elapsed, finish };
}

export function sampleShootingCue(take: ShootingTake, seconds: number): ShootingCue | undefined {
  const cues = take.cues;
  if (!cues?.length || seconds < cues[0]!.at) return;
  let low = 0, high = cues.length;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (cues[middle]!.at <= seconds) low = middle;
    else high = middle;
  }
  return cues[low]!.state;
}

export function sampleShootingTake(take: ShootingTake, seconds: number) {
  return sampleCameraFrames(take.samples, seconds / take.duration);
}

export function storeShootingTake(scene: SceneDocument, take: ShootingTake): SceneDocument {
  const existing = scene.shooting?.takes ?? [];
  if (existing.some(item => item.id === take.id)) return scene;
  return { ...scene, shooting: { ...scene.shooting, takes: [take, ...existing] } };
}

/** 只替换本功能创建的镜头段。即使用户随后在这台机位上剪辑，也保留其他镜头段。 */
export function adoptShootingTake(scene: SceneDocument, takeId: string): SceneDocument {
  const shooting = scene.shooting;
  const take = shooting?.takes.find(item => item.id === takeId);
  if (!shooting || !take) throw new Error("找不到要采用的拍次。");
  const cameras = [...(scene.cameras ?? [])];
  const previous = cameras.findIndex(camera => camera.id === shooting.cameraId);
  const camera = cameras[previous];
  const retained = (camera?.shots ?? []).filter(shot => shot.id !== shooting.shotId);
  const end = take.startTime + take.duration;
  const canReuse = camera && retained.length < 64 && !retained.some(shot => shot.start < end && shot.end > take.startTime);
  if (!canReuse && cameras.length >= 24) throw new Error("场景已达到 24 台机位上限，请整理现有机位后再采用拍次。");
  const cameraId = canReuse ? camera.id : crypto.randomUUID();
  const shotId = canReuse && shooting.shotId ? shooting.shotId : crypto.randomUUID();
  const frame = take.samples[0]!.frame;
  const front = Math.min(1000000, getTopShotFront(cameras) + 1);
  const shot = { id: shotId, start: take.startTime, end, front, frame, samples: take.samples, note: take.name };
  if (canReuse) {
    cameras[previous] = { ...camera, enabled: true, frame, shots: [...retained, shot].sort((a, b) => a.start - b.start) };
  } else {
    if (camera) cameras[previous] = { ...camera, shots: retained };
    cameras.push({ id: cameraId, name: "拍摄机位", frame, shots: [shot] });
  }
  return { ...scene, film: { ...scene.film, format: take.format }, cameras, shooting: { ...shooting, adoptedId: take.id, cameraId, shotId } };
}

