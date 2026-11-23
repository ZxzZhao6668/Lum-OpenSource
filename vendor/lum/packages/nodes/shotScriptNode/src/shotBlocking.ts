import { mentionedAssets, plainDescription } from "./shotData";
import type { Shot, ShotDocument } from "./shotData";
import type { ActorRoute, BlockingPlan, Point, ShotStage, StageActor, StageConstraint, StageMark, StageScene } from "./blockingTypes";

const center: Point = { x: 50, y: 50 };
const maxShots = 300;
const maxCast = 48;
const maxVia = 16;
const cameras = ["south", "north", "east", "west"] as const;
const cameraNames = { south: "南", north: "北", east: "东", west: "西" };
const limit = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const cleanText = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max).trim() : "";
const safeId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128
  && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v) && !(v in Object.prototype) && v !== "prototype";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function point(value: unknown): Point | undefined {
  if (!record(value) || typeof value.x !== "number" || typeof value.y !== "number"
    || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
  return { x: limit(value.x, 0, 100), y: limit(value.y, 0, 100) };
}

function frame(value: unknown): ShotStage["startFrame"] {
  if (!record(value) || typeof value.url !== "string" || value.url.length > 500) return;
  const url = value.url.replaceAll("\\", "/");
  if (!url || /[:?#%<>|"*\u0000-\u001f\u007f]/.test(url) || url.split("/").some(part =>
    !part || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return;
  const extension = /\.(png|jpe?g|webp|gif|avif)$/i.exec(url)?.[1]?.toLowerCase();
  const mimeType = "image/" + (extension === "jpg" ? "jpeg" : extension);
  if (!extension || value.mimeType !== mimeType) return;
  return { url, mimeType };
}

function uniqueList<T extends { id: string }>(input: unknown, max: number, parse: (v: Record<string, unknown>, id: string) => T | undefined): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(input)) return result;
  for (const raw of input.slice(0, max)) {
    if (!record(raw) || !safeId(raw.id) || seen.has(raw.id)) continue;
    const item = parse(raw, raw.id);
    if (item) { result.push(item); seen.add(item.id); }
  }
  return result;
}

function emptyRoutes(): Record<string, ActorRoute> { return Object.create(null); }
function still(visible = false): ActorRoute { return { visible, via: [], facing: "" }; }

export function normalizeBlocking(value: unknown): BlockingPlan | undefined {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.scenes) || !record(value.shots)) return;
  const scenes = uniqueList<StageScene>(value.scenes, maxShots, (raw, id) => {
    const name = cleanText(raw.name, 80);
    if (!name) return;
    const actors = uniqueList<StageActor>(raw.actors, maxCast, (item, actorId) => {
      const home = point(item.home), name = cleanText(item.name, 80);
      if (home && name) return { id: actorId, name, home, locked: item.locked === true };
    });
    const actorIds = new Set(actors.map(actor => actor.id));
    const marks = uniqueList<StageMark>(raw.marks, maxCast, (item, markId) => {
      const at = point(item.at), name = cleanText(item.name, 80);
      if (at && name && !actorIds.has(markId)) return { id: markId, name, at };
    });
    return { id, name, actors, marks };
  });
  const sceneMap = new Map(scenes.map(scene => [scene.id, scene]));
  const shots: BlockingPlan["shots"] = Object.create(null);
  let count = 0;
  for (const id in value.shots) {
    if (++count > maxShots) break;
    if (!Object.hasOwn(value.shots, id) || !safeId(id)) continue;
    const raw = value.shots[id];
    if (!record(raw) || raw.shotId !== id || !safeId(raw.sceneId)) continue;
    const scene = sceneMap.get(raw.sceneId);
    if (!scene) continue;
    const routes = emptyRoutes();
    for (const actor of scene.actors) {
      const route = record(raw.routes) && Object.hasOwn(raw.routes, actor.id) ? raw.routes[actor.id] : undefined;
      if (!record(route)) continue;
      const via = Array.isArray(route.via) ? route.via.slice(0, maxVia).map(point).filter((p): p is Point => !!p) : [];
      const start = point(route.start), end = point(route.end);
      routes[actor.id] = { ...(start && { start }), via, ...(end && { end }), visible: route.visible !== false, facing: cleanText(route.facing, 128) };
    }
    const startFrame = frame(raw.startFrame), endFrame = frame(raw.endFrame);
    shots[id] = { shotId: id, sceneId: scene.id, cut: raw.cut === true, camera: cameras.find(c => c === raw.camera) ?? "south",
      focus: cleanText(raw.focus, 128), routes, note: cleanText(raw.note, 600), ...(startFrame && { startFrame }), ...(endFrame && { endFrame }) };
  }
  return { version: 1, scenes, shots };
}

// 只根据可定位的场景词起草地标；具体布局由导演在主图校正。
const landmarks: [RegExp, string, Point][] = [
  [/门口|门边|门旁|门前|门后|门框/, "门口", { x: 15, y: 65 }],
  [/窗边|窗台|窗旁|窗前|窗下|窗户/, "窗边", { x: 82, y: 23 }],
  [/沙发/, "沙发", { x: 29, y: 46 }],
  [/办公桌|书桌|长桌|桌边|桌旁|桌前|桌子|桌后|桌上/, "桌旁", { x: 65, y: 52 }],
  [/床边|床头|床旁|床上/, "床边", { x: 78, y: 38 }],
  [/楼梯口|楼梯/, "楼梯口", { x: 22, y: 20 }],
  [/走廊尽头|走廊深处/, "走廊尽头", { x: 53, y: 12 }],
];
const slot = (index: number): Point => ({ x: [34, 66, 50, 18, 82, 42, 58][index % 7]!, y: [57, 51, 37, 69, 65, 39, 78][(index + Math.floor(index / 7)) % 7]! });

const voiceOver = /[（(]\s*(?:画外音?|画外声|场外|V\.?O\.?)\s*[)）]/i;
const speakerName = (value?: string) => cleanText(value, 80).replace(/^@/, "").replace(voiceOver, "").trim();

function naturalNames(shot: Shot, known: Iterable<string>) {
  const text = plainDescription(shot.description);
  const names = new Set<string>();
  for (const name of known) if (name && text.includes(name)) names.add(name);
  for (const line of shot.dialogues) {
    if (line.kind !== "line") continue;
    const speaker = speakerName(line.speaker);
    if (speaker) names.add(speaker);
  }
  // 仅识别有明确动作谓语的短主语，避免把对白内容、摄影描述当作人名。
  const subjects = /(?:^|[。！？；，、\n]|\s)([\p{Script=Han}·]{1,8}?|[A-Z][a-z]+)\s*(?=(?:从|正站|站在|站起|坐在|坐下|起身|靠在|走|跑|退到|冲向|推开|望向|看向|盯着|转身|抬头|低头|开口|说[道话]|回答|问道))/gu;
  for (const match of text.matchAll(subjects)) {
    for (const name of match[1]!.split(/[和与]/)) {
      if (names.has(name) || [...names].some(knownName => name.includes(knownName))) continue;
      if (/^(?:[他她它这那两三一众你我身镜画光眼双脚视]|随后|此时|接着|慢慢|缓缓|突然|转而|然后|转头|回头|偏头|抬头|低头|侧身|转身|快速|快步|缓步|慢步|向[左右前后东西南北])/.test(name)
        || /[前旁边处中后上下来向的着步]$/.test(name) || landmarks.some(([pattern]) => pattern.test(name))) continue;
      if (/^[\p{Script=Han}·]{2,4}$/u.test(name) || /^[A-Z][a-z]+$/.test(name)) names.add(name);
    }
  }
  return Array.from(names).slice(0, maxCast);
}

function markMentions(text: string, scene: StageScene) {
  return scene.marks.flatMap(mark => {
    const alias = landmarks.find(([, name]) => name === mark.name);
    const hits = new Set<number>();
    for (let i = text.indexOf(mark.name); i !== -1; i = text.indexOf(mark.name, i + mark.name.length)) hits.add(i);
    if (alias) for (const match of text.matchAll(new RegExp(alias[0].source, "g"))) hits.add(match.index!);
    return [...hits].map(index => ({ mark, index }));
  }).sort((a, b) => a.index - b.index);
}

const gazeVerb = /(?:看向|望向|望着|看着|面向|盯着|注视|对着)(?:画外|镜外|画面)?(?:左侧|右侧|左边|右边|左方|右方)?的?\s*$/;

function actorClause(actor: StageActor, description: string, scene: StageScene) {
  let clause = description.slice(description.indexOf(actor.name) + actor.name.length).split(/[。；！？\n]/, 1)[0]!;
  for (const other of scene.actors) {
    if (actor.id === other.id) continue;
    const next = clause.indexOf(other.name);
    // 作为视线或相对位置的参照时保留对方，否则下一位角色开始另一段调度。
    if (next >= 0 && !gazeVerb.test(clause.slice(0, next)) && !/(?:在|到|至|向|靠近)$/.test(clause.slice(0, next))) clause = clause.slice(0, next);
  }
  return clause;
}

function guessRoute(actor: StageActor, description: string, clause: string, scene: StageScene): ActorRoute {
  const prefix = description.slice(0, description.indexOf(actor.name));
  const route = still(!/(?:画外|镜外|镜头外)(?:左侧|右侧|左边|右边|左方|右方)?(?:的|传来)?\s*$/.test(prefix) && !/^\s*(?:[（(]?(?:画外[音声]?|镜外)|(?:始终)?(?:站)?在(?:画外|镜外|镜头外))/.test(clause));
  route.facing = /(?:面朝|面向|望向|朝向)([东西南北])(?:方|侧|面|边|[，。；\s]|$)/.exec(clause)?.[1] ?? "";
  for (const target of [...scene.actors, ...scene.marks]) {
    const index = clause.indexOf(target.name);
    if (target.id !== actor.id && index >= 0 && gazeVerb.test(clause.slice(0, index))) {
      route.facing = target.id;
      break;
    }
  }
  const places = markMentions(clause, scene);
  for (const { mark, index } of places) {
    const before = clause.slice(0, index);
    if (/绕过\s*$/.test(before)) route.via.push({ x: mark.at.x, y: limit(mark.at.y + (mark.at.y > 85 ? -12 : 12), 0, 100) });
    else if (/(?:经过|经由|途经|穿过)\s*$/.test(before)) route.via.push({ ...mark.at });
    else if (/(?:走向|走到|来到|到达|跑到|跑向|冲向|奔向|退到|移到|停在|走近|移至|跑至|走至|走进|退回|回到)\s*$/.test(before)) route.end = { ...mark.at };
    else if (/(?:从|站在|坐在|靠在|守在|倚在|立于|站到)\s*$/.test(before)) route.start = { ...mark.at };
  }
  return route;
}

export function draftBlocking(doc: ShotDocument, previous?: BlockingPlan): BlockingPlan {
  const plan: BlockingPlan = normalizeBlocking(previous) ?? { version: 1, scenes: [], shots: Object.create(null) };
  const saved = plan.shots;
  plan.shots = Object.create(null);
  const sceneAssets = doc.assets.filter(a => a.kind === "scene").sort((a, b) => b.name.length - a.name.length);
  const characterAssets = doc.assets.filter(a => a.kind === "character");
  const names = new Set(characterAssets.map(a => a.name));
  for (const shot of doc.shots) {
    for (const line of shot.dialogues) if (line.kind === "line" && line.speaker) names.add(speakerName(line.speaker));
  }
  const pending: { shot: Shot; scene: StageScene; present: string[]; stage: ShotStage }[] = [];
  const newActors = new Set<StageActor>();
  let lastScene: StageScene | undefined;
  let lastCamera: ShotStage["camera"] = "south";
  for (const shot of doc.shots.slice(0, maxShots)) {
    if (!safeId(shot.id) || Object.hasOwn(plan.shots, shot.id)) continue;
    const existing = saved[shot.id];
    if (existing) {
      lastScene = plan.scenes.find(scene => scene.id === existing.sceneId);
      lastCamera = existing.camera;
      plan.shots[shot.id] = existing;
      continue;
    }
    const mentions = mentionedAssets(shot.description, doc.assets);
    const asset = mentions.find(a => a.kind === "scene") ?? sceneAssets.find(a => shot.description.includes(a.name));
    const sceneId = asset && safeId(asset.id) ? asset.id : lastScene?.id ?? "mainStage";
    let scene = plan.scenes.find(s => s.id === sceneId || (asset && s.name === asset.name));
    if (!scene) {
      if (plan.scenes.length >= maxShots) continue;
      scene = { id: sceneId, name: asset?.name ?? "主场景", actors: [], marks: [] };
      plan.scenes.push(scene);
    }
    const text = plainDescription(shot.description);
    const present = naturalNames(shot, new Set([...names, ...scene.actors.map(a => a.name)]));
    for (const name of present) {
      if (scene.actors.length >= maxCast || scene.actors.some(a => a.name === name)) continue;
      const known = characterAssets.find(a => a.name === name);
      const candidate = known && safeId(known.id) ? known.id : "actor-" + name;
      const id = [...scene.actors, ...scene.marks].some(item => item.id === candidate) ? crypto.randomUUID() : candidate;
      const actor = { id, name, home: slot(scene.actors.length), locked: false };
      scene.actors.push(actor);
      newActors.add(actor);
    }
    const addMark = (id: string, name: string, at: Point) => {
      if (scene.marks.length >= maxCast || scene.marks.some(m => m.name === name)) return;
      const duplicate = [...scene.actors, ...scene.marks].some(item => item.id === id);
      scene.marks.push({ id: duplicate ? crypto.randomUUID() : id, name, at: { ...at } });
    };
    for (const [pattern, name, at] of landmarks) {
      if (pattern.test(text)) addMark("mark-" + name, name, at);
    }
    for (const prop of mentions.filter(a => a.kind === "prop")) {
      const alias = landmarks.find(([pattern]) => pattern.test(prop.name));
      if (!alias) addMark(safeId(prop.id) ? prop.id : "mark-" + prop.name, prop.name, slot(scene.marks.length + 3));
    }
    const cut = !lastScene || lastScene.id !== scene.id || /闪回|转场|多年后|次日|翌日|数日后|切至另一/.test(text);
    const direction = /([东南西北])侧(?:机位|拍摄)|(?:相机|机位|摄影机)(?:位于|设在|在|移至|移到)?([东南西北])侧/.exec(shot.camera + " " + text);
    const camera = cameras.find(key => cameraNames[key] === (direction?.[1] ?? direction?.[2])) ?? (cut ? "south" : lastCamera);
    const stage: ShotStage = { shotId: shot.id, sceneId: scene.id, cut, camera, focus: "", routes: emptyRoutes(), note: "" };
    plan.shots[shot.id] = stage;
    pending.push({ shot, scene, present, stage });
    lastScene = scene;
    lastCamera = camera;
  }
  for (const { shot, scene, present, stage } of pending) {
    const description = plainDescription(shot.description);
    const cast = scene.actors.filter(actor => present.includes(actor.name));
    const relative: { route: ActorRoute; target: string; side: number }[] = [];
    for (const actor of cast) {
      const inDescription = description.includes(actor.name);
      const clause = inDescription ? actorClause(actor, description, scene) : "";
      const route = inDescription ? guessRoute(actor, description, clause, scene) : still(true);
      if (shot.dialogues.some(line => line.kind === "line" && speakerName(line.speaker) === actor.name && voiceOver.test(line.speaker ?? ""))) route.visible = false;
      if (newActors.delete(actor) && route.start) actor.home = { ...route.start };
      if (!stage.cut) delete route.start;
      stage.routes[actor.id] = route;
      for (const target of cast) {
        if (target.id === actor.id) continue;
        const index = clause.indexOf(target.name);
        if (index < 0 || !/(?:在|至|到)\s*$/.test(clause.slice(0, index))) continue;
        const side = /^(?:的)?(左|右)(?:手边|侧|边|方)/.exec(clause.slice(index + target.name.length));
        if (side) relative.push({ route, target: target.id, side: side[1] === "左" ? -1 : 1 });
      }
    }
    if (relative.length) {
      const locations = resolveTracks(plan, doc.shots, shot.id);
      for (const { route, target, side } of relative) {
        const at = locations.find(track => track.actor.id === target)!.points.at(-1)!;
        const offset = (stage.camera === "north" || stage.camera === "east" ? -1 : 1) * 12 * side;
        route.end = stage.camera === "north" || stage.camera === "south"
          ? { x: limit(at.x + offset, 0, 100), y: at.y } : { x: at.x, y: limit(at.y + offset, 0, 100) };
      }
    }
    const onCamera = cast.filter(a => stage.routes[a.id]!.visible);
    if (onCamera.length === 1) stage.focus = onCamera[0]!.id;
  }
  return plan;
}

export function resolveTracks(plan: BlockingPlan, shots: readonly Shot[], shotId: string) {
  const stage = plan.shots[shotId], index = shots.findIndex(s => s.id === shotId);
  const scene = stage && plan.scenes.find(s => s.id === stage.sceneId);
  if (!stage || !scene || index < 0) return [];
  const inherited = new Map<string, Point>();
  const needed = new Set(scene.actors.filter(a => !a.locked && !stage.routes[a.id]?.start).map(a => a.id));
  for (let i = index - 1; !stage.cut && needed.size && i >= 0; i--) {
    const previous = plan.shots[shots[i]!.id];
    if (!previous || previous.sceneId !== scene.id) break;
    for (const id of needed) {
      const route = previous.routes[id];
      const last = route?.end ?? route?.via.at(-1) ?? route?.start;
      if (last) { inherited.set(id, last); needed.delete(id); }
    }
    if (previous.cut) break;
  }
  return scene.actors.map(actor => {
    const route = stage.routes[actor.id] ?? still();
    const start = actor.locked ? actor.home : route.start ?? inherited.get(actor.id) ?? actor.home;
    const points = actor.locked ? [start, start] : [start, ...route.via, route.end ?? route.via.at(-1) ?? start];
    return { actor, route, points };
  });
}

export function pointAt(points: Point[], fraction: number): Point {
  if (!points.length) return { ...center };
  const f = Number.isFinite(fraction) ? limit(fraction, 0, 1) : 0;
  if (f === 0) return { ...points[0]! };
  if (f === 1) return { ...points.at(-1)! };
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * f;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (length && remaining <= length) {
      const start = points[i]!, end = points[i + 1]!, t = remaining / length;
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    }
    remaining -= length;
  }
  return { ...points.at(-1)! };
}

const zoomBySize: Record<string, number> = { 大远景: 0.54, 远景: 0.72, 全景: 1, 中远景: 1.18, 中景: 1.48, 中近景: 1.85, 近景: 2.25, 特写: 3.1, 大特写: 4 };
export function projectPoint(p: Point, camera: ShotStage["camera"], focus: Point, shotSize: string) {
  const dx = p.x - focus.x, dy = p.y - focus.y;
  const horizontal = camera === "south" ? dx : camera === "north" ? -dx : camera === "west" ? dy : -dy;
  const depth = camera === "south" ? dy : camera === "north" ? -dy : camera === "west" ? -dx : dx;
  const zoom = Object.hasOwn(zoomBySize, shotSize) ? zoomBySize[shotSize]! : 1.48;
  const perspective = 1 / (1 - depth / 250);
  // 固定取景中心。百分比可以落在画外，近景抬高镜头后，人物脚点可以低于画面底边。
  return { x: 50 + horizontal * 0.94 * zoom * perspective, y: 79 + (zoom - 1) * 55 + depth * 0.46 * zoom * perspective, scale: 2.1 * zoom * perspective };
}

const promptName = (s: string, max = 30) => s.replace(/[@\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const axis = (n: number, left: string, right: string) => n < 35 ? left : n > 65 ? right : "中";
function stageLocation(p: Point, scene: StageScene) {
  let near: StageMark | undefined, distance = 16;
  for (const mark of scene.marks) {
    const d = Math.hypot(p.x - mark.at.x, p.y - mark.at.y);
    if (d < distance) { near = mark; distance = d; }
  }
  if (near) return promptName(near.name) + "附近";
  const ns = axis(p.y, "北", "南"), ew = axis(p.x, "西", "东");
  return ns === "中" && ew === "中" ? "场中央" : "场地" + (ew === "中" ? "" : ew) + (ns === "中" ? "" : ns) + "侧";
}

export function shotConstraint(plan: BlockingPlan, shots: readonly Shot[], shotId: string): StageConstraint | undefined {
  const stage = plan.shots[shotId], shot = shots.find(s => s.id === shotId);
  const scene = stage && plan.scenes.find(s => s.id === stage.sceneId);
  if (!stage || !shot || !scene) return;
  const tracks = resolveTracks(plan, shots, shotId);
  const focusActor = tracks.find(t => t.actor.id === stage.focus);
  const focusMark = scene.marks.find(m => m.id === stage.focus);
  const focus = focusActor?.points[0] ?? focusMark?.at ?? center;
  const subject = focusActor?.actor.name ?? focusMark?.name;
  const screen = (p: Point) => {
    const { x, y, scale } = projectPoint(p, stage.camera, focus, shot.shotSize);
    if (x < 0 || x > 100) return x < 0 ? "画外左侧" : "画外右侧";
    if (y < 0 || y - 28 * scale > 100) return "画外";
    const lateral = x < 35 ? "画左" : x > 65 ? "画右" : "画面中央";
    const depth = stage.camera === "south" ? p.y : stage.camera === "north" ? 100 - p.y : stage.camera === "west" ? 100 - p.x : p.x;
    return lateral + (depth > 65 ? "前景" : depth < 35 ? "后景" : "中层");
  };
  const coord = (p: Point) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
  const position = (p: Point) => stageLocation(p, scene) + "（" + coord(p) + "，" + screen(p) + "）";
  const intro = `场景${promptName(scene.name)}，机位在${cameraNames[stage.camera]}侧，${promptName(shot.shotSize)}${subject ? "，取景中心为" + promptName(subject) : ""}。`;
  const map = "俯视坐标按西→东、北→南各0至100。"
    + (scene.marks.length ? scene.marks.slice(0, 8).map(m => promptName(m.name, 16) + "(" + coord(m.at) + ")").join("、") + "。" : "");
  const image = [intro, map], endImage = [intro, map], video = [intro, map];
  const hidden = tracks.filter(t => !t.route.visible);
  if (hidden.length) {
    const off = "保持画外：" + hidden.map(t => promptName(t.actor.name, 16)).join("、") + "。";
    image.push(off); endImage.push(off); video.push(off);
  }
  for (const { actor, route, points } of tracks.filter(t => t.route.visible)) {
    const first = points[0]!, last = points.at(-1)!;
    const targetActor = tracks.find(t => t.actor.id === route.facing);
    const targetMark = scene.marks.find(m => m.id === route.facing);
    const facing = promptName(targetActor?.actor.name ?? targetMark?.name ?? route.facing);
    const look = (at: Point, index: number) => {
      if (!facing) return "";
      const target = targetActor?.points.at(index) ?? targetMark?.at;
      if (!target) return "，面向" + facing;
      const dx = projectPoint(target, stage.camera, focus, shot.shotSize).x - projectPoint(at, stage.camera, focus, shot.shotSize).x;
      return "，面向" + facing + (Math.abs(dx) < 4 ? "" : dx < 0 ? "，视线朝画左" : "，视线朝画右");
    };
    const name = promptName(actor.name);
    const fixed = actor.locked ? "，全程固定站位" : "";
    image.push(`${name}在${position(first)}${look(first, 0)}${fixed}。`);
    endImage.push(`${name}在${position(last)}${look(last, -1)}${fixed}。`);
    const stops = points.slice(1, -1).filter((p, i, arr) => (i === 0 || p.x !== arr[i - 1]!.x || p.y !== arr[i - 1]!.y) && (p.x !== last.x || p.y !== last.y));
    const moving = points.some(p => p.x !== first.x || p.y !== first.y);
    if (!moving) {
      const firstLook = look(first, 0), lastLook = look(first, -1);
      video.push(`${name}保持在${position(first)}${firstLook}${firstLook !== lastLook ? "，结尾" + lastLook.slice(1) : ""}。`);
    }
    else {
      const via = stops.length ? "，途经" + stops.slice(0, 4).map(p => position(p)).join("、") : "";
      video.push(`${name}从${position(first)}${via}，落位到${position(last)}${look(last, -1)}。`);
    }
  }
  if (stage.note) { const note = "调度备注：" + promptName(stage.note, 240); image.push(note); video.push(note); }
  return { image: image.join("").slice(0, 2500), endImage: endImage.join("").slice(0, 2500), video: video.join("").slice(0, 3500) };
}
