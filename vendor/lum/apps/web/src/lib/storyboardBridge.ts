import axios from "axios";
import { onBeforeUnmount, onMounted } from "vue";
import type { MediaModel, GeneratedMedia } from "@lum/tools-scaffold/runtime";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { embeddedProjectId } from "@/lib/embeddedProject";

const hostOrigins = new Set(["http://localhost:5178", "http://127.0.0.1:5178", "http://127.0.0.1:6178"]);
const methods = ["ping", "models", "upload", "generate", "status", "resume", "cancel", "preview"];
const outputDirectory = "assets/storyboard";
const maxUploadBytes = 10 * 1024 * 1024;
const maxPreviewBytes = 20 * 1024 * 1024;
const mimeExtensions: Record<string, string[]> = {
  "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"], "image/gif": ["gif"],
};
type Params = Record<string, unknown>;
type Envelope<T> = { code: number; data: T; message: string };
type TaskSnapshot = {
  taskId: string; state: "running" | "interrupted" | "succeeded" | "failed" | "cancelled";
  resumable: boolean; result?: Envelope<GeneratedMedia[] | null>;
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { bridgeCode: "INVALID_PARAMS" });
}
function record(value: unknown): Params {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("params 必须是对象");
  return value as Params;
}
function fields(params: Params, allowed: string[]) {
  if (Object.keys(params).some(key => !allowed.includes(key))) invalid("包含不支持的参数");
}
function text(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.length || value.length > max) invalid(`${name} 长度无效`);
  return value;
}
function uuid(value: unknown) {
  const id = text(value, "taskId", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) invalid("taskId 必须是 UUID");
  return id;
}
function relativePath(value: unknown) {
  const path = text(value, "path", 2048);
  if (/[\\:%?#\u0000-\u001f\u007f]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part))) invalid("path 必须是安全的工作区相对路径");
  return path;
}
function fileName(value: unknown) {
  const name = text(value, "fileName", 120);
  if (!/^[\p{L}\p{N}_-][\p{L}\p{N}_. -]*\.(png|jpe?g|webp|gif)$/iu.test(name)
    || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[. ]|$)/i.test(name)) invalid("fileName 必须是安全的图片文件名，不能包含路径或 Windows 保留名");
  return name;
}
export function imageMime(bytes: Uint8Array) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (starts(255, 216, 255)) return "image/jpeg";
  if (starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]!) && bytes[5] === 97) return "image/gif";
  if (starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
  invalid("仅支持 PNG、JPEG、WebP、GIF 图片，内容签名必须匹配");
}
function unwrap<T>(data: Envelope<T>) {
  if (!data || data.code !== 200) throw Object.assign(new Error(data?.message || "原版 API 返回错误"), { bridgeCode: "API_ERROR" });
  return data.data;
}
async function post<T>(url: string, body: Params) {
  // 使用原版 axios 单例与现有拦截器/同源授权，不转发宿主凭据。
  const { data } = await axios.post<Envelope<T>>(url, body, { headers: { "x-lum-workspace": "1" } });
  return unwrap(data);
}
async function project(projectId = embeddedProjectId()) {
  const result = await post<{ directory: string }>("/api/integration/project", { projectId });
  if (typeof result?.directory !== "string" || !result.directory) throw new Error("关联项目目录无效");
  return { directory: result.directory, files: useWorkspaceFiles(result.directory) };
}
export async function ensureFolder(files: ReturnType<typeof useWorkspaceFiles>, parent: string, name: string) {
  const { entries } = await files.list(parent);
  const existing = entries.find(entry => entry.name === name);
  if (existing) {
    if (existing.type !== "directory") invalid("素材目录被同名文件占用");
    return;
  }
  try { await files.mkdir(parent ? `${parent}/${name}` : name); }
  catch (cause) {
    // 仅处理并发创建的明确冲突，不吞掉其他写入错误。
    if (!axios.isAxiosError(cause) || cause.response?.status !== 409) throw cause;
    const { entries: current } = await files.list(parent);
    if (!current.some(entry => entry.name === name && entry.type === "directory")) throw cause;
  }
}
async function readImage(files: ReturnType<typeof useWorkspaceFiles>, path: string, migrate = false) {
  try { return await files.read(path); }
  catch (cause) {
    // Only an explicitly referenced old storyboard image can be recovered. Never enumerate or import a shared canvas.
    if (embeddedProjectId() === "localProject" || !path.startsWith(`${outputDirectory}/`) || !axios.isAxiosError(cause) || cause.response?.status !== 404) throw cause;
    const legacy = await project("localProject");
    const bytes = await legacy.files.read(path);
    if (!bytes.byteLength || bytes.byteLength > maxPreviewBytes) invalid("旧版参考图超过大小限制");
    imageMime(new Uint8Array(bytes));
    if (migrate) {
      await ensureFolder(files, "", "assets");
      await ensureFolder(files, "assets", "storyboard");
      // Generated image names live directly in this folder; deeper legacy paths stay readable but are not copied implicitly.
      if (path.slice(outputDirectory.length + 1).includes("/")) invalid("请重新上传旧版子目录中的参考图片");
      try { await files.write(path, bytes, true); }
      catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error; }
    }
    return bytes;
  }
}
async function taskSnapshots(directory: string, taskIds: string[], resume = false) {
  const tasks = await post<TaskSnapshot[]>("/api/ai/media/tasks/status", { directory, taskIds, resume });
  const missing = tasks.filter(task => task.result?.code === 404).map(task => task.taskId);
  if (!missing.length || embeddedProjectId() === "localProject") return { tasks, legacyIds: [] as string[] };
  const legacy = await project("localProject");
  const previous = await post<TaskSnapshot[]>("/api/ai/media/tasks/status", { directory: legacy.directory, taskIds: missing, resume });
  const found = previous.filter(task => task.result?.code !== 404);
  return { tasks: tasks.map(task => found.find(old => old.taskId === task.taskId) ?? task), legacyIds: found.map(task => task.taskId) };
}
async function dispatch(method: string, params: Params): Promise<unknown> {
  if (method === "ping") {
    fields(params, []);
    return { version: 1, projectId: embeddedProjectId(), methods };
  }
  if (method === "models") {
    fields(params, []);
    const { data } = await axios.get<Envelope<MediaModel[]>>("/api/ai/media/models");
    // 保留原版模型与 form-create rules；缺失能力不推测、不硬编码模型目录。
    return { models: unwrap(data).filter(model => (model.operation ?? "generate") === "generate") };
  }
  if (method === "upload") {
    fields(params, ["fileName", "dataUrl"]);
    const name = fileName(params.fileName);
    const value = text(params.dataUrl, "dataUrl", Math.ceil(maxUploadBytes / 3) * 4 + 64);
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2]!.length % 4 !== 0) invalid("dataUrl 必须是规范 base64 图片");
    const binary = atob(match[2]!);
    if (!binary.length || binary.length > maxUploadBytes) invalid("上传图片必须为 1 字节至 10 MiB");
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const mimeType = imageMime(bytes);
    if (mimeType !== match[1] || !mimeExtensions[mimeType]!.includes(name.split(".").pop()!.toLowerCase())) invalid("扩展名、MIME 与图片内容不匹配");
    const { files } = await project();
    await ensureFolder(files, "", "assets");
    await ensureFolder(files, "assets", "storyboard");
    const path = `${outputDirectory}/${name}`;
    await files.write(path, new Blob([bytes], { type: mimeType }), true);
    return { path, mimeType, size: bytes.byteLength };
  }
  if (method === "generate") {
    fields(params, ["taskId", "providerId", "modelId", "prompt", "images", "ratio", "size", "other"]);
    const taskId = uuid(params.taskId);
    const providerId = text(params.providerId, "providerId", 96);
    if (!/^[a-z][a-zA-Z0-9]{0,95}$/.test(providerId)) invalid("providerId 无效");
    const request: Params = { providerId, modelId: text(params.modelId, "modelId", 256).trim(), prompt: text(params.prompt, "prompt", 100000).trim() };
    if (!request.modelId || !request.prompt) invalid("modelId 和 prompt 不能为空白");
    if (params.ratio !== undefined) {
      request.ratio = text(params.ratio, "ratio", 9);
      if (!/^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(request.ratio as string)) invalid("ratio 无效");
    }
    if (params.size !== undefined) request.size = text(params.size, "size", 64).trim();
    if (params.images !== undefined) {
      if (!Array.isArray(params.images) || params.images.length > 64) invalid("images 最多 64 项");
      request.images = params.images.map(value => {
        const image = record(value);
        fields(image, ["path", "mimeType"]);
        const mimeType = text(image.mimeType, "mimeType", 64);
        if (!mimeExtensions[mimeType]) invalid("参考图片格式不支持");
        return { path: relativePath(image.path), mimeType };
      });
    }
    if (params.other !== undefined) {
      const other = record(params.other);
      let json: string;
      try { json = JSON.stringify(other); } catch { invalid("other 必须是 JSON 对象"); }
      if (json.length > 65536 || /"(?:__proto__|constructor|prototype)"\s*:/.test(json)) invalid("other 过大或含不安全字段");
      // 原版 imageGenerationSchema 继续校验完整请求及 z.json，不在桥里另造供应商 schema。
      request.other = other;
    }
    const { data: modelData } = await axios.get<Envelope<MediaModel[]>>("/api/ai/media/models");
    const model = unwrap(modelData).find(model => model.type === "image" && (model.operation ?? "generate") === "generate" && model.providerId === providerId && model.modelId === request.modelId);
    if (!model) invalid("所选图片模型不存在，请刷新模型列表");
    const imageCount = Array.isArray(request.images) ? request.images.length : 0;
    if (imageCount && Array.isArray(model.mode)) {
      if (model.mode.length && model.mode.every(mode => mode === "text")) invalid("所选模型仅支持文生图，不能接收参考图片");
      if (imageCount > 1 && model.mode.includes("singleImage") && !model.mode.includes("multiReference")) invalid("所选模型最多接收 1 张参考图片");
    }
    const { directory, files } = await project();
    for (const reference of (request.images ?? []) as { path: string; mimeType: string }[]) await readImage(files, reference.path, true);
    return post<{ taskId: string }>("/api/ai/media/generate", { ...request, directory, mediaType: "image", taskId, outputDirectory });
  }
  if (method === "status" || method === "resume" || method === "cancel") {
    fields(params, ["taskIds"]);
    if (!Array.isArray(params.taskIds) || !params.taskIds.length || params.taskIds.length > 100) invalid("taskIds 必须有 1 至 100 项");
    const taskIds = [...new Set(params.taskIds.map(uuid))];
    const { directory } = await project();
    const { tasks, legacyIds } = await taskSnapshots(directory, taskIds, method === "resume");
    if (method === "cancel") {
      const currentIds = taskIds.filter(id => !legacyIds.includes(id));
      if (currentIds.length) await post("/api/ai/media/tasks/cancel", { directory, taskIds: currentIds });
      if (legacyIds.length) await post("/api/ai/media/tasks/cancel", { directory: (await project("localProject")).directory, taskIds: legacyIds });
      return { cancelled: true };
    }
    // 不将供应商 taskData/凭据或画布所属信息穿透到宿主。
    return { tasks: tasks.map(({ taskId, state, resumable, result }) => ({
      taskId, state, resumable,
      ...(result ? { result: {
        code: result.code,
        data: result.code === 200 ? result.data?.map(file => ({ path: relativePath(file.path), mimeType: file.mimeType, mediaType: file.mediaType })) ?? null : null,
        message: result.code === 200 ? "成功" : result.code === 404 ? "生成任务不存在"
          : state === "cancelled" ? "生成已取消" : state === "interrupted" ? resumable ? "任务中断，可恢复原任务继续取图" : "生成已中断，请检查模型配置和网络连接" : "生成失败，请在 Lum 检查配置与任务详情",
      } } : {}),
    })) };
  }
  if (method === "preview") {
    fields(params, ["path"]);
    const path = relativePath(params.path);
    const { files } = await project();
    // ACT: 复用原版二进制读取；20 MiB 上限在读取后校验，不绕过统一文件入口。
    const bytes = await readImage(files, path);
    if (!bytes.byteLength || bytes.byteLength > maxPreviewBytes) invalid("预览图片必须为 1 字节至 20 MiB");
    const mimeType = imageMime(new Uint8Array(bytes));
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("图片预览编码失败"));
      reader.readAsDataURL(new Blob([bytes], { type: mimeType }));
    });
    return { path, mimeType, dataUrl };
  }
  throw Object.assign(new Error("不支持的 storyboard 方法"), { bridgeCode: "METHOD_NOT_FOUND" });
}

export default function useStoryboardBridge() {
  const active = new Set<string>();
  let disposed = false;
  async function receive(event: MessageEvent) {
    if (disposed || window.parent === window || event.source !== window.parent || !hostOrigins.has(event.origin)) return;
    const message = event.data;
    if (!message || message.type !== "laper:storyboardRequest" || typeof message.id !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(message.id)) return;
    const { id } = message;
    const reply = (payload: Params) => {
      if (!disposed) window.parent.postMessage({ type: "lum:storyboardResponse", id, ...payload }, event.origin);
    };
    if (active.has(id)) return; // 重复的执行中 ID 不再次提交付费任务。
    if (active.size >= 16) {
      reply({ error: { code: "BUSY", message: "桥最多同时处理 16 个请求" } });
      return;
    }
    active.add(id);
    try {
      fields(record(message), ["type", "id", "method", "params"]);
      const method = text(message.method, "method", 32);
      reply({ result: await dispatch(method, record(message.params ?? {})) });
    } catch (cause) {
      const httpStatus = axios.isAxiosError(cause) ? cause.response?.status : undefined;
      const bridgeCode = cause && typeof cause === "object" && "bridgeCode" in cause ? String(cause.bridgeCode) : "API_ERROR";
      // 不跨 origin 返回 axios config、请求头、绝对路径或供应商原始错误正文。
      const message = bridgeCode === "INVALID_PARAMS" || bridgeCode === "METHOD_NOT_FOUND"
        ? (cause as Error).message
        : httpStatus === 409 ? "文件或任务冲突，请使用新的文件名或核对 taskId"
        : httpStatus === 401 || httpStatus === 403 ? "请求未获授权，请在 Lum 中检查供应商配置与工作区权限"
        : "原版操作失败，请在 Lum 界面检查配置、模型和任务状态";
      reply({ error: { code: bridgeCode, message, ...(httpStatus ? { status: httpStatus } : {}) } });
    } finally { active.delete(id); }
  }
  onMounted(() => window.addEventListener("message", receive));
  onBeforeUnmount(() => {
    disposed = true;
    window.removeEventListener("message", receive);
  });
}
