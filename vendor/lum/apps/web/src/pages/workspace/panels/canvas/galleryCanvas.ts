import type { Edge, Node } from "@vue-flow/core";
import { galleryMediaPath, outputKind, parseGalleryMedia, type GalleryMedia } from "./galleryMedia";
import { getPromptText } from "@lum/node-shared/promptText";

const nodeTypes = ["canvasGroup", "remote-textNode", "remote-imageNode", "remote-videoNode", "remote-audioNode",
  "remote-imageGenerationNode", "remote-videoGenerationNode", "remote-audioGenerationNode"] as const;
type GalleryType = (typeof nodeTypes)[number];
type GalleryNode = { id: string; type: GalleryType; label: string; x: number; y: number;
  parent?: string; width?: number; height?: number; text?: string; prompt?: string; media?: GalleryMedia };
type GalleryEdge = { source: string; target: string; sourceHandle?: string; targetHandle?: string };
export type GalleryMetadata = { title: string; author: string; description: string };
export type GalleryCanvas = GalleryMetadata & { format: "lum-canvas-gallery"; version: 1; nodes: GalleryNode[]; edges: GalleryEdge[] };
export const galleryMaxBytes = 20 * 1024 * 1024;
const nodeId = /^n[1-9]\d{0,3}$/;
const portId = /^[\w-]{1,80}$/;

function invalid(reason: string): never { throw new Error(reason); }
function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    invalid("分享文件含有无效或未支持的字段");
  }
  return value as Record<string, unknown>;
}
function stringField(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || (required && !value.trim())) {
    invalid("请检查作品文字字段的长度和内容");
  }
  return value;
}
function numberField(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid("画布坐标或尺寸超出范围");
  return value;
}
function idField(value: unknown) {
  if (typeof value !== "string" || !nodeId.test(value)) invalid("画布节点编号无效");
  return value;
}
function portField(value: unknown) {
  if (typeof value !== "string" || !portId.test(value)) invalid("画布连接端口无效");
  return value;
}

export function parseGalleryCanvas(value: unknown): GalleryCanvas {
  const raw = record(value, ["format", "version", "title", "author", "description", "nodes", "edges"]);
  if (raw.format !== "lum-canvas-gallery" || raw.version !== 1) invalid("当前版本不支持此分享文件");
  if (!Array.isArray(raw.nodes) || !raw.nodes.length || raw.nodes.length > 500 || !Array.isArray(raw.edges) || raw.edges.length > 2000) {
    invalid("分享画布支持 1 至 500 个节点和最多 2000 条连线");
  }
  let mediaChars = 0;
  const nodes = raw.nodes.map((item: unknown): GalleryNode => {
    const n = record(item, ["id", "type", "label", "x", "y", "parent", "width", "height", "text", "prompt", "media"]);
    if (!nodeTypes.includes(n.type as GalleryType)) invalid("分享文件使用了不支持的节点类型");
    const type = n.type as GalleryType;
    const media = n.media === undefined ? undefined : parseGalleryMedia(n.media, type);
    mediaChars += media?.base64.length ?? 0;
    if (mediaChars > galleryMaxBytes) invalid("分享文件超过 20 MiB");
    if ((n.text !== undefined && type !== "remote-textNode") || (n.prompt !== undefined && !type.endsWith("GenerationNode"))) invalid("节点内容与类型不匹配");
    return {
      id: idField(n.id), type, ...(media && { media }), label: stringField(n.label, 160), x: numberField(n.x, -1e7, 1e7), y: numberField(n.y, -1e7, 1e7),
      ...(n.parent !== undefined && { parent: idField(n.parent) }),
      ...(n.width !== undefined && { width: numberField(n.width, 1, 10000) }),
      ...(n.height !== undefined && { height: numberField(n.height, 1, 10000) }),
      ...(n.text !== undefined && { text: stringField(n.text, 300000) }),
      ...(n.prompt !== undefined && { prompt: stringField(n.prompt, 60000) }),
    };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (nodes.length !== byId.size) invalid("分享画布中存在重复的节点编号");
  for (const n of nodes) {
    const seen = new Set([n.id]);
    let parent = n.parent;
    while (parent) {
      const group = byId.get(parent);
      if (!group || group.type !== "canvasGroup" || seen.has(parent)) invalid("分享画布中的分组关系无效");
      seen.add(parent);
      parent = group.parent;
    }
  }
  const edges = raw.edges.map((item: unknown): GalleryEdge => {
    const e = record(item, ["source", "target", "sourceHandle", "targetHandle"]);
    const source = idField(e.source), target = idField(e.target);
    if (!byId.has(source) || !byId.has(target)) invalid("分享画布的连线指向不存在的节点");
    return { source, target, ...(e.sourceHandle !== undefined && { sourceHandle: portField(e.sourceHandle) }),
      ...(e.targetHandle !== undefined && { targetHandle: portField(e.targetHandle) }) };
  });
  const result: GalleryCanvas = { format: "lum-canvas-gallery", version: 1, title: stringField(raw.title, 100, true),
    author: stringField(raw.author, 80, true), description: stringField(raw.description, 1500), nodes, edges };
  if (new TextEncoder().encode(JSON.stringify(result, null, 2) + "\n").length > galleryMaxBytes) invalid("分享文件超过 20 MiB");
  return result;
}

export function prepareGalleryCanvas(nodes: Node[], edges: Edge[], metadata: GalleryMetadata, includeText: boolean) {
  const ids = new Map(nodes.map((node, i) => [node.id, "n" + (i + 1)]));
  const converted = new Map<string, string>();
  const media: string[] = [];
  const shared = nodes.map(node => {
    const type = nodeTypes.includes(node.type as GalleryType) ? node.type as GalleryType : "remote-textNode";
    const label = typeof node.data?.label === "string" ? node.data.label : node.type || "节点";
    if (type !== node.type) converted.set(node.id, label);
    if (type !== "remote-textNode" && type !== "canvasGroup") media.push(label);
    const dimension = (key: "width" | "height") => {
      const size = typeof node.style === "object" && node.style ? node.style[key] : undefined;
      const numeric = typeof size === "number" ? size : typeof size === "string" && /^\d+(?:\.\d+)?px$/.test(size) ? parseFloat(size) : undefined;
      return numeric && numeric >= 1 && numeric <= 10000 ? Math.round(numeric) : undefined;
    };
    const text = node.data?.outputs?.text?.value || node.data?.textSnapshot || "";
    const model = node.data?.promptModel;
    const prompt = includeText && type.endsWith("GenerationNode")
      ? (Array.isArray(model) && model.length && model.every(Array.isArray) ? getPromptText(model) : "") || node.data?.prompt : undefined;
    return { id: ids.get(node.id), type, label, x: node.position.x, y: node.position.y,
      ...(node.parentNode && { parent: ids.get(node.parentNode) }), width: dimension("width"), height: dimension("height"),
      ...(includeText && type === "remote-textNode" && typeof text === "string" && text && { text }),
      ...(typeof prompt === "string" && prompt && { prompt }) };
  });
  const connections = edges.map(e => ({ source: ids.get(e.source), target: ids.get(e.target),
    sourceHandle: converted.has(e.source) ? "text" : e.sourceHandle ?? undefined,
    targetHandle: converted.has(e.target) ? "in" : e.targetHandle ?? undefined }));
  return { work: parseGalleryCanvas({ format: "lum-canvas-gallery", version: 1, ...metadata, nodes: shared, edges: connections }),
    converted: [...converted.values()], media };
}

function safeMarkdown(text: string) {
  // 富文本预览会加载内嵌图片。分享正文含媒体标记时使用代码块原样展示，阻止隐式网络及文件读取。
  if (!/!\[|<(?!br\s*\/?>)[a-z][^>]*>/i.test(text)) return text;
  let fenceLength = 3;
  for (const match of text.matchAll(/^ {0,3}(~+)/gm)) fenceLength = Math.max(fenceLength, match[1]!.length + 1);
  const fence = "~".repeat(fenceLength);
  return fence + "\n" + text + "\n" + fence;
}

export function galleryCanvasCopy(input: GalleryCanvas) {
  const work = parseGalleryCanvas(input);
  const ids = new Map(work.nodes.map(node => [node.id, crypto.randomUUID()]));
  const nodes = work.nodes.map(n => ({
    id: ids.get(n.id)!, type: n.type, position: { x: n.x, y: n.y },
    ...(n.parent && { parentNode: ids.get(n.parent)! }),
    ...((n.width || n.height) && { style: { ...(n.width && { width: n.width + "px" }), ...(n.height && { height: n.height + "px" }) } }),
    data: { label: n.label, ...(n.media && { outputs: { [outputKind(n.type)!]: { dataType: outputKind(n.type)!.toUpperCase(),
      value: { url: galleryMediaPath(ids.get(n.id)!, n.media), mimeType: n.media.mimeType } } } }), ...(n.text !== undefined && { textSnapshot: safeMarkdown(n.text) }),
      ...(n.prompt !== undefined && { prompt: n.prompt, promptModel: n.prompt.split("\n").map(text => [{ type: "Write", text }]) }) },
  }));
  const edges = work.edges.map(e => ({ ...e, id: crypto.randomUUID(), source: ids.get(e.source)!, target: ids.get(e.target)! }));
  const roots = nodes.filter(n => !n.parentNode);
  const x = 60 - Math.min(...roots.map(n => n.position.x)), y = 60 - Math.min(...roots.map(n => n.position.y));
  return { lumCanvas: true, nodes, edges, viewport: { x, y, zoom: 1 } };
}

export function galleryFileStem(title: string) {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 60).replace(/[. ]+$/g, "") || "画布";
}
