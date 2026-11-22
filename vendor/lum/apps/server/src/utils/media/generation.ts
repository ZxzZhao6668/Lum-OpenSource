import { t, translateMessage } from "@/lib/i18n";
import { mkdir, readFile, realpath, stat, unlink } from "@lum/file";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { ProviderTaskData } from "@lum/providers";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel, MediaReference } from "@lum/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { withDefaultModels } from "@/lib/defaultModels";
import { getMediaProvider, listMediaProviders, loadMediaProviderSource } from "@/utils/media/provider";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { beginGeneration, getProviderPrice } from "@/utils/media/billing";
import { detectMimeType, readPriceReference, readVideoEditReference } from "@/utils/media/priceReference";
import { hasEnhancementConfiguration } from "./enhancement";

const maxMediaSize = 100 * 1024 * 1024;
export type MediaGenerationCheckpoint = {
  enhancementFileStage?: "download" | "validate";
  partialPaths?: string[];
  providerData?: ProviderTaskData;
  assets?: Extract<MediaAsset, { type: "url" }>[];
  assetCount?: number;
  files?: (GeneratedMedia & { index: number; hash: string })[];
};

export type MediaGenerationTask = {
  taskId: string;
  resume: boolean;
  checkpoint: MediaGenerationCheckpoint;
  save: (patch: Partial<MediaGenerationCheckpoint>) => Promise<void>;
};
const mediaExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "audio/flac": "flac", "audio/aac": "aac", "audio/mp4": "m4a", "audio/opus": "opus", "audio/pcm": "pcm",
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function imageOptions(value: unknown, pattern: RegExp) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 64 && item === item.trim() && pattern.test(item)))] : undefined;
}

export async function listMediaModels(): Promise<MediaModel[]> {
  const installedProviders = await listMediaProviders();
  const configs = conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  return withDefaultModels(installedProviders.flatMap(provider => provider.models.flatMap(model => {
    if (model.type !== "image" && model.type !== "video" && model.type !== "audio") return [];
    if (model.operation === "upscale" && model.type !== "video") return [];
    return [{
      providerId: provider.id, providerLabel: provider.label, modelId: model.id, label: model.label, type: model.type,
      supportsPrice: "supportsPrice" in provider && provider.supportsPrice === true,
      enhancementCapabilities: (model.type === "video" && "supportsUpscaleVideo" in provider && provider.supportsUpscaleVideo && "supportsEnhancementPreparation" in provider && provider.supportsEnhancementPreparation) ? model.enhancementCapabilities : undefined,
      supportsEnhancementPreparation: model.type === "video" && model.operation === "upscale" && "supportsEnhancementPreparation" in provider && provider.supportsEnhancementPreparation === true,
      ...(model.type === "video" && model.operation === "upscale" ? { enhancementConfigured: hasEnhancementConfiguration(provider.rules, configs?.[provider.id] ?? {}) } : {}),
      operation: model.operation, editCapabilities: "supportsEditVideo" in provider && provider.supportsEditVideo ? model.editCapabilities : undefined, rules: model.rules,
      mode: model.mode, durationResolutionMap: model.durationResolutionMap, audio: model.audio,
      ...(model.type === "audio" ? { voices: model.voices } : {}),
      ...(model.type === "image" ? {
        imageSizes: imageOptions(model.imageSizes, /^[^\u0000-\u001f\u007f]+$/),
        imageRatios: imageOptions(model.imageRatios, /^[1-9]\d{0,3}:[1-9]\d{0,3}$/),
      } : {}),
    } as MediaModel];
  })));
}

export async function readReference(cwd: string, reference: MediaReference, mediaType: string, signal?: AbortSignal): Promise<Extract<MediaInput, { type: "base64" }>> {
  signal?.throwIfAborted();
  const { path } = await resolveWorkspacePath(cwd, reference.path);
  const info = await stat(path);
  if (!info.isFile() || info.size > maxMediaSize) invalid("参考媒体须为不超过 100 MB 的文件");
  const bytes = await readFile(path, { signal });
  if (!bytes.length || bytes.length > maxMediaSize) invalid("参考媒体为空或超过 100 MB");
  const mimeType = detectMimeType(bytes, reference.mimeType);
  if (!mimeType.startsWith(`${mediaType}/`)) invalid(t`参考媒体类型须为 ${mediaType}`);
  return { type: "base64", data: bytes.toString("base64"), mimeType, name: reference.path };
}

async function downloadAsset(url: string, signal?: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) invalid("生成结果必须使用 HTTP 或 HTTPS 地址");
  const response = await fetch(url, { signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(t`下载生成结果失败（HTTP ${response.status}）`), {
      code: [401, 403, 404, 410].includes(response.status) ? "MEDIA_ASSET_URL_EXPIRED" : "MEDIA_ASSET_DOWNLOAD_FAILED",
    });
  }
  if (Number(response.headers.get("content-length")) > maxMediaSize) {
    await response.body?.cancel();
    invalid("生成文件不能超过 100 MB");
  }
  const reader = response.body?.getReader();
  if (!reader) invalid("生成结果为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxMediaSize) invalid("生成文件不能超过 100 MB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { bytes: Buffer.concat(chunks, size), mimeType: response.headers.get("content-type") ?? "" };
}

async function assetBytes(asset: MediaAsset, mediaType: "image" | "video" | "audio", signal?: AbortSignal) {
  if (!asset || asset.mediaType !== mediaType) invalid("供应商返回的媒体类型不正确");
  let bytes: Uint8Array;
  let mimeType = asset.mimeType ?? "";
  if (asset.type === "url") {
    const result = await downloadAsset(asset.url, signal);
    bytes = result.bytes;
    const responseMimeType = result.mimeType.split(";")[0].trim().toLowerCase();
    mimeType = responseMimeType && responseMimeType !== "application/octet-stream" ? result.mimeType : mimeType;
  } else if (asset.type === "base64") {
    const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(asset.data);
    const content = (data?.[2] ?? asset.data).replace(/\s/g, "");
    if (content.length > Math.ceil(maxMediaSize / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) invalid("生成结果的 base64 内容无效或超过 100 MB");
    bytes = Buffer.from(content, "base64");
    mimeType = data?.[1] ?? mimeType;
  } else if (asset.type === "binary" && ArrayBuffer.isView(asset.data) && asset.data.BYTES_PER_ELEMENT === 1) {
    bytes = asset.data;
  } else { return invalid("供应商返回了无效的媒体结果"); }
  if (!bytes.byteLength || bytes.byteLength > maxMediaSize) invalid("生成文件为空或超过 100 MB");
  mimeType = detectMimeType(bytes, mimeType);
  if (!mimeType.startsWith(`${mediaType}/`) || !mediaExtensions[mimeType]) invalid("生成结果不是支持的图片、视频或音频格式");
  return { bytes, mimeType };
}

function resumableAssets(assets: MediaAsset[], mediaType: "image" | "video" | "audio") {
  for (const asset of assets) {
    if (!asset || asset.mediaType !== mediaType || !["url", "base64", "binary"].includes(asset.type)) invalid("供应商返回的媒体类型不正确");
    if (asset.type === "url" && (typeof asset.url !== "string" || !/^https?:\/\//i.test(asset.url))) invalid("生成结果必须使用 HTTP 或 HTTPS 地址");
  }
  return assets.every(asset => asset.type === "url") ? assets.map(asset => {
    const value = asset as Extract<MediaAsset, { type: "url" }>;
    return { type: "url" as const, mediaType, url: value.url, ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}) };
  }) : undefined;
}

async function prepareRequest<T>(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest,
  read: (cwd: string, reference: MediaReference, type: string, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  const referenceOrder = mediaType === "video" ? request.referenceOrder : undefined;
  if (referenceOrder) {
    const media = { image: request.images, video: request.videos, audio: request.audios };
    for (const [index, reference] of referenceOrder.entries()) {
      const available = reference.type === "text" || ("index" in reference
        ? Number.isSafeInteger(reference.index) && reference.index >= 0 && !!media[reference.type]?.[reference.index]
        : !!request[reference.type]);
      if (!available) invalid(`参考 ${index + 1} 指向的素材不存在，请重新选择引用`);
    }
    for (const match of request.prompt.matchAll(/\{\{ref (\d+)\}\}/g)) {
      if (!referenceOrder[Number(match[1]) - 1]) invalid(`引用标记 ${match[0]} 没有对应素材，请重新选择引用`);
    }
  }
  const references = async (items: MediaReference[] | undefined, type: string) => {
    if (!items?.length) return items ? [] : undefined;
    if (!directory) invalid("参考媒体需要工作目录");
    // ACT: 单次请求顺序处理引用，避免数十个参考媒体同时启动探测进程。
    const result: T[] = [];
    for (const item of items) result.push(await read(directory, item, type, signal));
    return result;
  };
  const images = await references(request.images, "image");
  if (mediaType === "audio") return {
    type: "audio" as const, model: request.modelId, text: request.prompt, images, audios: await references(request.audios, "audio"), other: request.other,
    voice: request.voice, speed: request.speed, volume: request.volume, pitch: request.pitch, language: request.language, format: request.format, sampleRate: request.sampleRate,
  };
  if (mediaType === "image") return { type: "image" as const, model: request.modelId, prompt: request.prompt, images, ratio: request.ratio, size: request.size, other: request.other };
  return {
    ...(request.operation === "edit" ? { operation: "edit" as const, sourceClip: (await references([request.sourceClip!], "video"))![0], sourceRange: request.sourceRange } : {}),
    type: "video" as const, model: request.modelId, prompt: request.prompt, images, other: request.other,
    ...(referenceOrder ? { referenceOrder } : {}),
    videos: await references(request.videos, "video"), audios: await references(request.audios, "audio"),
    firstFrame: (await references(request.firstFrame ? [request.firstFrame] : undefined, "image"))?.[0],
    lastFrame: (await references(request.lastFrame ? [request.lastFrame] : undefined, "image"))?.[0],
    ratio: request.ratio, resolution: request.resolution, duration: request.duration, generateAudio: request.generateAudio, mode: request.mode,
  };
}

async function configuredProvider(request: MediaGenerationRequest, mediaType: "image" | "video" | "audio", signal?: AbortSignal, directory?: string,
  saveTaskData?: (data: ProviderTaskData) => Promise<void>, resume = false) {
  const info = await getMediaProvider(request.providerId);
  if (!resume) {
    const model = info.models.find(model => model.id === request.modelId && model.type === mediaType);
    if (!model) invalid("所选媒体模型不存在或类型不匹配，请重新选择");
    const operation = request.operation ?? "generate";
    if ((operation === "edit" && mediaType !== "video") || (operation === "upscale" && mediaType === "audio") || (model.operation ?? "generate") !== operation) invalid("所选媒体模型不支持此操作，请重新选择");
    if (operation === "upscale") invalid("增强任务须通过显式准备和提交入口执行");
    if (request.enhancement) invalid("普通生成或编辑不能携带增强参数");
    if (operation === "edit") {
      const bounds = model.editCapabilities;
      const range = request.sourceRange;
      if (!bounds || !request.sourceClip || !range || !Number.isFinite(range.start) || range.start < 0 || !Number.isFinite(range.end) || range.end <= range.start
        || !request.duration || Math.abs(request.duration - (range.end - range.start)) > 0.000001
        || request.duration < bounds.minDuration || request.duration > bounds.maxDuration
        || (request.images?.length ?? 0) > bounds.maxImages || (request.videos?.length ?? 0) > bounds.maxVideos || (request.audios?.length ?? 0) > bounds.maxAudios
        || request.firstFrame || request.lastFrame || request.mode) invalid("原生编辑请求不符合模型的片段时长或引用能力");
    } else if (request.sourceClip || request.sourceRange) invalid("普通生成不能提交原生编辑源片段");
  }
  const configurations = record(conf.get("settings", {}).mediaProviderConfigs);
  const provider = await loadMediaProviderSource(info.source, record(configurations[info.id]), signal, undefined, directory, saveTaskData);
  if (!resume && request.operation === "edit" && !provider.editVideo) invalid("当前供应商未实现原生 editVideo，不能用普通生成代替");
  return provider;
}

async function preparePriceRequest(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(5000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const prepared = await prepareRequest(directory, mediaType, request, readPriceReference, combined);
    if (prepared.type === "video") delete prepared.referenceOrder;
    return prepared;
  }
  catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new Error("读取参考媒体信息超时，请稍后重试");
    throw error;
  }
}

export async function getMediaPrice(directory: string | undefined, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (request.operation === "upscale") {
    if (mediaType !== "video") invalid("当前仅支持视频超分");
    return null;
  }
  const provider = await configuredProvider(request, mediaType, signal, directory);
  if (!provider.getPrice) return null;
  const prepared = await preparePriceRequest(directory, mediaType, request, signal);
  signal?.throwIfAborted();
  return getProviderPrice(provider, prepared);
}

export async function generateMedia(
  cwd: string,
  mediaType: "image" | "video" | "audio",
  request: MediaGenerationRequest,
  signal?: AbortSignal,
  task?: MediaGenerationTask,
): Promise<GeneratedMedia[]> {
  signal?.throwIfAborted();
  if (!request.prompt.trim()) invalid("请输入生成提示词");
  const directory = await realpath(cwd);
  const outputDirectory = request.outputDirectory ?? "assets/generated";
  await resolveWorkspacePath(directory, outputDirectory, true);
  const checkpoint = task?.checkpoint;
  const saved = new Map<number, GeneratedMedia>();
  for (const file of checkpoint?.files ?? []) {
    const expected = join(outputDirectory, `${mediaType}${task!.taskId.replaceAll("-", "")}${file.index}.${mediaExtensions[file.mimeType]}`).replace(/\\/g, "/");
    if (file.path !== expected || file.mediaType !== mediaType) invalid("任务结果文件记录与原生成请求不匹配");
    const { path } = await resolveWorkspacePath(directory, file.path);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > maxMediaSize) invalid("任务结果文件已被修改，不能覆盖");
      const bytes = await readFile(path, { signal });
      if (createHash("sha256").update(bytes).digest("hex") !== file.hash) invalid("任务结果文件已被修改，不能覆盖");
      saved.set(file.index, { path: file.path, mimeType: file.mimeType, mediaType });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (checkpoint?.assetCount && saved.size === checkpoint.assetCount && [...saved.keys()].every(index => index >= 0 && index < checkpoint.assetCount!)) {
    return Array.from({ length: checkpoint.assetCount }, (_, index) => saved.get(index)!);
  }
  let finish = () => {};
  const resumeAssets = async () => {
    const provider = await configuredProvider(request, mediaType, signal, directory, data => task!.save({ providerData: data }), true);
    if (!checkpoint?.providerData || !provider.resumeTask) invalid("该任务没有可恢复的供应商凭据，不能重新提交生成");
    finish();
    finish = beginGeneration(provider);
    // 恢复只使用已保存的凭据，不重新读取参考文件、预处理或提交生成。
    return provider.resumeTask(checkpoint.providerData);
  };
  const written: string[] = [];
  const result: GeneratedMedia[] = [];
  let providerInvoked = task?.resume ?? false;
  try {
    signal?.throwIfAborted();
    let assets: MediaAsset[] | undefined;
    if (task?.resume) {
      assets = checkpoint?.assets ?? await resumeAssets();
    } else {
      const provider = await configuredProvider(request, mediaType, signal, directory,
        task ? data => task.save({ providerData: data }) : undefined);
      const generate = mediaType === "image" ? provider.generateImage : mediaType === "video" ? request.operation === "edit" ? provider.editVideo : provider.generateVideo : provider.generateAudio;
      if (typeof generate !== "function") invalid(t`此供应商不支持${translateMessage({ image: "图片", video: "视频", audio: "音频" }[mediaType])}生成`);
      const rules = Array.isArray(provider.rules) ? provider.rules : [];
      if (rules.some(rule => rule.field === "apiKey") && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) invalid("请先在媒体模型设置中配置供应商 API Key");
      if (request.operation === "edit") {
        const source = await readVideoEditReference(directory, request.sourceClip!, signal);
        const timing = source.videoTiming;
        if (!timing || !source.width || !source.height) invalid("无法确认原生编辑源片段的视频流起点、时长或帧率，请重新准备片段");
        // 截取保留时间戳：首帧可稍晚于选区起点，末帧可跨过选区终点；不拉伸、不改输出时长。
        const tolerance = 1 / timing.frameRate + 0.001;
        if (!Number.isFinite(tolerance) || timing.start < -0.001 || timing.start > tolerance
          || Math.abs(timing.start + timing.duration - request.duration!) > tolerance) invalid("原生编辑源片段的视频时间线超出一帧加 1 毫秒的允许偏差，请重新准备片段");
      }
      const { type, ...parameters } = await prepareRequest(directory, mediaType, request, readReference, signal);
      signal?.throwIfAborted();
      finish = beginGeneration(provider);
      providerInvoked = true;
      assets = type === "audio" ? await provider.generateAudio!(parameters as AudioRequest)
        : type === "image" ? await provider.generateImage!(parameters as ImageRequest) : request.operation === "edit" ? await provider.editVideo!(parameters as VideoEditRequest) : await provider.generateVideo!(parameters as VideoRequest);
    }
    if (!Array.isArray(assets) || !assets.length) invalid("供应商未返回生成结果");
    if (checkpoint?.assetCount !== undefined && checkpoint.assetCount !== assets.length) invalid("恢复任务的结果数量发生变化");
    // ACT: 只持久化下载地址；二进制直接落盘，避免把大媒体复制进任务 JSON。未落盘部分由 resumeTask 重新取回。
    await task?.save({ assetCount: assets.length, assets: resumableAssets(assets, mediaType) });
    let refreshed = false;
    for (let index = 0; index < assets.length; index++) {
      signal?.throwIfAborted();
      const existing = saved.get(index);
      if (existing) { result.push(existing); continue; }
      let content: Awaited<ReturnType<typeof assetBytes>>;
      try { content = await assetBytes(assets[index]!, mediaType, signal); }
      catch (cause) {
        if (refreshed || !checkpoint?.providerData || (cause as { code?: string } | null)?.code !== "MEDIA_ASSET_URL_EXPIRED") throw cause;
        // 下载地址过期时只重新查询原任务一次，不重提生成，也不无限重试同一失效地址。
        assets = await resumeAssets();
        refreshed = true;
        if (!Array.isArray(assets) || assets.length !== checkpoint.assetCount) invalid("恢复任务的结果数量发生变化");
        await task!.save({ assets: resumableAssets(assets, mediaType) });
        content = await assetBytes(assets[index]!, mediaType, signal);
      }
      const { bytes, mimeType } = content;
      signal?.throwIfAborted();
      const output = await resolveWorkspacePath(directory, outputDirectory, true);
      const release = lockWorkspaceFiles([output.path]);
      try {
        await mkdir(output.path, { recursive: true });
        const file = join(outputDirectory, `${mediaType}${task ? `${task.taskId.replaceAll("-", "")}${index}` : crypto.randomUUID()}.${mediaExtensions[mimeType]}`);
        const { path } = await resolveWorkspacePath(directory, file);
        const outputFile = { path: relative(directory, path).replace(/\\/g, "/"), mimeType, mediaType };
        if (task) {
          const fileRecord = { ...outputFile, index, hash: createHash("sha256").update(bytes).digest("hex") };
          await task.save({ files: [...(checkpoint?.files ?? []).filter(item => item.index !== index), fileRecord] });
        }
        signal?.throwIfAborted();
        await writeWorkspaceFile(path, bytes, true);
        written.push(path);
        result.push(outputFile);
      } finally { release(); }
    }
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    // ACT: 只回滚本次创建的文件，保留目录中已有的节点资源。
    if (!task) await Promise.all(written.map(path => unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; })));
    if (!providerInvoked && !signal?.aborted) {
      throw Object.assign(new Error(err instanceof Error ? err.message : String(err)), err, { code: "MEDIA_TASK_FAILED", cause: err });
    }
    throw err;
  } finally { finish(); }
}
