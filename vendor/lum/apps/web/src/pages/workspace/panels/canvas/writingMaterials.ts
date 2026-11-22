import type { Edge, Node } from "@vue-flow/core";
import type useWorkspaceFiles from "@/lib/workspaceFiles";
import { remapNodeReferences } from "./canvasFiles";
import { parseWritingSetup, type WritingSetupSnapshot } from "@lum/node-shared/writingSetup";
import { parseVideoContinuity } from "@lum/node-shared/videoContinuity";

export type WritingMaterial = { key: string; sourceKey: string; kind: "text" | "image"; label: string; text?: string; image?: { path: string; mimeType: string }; imageSource?: {assetId: string; appearanceId: string; revision: number; viewId: string; mediaId: string}; episodeId?: string; referenceKeys?: string[]; setupSnapshot?: WritingSetupSnapshot; entityKind?: "character" | "location" | "prop" };
export function parseWritingMaterials(value: unknown): WritingMaterial[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new Error("一次最多送入 200 个素材节点");
  let total = 0;
  const keys = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || !["text", "image"].includes(item.kind)
      || typeof item.key !== "string" || !/^(entity|assetView|scene|shot|clip|styleRef):[\w:.-]{1,400}:(text|image)$/.test(item.key)
      || typeof item.sourceKey !== "string" || item.key !== `${item.sourceKey}:${item.kind}` || keys.has(item.key)
      || typeof item.label !== "string" || !item.label || item.label.length > 500) throw new Error("素材标识或名称无效");
    if (item.imageSource !== undefined) {
      const pin = item.imageSource;
      if (item.kind !== 'image' || !pin || ![pin.assetId,pin.appearanceId,pin.viewId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))
        || !Number.isSafeInteger(pin.revision) || pin.revision < 1 || !/^sha256:[a-f0-9]{64}$/.test(pin.mediaId)
        || item.sourceKey !== `assetView:${pin.assetId}:${pin.appearanceId}:${pin.revision}:${pin.viewId}`) throw new Error('共用视图版本标识无效');
    }
    if (item.sourceKey.startsWith("styleRef:") && (item.kind !== "image" || !/^styleRef:sha256:[a-f0-9]{64}$/.test(item.sourceKey))) throw Error("画风参考图片标识无效");
    const setupSnapshot = item.setupSnapshot === undefined ? undefined : parseWritingSetup(item.setupSnapshot);
    if (setupSnapshot && (item.sourceKey !== `shot:${item.episodeId}:${setupSnapshot.shotId}` || typeof item.episodeId !== "string")) throw Error("镜头素材与画风快照来源不符");
    const referenceKeys = item.referenceKeys;
    if (referenceKeys !== undefined && (item.kind !== 'text' || !item.sourceKey.startsWith('shot:') || !Array.isArray(referenceKeys) || referenceKeys.length > 100 ||
      referenceKeys.some(key=>typeof key!=='string'||! /^(entity|assetView):[\w:.-]{1,400}$/.test(key)))) throw Error('分镜参考图片标识无效');
    keys.add(item.key);
    if (item.kind === "text") {
      if (typeof item.text !== "string" || item.text.length > 100000 || item.text.includes("\0")) throw new Error("素材文字无效或过长");
      total += item.text.length;
    } else if (!item.image || typeof item.image.path !== "string" || !/^assets\/[\w\-/ .]+\.(png|jpg|jpeg|webp|gif)$/i.test(item.image.path)
      || item.image.path.split("/").some((part: string) => part === ".." || part === ".")
      || !/^image\/(png|jpeg|webp|gif)$/.test(item.image.mimeType)) throw new Error("素材图片路径无效");
    if (total > 2000000) throw new Error("素材文字总量过大，请分批送入");
    return { ...(referenceKeys ? {referenceKeys:[...new Set<string>(referenceKeys)]} : {}), ...(setupSnapshot ? {setupSnapshot} : {}), ...(item.imageSource ? {imageSource: {assetId:item.imageSource.assetId,appearanceId:item.imageSource.appearanceId,revision:item.imageSource.revision,viewId:item.imageSource.viewId,mediaId:item.imageSource.mediaId}} : {}), key: item.key, sourceKey: item.sourceKey, kind: item.kind, label: item.label, ...(item.kind === "text" ? { text: item.text } : { image: { path: item.image.path, mimeType: item.image.mimeType } }), ...(typeof item.episodeId === "string" ? { episodeId: item.episodeId.slice(0, 200) } : {}), ...(["character", "location", "prop"].includes(item.entityKind) ? { entityKind: item.entityKind } : {}) };
  });
}
export async function materialNodeId(key: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return `writing-${Array.from(bytes).map(v => v.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

/** 老版自由画布按素材共用文本文件；打开时复制为独立节点，原文件保留。 */
export async function isolateWritingTextNodes(files: ReturnType<typeof useWorkspaceFiles>, canvas: { nodes: Node[]; edges: Edge[] }, signal?: AbortSignal) {
  const ids = new Map<string, string>();
  for (const node of canvas.nodes) {
    const key = node.data?.writingSource?.key;
    if (node.type !== "remote-textNode" || typeof key !== "string" || node.id !== await materialNodeId(key)) continue;
    signal?.throwIfAborted();
    const oldPath = `assets/${node.id}/content.md`;
    if (node.data.textPath !== undefined && node.data.textPath !== oldPath) throw new Error("旧素材文本路径无效，已保留原画布");
    const text = node.data.textSnapshot ?? (node.data.textPath ? (await files.readTextSnapshot(oldPath, { signal })).text : node.data.outputs?.text?.value ?? node.data.writingSource.content);
    if (typeof text !== "string") throw new Error("旧素材文本无效，已保留原画布");
    const id = `writing-${crypto.randomUUID()}`;
    await files.mkdir("assets").catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "EEXIST") throw error;
    });
    // 正文中的相对图片/附件以节点目录解析，需要一起复制。
    await files.copy(`assets/${node.id}`, `assets/${id}`).catch(async (error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
      await files.mkdir(`assets/${id}`);
    });
    await files.write(`assets/${id}/content.md`, text);
    signal?.throwIfAborted();
    ids.set(node.id, id);
    node.id = id;
    node.data.textPath = `assets/${id}/content.md`;
  }
  if (!ids.size) return false;
  for (const node of canvas.nodes) {
    if (node.parentNode) node.parentNode = ids.get(node.parentNode) ?? node.parentNode;
    remapNodeReferences(node, ids, false);
  }
  for (const edge of canvas.edges) {
    edge.source = ids.get(edge.source) ?? edge.source;
    edge.target = ids.get(edge.target) ?? edge.target;
  }
  return true;
}

export function parseProductionSetup(value: unknown, items: WritingMaterial[]) {
  if (value === undefined) return;
  if (!value || typeof value !== "object") throw new Error("制片参数无效");
  const setup = value as { clipId?: unknown; duration?: unknown; mode?: unknown; batchId?: unknown; continuity?: unknown; setupSnapshots?: unknown; styleOverride?: unknown };
  if (typeof setup.clipId !== "string" || !/^[\w-]{1,100}$/.test(setup.clipId)
    || (setup.batchId !== undefined && (typeof setup.batchId !== "string" || !/^[\w-]{1,100}$/.test(setup.batchId)))
    || typeof setup.duration !== "number" || !Number.isFinite(setup.duration) || setup.duration <= 0 || setup.duration > 360000
    || !items.some(item => item.key === `clip:${setup.clipId}:text` && item.kind === "text")
    || (setup.mode !== undefined && setup.mode !== "video" && setup.mode !== "previs")) throw new Error("胶卷或制作说明无效");
  const continuity = parseVideoContinuity(setup.continuity);
  if (continuity && items.some(item => item.sourceKey.startsWith("shot:") && item.episodeId !== continuity.episodeId)) throw Error("镜头衔接资料不属于本章节");
  const snapshots = setup.setupSnapshots;
  if (snapshots !== undefined && (!Array.isArray(snapshots) || snapshots.length > 100)) throw Error('胶卷画风快照过多或无效');
  const setupSnapshots = (snapshots as unknown[] | undefined)?.map(parseWritingSetup);
  if (setupSnapshots?.some((snapshot, index) => setupSnapshots.findIndex(s => s.shotId === snapshot.shotId) !== index || !items.some(item => item.kind === 'text' && item.sourceKey === `shot:${item.episodeId}:${snapshot.shotId}` && JSON.stringify(item.setupSnapshot) === JSON.stringify(snapshot)))) throw Error('胶卷与镜头画风快照不符');
  const styleOverride = setup.styleOverride;
  if (styleOverride !== undefined && (typeof styleOverride !== 'string' || styleOverride.length > 2000 || styleOverride.includes('\0') || styleOverride.trim() && setupSnapshots?.some(snapshot => snapshot.locked))) throw Error('胶卷画风覆盖无效或已锁定');
  return { setupSnapshots, styleOverride, clipId: setup.clipId, batchId: setup.batchId as string | undefined, duration: setup.duration, mode: setup.mode === "previs" ? "previs" : "video", continuity };
}
