import { createHash, randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { Readable } from "node:stream";
import { mkdir, open, realpath, stat, type FileHandle } from "@lum/file";
import type { EnhancementCapabilities, EnhancementMetadata, EnhancementOptions, EnhancementSource } from "@lum/providers";
import { getStatus } from "@/utils/ffmpeg";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { detectMimeType } from "./priceReference";
import { enhancementCapabilitiesSchema, enhancementOptionsSchema, enhancementMetadataSchema } from "./enhancementSchemas";

export const enhancementLimits = Object.freeze({ inputBytes: 500000000, outputBytes: 2000000000 });
export type EnhancementFile = { path: string; metadata: EnhancementMetadata };
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
function revision(info: NonNullable<Awaited<ReturnType<typeof stat>>>) { return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`; }

async function hashFile(handle: FileHandle, cap: number, signal?: AbortSignal) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(256 * 1024);
  let size = 0;
  while (true) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
    if (!bytesRead) break;
    size += bytesRead;
    if (size > cap) invalid("增强媒体超过允许的大小");
    hash.update(buffer.subarray(0, bytesRead));
  }
  if (!size) invalid("增强媒体为空");
  return { sha256: hash.digest("hex"), size };
}

async function probeVideo(path: string, signal?: AbortSignal) {
  const { tools } = await getStatus();
  if (tools.ffprobe.error || !tools.ffprobe.path) invalid("增强视频需要可用的 FFprobe，请先配置媒体工具");
  const child = Bun.spawn([tools.ffprobe.path, "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm",
    "-count_frames", "-show_entries", "stream=codec_type,width,height,duration,avg_frame_rate,nb_read_frames,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation:format=duration", "-of", "json", "-i", path], {
    stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true, timeout: 120000, signal,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "FFREPORT")),
  });
  const [text, code] = await Promise.all([child.stdout.text(), child.exited]);
  signal?.throwIfAborted();
  if (code !== 0 || text.length > 1024 * 1024) invalid("无法完整探测增强视频");
  const data = JSON.parse(text);
  const streams = data.streams as Record<string, unknown>[];
  const video = streams?.filter(stream => stream.codec_type === "video");
  if (video?.length !== 1) invalid("增强视频必须包含一个实际视频流");
  const audio = streams.filter(stream => stream.codec_type === "audio");
  if (audio.length > 1 || audio.length === 1 && (!Number.isFinite(Number(audio[0]!.duration)) || Number(audio[0]!.duration) <= 0)) invalid("增强视频仅支持时长可验证的单音轨");
  const stream = video[0]!;
  const sar = String(stream.sample_aspect_ratio ?? "1:1");
  const rotations = (stream.side_data_list as { rotation?: number }[] | undefined) ?? [];
  if (!["1:1", "N/A"].includes(sar) || Number((stream.tags as { rotate?: string } | undefined)?.rotate ?? 0) !== 0
    || rotations.some(item => Number(item.rotation ?? 0) !== 0)) invalid("增强暂不支持非方形像素或旋转视频，请先明确转换为正向方形像素视频");
  const [n, d = "1"] = String(stream.avg_frame_rate).split("/");
  const result = { width: Number(stream.width), height: Number(stream.height), duration: Number(stream.duration ?? data.format?.duration),
    fps: Number(n) / Number(d), frameCount: Number(stream.nb_read_frames), hasAudio: audio.length === 1, ...(audio.length ? { audioDuration: Number(audio[0]!.duration) } : {}) };
  if (Object.entries(result).some(([key, value]) => key !== "hasAudio" && (typeof value !== "number" || !Number.isFinite(value) || value <= 0))) invalid("增强视频的实际尺寸、时长、帧率或帧数未知");
  return result;
}

/** cwd 必须来自 resolveWorkspace(req, directory)，不得直接使用请求正文目录。 */
export async function inspectEnhancementFile(cwd: string, sourcePath: string, mediaType: "video", cap: number = enhancementLimits.inputBytes, signal?: AbortSignal): Promise<EnhancementFile> {
  if (mediaType !== "video") invalid("当前仅支持视频超分");
  const directory = await realpath(cwd);
  const { path } = await resolveWorkspacePath(directory, sourcePath);
  const release = lockWorkspaceFiles([path]);
  try { return await inspectUnlocked(directory, path, mediaType, cap, signal); }
  finally { release(); }
}
async function inspectUnlocked(directory: string, path: string, mediaType: "video", cap: number, signal?: AbortSignal): Promise<EnhancementFile> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(cap) || cap <= 0 || cap > enhancementLimits.outputBytes) invalid("增强文件大小上限无效");
  const before = await stat(path);
  if (!before.isFile() || !before.size || before.size > cap) invalid("增强媒体不是允许大小范围内的普通文件");
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    // 不以调用方 MIME 作为 fallback，未知文件不能伪装成视频。
    const mimeType = detectMimeType(header, "");
    if (!["video/mp4", "video/quicktime", "video/webm"].includes(mimeType)) invalid("增强源不是支持的真实媒体格式");
    const digest = await hashFile(handle, cap, signal);
    const dimensions = await probeVideo(path, signal);
    if (!dimensions.width || !dimensions.height) invalid("增强媒体尺寸未知");
    if (revision(before) !== revision(await stat(path)) || revision(before) !== revision(await handle.stat()) || digest.size !== before.size) invalid("增强媒体在检查期间已变化");
    return { path: relative(directory, path).replace(/\\/g, "/"), metadata: enhancementMetadataSchema.parse({ ...digest, mimeType, ...dimensions }) };
  } finally { await handle.close(); }
}

export function validateEnhancementOptions(metadata: EnhancementMetadata, options: EnhancementOptions, capabilities: EnhancementCapabilities, mediaType: "video") {
  metadata = enhancementMetadataSchema.parse(metadata);
  const value = enhancementOptionsSchema.parse(options);
  const bounds = enhancementCapabilitiesSchema.parse(capabilities);
  if (metadata.size > bounds.maxInputBytes || value.width > bounds.maxWidth || value.height > bounds.maxHeight || value.width * value.height > bounds.maxPixels
    || value.width < metadata.width || value.height < metadata.height || value.width / metadata.width > bounds.maxScale || value.height / metadata.height > bounds.maxScale
    || Math.abs(value.width * metadata.height - value.height * metadata.width) > Math.max(metadata.width, metadata.height)
    || !bounds.interpolation.includes(value.interpolation) || !bounds.slowMotion.includes(value.slowMotion) || !bounds.audio.includes(value.audio)) invalid("增强参数不符合模型实际能力或原始宽高比");
  const dimensionMultiple = bounds.dimensionMultiple ?? 1;
  if (value.width % dimensionMultiple || value.height % dimensionMultiple) invalid(`输出宽和高都必须是 ${dimensionMultiple} 的倍数`);
  if (mediaType !== "video") invalid("当前仅支持视频超分");
  const fps = value.fps ?? metadata.fps;
  if (!metadata.duration || !metadata.fps || !metadata.frameCount || !fps || fps < bounds.minFps || fps > bounds.maxFps || metadata.duration > bounds.maxDuration
    || metadata.duration * value.slowMotion > bounds.maxDuration) invalid("视频时长或帧率超过模型能力");
  if (value.interpolation === "none" && (value.slowMotion !== 1 || Math.abs(fps - metadata.fps) > 0.001)) invalid("不补帧模式必须保持原始帧率和速度");
  if (value.slowMotion !== 1 && value.audio !== "mute") invalid("慢放增强须明确静音，不能声称原声仍同步");
  return value;
}

/** 每次 PUT 前后重验整个源，区间结束不含 end；上传成功响应只在完整发送及源未变时返回。 */
export async function createEnhancementSource(cwd: string, frozen: EnhancementFile, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<EnhancementSource> {
  const directory = await realpath(cwd);
  const metadata = Object.freeze(enhancementMetadataSchema.parse(frozen.metadata));
  const sourcePath = frozen.path;
  if (metadata.size > enhancementLimits.inputBytes) invalid("增强输入超过 500 MB");
  return Object.freeze({ metadata, async upload(url: string, range = { start: 0, end: metadata.size }) {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password) invalid("增强上传须使用 HTTPS 地址");
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > metadata.size) invalid("增强上传范围越界");
    const start = range.start, end = range.end;
    const { path } = await resolveWorkspacePath(directory, sourcePath);
    const release = lockWorkspaceFiles([path]);
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, "r");
      const before = await handle.stat();
      const digest = await hashFile(handle, enhancementLimits.inputBytes, signal);
      if (digest.sha256 !== metadata.sha256 || digest.size !== metadata.size) invalid("增强源已变化，请重新准备报价");
      const input = handle;
      let sent = 0;
      const stream = Readable.from((async function* () {
        while (start + sent < end) {
          signal?.throwIfAborted();
          const chunk = Buffer.alloc(Math.min(256 * 1024, end - start - sent));
          const { bytesRead } = await input.read(chunk, 0, chunk.length, start + sent);
          if (!bytesRead) invalid("增强上传源被截断");
          sent += bytesRead;
          yield chunk.subarray(0, bytesRead);
        }
      })());
      const body = Readable.toWeb(stream);
      let response: Response;
      try { response = await fetcher(url, { method: "PUT", headers: { "content-length": String(end - start), "content-type": metadata.mimeType }, body: body as ReadableStream<Uint8Array>, duplex: "half", redirect: "error", signal }); }
      finally { stream.destroy(); }
      const eTag = response.headers.get("etag");
      await response.body?.cancel();
      if (!response.ok || sent !== end - start) invalid(`增强上传未完成（HTTP ${response.status}）`);
      const latest = await hashFile(handle, enhancementLimits.inputBytes, signal);
      const resolved = await resolveWorkspacePath(directory, sourcePath);
      if (resolved.path !== path || latest.sha256 !== metadata.sha256 || latest.size !== metadata.size || revision(before) !== revision(await stat(path)) || revision(before) !== revision(await handle.stat())) invalid("增强源在上传期间变化，禁止确认上传完成");
      return { eTag };
    } finally { await handle?.close(); release(); }
  } });
}

/** 唯一新文件；任何失败均保留部分文件。onCreated 应先持久保存路径，便于任务恢复/人工检查。 */
export async function downloadEnhancementOutput(cwd: string, outputDirectory: string, url: string, mediaType: "video", source: EnhancementMetadata,
  options: EnhancementOptions, capabilities: EnhancementCapabilities, onCreated: (path: string) => Promise<void>, signal?: AbortSignal,
  onValidating?: () => Promise<void>): Promise<EnhancementFile> {
  validateEnhancementOptions(source, options, capabilities, mediaType);
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) invalid("增强结果须使用 HTTPS 地址");
  const directory = await realpath(cwd);
  const output = await resolveWorkspacePath(directory, outputDirectory, true);
  const release = lockWorkspaceFiles([output.path]);
  try {
    await mkdir(output.path, { recursive: true });
    const { path } = await resolveWorkspacePath(directory, join(outputDirectory, `enhanced${options.width}x${options.height}${randomUUID()}.mp4`));
    const relativePath = relative(directory, path).replace(/\\/g, "/");
    await onCreated(relativePath);
    const response = await fetch(url, { signal, redirect: "error" });
    const cap = Math.min(capabilities.maxOutputBytes, enhancementLimits.outputBytes);
    if (!response.ok || Number(response.headers.get("content-length")) > cap || !response.body) { await response.body?.cancel(); invalid("增强结果下载失败或超过大小限制"); }
    const reader = response.body.getReader();
    let handle: FileHandle | undefined;
    const hash = createHash("sha256");
    let size = 0;
    try {
      handle = await open(path, "wx");
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > cap) invalid("增强结果超过允许的大小");
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
          if (!bytesWritten) invalid("增强结果写入未完成");
          offset += bytesWritten;
        }
      }
      await handle.sync();
    } finally { await reader.cancel().catch(() => {}); await handle?.close(); }
    await onValidating?.();
    const result = await inspectUnlocked(directory, path, mediaType, cap, signal);
    const actual = result.metadata;
    if (actual.sha256 !== hash.digest("hex") || actual.size !== size || actual.mimeType !== "video/mp4" || actual.width !== options.width || actual.height !== options.height) invalid("增强结果的内容、格式或尺寸校验失败，已保留文件");
    {
      const fps = options.fps ?? source.fps!;
      const duration = source.duration! * options.slowMotion;
      if (!actual.fps || !actual.duration || Math.abs(actual.fps - fps) > 0.01 || Math.abs(actual.duration - duration) > Math.max(0.1, 2 / fps)
        || !actual.frameCount || (options.interpolation === "none" ? actual.frameCount !== source.frameCount : Math.abs(actual.frameCount - Math.round(duration * fps)) > 2)
        || actual.hasAudio !== (options.audio === "preserve" && source.hasAudio)
        || actual.hasAudio && (!actual.audioDuration || !source.audioDuration || Math.abs(actual.audioDuration - source.audioDuration) > 0.1)) invalid("增强结果时长、帧率或音轨校验失败，已保留文件");
    }
    return result;
  } finally { release(); }
}
