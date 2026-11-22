import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
const origin = canvasOrigin;
export interface TextModel { providerId: string; providerLabel: string; modelId: string; label: string; contextWindow?: number; maxOutputTokens?: number; isDefault?:boolean }
export type WritingEvent = { type: "text" | "reasoning"; delta: string } | { type: "done"; message: unknown } | { type: "error"; message: string };
type Pending = { source: Window; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; event?: (event: WritingEvent) => void };
const pending = new Map<string, Pending>();
function iframeWindow() { return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe")).find(frame => { try { return new URL(frame.src).origin === origin; } catch { return false; } })?.contentWindow; }
window.addEventListener("message", event => {
  if (event.origin !== origin || !event.data || typeof event.data !== "object") return;
  const message = event.data; const request = pending.get(message.id);
  if (!request || request.source !== event.source) return;
  if (lumBridgeType(message.type) === "lum:writingEvent") { request.event?.(message.event); return; }
  if (lumBridgeType(message.type) !== "lum:writingResponse") return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.ok) request.resolve(message.result);
  else request.reject(Object.assign(new Error(message.error?.message || "写作模型请求失败"), { code: message.error?.code }));
});
function request<T>(method: string, params: Record<string, unknown>, timeout: number, onEvent?: (event: WritingEvent) => void): Promise<T> {
  const source = iframeWindow(); if (!source) return Promise.reject(new Error("Lum 工作区尚未加载"));
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("写作服务响应超时；未自动重新提交，请先确认任务状态")); }, timeout);
    pending.set(id, { source, resolve: value => resolve(value as T), reject, timer, event: onEvent });
    source.postMessage({ type: "laper:writingRequest", id, method, params }, origin);
  });
}
export async function ensureWritingBridge() {
  window.dispatchEvent(new Event("dsh:requireLum"));
  for (let i = 0; i < 20; i++) {
    try { await request("ping", {}, 1200); return; } catch { await new Promise(resolve => setTimeout(resolve, 300)); }
  }
  throw new Error("无法连接写作服务，请确认 Lum 本地服务正在运行，并刷新页面");
}
export async function listTextModels(): Promise<TextModel[]> {
  await ensureWritingBridge();
  const result = await request<TextModel[] | { models: TextModel[] }>("models", {}, 30000);
  const models=Array.isArray(result)?result:result.models;
  const preferred=models.find(model=>model.isDefault);
  if(preferred)localStorage.setItem('writing:preferredModel',JSON.stringify([preferred.providerId,preferred.modelId]));
  return models;
}
export async function generateWriting(params: { requestId: string; providerId: string; modelId: string; context: unknown }, onEvent: (event: WritingEvent) => void) {
  // Never retry generation: a timeout is not proof that a provider did not charge.
  return request<{ message: unknown }>("generate", params, 240000, onEvent);
}
export async function cancelWriting(requestId: string) { return request("cancel", { requestId }, 15000); }
