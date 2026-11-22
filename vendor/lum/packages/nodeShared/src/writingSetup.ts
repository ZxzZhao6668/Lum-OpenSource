export type WritingSetupSnapshot = {
  shotId: string; projectId: string; workspaceEpoch: string; episodeId: string; sceneId?: string; locked: boolean;
  characters?: {entityId:string;name:string;identity:string;appearance:string;lockedFields:('identity'|'appearance')[]}[];
  visual: null | {
    projectId: string; workspaceEpoch: string; episodeId: string; sceneId?: string; setupRevision: number; setupVersionId: string;
    sourceVersions: {key: string; fingerprint: string; revision?: number}[];
    profileVersions: {entityId: string; fingerprint: string; revision: number}[];
    worldVersions: {id: string; fingerprint: string}[];
    style: {customText: string; referenceMediaId?: string; preset?: {
      id: string; label: string; description?: string; palette: string; light: string; texture: string; composition: string;
    }};
  };
};
type CanvasSetup = {setupSnapshots?: WritingSetupSnapshot[]; styleOverride?: string; projectStyle?: CurrentProjectStyle | null};
export type CurrentProjectStyle = {revision: number; versionId: string; style: string; locked: boolean; referenceMediaId?: string};
const bad = () => {throw Error("镜头画风快照无效");};
function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) return bad();
  return value as Record<string, unknown>;
}
function string(value: unknown, limit: number, empty = false) {
  if (typeof value !== "string" || (!empty && !value.length) || value.length > limit || value.includes("\0")) return bad();
  return value;
}
function integer(value: unknown, minimum: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return bad();
  return value;
}
function fingerprint(value: unknown) {
  if (!/^[0-9a-f]{64}$/.test(string(value, 64))) return bad();
}
function list(value: unknown, limit: number, read: (item: unknown) => void) {
  if (!Array.isArray(value) || value.length > limit) return bad();
  value.forEach(read);
}
function referenceMediaId(value: unknown) {
  if (value !== undefined && !/^sha256:[a-f0-9]{64}$/.test(string(value, 71))) return bad();
}
export function parseWritingSetup(value: unknown): WritingSetupSnapshot {
  const identity = ["projectId","workspaceEpoch","episodeId","sceneId"];
  const v = record(value, [...identity,"shotId","locked","visual","characters"]);
  string(v.shotId, 200); string(v.projectId, 200); string(v.episodeId, 200); string(v.workspaceEpoch, 200, true);
  if (v.sceneId !== undefined) string(v.sceneId, 210);
  if (typeof v.locked !== "boolean") return bad();
  if (v.characters !== undefined) list(v.characters, 100, item=>{
    const c=record(item,['entityId','name','identity','appearance','lockedFields']);
    string(c.entityId,200);string(c.name,1000);string(c.identity,4000,true);string(c.appearance,4000,true);
    list(c.lockedFields,2,field=>{if(field!=='identity'&&field!=='appearance')bad();});
  });
  if (v.visual === null) {
    if (v.locked || Array.isArray(v.characters) && v.characters.length) return bad();
    return value as WritingSetupSnapshot;
  }
  const visual = record(v.visual, [...identity,"setupRevision","setupVersionId","sourceVersions","profileVersions","worldVersions","style"]);
  if (identity.some(key => visual[key] !== v[key])) return bad();
  integer(visual.setupRevision, 1); string(visual.setupVersionId, 200);
  list(visual.sourceVersions, 1100, item => {
    const r = record(item, ["key","fingerprint","revision"]);
    string(r.key, 1000); fingerprint(r.fingerprint);
    if (r.revision !== undefined) integer(r.revision, 0);
  });
  list(visual.profileVersions, 10000, item => {
    const r = record(item, ["entityId","fingerprint","revision"]);
    string(r.entityId, 200); fingerprint(r.fingerprint); integer(r.revision, 0);
  });
  list(visual.worldVersions, 500, item => {
    const r = record(item, ["id","fingerprint"]);
    string(r.id, 200); fingerprint(r.fingerprint);
  });
  const style = record(visual.style, ["customText","referenceMediaId","preset"]);
  string(style.customText, 4000, true); referenceMediaId(style.referenceMediaId);
  if (style.preset !== undefined) {
    const p = record(style.preset, ["id","label","description","palette","light","texture","composition"]);
    string(p.id, 128); string(p.label, 120);
    if (p.description !== undefined) string(p.description, 1200, true);
    for (const key of ["palette","light","texture","composition"]) string(p[key], 600, true);
  }
  return value as WritingSetupSnapshot;
}

export function parseCurrentProjectStyle(value: unknown) {
  if (value === null) return null;
  const v = record(value, ["revision","versionId","style","locked","referenceMediaId"]);
  integer(v.revision, 1); string(v.versionId, 200); string(v.style, 8000, true); referenceMediaId(v.referenceMediaId);
  if (typeof v.locked !== "boolean") return bad();
  return value as CurrentProjectStyle;
}

export function writingSetupStyle(data?: CanvasSetup) {
  if (data && Object.hasOwn(data,"projectStyle")) return data.projectStyle
    ? {label: `固定项目设定 v${data.projectStyle.revision}`, text: data.projectStyle.style}
    : {label:"保持旧行为 · 不使用项目画风",text:""};
  const override = data?.styleOverride?.trim();
  if (override && !data?.setupSnapshots?.some(item => item.locked) && !data?.projectStyle?.locked) return {label: "本次覆盖", text: override};
  if (!data?.setupSnapshots?.length) return {label: "", text: ""};
  const lines = data.setupSnapshots.map(snapshot => {
    const s = snapshot.visual?.style, p = s?.preset;
    return {revision: snapshot.visual?.setupRevision, text: [p?.label,p?.description,p?.palette,p?.light,p?.texture,p?.composition,s?.customText].filter(Boolean).join("；")};
  });
  const revisions = [...new Set(lines.flatMap(line => line.revision === undefined ? [] : [`v${line.revision}`]))];
  const unique = [...new Set(lines.map(line => line.text))];
  return {label: revisions.length ? `固定项目设定 ${revisions.join(" / ")}` : "保持旧行为 · 不使用项目画风",
    text: unique.length === 1 ? unique[0]! : lines.map((line, index) => `第 ${index + 1} 镜：${line.text || "保持原画面风格"}`).join("\n")};
}

export function removeWritingSetupStyle(prompt: string, style: string) {
  return style ? prompt.split("\n\n").filter(part=>![`画面风格（本次生效）：${style}`,`视频风格：${style}`,`美术风格：${style}`].includes(part)).join("\n\n") : prompt;
}

export function applyWritingSetupStyle(prompt: string, data?: CanvasSetup) {
  const {text} = writingSetupStyle(data);
  if (!prompt.trim() || !text) return prompt;
  const line = `画面风格（本次生效）：${text}`;
  const clean = removeWritingSetupStyle(prompt,text);
  return `${clean.trim()}\n\n${line}`;
}
