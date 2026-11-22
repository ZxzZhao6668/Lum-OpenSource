import axios from "axios";
import { embeddedProjectId } from "./embeddedProject";

interface LumSkillCatalog {
  projectId: string;
  skills: { id: string; name: string; description: string; instruction: string }[];
}

/** 独立画布沿用自己的技能；嵌入 Lum 时，发送前确保当前项目 Skill 正文可供 Agent 读取。 */
export async function syncLumAgentSkills(directory: string, signal?: AbortSignal) {
  if (window.parent === window) return;
  let origin = "";
  try { origin = new URL(document.referrer).origin; } catch { /* 未知父页面不授予技能桥权限。 */ }
  if (!["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(origin)) return;
  const projectId = embeddedProjectId(), id = crypto.randomUUID();
  const catalog = await new Promise<LumSkillCatalog>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("已停止读取 Skill", "AbortError")); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== origin || event.data?.type !== "lum:previsSkillResponse" || event.data.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(String(event.data.error)));
      else if (event.data.result?.projectId !== projectId || !Array.isArray(event.data.result?.skills)) reject(new Error("Skill 项目不匹配，请重新打开画布"));
      else resolve(event.data.result);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("读取 Lum Skill 超时，请刷新后重试")); }, 15000);
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    window.parent.postMessage({ type: "lum:previsSkillRequest", id, method: "agentCatalog", params: { projectId } }, origin);
  });
  signal?.throwIfAborted();
  if (embeddedProjectId() !== projectId) throw new Error("项目已切换，请重新打开画布");
  const { data } = await axios.post("/api/agent/syncLumSkills", { directory, skills: catalog.skills }, {
    signal, timeout: 30000, headers: { "x-lum-workspace": "1" },
  });
  if (data.code !== 200) throw new Error(data.message || "Lum Skill 同步失败");
}
