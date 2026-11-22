const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

type TopazContext = ProviderContext<ProviderConfig<typeof rules>>;
type Stage = "prepared" | "accept" | "upload" | "complete" | "poll" | "download";
type UploadPart = { partNum: number; eTag: string };
type RemoteStatus = "requested" | "accepted" | "initializing" | "preprocessing" | "processing" | "postprocessing" | "complete" | "canceling";
type TopazCheckpoint = {
  kind: "officialTopazVideo";
  requestId: string;
  stage: Stage;
  remoteStatus?: RemoteStatus;
  progress?: number;
  uploadResults?: UploadPart[];
};

const apiBase = "https://api.topazlabs.com/video";
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stages: readonly Stage[] = ["prepared", "accept", "upload", "complete", "poll", "download"];
const segmentBytes = 500000000;
const maxParts = 150;
const pollInterval = 5000;
const pollWindow = 10 * 60_000;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function httpsUrl(value: unknown) {
  if (typeof value === "string") {
    const url = URL.parse(value);
    if (url?.protocol === "https:" && !url.username && !url.password && !url.hash) return value;
  }
  throw new Error("Topaz 未返回可直接访问的 HTTPS 媒体地址");
}

function requestId(value: unknown) {
  if (typeof value === "string" && requestIdPattern.test(value)) return value;
  throw new Error("Topaz 请求 ID 无效");
}

function saver(context: TopazContext) {
  if (!context.saveTaskData) throw new Error("当前宿主不支持 Topaz 任务持久化");
  const save = context.saveTaskData;
  return (state: TopazCheckpoint) => save({ ...state });
}

function checkpoint(id: string, stage: Stage): TopazCheckpoint {
  return { kind: "officialTopazVideo", requestId: id, stage };
}

async function api(context: TopazContext, path: string, method: "GET" | "POST" | "PATCH", expected: string, body?: object) {
  const apiKey = typeof context.config.apiKey === "string" && context.config.apiKey.trim();
  if (!apiKey) throw new Error("请先在供应商设置中填写 Topaz API Key");
  const response = await context.tool.fetch(`${apiBase}${path}`, {
    method,
    headers: { "X-API-Key": apiKey, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Topaz ${expected}未获得成功响应（HTTP ${response.status}）；请保留原任务`);
  return response;
}

function estimate(value: unknown) {
  if (Array.isArray(value) && value.length === 2) {
    const [min, max] = value;
    if (typeof min === "number" && typeof max === "number" && Number.isSafeInteger(min) && Number.isSafeInteger(max) && min >= 0 && min <= max) return { min, max };
  }
  throw new Error("Topaz 未返回有效的报价区间");
}

function checkOptions(request: VideoUpscalePreparationRequest) {
  const { options, source } = request;
  if (request.operation !== "upscale" || request.model !== "prob-4") throw new Error("Topaz 只支持 Proteus 视频超分");
  if (options.interpolation !== "none" || options.slowMotion !== 1 || (options.fps !== undefined && Math.abs(options.fps - (source.metadata.fps ?? 0)) > 0.001)) {
    throw new Error("Proteus 必须保持原始帧率和速度");
  }
  if (![options.width, options.height].every(size => Number.isSafeInteger(size) && size > 0 && size <= 4096 && size % 4 === 0)) {
    throw new Error("Topaz 输出的宽和高都必须是 4 的倍数，且不超过 4096 像素");
  }
}

function readUploadPlan(value: unknown, size: number) {
  const { urls, uploadId } = object(value);
  if (typeof uploadId !== "string" || !uploadId.trim() || !Array.isArray(urls) || !urls.length || urls.length > maxParts) {
    throw new Error("Topaz 未返回完整的上传信息");
  }
  const signedUrls = Array.from(urls, httpsUrl);
  const partSize = Math.max(segmentBytes, Math.ceil(size / signedUrls.length));
  if (new Set(signedUrls).size !== signedUrls.length || (signedUrls.length > 1 && Math.ceil(size / partSize) !== signedUrls.length)) {
    throw new Error("Topaz 返回的上传地址数量与原视频大小不匹配");
  }
  return { signedUrls, partSize };
}

function readUploadResults(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > maxParts) throw new Error("Topaz 上传确认记录无效");
  return Array.from(value, (item, index): UploadPart => {
    const { partNum, eTag } = object(item);
    if (partNum !== index + 1 || typeof eTag !== "string" || !eTag.trim()) throw new Error("Topaz 上传分片记录无效");
    return { partNum, eTag };
  });
}

function wait(signal: AbortSignal, ms: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function statusOf(context: TopazContext, id: string) {
  const response = await api(context, `/${id}/status`, "GET", "状态查询");
  const data = object(await response.json());
  const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
  switch (status) {
    case "failed":
    case "canceled":
    case "cancelled":
      throw Object.assign(new Error(status === "failed" ? "Topaz 已确认视频处理失败" : "Topaz 已取消视频任务"), { code: "MEDIA_TASK_FAILED" });
    case "requested":
    case "accepted":
    case "initializing":
    case "preprocessing":
    case "processing":
    case "postprocessing":
    case "complete":
    case "canceling": {
      const progress = typeof data.progress === "number" && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 100 ? data.progress : undefined;
      return { status, progress, data };
    }
    default:
      throw new Error("Topaz 返回未知任务状态，可继续查询原请求");
  }
}

async function completeUpload(context: TopazContext, id: string, uploadResults: UploadPart[]) {
  const save = saver(context);
  await save({ ...checkpoint(id, "complete"), uploadResults });
  const response = await api(context, `/${id}/complete-upload/`, "PATCH", "上传确认", { uploadResults });
  await response.body?.cancel();
  if (response.status !== 202) throw new Error("Topaz 未确认进入处理队列，可继续查询原请求");
  await save(checkpoint(id, "poll"));
}

async function uploadSource(context: TopazContext, id: string, source: EnhancementSource, outstanding?: unknown) {
  const save = saver(context);
  if (!outstanding) {
    await save(checkpoint(id, "accept"));
    const response = await api(context, `/${id}/accept`, "PATCH", "接单");
    outstanding = await response.json();
  }
  const { signedUrls, partSize } = readUploadPlan(outstanding, source.metadata.size);
  const uploadResults: UploadPart[] = [];
  for (const [index, url] of signedUrls.entries()) {
    await save(checkpoint(id, "upload"));
    if (signedUrls.length === 1) {
      await source.upload(url);
      // 单一上传 URL 的此字段仅用于满足 complete-upload 请求结构。
      uploadResults.push({ partNum: 1, eTag: "unused" });
    } else {
      const start = index * partSize;
      const { eTag } = await source.upload(url, { start, end: Math.min(start + partSize, source.metadata.size) });
      if (!eTag?.trim()) throw new Error("Topaz 分片上传未返回 ETag，无法确认上传");
      uploadResults.push({ partNum: index + 1, eTag });
    }
  }
  await completeUpload(context, id, uploadResults);
}

async function poll(context: TopazContext, id: string, initial?: Awaited<ReturnType<typeof statusOf>>): Promise<MediaAsset[]> {
  const save = saver(context);
  const deadline = Date.now() + pollWindow;
  const signal = context.signal ?? new AbortController().signal;
  let last: TopazCheckpoint | undefined;
  for (let current = initial ?? await statusOf(context, id); ; current = await statusOf(context, id)) {
    const { status, progress, data } = current;
    const state = { ...checkpoint(id, status === "complete" ? "download" : "poll"), remoteStatus: status, ...(progress === undefined ? {} : { progress }) };
    if (!last || last.stage !== state.stage || last.remoteStatus !== status || last.progress !== progress) {
      await save(state);
      last = state;
    }
    if (status === "complete") {
      const download = object(data.download);
      if (typeof download.expiresAt === "number" && download.expiresAt <= Date.now()) throw new Error("Topaz 结果下载地址已过期，请保留原请求");
      return [{ type: "url", mediaType: "video", mimeType: "video/mp4", url: httpsUrl(download.url) }];
    }
    if (Date.now() >= deadline) throw new Error("Topaz 尚未处理完毕，可继续查询原请求");
    await wait(signal, pollInterval);
  }
}

export default {
  id: "officialTopaz",
  label: "Topaz Labs 官方",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%2313161d' d='M2 15.357V22h6.65v-6.643H2zM15.32 15.357V8.714H8.67v6.643h6.65zM22 8.643V2h-6.65v6.643H22z'/%3E%3C/svg%3E",
  version: "1.0.0",
  readme: "使用 Topaz Labs 官方 Proteus 视频超分。先按实际素材获取报价，确认后才提交。保留原宽高比、帧率和播放速度，可保留原声或静音。Lum 此接入限制：输入 500 MB、输出 2 GB，视频最长 10 分钟，帧率 1–120，最多放大 8 倍，输出宽高均须为 4 的倍数且不超过 4096 像素。\n\n[管理 Topaz API Key](https://account.topazlabs.com/manage-api)",
  rules,
  models: [
    {
      id: "prob-4",
      label: "Proteus 视频超分",
      type: "video",
      operation: "upscale",
      enhancementCapabilities: {
        maxInputBytes: 500000000,
        maxOutputBytes: 2000000000,
        maxWidth: 4096,
        maxHeight: 4096,
        maxPixels: 16777216,
        dimensionMultiple: 4,
        maxScale: 8,
        maxDuration: 600,
        minFps: 1,
        maxFps: 120,
        interpolation: ["none"],
        slowMotion: [1],
        audio: ["preserve", "mute"],
      },
    },
  ] satisfies ProviderModel[],
  async prepareVideoUpscale(request: VideoUpscalePreparationRequest): Promise<ProviderEnhancementQuote> {
    const save = saver(this);
    checkOptions(request);
    const { width, height, size, mimeType, duration, fps, frameCount, hasAudio } = request.source.metadata;
    const container = mimeType === "video/mp4" ? "mp4" : mimeType === "video/quicktime" ? "mov" : mimeType === "video/webm" ? "webm" : null;
    if (!container || !duration || !fps || !frameCount) throw new Error("Topaz 报价需要支持的容器和完整的视频探测信息");
    const preserveAudio = hasAudio && request.options.audio === "preserve";
    const response = await api(this, "/", "POST", "报价", {
      source: { container, size, duration, frameCount, frameRate: fps, resolution: { width, height } },
      filters: [{ model: "prob-4", auto: "Auto" }],
      output: {
        container: "mp4",
        videoEncoder: "H264",
        videoProfile: "High",
        cropToFit: false,
        frameRate: fps,
        resolution: { width: request.options.width, height: request.options.height },
        audioTransfer: preserveAudio ? "Convert" : "None",
        ...(preserveAudio ? { audioCodec: "AAC" } : {}),
      },
    });
    const data = object(await response.json());
    const id = requestId(data.requestId);
    await save(checkpoint(id, "prepared"));
    const estimates = object(data.estimates);
    return { requestId: id, cost: { ...estimate(estimates.cost), unit: "credits" }, seconds: estimate(estimates.time) };
  },
  async upscaleVideo(request: VideoUpscaleRequest): Promise<MediaAsset[]> {
    checkOptions(request);
    const id = requestId(request.preparation.requestId);
    await uploadSource(this, id, request.source);
    return await poll(this, id);
  },
  async resumeTask(data: ProviderTaskData): Promise<MediaAsset[]> {
    const source = this.enhancementSource;
    const stage = data.stage as Stage;
    if (!source || data.kind !== "officialTopazVideo" || !stages.includes(stage)) throw new Error("Topaz 恢复数据无效");
    const id = requestId(data.requestId);
    const current = await statusOf(this, id);
    const outstanding = current.status === "accepted" && Array.isArray(current.data.urls) && current.data.urls.length > 0;
    if (stage === "prepared" || stage === "accept" || stage === "upload") {
      // 宿主只在用户确认且持久保存提交意图后调用恢复；请求创建结果未知时不进入这里。
      if (current.status === "requested" || current.status === "accepted") {
        await uploadSource(this, id, source, outstanding ? current.data : undefined);
        return await poll(this, id);
      }
    } else if (stage === "complete") {
      // 确认响应丢失：仅在官方状态仍返回待上传信息时重发原分片结果。
      if (outstanding) {
        await completeUpload(this, id, readUploadResults(data.uploadResults));
        return await poll(this, id);
      }
      if (current.status === "requested" || current.status === "accepted") throw new Error("Topaz 尚未确认上传结果，可继续查询原请求");
    }
    return await poll(this, id, current);
  },
} satisfies ProviderDefinition<typeof rules>;
