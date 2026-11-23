import { mediaMimeTypes } from "@lum/node-shared/mediaTypes";
import type { WorkspaceFiles } from "@lum/nodes-scaffold/runtime";

type Frame = { path: string; mimeType: string };
export type BlockingFrames = { start?: Frame; end?: Frame };

export function readBlockingFrame(input: unknown): Frame | undefined {
  if (!input || typeof input !== "object" || !("url" in input) || !("mimeType" in input)) return;
  if (typeof input.url !== "string" || input.url.length > 500 || typeof input.mimeType !== "string") return;
  const path = input.url.replaceAll("\\", "/");
  if (/[:?#%<>|"*\u0000-\u001f\u007f]/.test(path) || path.split("/").some(part => !part || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return;
  const extension = /\.(png|jpe?g|webp|gif|avif)$/i.exec(path)?.[1]?.toLowerCase();
  if (!extension || mediaMimeTypes[extension] !== input.mimeType) return;
  return { path, mimeType: input.mimeType };
}

/** 两帧可位于同一目录；只查本地目录条目，不加载整张图片来估价。 */
export async function availableBlockingFrames(requested: BlockingFrames, files: WorkspaceFiles) {
  const entries = new Map<string, ReturnType<WorkspaceFiles["list"]>>();
  async function available(frame?: Frame) {
    if (!frame) return;
    const slash = frame.path.lastIndexOf("/");
    const directory = slash < 0 ? "" : frame.path.slice(0, slash);
    if (!entries.has(directory)) entries.set(directory, files.list(directory));
    try {
      const page = await entries.get(directory)!;
      return page.entries.some(entry => entry.type === "file" && entry.name === frame.path.slice(slash + 1)) ? frame : undefined;
    } catch { return undefined; }
  }
  const [start, end] = await Promise.all([available(requested.start), available(requested.end)]);
  return { start, end };
}

export function isFrameMode(mode: unknown) {
  return mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional";
}

/** 既有连线沿用该模式原来的槽位；走位分镜只补空位，引用编号始终跟随原连线。 */
export function frameLayout(mode: unknown, images: Frame[], continuationFirst: boolean, storyboardFirst: boolean, blocking: BlockingFrames) {
  const onlyLast = mode === "startFrameOptional" && images.length === 1 && !continuationFirst && !storyboardFirst;
  const connectedStart = onlyLast ? undefined : images[0];
  const connectedEnd = images[onlyLast ? 0 : 1];
  const sameFrameChosen = !!blocking.start && blocking.start.path === blocking.end?.path;
  const firstFrame = connectedStart ?? (sameFrameChosen || blocking.start?.path !== connectedEnd?.path ? blocking.start : undefined);
  const lastFrame = connectedEnd ?? (sameFrameChosen || blocking.end?.path !== firstFrame?.path ? blocking.end : undefined);
  const fits = mode === "startEndRequired" ? !!firstFrame && !!lastFrame
    : mode === "endFrameOptional" ? !!firstFrame : !!lastFrame || (!!connectedStart && continuationFirst);
  return { firstFrame, lastFrame, onlyLast, fits: images.length <= 2 && fits };
}
