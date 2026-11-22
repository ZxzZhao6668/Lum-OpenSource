import type { Node } from "@vue-flow/core";
import type useWorkspaceFiles from "@/lib/workspaceFiles";

const extensions = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a",
} as const;
type Mime = keyof typeof extensions;
export type GalleryMedia = { mimeType: Mime; base64: string };
export type GalleryAttachment = { id: string; label: string; mimeType: Mime; read: (signal: AbortSignal) => Promise<GalleryMedia> };
const singleLimit = 10 * 1024 * 1024;
const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function outputKind(type: unknown) {
  const kind = /^remote-(image|video|audio)(?:Generation)?Node$/.exec(String(type))?.[1];
  return kind as "image" | "video" | "audio" | undefined;
}

function signature(bytes: Uint8Array, mime: Mime, size: number) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  const head = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  if (mime === "image/png") return head(137,80,78,71,13,10,26,10,0,0,0,13) && ascii(12, 4) === "IHDR" && size >= 33;
  if (mime === "image/jpeg") return size >= 4 && head(255,216,255) && bytes[3] !== 0 && bytes[3] !== 255;
  if (mime === "image/gif") return size >= 13 && ["GIF87a","GIF89a"].includes(ascii(0, 6));
  if (mime === "image/webp") return size >= 20 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP" && ["VP8 ","VP8L","VP8X"].includes(ascii(12, 4));
  if (mime === "audio/wav") return size >= 44 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
  if (mime === "audio/ogg") return ascii(0, 4) === "OggS" && bytes[4] === 0 && /OpusHead|\x01vorbis/.test(ascii(26, 280));
  if (mime === "audio/mpeg") {
    if (ascii(0, 3) === "ID3") return size >= 10 && [2,3,4].includes(bytes[3]!) && bytes.subarray(6,10).every(b => b < 128)
      && bytes.subarray(6,10).reduce((n,b) => n * 128 + b, 0) + 10 < size;
    return bytes[0] === 255 && (bytes[1]! & 224) === 224 && (bytes[1]! & 6) !== 0 && (bytes[2]! >> 4) !== 15 && (bytes[2]! & 12) !== 12;
  }
  if (mime === "video/webm") return head(26,69,223,163) && /\x42\x82\x84webm/.test(ascii(4, 128));
  if (bytes.length < 16 || ascii(4, 4) !== "ftyp") return false;
  const box = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const brands = mime === "audio/mp4" ? ["M4A ", "M4B "] : ["isom","iso2","iso4","iso5","iso6","mp41","mp42","avc1","M4V "];
  return box >= 16 && box <= size && brands.includes(ascii(8, 4));
}

export function mediaByteSize(media: GalleryMedia) {
  return media.base64.length / 4 * 3 - (media.base64.endsWith("==") ? 2 : media.base64.endsWith("=") ? 1 : 0);
}

export function parseGalleryMedia(value: unknown, type: string): GalleryMedia {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["mimeType","base64"].includes(k))) throw Error("媒体附件字段无效");
  const { mimeType, base64 } = value as Record<string, unknown>;
  if (typeof mimeType !== "string" || !Object.hasOwn(extensions, mimeType) || mimeType.split("/")[0] !== outputKind(type)) throw Error("媒体类型与节点输出不符");
  if (typeof base64 !== "string" || !base64.length || base64.length > Math.ceil(singleLimit / 3) * 4) throw Error("附件为空或超过 10 MiB");
  const media = { mimeType: mimeType as Mime, base64 };
  const size = mediaByteSize(media);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const end = base64.length - padding;
  const tail = base64Chars.indexOf(base64[end - 1]!);
  if (size < 4 || size > singleLimit || base64.length % 4 || /[^A-Za-z0-9+/]/.test(base64.slice(0, end))
    || (padding === 1 && (tail & 3)) || (padding === 2 && (tail & 15))) throw Error("媒体附件的 Base64 编码或大小无效");
  const header = Uint8Array.from(atob(base64.slice(0, 512)), c => c.charCodeAt(0));
  if (!signature(header, media.mimeType, size)) throw Error("媒体附件签名与声明的格式不符");
  return media;
}

export function galleryMediaBlob(media: GalleryMedia) {
  const binary = atob(media.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: media.mimeType });
}
export function galleryMediaPath(id: string, media: GalleryMedia) {
  return "assets/" + id + "/shared." + extensions[media.mimeType];
}

function encodeMedia(bytes: Uint8Array, mimeType: Mime): GalleryMedia {
  if (!bytes.length || bytes.length > singleLimit) throw Error("所选文件为空或超过 10 MiB");
  if (!signature(bytes, mimeType, bytes.length)) throw Error("文件内容与所选媒体格式不符");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { mimeType, base64: btoa(binary) };
}

export async function readLocalFilm(file: File, signal: AbortSignal) {
  if (!file.size || file.size > singleLimit) throw Error("成片文件为空或超过 10 MiB");
  if (!/\.mp4$/i.test(file.name)) throw Error("请选择 MP4 成片文件");
  signal.throwIfAborted();
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  return encodeMedia(bytes, "video/mp4");
}

function localOutput(node: Node) {
  const kind = outputKind(node.type);
  if (!kind) return;
  const port = node.data?.outputs?.[kind];
  if (port?.dataType !== kind.toUpperCase()) return;
  const path = port.value?.url, declared = port.value?.mimeType;
  if (typeof path !== "string" || path.length > 1024 || !path.startsWith("assets/") || /[\\:%?#<>"|\x00-\x1f]/.test(path)
    || path.split("/").some(part => !part || part.startsWith(".") || /[. ]$/.test(part)) || typeof declared !== "string") return;
  const aliases: Record<string, string> = { "image/jpg": "image/jpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg" };
  const canonical = aliases[declared.toLowerCase()] ?? declared.toLowerCase();
  if (!Object.hasOwn(extensions, canonical) || canonical.split("/")[0] !== kind) return;
  const mimeType = canonical as Mime;
  const ext = path.split(".").at(-1)!.toLowerCase();
  if (ext !== extensions[mimeType] && !(mimeType === "image/jpeg" && ext === "jpeg") && !(mimeType === "audio/ogg" && ["opus","oga"].includes(ext))) return;
  return { path, mimeType };
}

export function galleryAttachments(nodes: Node[], files: ReturnType<typeof useWorkspaceFiles>, current: (id: string) => Node | undefined) {
  const choices: GalleryAttachment[] = [];
  nodes.forEach((node, i) => {
    const source = localOutput(node);
    if (!source) return;
    const check = () => {
      const live = current(node.id);
      const output = live && localOutput(live);
      if (output?.path !== source.path || output.mimeType !== source.mimeType) throw Error("画布或媒体输出已变化，请重新生成预览");
    };
    choices.push({ id: "n" + (i + 1), label: node.data?.label || node.type || "媒体", mimeType: source.mimeType, async read(signal) {
      check(); signal.throwIfAborted();
      // 读取本次勾选时的有界快照，不借用其他预览缓存。
      const lease = files.acquireUrl(source.path, source.mimeType, crypto.randomUUID(), singleLimit);
      let released = false;
      const release = () => { if (!released) { released = true; lease.release(); } };
      signal.addEventListener("abort", release, { once: true });
      try {
        const url = await lease.url.catch(error => {
          if (error instanceof Error && error.message.includes("超过")) throw Error("所选附件超过 10 MiB");
          throw error;
        });
        signal.throwIfAborted();
        const bytes = new Uint8Array(await (await fetch(url, { signal })).arrayBuffer());
        check(); signal.throwIfAborted();
        return encodeMedia(bytes, source.mimeType);
      } finally { signal.removeEventListener("abort", release); release(); }
    } });
  });
  return choices;
}
