import { embeddedHost } from "./projectSetupBridge";

export const storyGridImageLimit = 32;
export const storyGridPageSize = 24;
export const storyGridImageBytes = 32 * 1024 * 1024;
export const storyGridBatchBytes = 64 * 1024 * 1024;

export type StoryGridCategory = "location" | "character" | "prop" | "image";
export type StoryGridScope = "project" | "shared" | "canvas";
export type StoryGridContext = { directory: string; canvasPath: string };
export type StoryGridAsset = { id: string; version: string; label: string; category: StoryGridCategory; scope: StoryGridScope };
export type StoryGridShot = { id: string; shotId: string; version: string; label: string; scene: string; summary: string; order: number };
export type StoryGridShotDetail = StoryGridShot & { text: string };
export type StoryGridSelection = {
  context: StoryGridContext;
  projectId?: string;
  assets: StoryGridAsset[];
  shots: StoryGridShot[];
};
export type StoryGridCatalogQuery = { scope: "project" | "shared" | "shots"; category?: StoryGridCategory; scene?: string; search: string; offset: number };
export type StoryGridCatalog = {
  projectId: string;
  assets: StoryGridAsset[];
  shots: StoryGridShot[];
  scenes: { id: string; label: string }[];
  more: boolean;
};
export type StoryGridImageInput = {
  id: string;
  sourceKey: string;
  legacyKey?: string;
  label: string;
  category: Exclude<StoryGridCategory, "image">;
  blob: Blob;
  imageSource?: { assetId: string; appearanceId: string; revision: number; viewId: string; mediaId: string };
};
export type StoryGridImageReceipt = { id: string; nodeId: string; handleId: string; path: string; mimeType: string; sha256: string };
export type StoryGridPrepared = { session: string; shots: StoryGridShotDetail[]; images: StoryGridImageReceipt[] };

export function storyGridHost() {
  return embeddedHost();
}

export async function requestStoryGridSources<T>(method: "catalog" | "prepare" | "validate", context: StoryGridContext, payload: object, signal: AbortSignal): Promise<T> {
  const host = storyGridHost();
  if (!host) throw new Error("请在 Lum 项目中打开画布，才能读取项目素材与分镜");
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== host.origin || event.data?.type !== "lum:storyGridSourcesResponse" || event.data.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(String(event.data.error)));
      else resolve(event.data.result as T);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("剧情素材响应超时。若已导入部分图片，重试时会按来源复用"));
    }, method === "prepare" ? 120000 : 25000);
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    try {
      window.parent.postMessage({
        ...payload, type: "lum:storyGridSourcesRequest", id, method,
        context: { directory: context.directory, canvasPath: context.canvasPath }, projectId: host.projectId,
      }, host.origin);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
