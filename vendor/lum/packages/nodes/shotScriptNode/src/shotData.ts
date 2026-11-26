import type { BlockingPlan } from "./blockingTypes";
import { normalizeBlocking } from "./shotBlocking";
import { normalizeGrid, type GridSettings } from "./storyboardGrid";

/** 脚本节点的数据格式（assets/<节点ID>/shots.json），说明见实施记录 dataFormat.md。 */
export type AssetKind = "character" | "scene" | "prop";
export interface ShotDialogue { kind: "line" | "narration"; speaker?: string; text: string }
export interface Shot {
  id: string;
  duration: number;
  description: string;
  shotSize: string;
  lighting: string;
  dialogues: ShotDialogue[];
  sound: string;
  camera: string;
  color: string;
  imagePrompt: string;
  videoPrompt: string;
  promptMode: "smart" | "concat";
}
export interface ShotAsset {
  id: string;
  kind: AssetKind;
  name: string;
  description: string;
  image: { path: string; mimeType: string } | null;
  nodeId: string | null;
}
export interface ShotDocument {
  lumShots: 1;
  toonflowShots?: 1;
  sourceNodeId: string | null;
  episodeId: string | null;
  episodeTitle: string;
  mode: "script" | "character" | "manual" | null;
  step: 1 | 2 | 3;
  style: string;
  shots: Shot[];
  assets: ShotAsset[];
  blocking?: BlockingPlan;
  grid?: GridSettings;
  batch: {
    assetGroupId: string | null; imageGroupId: string | null; videoGroupId: string | null;
    imageNodes: Record<string, string>; videoNodes: Record<string, string>;
    endFrameNodes?: Record<string, string>; gridImageNodes?: Record<string, string>;
  };
}

export const shotSizes = ["大远景", "远景", "全景", "中远景", "中景", "中近景", "近景", "特写", "大特写"];
export const cameraPresets = ["推镜", "拉镜", "摇镜", "移镜", "跟镜", "升降", "俯拍", "仰拍", "固定镜头", "手持晃动"];
export const assetKindLabels: Record<AssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };
export const rowColors = ["", "#e5484d33", "#f5a52433", "#30a46c33", "#3e63dd33", "#8e4ec633"];

export function createShot(partial: Partial<Shot> = {}): Shot {
  return { id: crypto.randomUUID(), duration: 5, description: "", shotSize: "中景", lighting: "", dialogues: [], sound: "", camera: "", color: "", imagePrompt: "", videoPrompt: "", promptMode: "smart", ...partial };
}
export function createShotDocument(): ShotDocument {
  return {
    lumShots: 1, toonflowShots: 1, sourceNodeId: null, episodeId: null, episodeTitle: "", mode: null, step: 1, style: "", shots: [], assets: [],
    batch: { assetGroupId: null, imageGroupId: null, videoGroupId: null, imageNodes: {}, videoNodes: {} },
  };
}

const str = (value: unknown, max = 20000) => typeof value === "string" ? value.slice(0, max) : "";
const num = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(60, Math.round(parsed * 10) / 10) : fallback;
};
function normalizeDialogues(value: unknown): ShotDialogue[] {
  if (typeof value === "string") return value.trim() && value.trim() !== "—" ? [{ kind: "line", text: value.trim() }] : [];
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const text = str(raw.text, 2000).trim();
    if (!text) return [];
    const kind = raw.kind === "narration" ? "narration" : "line";
    return [{ kind, ...(kind === "line" && str(raw.speaker, 60).trim() ? { speaker: str(raw.speaker, 60).trim() } : {}), text }];
  });
}
export function normalizeShot(value: unknown): Shot {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return createShot({
    id: str(raw.id, 64) || crypto.randomUUID(),
    duration: num(raw.duration, 5),
    description: str(raw.description, 4000),
    shotSize: str(raw.shotSize, 20) || "中景",
    lighting: str(raw.lighting, 1000),
    dialogues: normalizeDialogues(raw.dialogues),
    sound: str(raw.sound, 1000),
    camera: str(raw.camera, 1000),
    color: str(raw.color, 20),
    imagePrompt: str(raw.imagePrompt, 8000),
    videoPrompt: str(raw.videoPrompt, 8000),
    promptMode: raw.promptMode === "concat" ? "concat" : "smart",
  });
}
export function normalizeShotDocument(value: unknown): ShotDocument {
  if (!value || typeof value !== "object") throw new Error("不是脚本节点文件");
  const raw = value as Record<string, unknown>;
  if (raw.lumShots !== 1 && raw.toonflowShots !== 1) throw new Error("不是脚本节点文件");
  const base = createShotDocument();
  const batch = (raw.batch && typeof raw.batch === "object" ? raw.batch : {}) as Record<string, unknown>;
  const ids = (item: unknown) => Object.fromEntries(Object.entries(item && typeof item === "object" ? item : {}).filter(([, id]) => typeof id === "string")) as Record<string, string>;
  const shots = (Array.isArray(raw.shots) ? raw.shots : []).slice(0, 300).map(normalizeShot);
  return {
    ...base,
    sourceNodeId: str(raw.sourceNodeId, 64) || null,
    episodeId: str(raw.episodeId, 64) || null,
    episodeTitle: str(raw.episodeTitle, 200),
    mode: raw.mode === "script" || raw.mode === "character" || raw.mode === "manual" ? raw.mode : null,
    step: raw.step === 2 || raw.step === 3 ? raw.step : 1,
    style: str(raw.style, 2000),
    blocking: normalizeBlocking(raw.blocking),
    ...(raw.grid ? { grid: normalizeGrid(raw.grid, shots) } : {}),
    shots,
    assets: (Array.isArray(raw.assets) ? raw.assets : []).slice(0, 200).flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const asset = item as Record<string, unknown>;
      const name = str(asset.name, 80).trim();
      if (!name) return [];
      const image = asset.image && typeof asset.image === "object" ? asset.image as Record<string, unknown> : null;
      return [{
        id: str(asset.id, 64) || crypto.randomUUID(),
        kind: asset.kind === "scene" || asset.kind === "prop" ? asset.kind : "character",
        name, description: str(asset.description, 2000),
        image: image && str(image.path, 500) ? { path: str(image.path, 500), mimeType: str(image.mimeType, 80) || "image/png" } : null,
        nodeId: str(asset.nodeId, 64) || null,
      } satisfies ShotAsset];
    }),
    batch: {
      assetGroupId: str(batch.assetGroupId, 64) || null, imageGroupId: str(batch.imageGroupId, 64) || null, videoGroupId: str(batch.videoGroupId, 64) || null,
      imageNodes: ids(batch.imageNodes), videoNodes: ids(batch.videoNodes),
      ...(batch.endFrameNodes ? {endFrameNodes: ids(batch.endFrameNodes)} : {}),
      ...(batch.gridImageNodes ? {gridImageNodes: ids(batch.gridImageNodes)} : {}),
    },
  };
}

/** 画面描述里的 `@名字`，按资产名最长优先匹配。 */
export function mentionedAssets(text: string, assets: ShotAsset[]) {
  const names = [...assets].sort((a, b) => b.name.length - a.name.length);
  const found: ShotAsset[] = [];
  let rest = text;
  for (const asset of names) {
    if (rest.includes(`@${asset.name}`)) { found.push(asset); rest = rest.split(`@${asset.name}`).join(" "); }
  }
  return found;
}
export function plainDescription(text: string) {
  return text.replace(/@(\S)/g, "$1");
}
export function dialogueText(shot: Shot) {
  return shot.dialogues.map(item => item.kind === "narration" ? `旁白：${item.text}` : `${item.speaker ? `${item.speaker}：` : ""}${item.text}`).join("\n");
}
export function totalDuration(shots: Shot[]) {
  return Math.round(shots.reduce((total, shot) => total + shot.duration, 0));
}

/** 自动拼接：不调用模型，按模板把画面、资产、光影、运镜和对白拼起来。 */
export function concatImagePrompt(shot: Shot, document: ShotDocument) {
  const assets = mentionedAssets(shot.description, document.assets);
  const scene = assets.find(item => item.kind === "scene");
  const people = assets.filter(item => item.kind !== "scene");
  return [
    `${shot.shotSize}。${plainDescription(shot.description)}`,
    scene && `场景：${scene.name}，${scene.description}`,
    ...people.map(item => `${item.name}：${item.description}`),
    shot.lighting && `光影氛围：${shot.lighting}`,
    document.style && `【视觉风格：${document.style}】`,
    "画面中不出现文字、字幕和水印。",
  ].filter(Boolean).join("\n");
}
export function concatVideoPrompt(shot: Shot, document: ShotDocument) {
  const assets = mentionedAssets(shot.description, document.assets);
  const people = assets.filter(item => item.kind === "character");
  const scene = assets.find(item => item.kind === "scene");
  const props = assets.filter(item => item.kind === "prop");
  return [
    people.length && `出场角色：${people.map(item => `@${item.name}（${item.description.slice(0, 60)}）`).join("　")}`,
    scene && `背景场景：@${scene.name}（${scene.description.slice(0, 80)}）`,
    props.length && `道具：${props.map(item => `@${item.name}`).join("、")}`,
    `画面（${shot.duration} 秒，${shot.shotSize}）：${plainDescription(shot.description)}`,
    shot.camera && `运镜：${shot.camera}`,
    shot.lighting && `光影氛围：${shot.lighting}`,
    shot.dialogues.length && `对白：\n${dialogueText(shot)}`,
    shot.sound && `音效：${shot.sound}`,
    "参考图使用规则：角色参考图只参考形象，不参考角度、构图、姿势、表情；场景参考图只参考空间结构与光线；首帧图决定构图与起始姿态。",
    document.style && `【视觉风格：${document.style}】`,
  ].filter(Boolean).join("\n");
}

export function shotsMarkdown(document: ShotDocument) {
  const cell = (value: string) => value.replace(/\|/g, "／").replace(/\r?\n/g, "<br>") || "—";
  const rows = document.shots.map((shot, index) => `| ${index + 1} | ${shot.duration}s | ${cell(shot.description)} | ${shot.shotSize} | ${cell(shot.lighting)} | ${cell(dialogueText(shot))} | ${cell(shot.sound)} | ${cell(shot.camera)} |`);
  return [
    `# 分镜脚本 · ${document.episodeTitle || "未命名"}`,
    document.style ? `> 全局风格：${document.style}` : "",
    "",
    "| 镜号 | 时长 | 画面描述 | 景别 | 光影氛围 | 对白·旁白 | 音效 | 运镜 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** 模型返回的 JSON 可能包了代码块或前后有说明，取第一个完整的 JSON 对象。 */
export function parseJsonReply(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("模型没有返回 JSON");
  const open = body[start]!, close = open === "{" ? "}" : "]";
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < body.length; index++) {
    const char = body[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quoted = false;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return JSON.parse(body.slice(start, index + 1));
  }
  throw new Error("模型返回的 JSON 不完整，可能输出被截断，请减少镜头数或换用输出更长的模型");
}
