import axios from "axios";
import { onBeforeUnmount, onMounted } from "vue";

const hostOrigins = new Set(["http://localhost:5178", "http://127.0.0.1:5178", "http://127.0.0.1:6178"]);
const methods = ["ping", "models", "generate", "cancel"];
const toolNames = ["readScript", "readScriptSetup", "findNode", "readEntities", "listEpisodes", "proposeScriptEdit", "askUser", "proposeContentEdit", "proposeScriptAppend", "editEpisodes", "editScript", "organizeScenes", "writeOutline", "extractEntities", "editStoryboard", "editWorldview", "editBeats", "switchEpisode", "grepManuscript", "listFiles", "readFile", "fileStat", "grepWorkspace", "skillRead", "readProject", "editProject", "editLocationGroups", "readStoryBible", "editStoryBible", "readWritingBoard", "editWritingBoard"];
const maxBytes = 4 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Data = Record<string, unknown>;
type Envelope = { code: number; data: unknown };
class BridgeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function invalid(): never { throw new BridgeError("INVALID_PARAMS", "参数不符合写作桥契约或超过限额"); }
function record(value: unknown): Data {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Data;
}
function fields(value: Data, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function text(value: unknown, max = 1000000, empty = true): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.length)) invalid();
  return value;
}
function uuid(value: unknown): string {
  if (!uuidPattern.test(text(value, 36, false))) invalid();
  return (value as string).toLowerCase();
}
function number(value: unknown, nonnegative = true) {
  if (typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0)) invalid();
}
function boolean(value: unknown) { if (typeof value !== "boolean") invalid(); }
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
// 限制深度/节点数后再编码；拒绝循环、非 JSON、原型及凭据/文件入口字段。
function json(value: unknown, limit = maxBytes) {
  let nodes = 0;
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 24) invalid();
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") { number(item, false); return; }
    if (typeof item === "string") { text(item); return; }
    if (Array.isArray(item)) { array(item, 10000).forEach(child => visit(child, depth + 1)); return; }
    for (const [key, child] of Object.entries(record(item))) {
      if (/^(?:__proto__|prototype|constructor|directory|references|credentials?|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|headers|password|secret|token)$/i.test(key)) invalid();
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > limit) invalid();
  return encoded;
}
function usage(value: unknown) {
  const item = record(value);
  fields(item, ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cacheWrite1h", "reasoning", "cost"]);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) number(item[key]);
  for (const key of ["cacheWrite1h", "reasoning"]) if (item[key] !== undefined) number(item[key]);
  const cost = record(item.cost);
  fields(cost, ["input", "output", "cacheRead", "cacheWrite", "total"]);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) number(cost[key], false);
}
function toolName(value: unknown) {
  if (!toolNames.includes(text(value, 64, false))) invalid();
}
function content(value: unknown, assistant: boolean) {
  for (const entry of array(value, 256)) {
    const part = record(entry);
    if (part.type === "text") {
      fields(part, ["type", "text", "textSignature"]);
      text(part.text);
      if (part.textSignature !== undefined) text(part.textSignature);
    } else if (assistant && part.type === "thinking") {
      fields(part, ["type", "thinking", "thinkingSignature", "redacted"]);
      text(part.thinking);
      if (part.thinkingSignature !== undefined) text(part.thinkingSignature);
      if (part.redacted !== undefined) boolean(part.redacted);
    } else if (assistant && part.type === "toolCall") {
      fields(part, ["type", "id", "name", "arguments", "thoughtSignature", "namespace"]);
      text(part.id, 256, false);
      toolName(part.name);
      json(record(part.arguments), 100000);
      if (part.thoughtSignature !== undefined) text(part.thoughtSignature);
      if (part.namespace !== undefined) text(part.namespace, 256);
    } else invalid(); // 仅文本上下文，不接受 image、文件或 OpenAI 裸消息。
  }
}
function message(value: unknown) {
  const item = record(value);
  number(item.timestamp);
  if (item.role === "user") {
    fields(item, ["role", "content", "timestamp"]);
    if (typeof item.content === "string") text(item.content);
    else content(item.content, false);
  } else if (item.role === "assistant") {
    fields(item, ["role", "content", "api", "provider", "model", "timestamp", "usage", "stopReason", "responseModel", "responseId", "providerThinkingLevel", "diagnostics", "errorMessage", "rawStopReason", "endTurn"]);
    content(item.content, true);
    for (const key of ["api", "provider", "model"]) text(item[key], 256, false);
    for (const key of ["responseModel", "responseId", "providerThinkingLevel", "errorMessage", "rawStopReason"]) if (item[key] !== undefined) text(item[key]);
    if (item.endTurn !== undefined) boolean(item.endTurn);
    if (item.diagnostics !== undefined) json(array(item.diagnostics, 64), 100000);
    if (!["pending", "stop", "length", "toolUse", "error", "aborted"].includes(text(item.stopReason, 32))) invalid();
    usage(item.usage);
  } else if (item.role === "toolResult") {
    fields(item, ["role", "toolCallId", "toolName", "content", "isError", "timestamp", "details", "usage", "addedToolNames"]);
    text(item.toolCallId, 256, false);
    toolName(item.toolName);
    content(item.content, false);
    boolean(item.isError);
    if (item.details !== undefined) json(item.details, 100000);
    if (item.usage !== undefined) usage(item.usage);
    if (item.addedToolNames !== undefined) array(item.addedToolNames, toolNames.length).forEach(toolName);
  } else invalid();
  return item;
}
function context(value: unknown) {
  const item = record(value);
  fields(item, ["systemPrompt", "messages", "tools"]);
  if (item.systemPrompt !== undefined) text(item.systemPrompt, 100000);
  const messages = array(item.messages, 200);
  if (!messages.length) invalid();
  messages.forEach(message);
  if (item.tools !== undefined) {
    const names = new Set<string>();
    for (const entry of array(item.tools, toolNames.length)) {
      const tool = record(entry);
      fields(tool, ["name", "description", "parameters", "constrainedSampling"]);
      toolName(tool.name);
      const name = tool.name as string;
      if (names.has(name)) invalid();
      names.add(name);
      text(tool.description, 10000, false);
      if (record(tool.parameters).type !== "object") invalid();
      json(tool.parameters, 100000);
      if (tool.constrainedSampling !== undefined && tool.constrainedSampling !== false) {
        const sampling = record(tool.constrainedSampling);
        if (sampling.type === "json_schema") {
          fields(sampling, ["type", "strict"]);
          if (sampling.strict !== "prefer" && sampling.strict !== "require") invalid();
        } else if (sampling.type === "grammar") {
          fields(sampling, ["type", "variants"]);
          const variants = record(sampling.variants);
          fields(variants, ["openai_lark", "openai_regex"]);
          for (const variant of Object.values(variants)) text(variant, 100000);
        } else invalid();
      }
    }
  }
  return item;
}
async function models(signal?: AbortSignal) {
  const { data } = await axios.get<Envelope>("/api/ai/models", { signal, headers: { "Cache-Control": "no-cache", "x-lum-workspace": "1" } });
  if (data?.code !== 200 || !Array.isArray(data.data)) throw new BridgeError("API_ERROR", "无法读取 Lum 文本模型列表");
  // 明确投影原列表，不透传未来可能添加的配置或凭据。
  return data.data.map(entry => {
    const item = record(entry);
    const model: Data = {};
    model.isDefault = item.isDefault === true;
    for (const key of ["providerId", "providerLabel", "protocol", "modelId", "label"]) model[key] = text(item[key], 1024);
    for (const key of ["contextWindow", "maxOutputTokens"]) if (item[key] !== undefined) { number(item[key]); model[key] = item[key]; }
    if (item.reasoningLevels !== undefined) model.reasoningLevels = array(item.reasoningLevels, 32).map(level => text(level, 64));
    return model;
  });
}

// ACT: 原版 SSE parser 位于 nodeScaffold 私有函数且 web 无其依赖；两文件边界内
// 使用有界的 SSE 行解析，兼容 LF/CRLF/CR、多行 data、心跳及跨 chunk UTF-8，不自动重试。
async function generate(body: Data, signal: AbortSignal, emit: (event: Data) => void) {
  const { data, headers } = await axios.post<ReadableStream<Uint8Array>>("/api/ai/generate", body, {
    adapter: "fetch", responseType: "stream", signal,
    headers: { "Content-Type": "application/json", "x-lum-workspace": "1" },
  });
  if (!String(headers["content-type"]).includes("text/event-stream") || !data?.getReader) throw new BridgeError("STREAM_ERROR", "Lum 未返回 SSE 数据流");
  const reader = data.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lines: string[] = [];
  let eventLength = 0;
  let total = 0;
  let skipLf = false;
  try {
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) throw new BridgeError("STREAM_INTERRUPTED", "生成流在 done 前断开；未自动重试，请核对已有内容");
      total += chunk.value.length;
      if (total > 16 * 1024 * 1024) throw new BridgeError("STREAM_LIMIT", "生成流超过限额");
      buffer += decoder.decode(chunk.value, { stream: true });
      if (skipLf && buffer.length) { if (buffer[0] === "\n") buffer = buffer.slice(1); skipLf = false; }
      let end: number;
      while ((end = buffer.search(/[\r\n]/)) !== -1) {
        const line = buffer.slice(0, end);
        const cr = buffer[end] === "\r";
        buffer = buffer.slice(end + 1);
        if (cr) {
          if (buffer[0] === "\n") buffer = buffer.slice(1);
          else if (!buffer.length) skipLf = true;
        }
        if (!line) {
          if (!lines.length) continue;
          const event = record(JSON.parse(lines.join("\n")));
          lines = [];
          eventLength = 0;
          if (event.type === "error") {
            // 只识别上游已知的计费错误，返回固定提示；不透传可能包含凭据的原始正文。
            const detail = typeof event.message === "string" ? event.message.slice(0, 12000) : "";
            if (/\b403004\b|\bin arrears\b|账号已欠费|账户已欠费/i.test(detail)) {
              throw new BridgeError("MODEL_BILLING_BLOCKED", "模型服务商上游账号欠费，服务已暂停（403004）。请在 Lum 切换可用模型，或联系服务商恢复该服务。");
            }
            if (/^\s*402\b|上游返回\s*402\b/.test(detail)) {
              throw new BridgeError("MODEL_BILLING_ERROR", "模型供应商返回计费或额度错误（402）。请在 Lum 切换可用模型，或向供应商核对额度与服务状态。");
            }
            throw new BridgeError("GENERATION_FAILED", "模型生成失败，请在 Lum 检查模型与配置");
          }
          if (event.type === "text" || event.type === "reasoning") emit({ type: event.type, delta: text(event.delta) });
          else if (event.type === "done") {
            json(event.message);
            const result = message(event.message);
            if (result.role !== "assistant" || !["stop", "length", "toolUse"].includes(String(result.stopReason))) throw new BridgeError("STREAM_ERROR", "模型未正常完成本轮生成");
            emit({ type: "done", message: result });
            return { message: result };
          } else throw new BridgeError("STREAM_ERROR", "未知的模型流事件");
        } else if (line === "data" || line.startsWith("data:")) {
          const value = line === "data" ? "" : line.slice(5).replace(/^ /, "");
          eventLength += value.length + 1;
          if (eventLength > maxBytes) throw new BridgeError("STREAM_LIMIT", "模型事件超过限额");
          lines.push(value);
        }
      }
      if (buffer.length > maxBytes) throw new BridgeError("STREAM_LIMIT", "模型事件超过限额");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export default function useWritingBridge() {
  const active = new Set<string>();
  const requests = new Map<string, { controller: AbortController; origin: string }>();
  // ACT: 页面生命周期内保存最多 4096 个付费请求 ID；满后拒绝，不淘汰以免重放扣费。
  const submitted = new Set<string>();
  let disposed = false;
  async function receive(event: MessageEvent) {
    if (disposed || window.parent === window || event.source !== window.parent || !hostOrigins.has(event.origin)) return;
    const input = event.data;
    if (!input || input.type !== "laper:writingRequest" || typeof input.id !== "string" || !uuidPattern.test(input.id)) return;
    const id = input.id;
    const key = id.toLowerCase();
    const reply = (payload: Data) => { if (!disposed) window.parent.postMessage({ type: "lum:writingResponse", id, ...payload }, event.origin); };
    const emit = (requestId: string, data: Data) => { if (!disposed) window.parent.postMessage({ type: "lum:writingEvent", id, requestId, event: data }, event.origin); };
    if (active.has(key)) return;
    if (active.size >= 16 && input.method !== "cancel") { reply({ ok: false, error: { code: "BUSY", message: "桥最多同时处理 16 个请求" } }); return; }
    active.add(key);
    let requestId: string | undefined;
    let controller: AbortController | undefined;
    try {
      json(input);
      fields(record(input), ["type", "id", "method", "params"]);
      const params = record(input.params);
      let result: unknown;
      if (input.method === "ping") {
        fields(params, []);
        result = { version: 1, methods, toolNames };
      } else if (input.method === "models") {
        fields(params, []);
        result = { models: await models() };
      } else if (input.method === "cancel") {
        fields(params, ["requestId"]);
        const target = requests.get(uuid(params.requestId));
        const cancelled = !!target && target.origin === event.origin;
        if (cancelled) target.controller.abort();
        result = { cancelled };
      } else if (input.method === "generate") {
        fields(params, ["requestId", "providerId", "modelId", "context"]);
        const targetId = uuid(params.requestId);
        const providerId = text(params.providerId, 256, false);
        const modelId = text(params.modelId, 256, false);
        const body = { providerId, modelId, context: context(params.context) };
        if (submitted.has(targetId)) throw new BridgeError("DUPLICATE_REQUEST", "requestId 已使用，未重新提交生成");
        if (submitted.size >= 4096) throw new BridgeError("REQUEST_LIMIT", "本页面生成请求数量达到限额");
        if (requests.size >= 12) throw new BridgeError("BUSY", "最多同时生成 12 个写作请求");
        requestId = params.requestId as string;
        controller = new AbortController();
        requests.set(targetId, { controller, origin: event.origin });
        submitted.add(targetId);
        const available = await models(controller.signal);
        controller.signal.throwIfAborted();
        if (!available.some(model => model.providerId === providerId && model.modelId === modelId)) throw new BridgeError("MODEL_NOT_FOUND", "所选文本模型不在原版可用列表，请刷新模型列表");
        const streamRequestId = requestId;
        result = await generate(body, controller.signal, data => emit(streamRequestId, data));
      } else throw new BridgeError("METHOD_NOT_FOUND", "不支持的 writing 方法");
      reply({ ok: true, result });
    } catch (cause) {
      // 只返回桥自己的固定错误，绝不返回 axios config/headers/token 或供应商错误正文。
      const error = controller?.signal.aborted ? { code: "CANCELLED", message: "生成已取消" }
        : cause instanceof BridgeError ? { code: cause.code, message: cause.message }
        : { code: "API_ERROR", message: "原版请求失败，请在 Lum 检查授权与模型配置；未自动重试" };
      if (requestId) emit(requestId, { type: "error", message: error.message });
      reply({ ok: false, error });
    } finally {
      if (requestId) requests.delete(requestId.toLowerCase());
      active.delete(key);
    }
  }
  onMounted(() => window.addEventListener("message", receive));
  onBeforeUnmount(() => {
    disposed = true;
    window.removeEventListener("message", receive);
    for (const { controller } of requests.values()) controller.abort();
    requests.clear();
  });
}
