import type { BlockingPlan } from "./blockingTypes";
import { pointAt, projectPoint, resolveTracks } from "./shotBlocking";
import type { Shot } from "./shotData";

export const gridIntervals = [1, 1.5, 2, 3] as const;
export const gridBatchLimit = 120;
export type GridInterval = typeof gridIntervals[number];
export type GridView = "main" | "a" | "b";

export type GridBeat = {
  time: number;
  view: GridView;
  transition: "cut" | "dissolve";
  shotSize: string;
  camera: string;
  movement: string;
  focalLength: string;
  aperture: string;
  action: string;
};

export type GridShotSettings = { interval?: GridInterval; beats: GridBeat[] };
export type GridSettings = { interval: GridInterval; shots: Record<string, GridShotSettings> };

export type GridFrame = Omit<GridBeat, "time" | "transition"> & {
  key: string;
  from: number;
  to: number;
  duration: number;
  transition: "start" | "continue" | GridBeat["transition"];
};

const defaultInterval: GridInterval = 1.5;
const ticksPerSecond = 10;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function gridInterval(value: unknown): GridInterval | undefined {
  return gridIntervals.find(interval => interval === value);
}

function toTicks(seconds: number): number {
  return Math.round(seconds * ticksPerSecond);
}

function durationTicks(shot: Shot): number {
  const duration = Number.isFinite(shot.duration) && shot.duration >= 0 ? shot.duration : 5;
  return Math.max(1, toTicks(Math.min(60, duration)));
}

function normalizeBeats(value: unknown, shot: Shot): GridBeat[] {
  if (!Array.isArray(value)) return [];
  const duration = durationTicks(shot);
  const beats = new Map<number, GridBeat>();
  for (const valueBeat of value) {
    const raw = record(valueBeat);
    if (typeof raw.time !== "number" || !Number.isFinite(raw.time) || raw.time < 0) continue;
    const tick = toTicks(raw.time);
    if (tick >= duration || (tick === 0 && raw.time !== 0)) continue;
    beats.set(tick, {
      time: tick / ticksPerSecond,
      view: raw.view === "a" || raw.view === "b" ? raw.view : "main",
      transition: raw.transition === "dissolve" ? "dissolve" : "cut",
      shotSize: cleanText(raw.shotSize, 20),
      camera: cleanText(raw.camera, 120),
      movement: cleanText(raw.movement, 160),
      focalLength: cleanText(raw.focalLength, 40),
      aperture: cleanText(raw.aperture, 40),
      action: cleanText(raw.action, 1000),
    });
  }
  return [...beats.values()].sort((a, b) => a.time - b.time);
}

export function normalizeGrid(value: unknown, shots: readonly Shot[]): GridSettings {
  const raw = record(value);
  const rawShots = record(raw.shots);
  const settings: GridSettings["shots"] = Object.create(null);
  for (const shot of shots) {
    if (!Object.hasOwn(rawShots, shot.id)) continue;
    const shotSettings = record(rawShots[shot.id]);
    const interval = gridInterval(shotSettings.interval);
    const beats = normalizeBeats(shotSettings.beats, shot);
    if (interval || beats.length) settings[shot.id] = { ...(interval && { interval }), beats };
  }
  return { interval: gridInterval(raw.interval) ?? defaultInterval, shots: settings };
}

export function gridFrames(shot: Shot, grid: GridSettings): GridFrame[] {
  const duration = durationTicks(shot);
  const settings = Object.hasOwn(grid.shots, shot.id) ? grid.shots[shot.id] : undefined;
  const interval = toTicks(gridInterval(settings?.interval) ?? gridInterval(grid.interval) ?? defaultInterval);
  const beats = new Map(normalizeBeats(settings?.beats, shot).map(beat => [toTicks(beat.time), beat]));
  const boundaries = new Set(beats.keys());
  for (let tick = 0; tick < duration; tick += interval) boundaries.add(tick);
  const sorted = [...boundaries].sort((a, b) => a - b);

  let active: GridBeat | undefined;
  return sorted.map((from, index) => {
    const beat = beats.get(from);
    if (beat) active = beat;
    const to = sorted[index + 1] ?? duration;
    return {
      key: `${shot.id}:${from}:${to}`,
      from: from / ticksPerSecond,
      to: to / ticksPerSecond,
      duration: (to - from) / ticksPerSecond,
      view: active?.view ?? "main",
      transition: from === 0 ? "start" : beat?.transition ?? "continue",
      shotSize: active?.shotSize || shot.shotSize,
      camera: active?.camera ?? "",
      movement: active?.movement || shot.camera,
      focalLength: active?.focalLength ?? "",
      aperture: active?.aperture ?? "",
      action: active?.action ?? "",
    };
  });
}

export function gridViewLabel(view: GridView): string {
  return { main: "主镜头", a: "正打（A）", b: "反打（B）" }[view];
}

export function gridTransitionLabel(transition: GridFrame["transition"]): string {
  return { start: "起始", continue: "延续", cut: "硬切", dissolve: "叠化" }[transition];
}

export function frameTime(from: number, to: number): string {
  return `${from}–${to} 秒`;
}

const shotReverseShot = "正反打机位保持在人物视线轴线同一侧，互相对视时画面视线方向相反，沿用人物实际站位和移动路线。";

export function gridVideoTimeline(frames: GridFrame[]): string {
  if (!frames.length) return "";
  return [
    "按以下分镜时间轴生成。标记为延续的区间保持当前镜头，按标记时间执行硬切或叠化。",
    ...(frames.some(frame => frame.view !== "main") ? [shotReverseShot] : []),
    ...frames.map(frame => [
      frameTime(frame.from, frame.to),
      gridTransitionLabel(frame.transition),
      gridViewLabel(frame.view),
      frame.shotSize,
      frame.camera && `机位 ${frame.camera}`,
      frame.movement && `运镜 ${frame.movement}`,
      frame.focalLength && `焦距 ${frame.focalLength}`,
      frame.aperture && `光圈 ${frame.aperture}`,
      frame.action && `动作 ${frame.action}`,
    ].filter(Boolean).join(" · ")),
  ].join("\n");
}

export function gridFrameBlocking(
  plan: BlockingPlan | undefined, shots: readonly Shot[], shot: Shot, frame: GridFrame,
): string {
  const angleNote = frame.view === "main" ? "" : shotReverseShot;
  const stage = plan && Object.hasOwn(plan.shots, shot.id) ? plan.shots[shot.id] : undefined;
  const scene = stage && plan?.scenes.find(scene => scene.id === stage.sceneId);
  if (!plan || !stage || !scene) return angleNote;

  const fraction = toTicks(frame.from) / durationTicks(shot);
  const tracks = resolveTracks(plan, shots, shot.id)
    .map(track => ({ ...track, position: pointAt(track.points, fraction) }));
  const focus = tracks.find(track => track.actor.id === stage.focus)?.points[0]
    ?? scene.marks.find(mark => mark.id === stage.focus)?.at
    ?? { x: 50, y: 50 };
  const showScreenPosition = frame.view === "main" && !frame.camera;
  const visible = tracks.filter(track => track.route.visible);
  const positions = visible.map(({ actor, route, position }) => {
    const x = toTicks(position.x) / ticksPerSecond;
    const y = toTicks(position.y) / ticksPerSecond;
    const screen = projectPoint(position, stage.camera, focus, frame.shotSize);
    const screenPosition = screen.x < 0 ? "画外左侧" : screen.x > 100 ? "画外右侧"
      : screen.y < 0 || screen.y - 28 * screen.scale > 100 ? "画外"
      : screen.x < 35 ? "画左" : screen.x > 65 ? "画右" : "画面中央";
    const facing = tracks.find(track => track.actor.id === route.facing)?.actor.name
      ?? scene.marks.find(mark => mark.id === route.facing)?.name;
    return [
      `${actor.name}（${x},${y}）`,
      showScreenPosition ? screenPosition : "",
      facing ? `面向${facing}` : "",
    ].filter(Boolean).join("，");
  });
  const hidden = tracks.filter(track => !track.route.visible).map(track => track.actor.name);
  return [
    positions.length ? `取第 ${frame.from} 秒站位（场地坐标按西→东、北→南各 0–100）：${positions.join("；")}。` : "",
    hidden.length ? `保持画外：${hidden.join("、")}。` : "",
    angleNote,
  ].filter(Boolean).join("");
}
