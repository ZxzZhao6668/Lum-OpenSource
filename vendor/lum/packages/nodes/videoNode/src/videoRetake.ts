import type { BrowserFfmpegCommand, BrowserFfmpegFactory, FfprobeData } from "@lum/ffmpeg/browser";
import type { WorkspaceFiles } from "@lum/nodes-scaffold/runtime";
import { normalizeVideoPath, probeMedia, runCommand } from "./videoProcessing";

export type VideoRetakeSourceIdentity = Readonly<{ path: string; sha256: string }>;
export type VideoRetakeContext = {
  ffmpeg: BrowserFfmpegFactory;
  files: Pick<WorkspaceFiles, "write">;
  signal?: AbortSignal;
  /** 校验工作区、画布、素材与操作身份；来源 SHA-256 由固定目录的调用方取得。 */
  assertCurrent: (source: VideoRetakeSourceIdentity) => void | Promise<void>;
};

export type VideoRetakeRational = Readonly<{ numerator: number; denominator: number }>;
type MediaStream = Readonly<{
  index: number;
  codec: string;
  timeBase: VideoRetakeRational;
  start: number;
  end: number;
  durationFrom: "stream" | "container";
}>;
/** start/end 相对于容器播放起点；origin 是文件中的原始时钟。 */
export type VideoRetakeMedia = Readonly<{
  origin: number;
  duration: number;
  size: number;
  video: MediaStream & Readonly<{
    width: number;
    height: number;
    rotation: number;
    sampleAspectRatio: VideoRetakeRational;
    displayWidth: number;
    displayHeight: number;
    pixelFormat: string;
    frameRate: VideoRetakeRational;
    nominalFrameRate?: VideoRetakeRational;
    colorSpace?: string;
    colorTransfer?: string;
    colorPrimaries?: string;
    colorRange?: string;
  }>;
  audio?: MediaStream & Readonly<{ sampleRate: number; channels: number }>;
}>;
export type VideoRetakeSource = VideoRetakeSourceIdentity & Readonly<{ media: VideoRetakeMedia }>;
export type VideoRetakeTimes = Readonly<{ start: number; end: number }>;
export type VideoRetakeRange = VideoRetakeTimes & Readonly<{
  requested: VideoRetakeTimes;
  duration: number;
  /** 视频拼接/片段时长的核验阈值，绝不用于批准较短候选。 */
  toleranceSeconds: number;
  alignment: "timestamp";
}>;
export type VideoRetakeRangePaths = Readonly<{ clipPath: string; firstFramePath?: string; lastFramePath?: string }>;
export type VideoRetakePreparedRange = VideoRetakeRangePaths & Readonly<{
  range: VideoRetakeRange;
  clip: VideoRetakeMedia;
  firstFrameTime: number;
  lastFrameTime: number;
}>;
/** muteRange 只静音所选区间，选区外保留原声；无原声音轨时保持无音轨。 */
export type VideoRetakeAudioPolicy = "preserve" | "candidate" | "muteRange";
/** start 相对于候选首帧；指定非零起点或候选超长均须显式同意裁取。 */
export type VideoRetakeTrim = Readonly<{ start?: number; allowTrim?: boolean }>;
export type VideoRetakeCandidate = Readonly<{
  path: string;
  media: VideoRetakeMedia;
  range: VideoRetakeTimes;
  requiresTrim: boolean;
}>;
export type VideoRetakeAssemblyOptions = Readonly<{
  candidatePath: string;
  outputPath: string;
  audioPolicy?: VideoRetakeAudioPolicy;
  trim?: VideoRetakeTrim;
}>;
export type VideoRetakeResult = Readonly<{
  path: string;
  source: VideoRetakeSourceIdentity;
  range: VideoRetakeRange;
  candidate: VideoRetakeCandidate;
  /** 替换画面在输出时间线上的实际首末帧 PTS。 */
  replacementFrames: VideoRetakeTimes;
  audioPolicy: VideoRetakeAudioPolicy;
  media: VideoRetakeMedia;
}>;

const microseconds = 1_000_000;
const audioRate = 48_000;
const audioTolerance = 1024 / audioRate + 0.001;
const toPts = (seconds: number) => Math.round(seconds * microseconds);
const toSamples = (seconds: number) => Math.round(seconds * audioRate);
const atTimestamp = (seconds: number) => toPts(seconds) / microseconds;
const ratio = ({ numerator, denominator }: VideoRetakeRational) => numerator / denominator;

function rational(input: unknown): VideoRetakeRational | undefined {
  const match = /^(\d+)[:/](\d+)$/.exec(String(input));
  if (!match) return;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && numerator > 0 && denominator > 0) {
    return { numerator, denominator };
  }
}

function finite(input: unknown) {
  if (typeof input !== "number" && (typeof input !== "string" || !input.trim())) return undefined;
  const value = Number(input);
  if (Number.isFinite(value)) return value;
}

function integer(input: unknown) {
  const value = finite(input);
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

function streamInfo(stream: FfprobeData["streams"][number], origin: number, length: number): MediaStream {
  const timeBase = rational(stream.time_base);
  if (!timeBase || !Number.isSafeInteger(stream.index) || stream.index < 0 || !stream.codec_name) throw new Error("媒体流缺少有效的编码或时间基信息");
  const startPts = integer(stream.start_pts);
  const durationPts = integer(stream.duration_ts);
  const rawStart = startPts === undefined ? finite(stream.start_time) ?? origin : startPts * ratio(timeBase);
  const declared = durationPts && durationPts > 0 ? durationPts * ratio(timeBase) : finite(stream.duration);
  const start = atTimestamp(rawStart - origin);
  const fromStream = declared !== undefined && declared > 0;
  const end = atTimestamp(fromStream ? rawStart - origin + declared : length);
  if (!Number.isSafeInteger(toPts(start)) || !Number.isSafeInteger(toPts(end)) || end <= start) throw new Error("媒体流没有有效的播放区间");
  return { index: stream.index, codec: stream.codec_name, timeBase, start, end, durationFrom: fromStream ? "stream" : "container" };
}

function readMedia(data: FfprobeData): VideoRetakeMedia {
  // ACT: 只采用默认（否则首条）实际画面和音轨，不把封面当作视频。
  const videos = data.streams.filter(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic && !stream.disposition?.timed_thumbnails);
  const audios = data.streams.filter(stream => stream.codec_type === "audio");
  const video = videos.find(stream => stream.disposition?.default) ?? videos[0];
  const audio = audios.find(stream => stream.disposition?.default) ?? audios[0];
  const size = finite(data.format.size);
  if (!video?.width || !video.height || !video.pix_fmt || !(size && size > 0)) throw new Error("文件不包含可读取的视频画面");
  const origin = atTimestamp(finite(data.format.start_time) ?? finite(video.start_time) ?? 0);
  const duration = atTimestamp(finite(data.format.duration) ?? finite(video.duration) ?? 0);
  if (!Number.isSafeInteger(toPts(origin)) || !Number.isSafeInteger(toPts(duration)) || duration <= 0) throw new Error("无法确定媒体起点或时长");
  const nominalFrameRate = rational(video.r_frame_rate);
  const frameRate = rational(video.avg_frame_rate) ?? nominalFrameRate;
  if (!frameRate) throw new Error("无法读取视频的实际帧率信息");
  const rotationSideData = (video.side_data_list as { rotation?: number }[] | undefined)?.find(item => item.rotation !== undefined);
  const rotation = Number(rotationSideData?.rotation ?? video.tags?.rotate ?? 0);
  const quarterTurn = Math.round(rotation / 90);
  if (!Number.isFinite(rotation) || Math.abs(rotation - quarterTurn * 90) > 0.01) throw new Error("视频旋转角度无法可靠处理");
  const normalizedRotation = (quarterTurn % 4 + 4) % 4 * 90;
  const sampleAspectRatio = rational(video.sample_aspect_ratio) ?? { numerator: 1, denominator: 1 };
  const squareWidth = video.width * ratio(sampleAspectRatio);
  const swapped = normalizedRotation % 180 !== 0;
  const sampleRate = audio ? integer(audio.sample_rate) : undefined;
  const channels = audio ? integer(audio.channels) : undefined;
  if (audio && (!(sampleRate && sampleRate > 0) || !(channels && channels > 0))) throw new Error("无法读取音轨采样率或声道数");
  if (video.color_transfer === "smpte2084" || video.color_transfer === "arib-std-b67") throw new Error("当前片段重拍不支持 HDR 视频合成");
  return {
    origin, duration, size,
    video: {
      ...streamInfo(video, origin, duration), width: video.width, height: video.height, rotation: normalizedRotation,
      sampleAspectRatio, displayWidth: swapped ? video.height : squareWidth, displayHeight: swapped ? squareWidth : video.height,
      pixelFormat: video.pix_fmt, frameRate, nominalFrameRate, colorSpace: video.color_space,
      colorTransfer: video.color_transfer, colorPrimaries: video.color_primaries, colorRange: video.color_range,
    },
    ...(audio && sampleRate && channels ? { audio: { ...streamInfo(audio, origin, duration), sampleRate, channels } } : {}),
  };
}

function videoTolerance(video: VideoRetakeMedia["video"]) {
  return 1 / ratio(video.frameRate) + 0.001;
}

async function assertCurrent(context: VideoRetakeContext, source: VideoRetakeSourceIdentity) {
  context.signal?.throwIfAborted();
  await context.assertCurrent({ path: source.path, sha256: source.sha256 });
  context.signal?.throwIfAborted();
}

export async function probeVideoRetakeSource(context: VideoRetakeContext, identity: VideoRetakeSourceIdentity): Promise<VideoRetakeSource> {
  const path = normalizeVideoPath(identity.path);
  if (!/^[\da-f]{64}$/i.test(identity.sha256)) throw new Error("缺少有效的原片 SHA-256 快照");
  const source = { path, sha256: identity.sha256.toLowerCase() };
  await assertCurrent(context, source);
  const media = readMedia(await probeMedia(context.ffmpeg, path, context.signal));
  await assertCurrent(context, source);
  return { ...source, media };
}

export function planVideoRetakeRange(source: VideoRetakeSource, requested: VideoRetakeTimes): VideoRetakeRange {
  const min = Math.max(0, source.media.video.start);
  const max = source.media.video.end;
  const { start, end } = requested;
  if (!Number.isSafeInteger(toPts(min)) || !Number.isSafeInteger(toPts(max))
    || !Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || toPts(end) <= toPts(start)) {
    throw new Error(`请选择 ${min}–${max} 秒内有效的视频区间`);
  }
  return {
    requested: { start, end }, start: atTimestamp(start), end: atTimestamp(end),
    duration: (toPts(end) - toPts(start)) / microseconds, toleranceSeconds: videoTolerance(source.media.video), alignment: "timestamp",
  };
}

function checkPaths(inputs: string[], outputs: (string | undefined)[]) {
  const keys = new Set(inputs.map(path => normalizeVideoPath(path).toLowerCase()));
  for (const value of outputs) {
    if (value === undefined) continue;
    const path = normalizeVideoPath(value).toLowerCase();
    if (keys.has(path)) throw new Error("片段重拍的输出不能覆盖输入或其他输出");
    keys.add(path);
  }
}

function outputPath(value: string, extension: "mp4" | "png") {
  const path = normalizeVideoPath(value);
  if (!path.toLowerCase().endsWith(`.${extension}`)) throw new Error(`片段重拍输出必须是 ${extension.toUpperCase()} 文件`);
  return path;
}

async function writeOwnedOutput(context: VideoRetakeContext, source: VideoRetakeSource, path: string, command: BrowserFfmpegCommand) {
  await assertCurrent(context, source);
  // fluent 固定带 -y，与 -n 互斥；独占新建后才可将该路径交给 FFmpeg。
  await context.files.write(path, new ArrayBuffer(0), true);
  await assertCurrent(context, source);
  await runCommand(command.output(path), context.signal);
}

function canvasSize(media: VideoRetakeMedia) {
  const even = (value: number) => Math.max(2, Math.ceil(Math.round(value) / 2) * 2);
  return { width: even(media.video.displayWidth), height: even(media.video.displayHeight) };
}

function fitVideo({ width, height }: ReturnType<typeof canvasSize>, pixelFormat: "yuv420p" | "rgb24" = "yuv420p") {
  // FFmpeg 自动应用显示矩阵；用旋转后 DAR（含 SAR）等比缩放，再补边为方形像素。
  return `scale=w='max(2,trunc(min(${width},${height}*dar)/2)*2)':h='max(2,trunc(min(${height},${width}/dar)/2)*2)'`
    + `${pixelFormat === "yuv420p" ? ":out_color_matrix=bt709:out_range=tv" : ""},setsar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=${pixelFormat}`;
}

function videoTrim(start: number, end: number, origin: number) {
  return `settb=AVTB,trim=start_pts=${toPts(origin) + toPts(start)}:end_pts=${toPts(origin) + toPts(end)}`;
}

function videoCommand(command: BrowserFfmpegCommand, filters: string[], duration: number, audio: boolean) {
  command.complexFilter(filters).format("mp4").videoCodec("libx264")
    .outputOptions("-map", "[video]", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_range", "tv",
      "-fps_mode", "passthrough", "-enc_time_base", "1:1000000", "-video_track_timescale", "1000000", "-xerror", "-loglevel", "info",
      "-map_metadata", "-1", "-movflags", "+faststart").duration(duration);
  return audio ? command.audioCodec("aac").audioBitrate(192).outputOptions("-map", "[audio]") : command.noAudio();
}

function normalizedAudio(input: number, media: VideoRetakeMedia, end: number, label: string) {
  return `[${input}:${media.audio!.index}]asetpts=PTS-${toPts(media.origin)}/1000000/TB,aresample=${audioRate}:async=1:first_pts=0,`
    + `aformat=sample_rates=${audioRate}:channel_layouts=stereo,apad=whole_len=${toSamples(end)},atrim=end_sample=${toSamples(end)}[${label}]`;
}

function verifyOutput(data: FfprobeData, size: ReturnType<typeof canvasSize>, expected: { start: number; end: number; duration: number; videoTolerance: number; audioEnd?: number }) {
  const media = readMedia(data);
  const { video, audio } = media;
  if (!data.format.format_name?.split(",").includes("mp4") || data.streams.length !== (expected.audioEnd === undefined ? 1 : 2)
    || video.codec !== "h264" || video.pixelFormat !== "yuv420p" || video.rotation !== 0 || ratio(video.sampleAspectRatio) !== 1
    || video.width !== size.width || video.height !== size.height) throw new Error("合成的视频编码、尺寸或流数量不正确");
  if (Math.abs(media.origin + video.start - expected.start) > expected.videoTolerance
    || Math.abs(media.origin + video.end - expected.end) > expected.videoTolerance
    || Math.abs(media.duration - expected.duration) > Math.max(expected.videoTolerance, expected.audioEnd === undefined ? 0 : audioTolerance)) {
    throw new Error("生成视频的时间线超出允许偏差");
  }
  if (expected.audioEnd !== undefined && (!audio || audio.codec !== "aac" || audio.sampleRate !== audioRate || audio.channels !== 2
    || Math.abs(media.origin + audio.start) > audioTolerance || Math.abs(media.origin + audio.end - expected.audioEnd) > audioTolerance)) {
    throw new Error("生成视频的音轨或音轨时间线不正确");
  }
  return media;
}

function observeFrameTimes(command: BrowserFfmpegCommand) {
  let first: number | undefined;
  let last: number | undefined;
  command.on("stderr", line => {
    // 只保留真实首末 PTS；不累积逐帧列表，也不向浏览器传输解码画面。
    const match = line.includes("showinfo") && /\bn:\s*\d+\s+pts:\s*(-?\d+)\b/.exec(line);
    if (!match) return;
    const pts = Number(match[1]);
    if (!Number.isSafeInteger(pts)) return;
    first ??= pts;
    last = pts;
  });
  return (start: number, end: number) => {
    if (first === undefined || last === undefined || first < start || last < first || last >= end) {
      throw new Error("所选区间没有可确认的画面时间戳");
    }
    return { first, last };
  };
}

export async function prepareVideoRetakeRange(context: VideoRetakeContext, source: VideoRetakeSource, selection: VideoRetakeRange, paths: VideoRetakeRangePaths): Promise<VideoRetakePreparedRange> {
  const range = planVideoRetakeRange(source, selection.requested);
  const clipPath = outputPath(paths.clipPath, "mp4");
  const firstFramePath = paths.firstFramePath === undefined ? undefined : outputPath(paths.firstFramePath, "png");
  const lastFramePath = paths.lastFramePath === undefined ? undefined : outputPath(paths.lastFramePath, "png");
  checkPaths([source.path], [clipPath, firstFramePath, lastFramePath]);
  const sourcePath = normalizeVideoPath(source.path);
  const { media } = source;
  const size = canvasSize(media);
  const startPts = toPts(media.origin) + toPts(range.start);
  const filters = [`[0:${media.video.index}]${videoTrim(range.start, range.end, media.origin)},showinfo=checksum=0,setpts=PTS-${startPts},${fitVideo(size)}[video]`];
  if (media.audio) {
    filters.push(normalizedAudio(0, media, range.end, "clipAudio"),
      `[clipAudio]atrim=start_sample=${toSamples(range.start)}:end_sample=${toSamples(range.end)},asetpts=PTS-STARTPTS[audio]`);
  }
  const command = videoCommand(context.ffmpeg(sourcePath, { stdoutLines: 20 }).inputOptions("-copyts", "-nostdin"), filters, range.duration, !!media.audio);
  const readFrameTimes = observeFrameTimes(command);
  await writeOwnedOutput(context, source, clipPath, command);
  const { first: firstPts, last: lastPts } = readFrameTimes(startPts, toPts(media.origin) + toPts(range.end));
  const clip = verifyOutput(await probeMedia(context.ffmpeg, clipPath, context.signal), size,
    { start: (firstPts - startPts) / microseconds, end: range.duration, duration: range.duration, videoTolerance: range.toleranceSeconds,
      audioEnd: media.audio ? range.duration : undefined });
  for (const [path, pts] of [[firstFramePath, firstPts], [lastFramePath, lastPts]] as const) {
    if (!path) continue;
    const frame = context.ffmpeg(sourcePath).inputOptions("-copyts", "-nostdin").noAudio().frames(1).videoCodec("png").format("image2")
      .videoFilters(`settb=AVTB,trim=start_pts=${pts}:end_pts=${pts + 1},setpts=PTS-STARTPTS,${fitVideo(size, "rgb24")}`)
      .outputOptions("-map", `0:${media.video.index}`, "-update", "1", "-map_metadata", "-1");
    await writeOwnedOutput(context, source, path, frame);
    const data = await probeMedia(context.ffmpeg, path, context.signal);
    if (!(Number(data.format.size) > 0) || !data.streams.some(stream => stream.codec_name === "png" && stream.width === size.width && stream.height === size.height)) {
      throw new Error("所选区间的参考帧未成功生成");
    }
  }
  await assertCurrent(context, source);
  return { clipPath, firstFramePath, lastFramePath, range, clip,
    firstFrameTime: (firstPts - toPts(media.origin)) / microseconds, lastFrameTime: (lastPts - toPts(media.origin)) / microseconds };
}

function checkAudioPolicy(value: VideoRetakeAudioPolicy) {
  if (value !== "preserve" && value !== "candidate" && value !== "muteRange") throw new Error("未知的片段重拍音频策略");
}

export async function validateVideoRetakeCandidate(context: VideoRetakeContext, source: VideoRetakeSource, selection: VideoRetakeRange, candidatePath: string, trim: VideoRetakeTrim = {}, audioPolicy: VideoRetakeAudioPolicy = "preserve"): Promise<VideoRetakeCandidate> {
  const range = planVideoRetakeRange(source, selection.requested);
  const path = normalizeVideoPath(candidatePath);
  checkPaths([source.path], [path]);
  checkAudioPolicy(audioPolicy);
  const offset = trim.start ?? 0;
  const allowTrim = trim.allowTrim === true;
  if (!Number.isFinite(offset) || offset < 0) throw new Error("候选裁取起点无效");
  await assertCurrent(context, source);
  const media = readMedia(await probeMedia(context.ffmpeg, path, context.signal));
  const start = atTimestamp(media.video.start + offset);
  const end = atTimestamp(start + range.duration);
  if (toPts(end) > toPts(media.video.end) + 1) throw new Error("候选视频短于所需替换区间");
  const requiresTrim = start > media.video.start || toPts(media.video.end) - toPts(end) > 1;
  if (requiresTrim && !allowTrim) throw new Error("候选需要裁取，须明确同意后才能使用");
  if (audioPolicy === "candidate") {
    if (!media.audio) throw new Error("候选视频没有可替换的音轨");
    const sampleStep = 1 / media.audio.sampleRate;
    if (media.audio.start > start + sampleStep || media.audio.end < end - sampleStep) throw new Error("候选音轨未覆盖所选裁取区间");
  }
  await assertCurrent(context, source);
  return { path, media, range: { start, end }, requiresTrim };
}

function addAssemblyAudio(filters: string[], source: VideoRetakeMedia, range: VideoRetakeRange, candidate: VideoRetakeCandidate, policy: VideoRetakeAudioPolicy) {
  if (!source.audio && policy !== "candidate") return;
  const end = policy === "candidate" ? (source.audio ? Math.max(source.audio.end, range.end) : source.duration) : source.audio!.end;
  if (policy === "preserve") {
    filters.push(normalizedAudio(0, source, end, "audio"));
    return end;
  }
  const startSample = toSamples(range.start);
  const endSample = toSamples(Math.min(end, range.end));
  const total = toSamples(end);
  const parts = [[0, Math.min(startSample, total)], [startSample, endSample], [endSample, total]] as const;
  const croppedParts = parts.flatMap(([start, stop], index) => stop > start ? [{ start, stop, index }] : []);
  const useSource = (index: number) => !!source.audio && (index !== 1 || policy !== "candidate");
  const sourceInputs = croppedParts.filter(part => useSource(part.index)).map(part => `[original${part.index}]`);
  if (sourceInputs.length) {
    filters.push(normalizedAudio(0, source, end, sourceInputs.length > 1 ? "original" : sourceInputs[0].slice(1, -1)));
    if (sourceInputs.length > 1) filters.push(`[original]asplit=${sourceInputs.length}${sourceInputs.join("")}`);
  }
  for (const { index, start, stop } of croppedParts) {
    const label = croppedParts.length === 1 ? "audio" : `audio${index}`;
    if (index === 1 && policy === "candidate") {
      const candidateStart = toSamples(candidate.range.start);
      const candidateEnd = candidateStart + stop - start;
      filters.push(normalizedAudio(1, candidate.media, candidateEnd / audioRate, "replacementAudio"),
        `[replacementAudio]atrim=start_sample=${candidateStart}:end_sample=${candidateEnd},asetpts=PTS-STARTPTS[${label}]`);
    } else if (useSource(index)) {
      filters.push(`[original${index}]atrim=start_sample=${start}:end_sample=${stop},asetpts=PTS-STARTPTS${index === 1 ? ",volume=0" : ""}[${label}]`);
    } else {
      filters.push(`anullsrc=r=${audioRate}:cl=stereo,atrim=end_sample=${stop - start},asetpts=PTS-STARTPTS[${label}]`);
    }
  }
  if (croppedParts.length > 1) filters.push(`${croppedParts.map(part => `[audio${part.index}]`).join("")}concat=n=${croppedParts.length}:v=0:a=1[audio]`);
  return end;
}

export async function assembleVideoRetake(context: VideoRetakeContext, source: VideoRetakeSource, selection: VideoRetakeRange, options: VideoRetakeAssemblyOptions): Promise<VideoRetakeResult> {
  const range = planVideoRetakeRange(source, selection.requested);
  const path = outputPath(options.outputPath, "mp4");
  const audioPolicy = options.audioPolicy ?? "preserve";
  const candidatePath = normalizeVideoPath(options.candidatePath);
  checkPaths([source.path, candidatePath], [path]);
  const candidate = await validateVideoRetakeCandidate(context, source, range, candidatePath, options.trim, audioPolicy);
  const sourcePath = normalizeVideoPath(source.path);
  const { media } = source;
  const size = canvasSize(media);
  const fit = fitVideo(size);
  const filters: string[] = [];
  const parts: string[] = [];
  const before = range.start > Math.max(0, media.video.start);
  const after = range.end < media.video.end;
  const command = context.ffmpeg(sourcePath, { stdoutLines: 20 }).inputOptions("-copyts", "-nostdin").input(candidate.path);
  if (before && after) command.input(sourcePath);
  // 各段用原时间轴 PTS 拼接。interleave 不从前段最后一帧推算下段起点，避免 VFR 边界累积偏移。
  if (before) {
    filters.push(`[0:${media.video.index}]${videoTrim(media.video.start, range.start, media.origin)},setpts=PTS-${toPts(media.origin)},${fit}[before]`);
    parts.push("[before]");
  }
  filters.push(`[1:${candidate.media.video.index}]${videoTrim(candidate.range.start, candidate.range.end, candidate.media.origin)},`
    + `setpts=PTS-(${toPts(candidate.media.origin) + toPts(candidate.range.start) - toPts(range.start)}),showinfo=checksum=0,${fit}[${before || after ? "replacement" : "video"}]`);
  if (before || after) parts.push("[replacement]");
  if (after) {
    filters.push(`[${before ? 2 : 0}:${media.video.index}]${videoTrim(range.end, media.video.end, media.origin)},setpts=PTS-${toPts(media.origin)},${fit}[after]`);
    parts.push("[after]");
  }
  if (parts.length > 1) filters.push(`${parts.join("")}interleave=n=${parts.length}[video]`);
  const audioEnd = addAssemblyAudio(filters, media, range, candidate, audioPolicy);
  const duration = Math.max(media.duration, media.video.end, audioEnd ?? 0);
  const readFrameTimes = observeFrameTimes(command);
  await writeOwnedOutput(context, source, path, videoCommand(command, filters, duration, audioEnd !== undefined));
  const { first, last } = readFrameTimes(toPts(range.start), toPts(range.end));
  const replacementFrames = { start: first / microseconds, end: last / microseconds };
  const candidateTolerance = videoTolerance(candidate.media.video);
  if (replacementFrames.start - range.start > candidateTolerance || range.end - replacementFrames.end > candidateTolerance) {
    throw new Error("候选画面的实际时间戳未覆盖所选区间");
  }
  const result = verifyOutput(await probeMedia(context.ffmpeg, path, context.signal), size,
    { start: Math.max(0, media.video.start), end: media.video.end, duration, videoTolerance: range.toleranceSeconds, audioEnd });
  await assertCurrent(context, source);
  return { path, source: { path: sourcePath, sha256: source.sha256 }, range, candidate, replacementFrames, audioPolicy, media: result };
}
