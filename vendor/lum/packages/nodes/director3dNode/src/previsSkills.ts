export interface PrevisPromptDraft {
  open: boolean;
  sourceMode: "linked" | "manual";
  sourceId: string;
  manualText: string;
  requirements: string;
  actionId: string;
  cameraId: string;
  model: string;
  output: string;
}
export interface PrevisScriptSource { id: string; label: string; text: string }
export interface PrevisPromptSkill { id: string; name: string; description: string; instruction: string; uses: string[] }
export interface PrevisSkillCatalog {
  skills: PrevisPromptSkill[];
  models: {providerId:string;providerLabel:string;modelId:string;label:string}[];
  preferredModel: string;
  modelError: string;
}

export function requestPrevisSkill<T>(method: "catalog" | "generate", params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  let origin = "";
  try { origin = new URL(document.referrer).origin; } catch { /* Standalone nodes have no Lum library parent. */ }
  if (window.parent === window || !["http://127.0.0.1:5178", "http://localhost:5178"].includes(origin)) return Promise.reject(new Error("请从 Lum 画布打开预演，以连接项目技能库"));
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); signal?.removeEventListener("abort", abort); };
    const cancel = () => window.parent.postMessage({ type: "lum:previsSkillRequest", id, method: "cancel" }, origin);
    const abort = () => { cancel(); cleanup(); reject(new Error("已取消提示词生成")); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== origin || event.data?.type !== "lum:previsSkillResponse" || event.data.id !== id) return;
      cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result as T);
    };
    const timer = setTimeout(() => { cancel(); cleanup(); reject(new Error("预演技能服务响应超时，请检查连接；未自动重试")); }, method === "generate" ? 245000 : 45000);
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    window.parent.postMessage({ type: "lum:previsSkillRequest", id, method, params }, origin);
  });
}
