import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
const origin = canvasOrigin;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const getFrame = () => document.querySelector<HTMLIFrameElement>('iframe[data-production-frame]');
window.addEventListener("message", event => {
  if (event.origin !== origin || event.source !== getFrame()?.contentWindow || lumBridgeType(event.data?.type) !== "lum:storyboardResponse") return;
  const entry = pending.get(event.data.id); if (!entry) return;
  clearTimeout(entry.timer); pending.delete(event.data.id);
  if (event.data.error) entry.reject(Object.assign(new Error(typeof event.data.error === "string" ? event.data.error : event.data.error.message || "Lum 请求失败"), { status: event.data.error.status, code: event.data.error.code }));
  else entry.resolve(event.data.result);
});
function send<T>(method: string, params: unknown, timeout = 45000): Promise<T> {
  return new Promise((resolve, reject) => {
    const frame = getFrame(); if (!frame?.contentWindow) { reject(new Error("Lum 尚未启动")); return; }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method === "generate" ? "任务提交响应超时，请等待状态同步，不要重复生成" : "Lum 请求超时，请检查本地服务是否运行")); }, timeout);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    frame.contentWindow.postMessage({ type: "laper:storyboardRequest", id, method, params }, origin);
  });
}
let connecting: Promise<void> | undefined;
async function connect() {
  window.dispatchEvent(new Event("dsh:requireLum"));
  if (!connecting) connecting = (async () => {
    for (let i = 0; i < 15; i++) {
      try { await send("ping", {}, 1200); return; } catch { await new Promise(resolve => setTimeout(resolve, 400)); }
    }
    throw new Error("无法连接 Lum 本地服务，请重新连接或重启 Lum 后重试");
  })().finally(() => { connecting = undefined; });
  await connecting;
}
export async function lumRequest<T>(method: string, params: unknown = {}, isActive?: () => boolean): Promise<T> {
  await connect();
  if (isActive && !isActive()) throw Object.assign(new Error('操作已停止，未提交生成'), { code: 'LOCAL_CANCELLED' });
  return send<T>(method, params);
}
