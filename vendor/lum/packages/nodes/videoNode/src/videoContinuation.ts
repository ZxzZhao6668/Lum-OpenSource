import type { BrowserFfmpegCommand, BrowserFfmpegFactory, FfprobeData } from "@lum/ffmpeg/browser";
import { normalizeVideoPath, probeMedia, runCommand } from "./videoProcessing";

/** 记在续写节点上：它接的是哪段视频、从哪一帧接、拼接时怎么去重。 */
export type VideoContinuationLink = {
  version: 1;
  /** frame：取原片尾帧作下一段首帧；video：整段原片作为视频参考交给模型。 */
  method: "frame" | "video";
  sourceNodeId: string;
  sourceHandleId: string;
  /** 续写时原片的文件；原片节点之后换了视频，拼接仍用这一份。 */
  sourcePath: string;
  sourceLabel?: string;
  tailFrameNodeId?: string;
  tailFramePath?: string;
  /** 尾帧在原片时间轴上的 PTS（微秒，-copyts 口径）。 */
  tailPts?: number;
  /** 尾帧距原片画面起点的秒数。 */
  tailTime?: number;
  /** 从最后一帧往前退了几帧；拼接时原片末尾这几帧会裁掉。 */
  backFrames: number;
  /** 续写片段的第一帧就是原片尾帧，拼接时去掉。 */
  dropFirstFrame: boolean;
  autoCompose: boolean;
  composedNodeId?: string;
  /** 在当前生成节点配置的衔接素材。原片用于拼接，referencePath 才随生成请求提交。 */
  previousShot?: {
    referencePath: string;
    start: number;
    end: number;
    resultPath?: string;
    frameDuration: number;
    inheritedReference?: {source: string; handle: string};
  };
};

export type VideoClipInfo = Readonly<{
  /** 画面时长（秒）。 */
  duration: number;
  /** 显示尺寸，已计入旋转和像素宽高比。 */
  width: number;
  height: number;
  /** FFmpeg 可直接使用的帧率，如 24/1、30000/1001。 */
  frameRate: string;
  frameDuration: number;
  videoIndex: number;
  audioIndex?: number;
  /** 画面第一帧在文件时钟上的位置（微秒）。 */
  startPts: number;
  colorMatrix: "bt709" | "bt601";
  colorTags: string[];
}>;
export type VideoTailFrame = Readonly<{ path: string; pts: number; time: number; backFrames: number; clip: VideoClipInfo }>;
/** endPts 为该片段保留的最后一帧 PTS（微秒，含）；缺省保留到结尾。 */
export type VideoConcatClip = Readonly<{ path: string; dropFirstFrame?: boolean; endPts?: number; startTime?: number; endTime?: number }>;
export type VideoConcatResult = Readonly<{ path: string; duration: number; width: number; height: number; hasAudio: boolean; segments: number[] }>;

const microseconds = 1_000_000;
const audioRate = 48_000;
const toPts = (seconds: number) => Math.round(seconds * microseconds);

function rational(input: unknown) {
  const match = /^(\d+)[:/](\d+)$/.exec(String(input));
  if (!match) return;
  const numerator = Number(match[1]), denominator = Number(match[2]);
  if (numerator > 0 && denominator > 0) return { text: `${numerator}/${denominator}`, value: numerator / denominator };
}

function finite(input: unknown) {
  if (typeof input !== "number" && (typeof input !== "string" || !input.trim())) return;
  const value = Number(input);
  if (Number.isFinite(value)) return value;
}

export function readVideoClip(data: FfprobeData): VideoClipInfo {
  // 封面图不算画面；多条流时取默认流，否则取第一条。
  const videos = data.streams.filter(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic && !stream.disposition?.timed_thumbnails);
  const audios = data.streams.filter(stream => stream.codec_type === "audio");
  const video = videos.find(stream => stream.disposition?.default) ?? videos[0];
  const audio = audios.find(stream => stream.disposition?.default) ?? audios[0];
  if (!video?.width || !video.height) throw new Error("文件不包含可读取的视频画面");
  if (video.color_transfer === "smpte2084" || video.color_transfer === "arib-std-b67") throw new Error("视频续写暂不支持 HDR 视频");
  const frameRate = rational(video.avg_frame_rate) ?? rational(video.r_frame_rate);
  if (!frameRate) throw new Error("无法读取视频帧率");
  const origin = finite(data.format.start_time) ?? 0;
  const start = finite(video.start_time) ?? origin;
  const duration = finite(video.duration) ?? (finite(data.format.duration) ?? 0) - (start - origin);
  if (!(duration > 0)) throw new Error("无法读取有效的视频时长");
  const sideData = (video.side_data_list as { rotation?: number }[] | undefined)?.find(item => item.rotation !== undefined);
  const rotation = Number(sideData?.rotation ?? video.tags?.rotate ?? 0);
  const swapped = Number.isFinite(rotation) && Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const squareWidth = Math.max(1, Math.round(video.width * (rational(video.sample_aspect_ratio)?.value ?? 1)));
  const width = swapped ? video.height : squareWidth, height = swapped ? squareWidth : video.height;
  // 没写色彩标记的文件按播放器的惯例处理：高清当 BT.709，标清当 BT.601。
  const colorMatrix = video.color_space === "bt709" ? "bt709" : ["smpte170m", "bt470bg"].includes(String(video.color_space)) ? "bt601"
    : width >= 1280 || height >= 720 ? "bt709" : "bt601";
  const tag = (option: string, value: unknown) => typeof value === "string" && value && value !== "unknown" && value !== "reserved" ? [option, value] : [];
  return {
    duration, width, height, frameRate: frameRate.text, frameDuration: 1 / frameRate.value,
    videoIndex: video.index, ...(audio ? { audioIndex: audio.index } : {}), startPts: toPts(start), colorMatrix,
    colorTags: [...tag("-colorspace", video.color_space), ...tag("-color_primaries", video.color_primaries), ...tag("-color_trc", video.color_transfer)],
  };
}

function watchFrameTimes(command: BrowserFfmpegCommand) {
  const times: number[] = [];
  command.on("stderr", line => {
    const match = line.includes("showinfo") && /\bn:\s*\d+\s+pts:\s*(-?\d+)\b/.exec(line);
    if (!match) return;
    const pts = Number(match[1]);
    if (!Number.isSafeInteger(pts)) return;
    times.push(pts);
    // 只需要末尾若干帧，不随视频长度累积。
    if (times.length > 512) times.splice(0, times.length - 256);
  });
  return times;
}

function checkOutput(source: string, value: string, extension: "png" | "mp4") {
  const path = normalizeVideoPath(value);
  if (!path.toLowerCase().endsWith(`.${extension}`)) throw new Error(`输出必须是 ${extension.toUpperCase()} 文件`);
  if (path.toLowerCase() === source.toLowerCase()) throw new Error("输出文件不能覆盖原视频");
  return path;
}

/**
 * 用 FFmpeg 解码取出真正的最后一帧（或往前第 backFrames 帧），存成无损 PNG。
 * 浏览器 video 元素定位到「结尾前一点」拿到的往往不是最后一帧，接下一段时画面会跳。
 */
export async function extractVideoTailFrame(ffmpeg: BrowserFfmpegFactory, source: string, output: string, options: { backFrames?: number; signal?: AbortSignal } = {}): Promise<VideoTailFrame> {
  const { signal } = options;
  const backFrames = options.backFrames ?? 0;
  if (!Number.isInteger(backFrames) || backFrames < 0 || backFrames > 48) throw new Error("尾帧回退帧数须在 0–48 之间");
  const sourcePath = normalizeVideoPath(source);
  const outputPath = checkOutput(sourcePath, output, "png");
  const clip = readVideoClip(await probeMedia(ffmpeg, sourcePath, signal));
  const frame = `scale=${clip.width}:${clip.height}:in_color_matrix=${clip.colorMatrix}:flags=bicubic+accurate_rnd+full_chroma_int,setsar=1,format=rgb24`;
  const scan = async (seconds?: number) => {
    // 每解出一帧就覆盖同一张图，结束时留下的就是最后一帧；同时记下各帧时间戳。
    const command = ffmpeg(sourcePath, { stdoutLines: 20 })
      .inputOptions(...(seconds ? ["-sseof", `-${seconds.toFixed(3)}`] : []), "-copyts", "-nostdin")
      .noAudio().videoCodec("png").format("image2")
      .videoFilters(`settb=AVTB,showinfo=checksum=0,${frame}`)
      .outputOptions("-map", `0:${clip.videoIndex}`, "-update", "1", "-map_metadata", "-1", "-loglevel", "info");
    const times = watchFrameTimes(command);
    await runCommand(command.output(outputPath), signal);
    return times;
  };
  const tail = Math.max(1, (backFrames + 6) * clip.frameDuration + 0.5);
  let times = clip.duration > tail + 1 ? await scan(tail) : await scan();
  // 关键帧稀疏或时间戳不规则时末段可能扫不够，改为完整解码一遍。
  if (times.length < backFrames + 1 && clip.duration > tail + 1) times = await scan();
  if (!times.length) throw new Error("没有读到视频的尾帧，请确认文件可以正常播放");
  if (times.length < backFrames + 1) throw new Error(`视频只有 ${times.length} 帧，不能往前退 ${backFrames} 帧`);
  const pts = times[times.length - 1 - backFrames]!;
  const time = (pts - clip.startPts) / microseconds;
  if (backFrames) {
    const command = ffmpeg(sourcePath).inputOptions("-copyts", "-nostdin");
    if (time > 3) command.seekInput(time - 2);
    await runCommand(command.noAudio().frames(1).videoCodec("png").format("image2")
      .videoFilters(`settb=AVTB,trim=start_pts=${pts}:end_pts=${pts + 1},setpts=PTS-STARTPTS,${frame}`)
      .outputOptions("-map", `0:${clip.videoIndex}`, "-update", "1", "-map_metadata", "-1").output(outputPath), signal);
  }
  const image = await probeMedia(ffmpeg, outputPath, signal);
  if (!(Number(image.format.size) > 0) || !image.streams.some(stream => stream.codec_name === "png" && stream.width === clip.width && stream.height === clip.height)) {
    throw new Error("尾帧图片没有成功生成");
  }
  return { path: outputPath, pts, time, backFrames, clip };
}

/** 只把所选的末段画面交给模型。按视频流时钟裁切，声音不作为动作参考。 */
export async function extractVideoTailClip(ffmpeg: BrowserFfmpegFactory, source: string, output: string, clip: VideoClipInfo, seconds: number, signal?: AbortSignal) {
  const path = checkOutput(normalizeVideoPath(source), output, "mp4");
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > clip.duration) throw new Error("参考时长须在原片时长以内");
  const start = clip.duration - seconds;
  const command = ffmpeg(source).inputOptions("-copyts", "-nostdin");
  if (start > 2) command.seekInput(start - 2);
  command.noAudio().videoCodec("libx264").format("mp4")
    .videoFilters(`settb=AVTB,trim=start_pts=${clip.startPts + toPts(start)},setpts=PTS-STARTPTS,pad=ceil(iw/2)*2:ceil(ih/2)*2`)
    .outputOptions("-map", `0:${clip.videoIndex}`, "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
  await runCommand(command.output(path), signal);
  const result = readVideoClip(await probeMedia(ffmpeg, path, signal));
  if (Math.abs(result.duration - seconds) > Math.max(0.1, 2 * clip.frameDuration)) throw new Error("导出的动作参考片段时长与选区不符");
  return { path, start, end: clip.duration };
}

/**
 * 按顺序拼成一条视频：尺寸、帧率以第一段为准，其余等比缩放后补边；去掉续写片段里重复的首帧。
 * 统一重编码为 H.264 + AAC，有任意一段带声音时，其余片段补静音。
 */
export async function concatVideoClips(ffmpeg: BrowserFfmpegFactory, clips: readonly VideoConcatClip[], output: string, signal?: AbortSignal): Promise<VideoConcatResult> {
  if (clips.length < 2 || clips.length > 32) throw new Error("拼接需要 2–32 段视频");
  const paths = clips.map(clip => normalizeVideoPath(clip.path));
  const outputPath = paths.reduce((path, source) => checkOutput(source, path, "mp4"), output);
  const probed = new Map<string, VideoClipInfo>();
  for (const path of paths) if (!probed.has(path)) probed.set(path, readVideoClip(await probeMedia(ffmpeg, path, signal)));
  const infos = paths.map(path => probed.get(path)!);
  const first = infos[0]!;
  const even = (value: number) => Math.max(2, Math.ceil(value / 2) * 2);
  const width = even(first.width), height = even(first.height);
  const hasAudio = infos.some(info => info.audioIndex !== undefined);
  // 不指定色彩矩阵：同为 YUV 时数值原样保留，避免未标记色彩的片段在拼接后偏色。
  const fit = `scale=w='max(2,trunc(min(${width},${height}*dar)/2)*2)':h='max(2,trunc(min(${height},${width}/dar)/2)*2)':flags=bicubic,`
    + `setsar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
  const filters: string[] = [];
  const labels: string[] = [];
  const segments: number[] = [];
  clips.forEach((clip, index) => {
    const info = infos[index]!;
    if (clip.endPts !== undefined && !Number.isSafeInteger(clip.endPts)) throw new Error("片段的结束帧时间戳无效");
    const start = (clip.startTime ?? 0) + (clip.dropFirstFrame ? info.frameDuration : 0);
    const end = clip.endTime ?? (clip.endPts === undefined ? info.duration : (clip.endPts - info.startPts) / microseconds + info.frameDuration);
    if (!(end - start >= info.frameDuration / 2)) throw new Error(`第 ${index + 1} 段视频太短，去重后没有可用画面`);
    segments.push(end - start);
    const stopPts = clip.endTime !== undefined ? info.startPts + toPts(clip.endTime) : clip.endPts !== undefined ? clip.endPts + 1 : undefined;
    const trim = [clip.startTime !== undefined ? `start_pts=${info.startPts + toPts(clip.startTime)}` : "", stopPts !== undefined ? `end_pts=${stopPts}` : ""].filter(Boolean);
    filters.push(`[${index}:${info.videoIndex}]settb=AVTB${trim.length ? `,trim=${trim.join(":")}` : ""},setpts=PTS-STARTPTS`
      + `${clip.dropFirstFrame ? ",select='gte(n,1)',setpts=PTS-STARTPTS" : ""},fps=${first.frameRate},${fit}[v${index}]`);
    labels.push(`[v${index}]`);
    if (!hasAudio) return;
    const from = Math.round(start * audioRate), to = Math.floor(end * audioRate);
    // 声音对齐到画面第一帧，只截掉超出画面的部分。中间各段不足的声音由 concat 补静音，无声片段放一小段静音占位即可；
    // 最后一段 concat 不补，按画面时长补到定长（不用无限静音加 -shortest，旧版 FFmpeg 会因此停不下来）。
    const last = index === clips.length - 1;
    filters.push(info.audioIndex === undefined
      ? `anullsrc=r=${audioRate}:cl=stereo,atrim=end_sample=${last ? to - from : 480},asetpts=PTS-STARTPTS[a${index}]`
      : `[${index}:${info.audioIndex}]asetpts=PTS-${info.startPts}/1000000/TB,aresample=${audioRate}:async=1:first_pts=0,`
        + `aformat=sample_rates=${audioRate}:channel_layouts=stereo,atrim=start_sample=${from}:end_sample=${to},asetpts=PTS-STARTPTS`
        + `${last ? `,apad=whole_len=${to - from}` : ""}[a${index}]`);
    labels.push(`[a${index}]`);
  });
  filters.push(`${labels.join("")}concat=n=${clips.length}:v=1:a=${hasAudio ? 1 : 0}[video]${hasAudio ? "[audio]" : ""}`);
  const command = ffmpeg(paths[0]!, { stdoutLines: 20 }).inputOptions("-copyts", "-nostdin");
  for (const path of paths.slice(1)) command.input(path);
  command.complexFilter(filters).format("mp4").videoCodec("libx264")
    .outputOptions("-map", "[video]", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", ...first.colorTags, "-map_metadata", "-1", "-movflags", "+faststart");
  if (hasAudio) command.audioCodec("aac").audioBitrate(192).outputOptions("-map", "[audio]");
  else command.noAudio();
  await runCommand(command.output(outputPath), signal);
  const result = await probeMedia(ffmpeg, outputPath, signal);
  const video = result.streams.find(stream => stream.codec_type === "video");
  const duration = Number(result.format.duration);
  const expected = segments.reduce((total, value) => total + value, 0);
  // 不会比各段之和更长（留出接缝取整和编码余量）；个别容器写的时长偏大，所以偏短只在明显不对时才报错。
  const slack = clips.length * first.frameDuration * 1.5 + 0.1;
  if (!video || video.codec_name !== "h264" || video.width !== width || video.height !== height || !Number.isFinite(duration)
    || duration > expected + slack || duration < expected * 0.8 - slack) throw new Error("拼接出的视频时长或画面不正确");
  return { path: outputPath, duration, width, height, hasAudio, segments };
}

/**
 * 从续写节点往回找：它接的是谁、那一段又接的是谁，直到最初的原片，按播放顺序排出各段。
 * 原片节点已删除或换过视频时，仍用续写当时记下的文件。
 */
export function planVideoContinuation(current: { id: string; path: string; label?: string; link: VideoContinuationLink },
  find: (nodeId: string) => { link?: VideoContinuationLink; label?: string } | undefined) {
  const clips: VideoConcatClip[] = [{ path: current.path, dropFirstFrame: current.link.dropFirstFrame }];
  const nodeIds = [current.id];
  let rootLabel = current.label;
  let link: VideoContinuationLink | undefined = current.link;
  while (link) {
    if (nodeIds.includes(link.sourceNodeId)) throw new Error("续写关系出现循环，无法拼接");
    if (clips.length >= 32) throw new Error("续写超过 32 段，请先拼接前面的片段再继续");
    const parent = find(link.sourceNodeId);
    const previous = parent?.link;
    const parentLink: VideoContinuationLink | undefined = previous?.previousShot && previous.previousShot.resultPath !== link.sourcePath ? undefined : previous;
    clips.unshift({
      path: link.sourcePath,
      ...(parentLink?.dropFirstFrame ? { dropFirstFrame: true } : {}),
      ...(link.method === "frame" && link.backFrames > 0 && link.tailPts !== undefined ? { endPts: link.tailPts } : {}),
    });
    nodeIds.unshift(link.sourceNodeId);
    rootLabel = parent?.label ?? link.sourceLabel ?? rootLabel;
    link = parentLink;
  }
  return { clips, nodeIds, rootLabel };
}

/** 画面比例最接近的通用选项，供续写节点沿用原片比例。 */
export function nearestVideoRatio(width: number, height: number, options = ["16:9", "9:16", "1:1", "4:3", "3:4"]) {
  const target = Math.log(width / height);
  return options.reduce((best, option) => {
    const [w, h] = option.split(":").map(Number);
    const [bw, bh] = best.split(":").map(Number);
    return Math.abs(Math.log(w! / h!) - target) < Math.abs(Math.log(bw! / bh!) - target) ? option : best;
  });
}
