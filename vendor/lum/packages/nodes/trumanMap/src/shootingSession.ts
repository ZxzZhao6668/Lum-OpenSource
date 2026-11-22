import { computed, nextTick, reactive, ref, shallowRef, watch } from "vue";
import type { createSceneViewport } from "./sceneViewport";
import type { ShootingCameraSettings } from "./shootingCamera";
import { createShootingRecorder, sampleShootingCue, sampleShootingTake, storeShootingTake, adoptShootingTake, type ShootingTake } from "./shootingTakes";
import { filmFormats, type CameraFraming } from "./cameraDocument";
import type { SceneDocument } from "./sceneDocument";

type Method = ShootingCameraSettings["method"];
type Ratio = ShootingCameraSettings["format"];
type Adjustment = "speed" | "shake" | "height" | "aperture" | "randomness";
export const shootingMethods: Method[] = ["固定", "云台", "漂浮", "手持", "跑拍", "航拍", "穿越"];
export const shootingRatios: Ratio[] = ["16:9", "9:16", "1:1", "21:9"];
export const shootingLenses = [16, 35, 50, 85, 135];
const speeds = [0.12, 0.35, 0.7, 1, 1.4, 2, 3, 5, 8];
const apertures = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
function stepValue(values: number[], v: number, step: number) {
  const i = values.reduce((best, val, n) => Math.abs(val - v) < Math.abs(values[best]! - v) ? n : best, 0);
  return values[clamp(i + step, 0, values.length - 1)]!;
}

export function useShootingSession(options: {
  viewport: () => ReturnType<typeof createSceneViewport> | undefined;
  scene: () => SceneDocument;
  publish: (scene: SceneDocument) => void;
  filmTime: () => number;
  notice: (message: string) => void;
  saved: () => void;
}) {
  const active = ref(false), recording = ref(false), paused = ref(false);
  const selected = ref(""), playing = shallowRef<ShootingTake>(), elapsed = ref(0);
  const locked = ref(false), distance = ref(3.2), following = ref(false);
  const method = ref<Method>("云台"), ratio = ref<Ratio>("16:9"), focal = ref(16);
  const presets = reactive(shootingMethods.map((name, i) => ({
    speed: [1, 1.4, 0.7, 1, 2, 3, 5][i]!, shake: [0, 0, 1, 2, 3, 0, 1][i]!,
    height: name === "航拍" ? 8 : 1.65, aperture: 2.8, randomness: 30,
  })));
  const preset = computed(() => presets[shootingMethods.indexOf(method.value)]!);
  const settings = computed<ShootingCameraSettings>(() => ({
    method: method.value, speed: preset.value.speed, shake: preset.value.shake / 3,
    height: preset.value.height, aperture: preset.value.aperture, random: preset.value.randomness / 100,
    focalLength: focal.value, format: ratio.value, follow: following.value,
  }));
  const takes = computed(() => options.scene().shooting?.takes ?? []);
  const adopted = computed(() => {
    const scene = options.scene(), link = scene.shooting;
    const camera = scene.cameras?.find(item => item.id === link?.cameraId);
    return camera?.shots?.some(shot => shot.id === link?.shotId) ? link?.adoptedId : undefined;
  });
  const playbackFrame = shallowRef<CameraFraming>();
  const playbackCue = shallowRef<ReturnType<typeof sampleShootingCue>>();
  function captureCue() {
    const subject = options.viewport()?.getShootingSubjectId();
    return subject ? { ...settings.value, subject } : settings.value;
  }
  const recorder = createShootingRecorder();
  let animation = 0, startedAt = 0, worldStart = 0, durationLimit = 0, playStarted = 0, thumbnail: string | undefined;
  let lastUpdate = -1, lastSceneFrame = -1, seekActive = false, restoreRatio: Ratio | undefined;
  let pending: ShootingTake | undefined;
  function resetClock() {
    if (seekActive) options.viewport()?.seekPerformance(0, "cancel");
    seekActive = false;
    lastSceneFrame = -1;
  }
  function driveScene(world: number, at: number) {
    const frame = Math.floor(at * 24);
    if (frame === lastSceneFrame) return;
    options.viewport()?.seekPerformance(world + at, seekActive ? "move" : "start");
    seekActive = true;
    lastSceneFrame = frame;
  }
  function stopPlayback() {
    if (!playing.value) return;
    playing.value = undefined;
    playbackFrame.value = undefined;
    playbackCue.value = undefined;
    elapsed.value = 0;
    options.viewport()?.setShootingPlayback(null);
    if (restoreRatio) ratio.value = restoreRatio;
    restoreRatio = undefined;
    resetClock();
  }
  function tick(now: number) {
    const v = options.viewport();
    if (!active.value || !v) return;
    try {
      const clip = playing.value;
      const at = recording.value ? Math.min(durationLimit, recorder.elapsed(now)) : clip ? Math.min(clip.duration, (now - playStarted) / 1000) : 0;
      if (clip) {
        driveScene(clip.worldStart ?? worldStart, at);
        const frame = sampleShootingTake(clip, at);
        v.setShootingPlayback(frame);
        if (now - lastUpdate > 90) {
          playbackFrame.value = frame;
          playbackCue.value = sampleShootingCue(clip, at);
        }
        if (now - playStarted > clip.duration * 1000 + 250) stopPlayback();
      } else if (recording.value && !paused.value) {
        driveScene(worldStart, at);
        const frame = v.getShootingPose();
        if (frame) recorder.sample(frame, now, captureCue());
        if (at >= durationLimit) finish();
      }
      if (now - lastUpdate > 90) {
        elapsed.value = recording.value || playing.value ? at : 0;
        if (!playing.value) preset.value.height = v.getShootingHeight();
        distance.value = v.getShootingFocusDistance();
        locked.value = v.getShootingFocusLocked();
        lastUpdate = now;
      }
    } catch (err) {
      if (playing.value) stopPlayback();
      if (recording.value && !paused.value) togglePause();
      options.notice(err instanceof Error ? err.message : "拍摄预览暂时无法更新");
    }
    animation = requestAnimationFrame(tick);
  }
  watch(settings, value => { if (active.value) options.viewport()?.updateShooting(value); }, { flush: "sync" });
  function enter(frame?: CameraFraming) {
    const v = options.viewport();
    if (!v || active.value) return;
    const initial = options.scene().film?.format as Ratio;
    if (shootingRatios.includes(initial)) ratio.value = initial;
    if (frame) focal.value = frame.focalLength;
    v.beginShooting(settings.value, frame);
    worldStart = v.getWorldSeconds();
    active.value = true;
    selected.value = takes.value[0]?.id ?? "";
    animation = requestAnimationFrame(tick);
  }
  function record() {
    if (recording.value || pending) return finish();
    stopPlayback();
    const v = options.viewport(), frame = v?.getShootingPose();
    if (!v || !frame) return;
    const capture = document.createElement("canvas"), aspect = filmFormats[ratio.value];
    capture.width = Math.round(240 * Math.min(1, aspect));
    capture.height = Math.round(240 * Math.min(1, 1 / aspect));
    thumbnail = v.drawShootingFrame(capture) ? capture.toDataURL("image/jpeg", 0.72) : undefined;
    startedAt = options.filmTime();
    worldStart = v.getWorldSeconds();
    durationLimit = Math.min(86400 - startedAt, Date.UTC(2201, 0, 1) / 1000 - 0.001 - worldStart);
    if (durationLimit < 0.2) throw new Error("已到时间线末尾，请先把播放头移到较早的时刻。");
    driveScene(worldStart, 0);
    recorder.start(frame, performance.now(), captureCue());
    recording.value = true;
    paused.value = false;
    elapsed.value = 0;
  }
  function finish() {
    if (!recording.value && !pending) return;
    const v = options.viewport(), frame = v?.getShootingPose();
    if (!v || !frame) return;
    pending ??= recorder.finish(frame, { name: `拍次 ${takes.value.length + 1} · ${method.value}`, method: method.value, format: ratio.value, thumbnail, startTime: startedAt, worldStart });
    options.publish(storeShootingTake(options.scene(), pending));
    selected.value = pending.id;
    pending = undefined;
    recording.value = paused.value = false;
    v.setShootingPaused(false);
    resetClock();
    void nextTick(options.saved);
  }
  function togglePause() {
    if (!recording.value) return;
    if (paused.value) recorder.resume();
    else recorder.pause();
    paused.value = !paused.value;
    options.viewport()?.setShootingPaused(paused.value);
  }
  function exit() {
    if (!active.value) return;
    finish();
    stopPlayback();
    cancelAnimationFrame(animation);
    options.viewport()?.endShooting();
    active.value = following.value = locked.value = false;
  }
  function dispose() {
    try { exit(); }
    finally { cancelAnimationFrame(animation); active.value = false; }
  }
  function play(id: string) {
    if (recording.value) return;
    const same = playing.value?.id === id;
    stopPlayback();
    const clip = takes.value.find(item => item.id === id);
    if (same || !clip) return;
    selected.value = id;
    restoreRatio = ratio.value;
    if (shootingRatios.includes(clip.format as Ratio)) ratio.value = clip.format as Ratio;
    playStarted = performance.now();
    playing.value = clip;
  }
  function adopt(id: string) {
    if (recording.value) return;
    stopPlayback();
    options.publish(adoptShootingTake(options.scene(), id));
    options.notice("已采用拍次。回到场景后可从右上角导出分镜图或白模视频。");
  }
  function adjust(kind: Adjustment, step: number) {
    const p = preset.value;
    if (kind === "speed") p.speed = stepValue(speeds, p.speed, step);
    if (kind === "shake") p.shake = clamp(p.shake + step, 0, 3);
    if (kind === "height") p.height = clamp(Math.round(((options.viewport()?.getShootingHeight() ?? p.height) + step * 0.1) * 100) / 100, 0.25, 100);
    if (kind === "aperture") p.aperture = stepValue(apertures, p.aperture, step);
    if (kind === "randomness") p.randomness = clamp(p.randomness + step * 10, 0, 100);
  }
  function setFocus(value: boolean) {
    const v = options.viewport();
    if (value && !v?.setShootingFocus()) { options.notice("将取景中心对准场景中的主体后，再锁定或跟拍。"); return false; }
    if (!value) v?.clearShootingFocus();
    locked.value = value;
    if (!value) following.value = false;
    return true;
  }
  function follow(value: boolean) {
    if (!value || locked.value || setFocus(true)) following.value = value;
  }
  return reactive({ active, recording, paused, playing, selected, elapsed, method, ratio, focal, preset, settings, following, locked, distance, takes, adopted, playbackFrame, playbackCue,
    enter, exit, dispose, record, finish, play, adopt, togglePause, adjust, setFocus, follow, stopPlayback });
}

