import { parseCurrentProjectStyle, type CurrentProjectStyle } from "./writingSetup";

export function embeddedHost() {
  if (window.parent === window || !URL.canParse(document.referrer)) return;
  const origin = new URL(document.referrer).origin;
  if (!["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(origin)) return;
  const projectId = new URLSearchParams(location.search).get("project")?.toLowerCase();
  return {origin,projectId: !projectId || ["legacy","localproject"].includes(projectId) ? "localProject" : projectId};
}

export function canReadProjectSetup() {return !!embeddedHost();}

export async function requestProjectSetup(method: "summary" | "preview", signal?: AbortSignal, before?: {label: string; text: string}) {
  const host = embeddedHost();
  if (!host) return null;
  const id = crypto.randomUUID();
  return new Promise<unknown>((resolve,reject) => {
    const cleanup = () => {clearTimeout(timer);window.removeEventListener("message",receive);signal?.removeEventListener("abort",abort);};
    const abort = () => {cleanup();reject(signal?.reason ?? Error("已停止读取项目设定"));};
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== host.origin || event.data?.type !== "lum:projectSetupResponse" || event.data.id !== id) return;
      cleanup();
      if (event.data.error) reject(Error(String(event.data.error)));
      else resolve(event.data.result);
    };
    const timer = setTimeout(() => {cleanup();reject(Error("读取 Lum 项目设定超时，请重新发起"));},method === "summary" ? 10000 : 180000);
    window.addEventListener("message",receive);
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort",abort,{once:true});
    window.parent.postMessage({type:"lum:projectSetupRequest",id,projectId:host.projectId,method,before},host.origin);
  });
}

export type NodeProjectAppearance = {
  projectStyle: CurrentProjectStyle | null;
  projectStyleImage?: {path: string; mimeType: string};
};

export async function previewProjectStyle(before?: {label: string; text: string}): Promise<NodeProjectAppearance> {
  const result = await requestProjectSetup("preview",undefined,before);
  if (result === null) return {projectStyle: null};
  if (!result || typeof result !== "object") throw Error("Lum 节点画风无效");
  const {style,image} = result as {style?: unknown; image?: NodeProjectAppearance["projectStyleImage"]};
  const projectStyle = parseCurrentProjectStyle(style);
  if (image && (!projectStyle?.referenceMediaId || typeof image.path !== "string" || !/^assets\/[\w\-/ .]+\.(png|jpg|jpeg|webp|gif)$/i.test(image.path)
    || image.path.split("/").some(part=>part === ".." || part === ".") || !/^image\/(png|jpeg|webp|gif)$/.test(image.mimeType))) throw Error("Lum 画风原图路径无效");
  return {projectStyle, projectStyleImage:image};
}
