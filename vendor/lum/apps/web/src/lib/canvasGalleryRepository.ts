import { galleryMaxBytes, parseGalleryCanvas, type GalleryCanvas } from "@/pages/workspace/panels/canvas/galleryCanvas";

import { galleryRepository as repo } from "@/pages/workspace/panels/canvas/galleryGithub";
const api = `https://api.github.com/repos/${repo}`;
const raw = `https://raw.githubusercontent.com/${repo}`;
const slug = /^[a-z0-9][a-z0-9-]{0,79}$/;
const pageSize = 12;
type GalleryFile = { id: string; size: number };
type Snapshot = { revision: string; files: GalleryFile[] };
let snapshot: Snapshot | undefined;
const loaded = new Map<string, GalleryCanvas>();

async function fetchPublicJson(url: string, signal: AbortSignal, maxBytes: number, accept = "application/json"): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: accept }, signal: AbortSignal.any([signal, AbortSignal.timeout(maxBytes > 4 * 1024 * 1024 ? 120000 : 15000)]),
    credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
  if (!response.ok) throw new Error(`读取 GitHub 画布库失败（HTTP ${response.status}）`);
  if (!response.body) throw new Error("GitHub 返回了空文件");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error("画布库文件超过大小限制");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}

async function readSnapshot(signal: AbortSignal): Promise<Snapshot> {
  const head = await fetchPublicJson(`${api}/git/ref/heads/main`, signal, 16384) as { object?: { sha?: string } };
  const revision = head?.object?.sha;
  if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("画布库版本无效");
  if (snapshot?.revision === revision) return snapshot;
  const files = await fetchPublicJson(`${api}/contents/canvas-gallery/works?ref=${revision}`, signal, 4 * 1024 * 1024);
  if (!Array.isArray(files)) throw new Error("画布库目录格式无效");
  const works: GalleryFile[] = files.filter(file => file?.type === "file" && typeof file.name === "string"
    && file.name.endsWith(".json") && slug.test(file.name.slice(0, -5)) && file.size > 0 && file.size <= galleryMaxBytes)
    .map(file => ({ id: (file.name as string).slice(0, -5), size: file.size as number }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { revision, files: works };
}

// Lum writes the three display fields before the nodes. Reading just that prefix keeps
// opening a page of the gallery from downloading everyone's pictures and video.
async function readHeader(id: string, revision: string, signal: AbortSignal) {
  const path = `canvas-gallery/works/${id}.json`;
  const limit = 16 * 1024;
  const get = async (url: string, accept: string) => {
    const response = await fetch(url, { headers: { Accept: accept, Range: `bytes=0-${limit - 1}` },
      cache: "default", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`读取作品摘要失败（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(limit);
    let used = 0;
    try {
      while (used < limit) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const part = chunk.value.subarray(0, limit - used);
        bytes.set(part, used);
        used += part.length;
        if (bytes.subarray(0, used).includes(91)) {
          const prefix = new TextDecoder().decode(bytes.subarray(0, used));
          const nodes = /,\s*"nodes"\s*:\s*\[/.exec(prefix);
          if (nodes) {
            const header = JSON.parse(prefix.slice(0, nodes.index) + "}");
            if (typeof header.title === "string" && header.title.length <= 100 && typeof header.author === "string" && header.author.length <= 80) {
              return { title: header.title, author: header.author, description: typeof header.description === "string" ? header.description.slice(0, 1500) : "" };
            }
            break;
          }
        }
      }
      return { title: id, author: "", description: "" };
    } finally { await reader.cancel().catch(() => {}); }
  };
  try { return await get(`${raw}/${revision}/${path}`, "application/json"); }
  catch (error) {
    if (signal.aborted) throw error;
    return get(`${api}/contents/${path}?ref=${revision}`, "application/vnd.github.raw+json");
  }
}

async function readWork(fileInfo: GalleryFile, revision: string, signal: AbortSignal) {
  const { id } = fileInfo;
  const key = `${revision}/${id}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const path = `canvas-gallery/works/${id}.json`;
  let file: unknown;
  try {
    file = await fetchPublicJson(`${raw}/${revision}/${path}`, signal, galleryMaxBytes);
  } catch (error) {
    if (signal.aborted || !(error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))) throw error;
    file = await fetchPublicJson(`${api}/contents/${path}?ref=${revision}`, signal, galleryMaxBytes, "application/vnd.github.raw+json");
  }
  const work = parseGalleryCanvas(file);
  signal.throwIfAborted();
  // Keep recent pages for preview and download without retaining the entire library.
  if (fileInfo.size <= 128 * 1024) {
    if (loaded.size >= pageSize * 2) loaded.delete(loaded.keys().next().value!);
    loaded.set(key, work);
  }
  return work;
}

export async function listGalleryEntries(signal: AbortSignal, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("页码无效");
  const current = page === 1 || !snapshot ? await readSnapshot(signal) : snapshot;
  signal.throwIfAborted();
  snapshot = current;
  const files = current.files.slice((page - 1) * pageSize, page * pageSize);
  return Promise.all(files.map(async file => {
    const { id } = file;
    try {
      const { title, author, description } = file.size > 128 * 1024
        ? await readHeader(id, current.revision, signal) : await readWork(file, current.revision, signal);
      return { id, title, author, description };
    } catch (error) {
      if (signal.aborted) throw error;
      return { id, title: id, author: "", description: "作品暂时无法读取，点击可重试。" };
    }
  }));
}

export async function loadGalleryEntry(id: string, signal: AbortSignal) {
  const current = snapshot;
  const file = current?.files.find(entry => entry.id === id);
  if (!current || !file) throw new Error("请刷新画布库后重新选择作品");
  return readWork(file, current.revision, signal);
}
