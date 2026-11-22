import { reactive } from "vue";
import type { GraphNode } from "@vue-flow/core";
import type { EnhancementTaskOwner, EnhancementTaskSnapshot, EnhancementVideoSource, NodeMediaModel, NodeUpscaleRequest } from "@lum/nodes-scaffold/nodeAi";

export type VideoEnhancementOptions = NodeUpscaleRequest["enhancement"]["options"];
export type VideoEnhancementCapabilities = NonNullable<NodeMediaModel["enhancementCapabilities"]>;
export type VideoEnhancementAttempt = { owner: EnhancementTaskOwner; request: NodeUpscaleRequest; source: EnhancementVideoSource; label: string; modelLabel: string };
export type VideoEnhancementData = {
  videoEnhancementAttempt?: VideoEnhancementAttempt;
  videoEnhancementBatch?: { id: string; parentId: string; order: number };
  videoEnhancementPlan?: { taskIds: string[]; selected?: string[]; concurrency: number };
  videoEnhancementPreparing?: boolean;
  videoEnhancementSnapshot?: EnhancementTaskSnapshot;
  videoEnhancementIntent?: "submit" | "resume" | "abandon";
  videoEnhancementResult?: { taskId: string; path: string; mimeType: string };
  videoEnhancementIssue?: string;
};

export function ownedEnhancementAttempt(node: GraphNode, binding: { directory: string; canvasPath: string } | undefined) {
  const attempt = (node.data as VideoEnhancementData | undefined)?.videoEnhancementAttempt;
  if (binding && attempt?.owner?.nodeId === node.id && attempt.owner.canvasPath === binding.canvasPath
    && attempt.request?.directory === binding.directory) return attempt;
}

export function enhancementClaimsSlot(data: VideoEnhancementData) {
  const state = data.videoEnhancementSnapshot?.state;
  return state === "running" || state === "interrupted" || !!data.videoEnhancementIntent;
}

export function enhancementOccupiesSlot(node: GraphNode, binding: { directory: string; canvasPath: string } | undefined) {
  return !!ownedEnhancementAttempt(node, binding) && (enhancementClaimsSlot(node.data) || enhancementView(node).holdingSlot);
}

export function enhancementPlanHasDependents(node: GraphNode, nodes: GraphNode[], binding: { directory: string; canvasPath: string } | undefined) {
  const data: VideoEnhancementData = node.data, batch = data.videoEnhancementBatch;
  if (!ownedEnhancementAttempt(node, binding) || !batch || !data.videoEnhancementPlan) return false;
  return nodes.some(other => {
    const sibling: VideoEnhancementData = other.data;
    return other !== node && !!ownedEnhancementAttempt(other, binding)
      && sibling.videoEnhancementBatch?.id === batch.id && sibling.videoEnhancementBatch.parentId === batch.parentId
      && (enhancementOccupiesSlot(other, binding) || !["failed", "succeeded", "cancelled"].includes(sibling.videoEnhancementSnapshot?.state ?? ""));
  });
}

export const videoEnhancementNodeType = "remote-videoNode";
const videoNodeTypes = new Set([videoEnhancementNodeType, "remote-videoGenerationNode"]);
export function videoSource(node?: GraphNode) {
  const output = node?.data.outputs?.video;
  if (!node || !videoNodeTypes.has(node.type ?? "") || output?.dataType !== "VIDEO") return;
  const { url, mimeType } = output.value ?? {};
  if (typeof url !== "string" || !url || /^[\\/]|[:\u0000-\u001f]/.test(url)
    || url.split(/[\\/]/).some(part => !part || part === "." || part === "..")
    || typeof mimeType !== "string" || !/^video\//i.test(mimeType)) return;
  return { path: url.replaceAll("\\", "/"), mimeType };
}

export function sameSource(node: GraphNode | undefined, path: string, mimeType: string) {
  const source = videoSource(node);
  return source?.path === path && source.mimeType === mimeType;
}

export function enhancementOptionsIssue(source: EnhancementVideoSource, options: VideoEnhancementOptions, cap: VideoEnhancementCapabilities) {
  const { metadata } = source;
  const fps = options.fps ?? metadata.fps;
  if (metadata.size > cap.maxInputBytes) return "源文件超过模型大小上限";
  if (!metadata.duration || !metadata.frameCount || metadata.duration * options.slowMotion > cap.maxDuration) return "视频时长超过模型能力，或帧数无法确认";
  if (!fps || fps < cap.minFps || fps > cap.maxFps) return "输出帧率超出模型范围";
  if (!cap.interpolation.includes(options.interpolation) || !cap.slowMotion.includes(options.slowMotion) || !cap.audio.includes(options.audio)) return "模型未声明所选补帧、慢放或音轨能力";
  if (options.interpolation === "none" && (options.slowMotion !== 1 || Math.abs(fps - (metadata.fps ?? 0)) > 0.001)) return "不补帧时须保持原帧率与速度";
  if (options.slowMotion !== 1 && options.audio !== "mute") return "慢放须明确选择静音";
  const { width, height } = options, multiple = cap.dimensionMultiple ?? 1;
  if (![width, height].every(Number.isSafeInteger) || width < metadata.width || height < metadata.height
    || width === metadata.width && height === metadata.height
    || width > cap.maxWidth || height > cap.maxHeight || width * height > cap.maxPixels
    || width % multiple || height % multiple || width / metadata.width > cap.maxScale || height / metadata.height > cap.maxScale
    || Math.abs(width * metadata.height - height * metadata.width) > Math.max(metadata.width, metadata.height)) return "没有符合模型限制和原始比例的放大尺寸";
  return "";
}

export function enhancementSizes(source: EnhancementVideoSource, cap: VideoEnhancementCapabilities) {
  const { width, height } = source.metadata, multiple = cap.dimensionMultiple ?? 1;
  const maxWidth = Math.floor(Math.min(cap.maxWidth, width * cap.maxScale) / multiple) * multiple;
  const maxHeight = Math.floor(Math.min(cap.maxHeight, height * cap.maxScale) / multiple) * multiple;
  const fits = (w: number, h: number) => w >= width && h >= height && (w > width || h > height)
    && w <= maxWidth && h <= maxHeight && w * h <= cap.maxPixels
    && Math.abs(w * height - h * width) <= Math.max(width, height);
  const candidates: { width: number; height: number }[] = [];
  // 只沿长边遍历对齐值；另一边按原比例取相邻格点，仍受服务端相同的像素容差。
  const landscape = width >= height;
  const major = landscape ? width : height, minor = landscape ? height : width;
  const end = landscape ? maxWidth : maxHeight;
  for (let axis = Math.ceil(major / multiple) * multiple; axis <= end; axis += multiple) {
    const scaled = axis * minor / major / multiple;
    for (const minorAxis of new Set([Math.floor(scaled) * multiple, Math.ceil(scaled) * multiple])) {
      const w = landscape ? axis : minorAxis, h = landscape ? minorAxis : axis;
      if (fits(w, h)) candidates.push({ width: w, height: h });
    }
  }
  const output = new Map<string, { width: number; height: number }>();
  const maximum = candidates.reduce((best, item) => Math.max(best, Math.max(item.width, item.height)), 0);
  for (const target of [Math.max(width, height) * 2, 1280, 1920, 2560, 3840, maximum]) {
    if ((target > maximum && (target !== 3840 || maximum < 3840 * 0.98)) || target < Math.max(width, height)) continue;
    let best: typeof candidates[number] | undefined, distance = Infinity;
    for (const item of candidates) {
      const next = Math.abs(Math.max(item.width, item.height) - target);
      if (next < distance || next === distance && best && item.width * item.height > best.width * best.height) { best = item; distance = next; }
    }
    if (best) output.set(sizeKey(best), best);
  }
  return [...output.values()];
}

export const sizeKey = (value: { width: number; height: number }) => `${value.width} × ${value.height}`;
export const modelKey = (model: Pick<NodeMediaModel, "providerId" | "modelId">) => JSON.stringify([model.providerId, model.modelId]);
export const fileSize = (size: number) => `${(size / 1024 ** 2).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} MiB`;
export const previewByteLimit = 128 * 1024 ** 2;

type VideoEnhancementView = { busy: boolean; missing: boolean; queried: boolean; saving: boolean; holdingSlot: boolean; progress?: EnhancementTaskSnapshot["progress"]; error?: string };
const viewKey = Symbol.for("toonflow.videoEnhancementView");
const viewHost = globalThis as typeof globalThis & { [viewKey]?: WeakMap<GraphNode, VideoEnhancementView> };
const views = viewHost[viewKey] ??= new WeakMap<GraphNode, VideoEnhancementView>();
export function enhancementView(node: GraphNode) {
  let view = views.get(node);
  if (!view) { view = reactive({ busy: false, missing: false, queried: false, saving: false, holdingSlot: false }); views.set(node, view); }
  return view;
}

export function enhancementStatus(node: GraphNode) {
  const data: VideoEnhancementData = node.data, { videoEnhancementSnapshot: snapshot, videoEnhancementIntent: intent, videoEnhancementResult: result, videoEnhancementAttempt: attempt } = data;
  const view = enhancementView(node);
  if (!attempt || attempt.owner.nodeId !== node.id) return "副本不拥有原任务";
  if (view.saving) return "正在保存结果节点";
  if (view.busy && intent === "submit") return "正在确认提交";
  if (view.busy && intent === "resume") return "正在复查原任务";
  if (view.busy && intent === "abandon") return "正在保存放弃状态";
  if (view.missing) return data.videoEnhancementIssue ? "未建立本地记录" : "本地任务尚未建立";
  if (intent && snapshot?.state === "prepared") return "确认结果待核对";
  switch (snapshot?.state) {
    case "preparing": return "正在准备报价";
    case "prepared": return "等待确认报价";
    case "preparationUnknown": return "报价结果未知";
    case "interrupted": return snapshot.resumable ? "任务中断，可复查原任务" : "任务中断，缺少恢复凭据";
    case "succeeded": return result?.taskId === attempt.owner.taskId ? "结果已保存" : "文件已校验，等待写入画布";
    case "failed": return "供应商确认失败";
    case "cancelled": return "已放弃本地任务";
    case "running": {
      const progress = view.progress;
      if (!progress) return "任务进行中";
      const remote = { requested: "已创建请求", accepted: "供应商已接单", initializing: "供应商初始化", preprocessing: "供应商预处理", processing: "供应商处理中",
        postprocessing: "供应商后处理", complete: "供应商处理完成", canceling: "供应商正在取消" };
      return { prepared: "等待供应商接单", accept: "确认供应商接单", upload: "上传原视频", complete: "确认素材上传", poll: progress.remoteStatus ? remote[progress.remoteStatus] : "等待供应商处理",
        download: "下载超分结果", validate: "校验结果视频" }[progress.stage];
    }
    default: return view.busy ? "正在准备报价" : "等待查询原报价";
  }
}

export const enhancementError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/[^\s<>"']+/gi, "[私有地址]");

export function enhancementReady(node: GraphNode) {
  const data: VideoEnhancementData = node.data;
  const { videoEnhancementResult: result, videoEnhancementAttempt: attempt } = data, output = node.data.outputs?.video;
  return !!result && !!attempt && result.taskId === attempt.owner.taskId && !enhancementView(node).saving
    && output?.dataType === "VIDEO" && output.value.url === result.path && output.value.mimeType === result.mimeType;
}
