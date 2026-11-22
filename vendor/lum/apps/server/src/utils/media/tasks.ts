import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { lstat, mkdir, readFile, readdir, realpath, writeAtomic } from "@lum/file";
import type { ProviderTaskData } from "@lum/providers";
import type { EnhancementTaskProgress, GeneratedMedia, MediaGenerationRequest } from "@lum/tools-scaffold/runtime";
import { audioGenerationSchema, imageGenerationSchema, videoGenerationSchema } from "@/utils/media/schemas";
import { z } from "zod";
import { error, errorFromCause, success } from "@/lib/responseFormat";
import conf from "@/utils/conf";
import { generateMedia, type MediaGenerationCheckpoint } from "@/utils/media/generation";
import { resolveWorkspacePath } from "@/utils/workspace/files";

import { enhancementProvider, executeEnhancement, frozenEnhancementSchema } from "./enhancement";

const maxRecordSize = 16 * 1024 * 1024;
const maxBlobSize = 140 * 1024 * 1024;
const mediaTypeSchema = z.enum(["image", "video", "audio"]);
const relativePathSchema = z.string().min(1).max(4096).refine(value => !/^[\\/]|[:\u0000-\u001f]/.test(value)
  && value.split(/[\\/]/).every(part => part && part !== "." && part !== ".."));
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const mediaSchema = z.strictObject({ path: relativePathSchema, mimeType: z.string().min(1).max(256), mediaType: mediaTypeSchema });
const checkpointSchema = z.strictObject({
  enhancementFileStage: z.enum(["download", "validate"]).optional(),
  partialPaths: z.array(relativePathSchema).optional(),
  providerData: z.record(z.string(), z.json()).optional(),
  assets: z.array(z.strictObject({
    type: z.literal("url"), mediaType: mediaTypeSchema, url: z.string().regex(/^https?:\/\//i),
    mimeType: z.string().optional(), name: z.string().optional(),
  })).optional(),
  assetCount: z.number().int().positive().optional(),
  files: z.array(mediaSchema.extend({ index: z.number().int().nonnegative(), hash: hashSchema })).optional(),
});
const blobSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1).max(32),
  hash: hashSchema, size: z.number().int().positive().max(maxBlobSize),
});
const requestSchemas = { image: imageGenerationSchema, video: videoGenerationSchema, audio: audioGenerationSchema };
const recordSchema = z.strictObject({
  version: z.literal(1), taskId: z.uuid(), cwd: z.string().min(1).max(4096),
  mediaType: mediaTypeSchema.optional(),
  request: z.union([imageGenerationSchema, videoGenerationSchema, audioGenerationSchema]).optional(),
  nodeId: z.string().min(1).max(512).optional(), canvasPath: relativePathSchema.optional(),
  enhancement: frozenEnhancementSchema.optional(),
  state: z.enum(["preparing", "prepared", "preparationUnknown", "running", "interrupted", "succeeded", "failed", "cancelled"]),
  createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(),
  checkpoint: checkpointSchema,
  blobs: z.array(blobSchema).optional(),
  result: z.strictObject({ code: z.number().int(), data: z.array(mediaSchema).nullable(), message: z.string() }).optional(),
}).superRefine((record, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (!record.request || !record.mediaType) {
    if (record.state !== "cancelled" || record.request || record.mediaType) issue("任务缺少生成请求");
  } else if (!requestSchemas[record.mediaType].safeParse(record.request).success) issue("任务生成请求无效");
  if (["running", "preparing", "prepared"].includes(record.state) ? record.result !== undefined : record.result === undefined) issue("任务状态与结果不一致");
  if (record.state === "succeeded" && (record.result?.code !== 200 || !record.result.data?.length)) issue("任务成功结果无效");
  if (record.result && record.state !== "succeeded" && (record.result.code === 200 || record.result.data !== null)) issue("任务错误结果无效");
  const { assetCount, assets, files } = record.checkpoint;
  if (assets && (assetCount !== assets.length || assets.some(asset => asset.mediaType !== record.mediaType))) issue("任务媒体结果无效");
  if (files?.length && (assetCount === undefined || new Set(files.map(file => file.index)).size !== files.length
    || files.some(file => file.index >= assetCount || file.mediaType !== record.mediaType))) issue("任务文件索引无效");
  if (record.result?.data?.some(file => file.mediaType !== record.mediaType)) issue("任务结果类型无效");
  if (record.blobs?.length && (!record.checkpoint.providerData || new Set(record.blobs.map(blob => JSON.stringify(blob.path))).size !== record.blobs.length)) issue("任务媒体引用无效");
});

type TaskRecord = Omit<z.infer<typeof recordSchema>, "blobs" | "checkpoint"> & { checkpoint: MediaGenerationCheckpoint };
type BlobReference = z.infer<typeof blobSchema>;
type MediaTask = {
  key: string;
  record: TaskRecord;
  blobs: BlobReference[];
  prepared?: { source: ProviderTaskData; data: ProviderTaskData; blobs: BlobReference[] };
  active: boolean;
  controller?: AbortController;
  settledAt?: number;
  persistenceError?: unknown;
};
type TaskOwner = { nodeId?: string; canvasPath?: string };

// ACT: 单进程最多 1000 个执行中任务；磁盘记录保留，结束后只释放五分钟未用的内存缓存。
const tasks = new Map<string, MediaTask>();
const operations = new Map<string, Promise<void>>();
let activeCount = 0;

function invalid(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function identity(value: string) { return process.platform === "win32" ? value.toLowerCase() : value; }
function taskPath(cwd: string, taskId: string) {
  z.uuid().parse(taskId);
  return join(dirname(conf.path), "mediaTasks", `workspace${createHash("sha256").update(identity(cwd)).digest("hex")}`, `task${taskId.replaceAll("-", "").toLowerCase()}.json`);
}
function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
}
async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const next = (operations.get(key) ?? Promise.resolve()).then(action);
  // 队列只释放前一操作的占位；其错误仍由对应调用方接收。
  const tail = next.then(() => {}, () => {});
  operations.set(key, tail);
  try { return await next; }
  finally { if (operations.get(key) === tail) operations.delete(key); }
}
async function privateDirectory(path: string, create: boolean) {
  for (const folder of [dirname(path), path]) {
    let info = await lstat(folder).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
    if (!info && create) {
      await mkdir(folder, { mode: 0o700 }).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "EEXIST") throw cause; });
      info = await lstat(folder);
    }
    if (!info) return false;
    if (!info.isDirectory() || info.isSymbolicLink()) invalid("任务数据目录不能是文件或符号链接", 403);
  }
  return true;
}
async function readPrivateFile(path: string, maxSize: number) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxSize) invalid("任务记录或媒体文件无效");
  const bytes = await readFile(path);
  if (bytes.length > maxSize) invalid("任务记录或媒体文件过大");
  return bytes;
}

async function prepareBlobs(task: MediaTask) {
  const data = task.record.checkpoint.providerData;
  if (!data) { task.prepared = undefined; task.blobs = []; return { data, blobs: [] as BlobReference[] }; }
  if (task.blobs.length) return { data, blobs: task.blobs };
  if (task.prepared?.source === data) return task.prepared;
  const blobs: BlobReference[] = [];
  async function copy(value: ProviderTaskData[string], path: BlobReference["path"]): Promise<ProviderTaskData[string]> {
    if (typeof value === "string" && value.length > 4096 && /^data:(?:image|audio|video)\/[^,]*;base64,/i.test(value)) {
      const size = Buffer.byteLength(value, "utf8");
      if (size > maxBlobSize) invalid("任务参考媒体超过大小限制");
      const hash = createHash("sha256").update(value).digest("hex");
      const file = join(dirname(task.key), `media${hash}.bin`);
      const known = task.prepared?.blobs.some(blob => blob.hash === hash && blob.size === size);
      const info = known ? await lstat(file).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; }) : undefined;
      // 同一任务推进阶段时复用已写入的素材，避免每次保存凭据都重写大文件；恢复时仍验证完整哈希。
      if (!info?.isFile() || info.isSymbolicLink() || info.size !== size) {
        try { await writeAtomic(file, value, { exclusive: true, mode: 0o600 }); }
        catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
          const bytes = await readPrivateFile(file, maxBlobSize);
          if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== hash) invalid("任务参考媒体校验失败");
        }
      }
      blobs.push({ path, hash, size });
      return "";
    }
    if (Array.isArray(value)) {
      const result: ProviderTaskData[string][] = [];
      for (const [index, child] of value.entries()) result.push(await copy(child, [...path, index]));
      return result;
    }
    if (value && typeof value === "object") {
      const entries: [string, ProviderTaskData[string]][] = [];
      for (const [key, child] of Object.entries(value)) entries.push([key, await copy(child, [...path, key])]);
      return Object.fromEntries(entries);
    }
    return value;
  }
  task.prepared = { source: data, data: await copy(data, []) as ProviderTaskData, blobs };
  return task.prepared;
}

async function restoreBlobs(task: MediaTask) {
  if (!task.blobs.length) return;
  const source = task.record.checkpoint.providerData;
  if (!source) invalid("任务缺少媒体恢复数据");
  const data = structuredClone(source);
  for (const blob of task.blobs) {
    let parent: ProviderTaskData[string] = data;
    for (const key of blob.path.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) invalid("任务媒体引用路径无效");
      parent = (parent as Record<string | number, ProviderTaskData[string]>)[key];
    }
    const key = blob.path.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)
      || (parent as Record<string | number, unknown>)[key] !== "") invalid("任务媒体引用位置无效");
    const bytes = await readPrivateFile(join(dirname(task.key), `media${blob.hash}.bin`), maxBlobSize);
    if (bytes.length !== blob.size || createHash("sha256").update(bytes).digest("hex") !== blob.hash) invalid("任务参考媒体校验失败");
    const value = bytes.toString("utf8");
    if (!/^data:(?:image|audio|video)\/[^,]*;base64,/i.test(value)) invalid("任务参考媒体内容无效");
    Object.defineProperty(parent, key, { value, enumerable: true, configurable: true, writable: true });
  }
  task.prepared = { source: data, data: source, blobs: task.blobs };
  task.record.checkpoint.providerData = data;
  task.blobs = [];
}

async function persist(task: MediaTask, exclusive = false) {
  try {
    await privateDirectory(dirname(task.key), true);
    const prepared = await prepareBlobs(task);
    task.record.updatedAt = Date.now();
    const stored = recordSchema.parse({ ...task.record, checkpoint: { ...task.record.checkpoint, providerData: prepared.data }, blobs: prepared.blobs });
    const content = JSON.stringify(stored);
    if (Buffer.byteLength(content, "utf8") > maxRecordSize) invalid("任务元数据不能超过 16 MB");
    await writeAtomic(task.key, content, { exclusive, mode: 0o600 });
    task.persistenceError = undefined;
    if (task.record.state === "cancelled") task.controller?.abort(new Error("生成已取消"));
  } catch (cause) { task.persistenceError = cause; throw cause; }
}

async function load(cwd: string, taskId: string, key: string) {
  const cached = tasks.get(key);
  if (cached) { cached.settledAt = cached.active ? undefined : Date.now(); return cached; }
  if (!await privateDirectory(dirname(key), false)) return undefined;
  let bytes: Buffer;
  try { bytes = await readPrivateFile(key, maxRecordSize); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw cause; }
  const stored = recordSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (identity(stored.cwd) !== identity(cwd) || stored.taskId.toLowerCase() !== taskId.toLowerCase()) invalid("任务不属于当前工作区", 403);
  if (stored.canvasPath) await resolveWorkspacePath(cwd, stored.canvasPath, true);
  const { blobs, ...record } = stored;
  const task: MediaTask = { key, record, blobs: blobs ?? [], active: false, settledAt: Date.now() };
  // Legacy 65535 adapters emitted this text only for a terminal failed task,
  // but omitted MEDIA_TASK_FAILED. Preserve the receipt while releasing the node.
  if (record.state === "interrupted" && record.request?.providerId === "s65535"
    && !Object.keys(record.checkpoint).length && !task.blobs.length
    && /^生成失败；(?:[^\r\n]*；)?任务 ID [a-zA-Z0-9_-]+$/.test(record.result?.message ?? "")) {
    record.state = "failed";
    await persist(task);
  }
  tasks.set(key, task);
  return task;
}

async function resumable(task: MediaTask) {
  const { checkpoint, state } = task.record;
  if (state !== "running" && state !== "interrupted") return false;
  if (checkpoint.providerData || checkpoint.assets?.length) return true;
  if (!checkpoint.assetCount || checkpoint.files?.length !== checkpoint.assetCount) return false;
  for (const file of checkpoint.files) {
    const { path } = await resolveWorkspacePath(task.record.cwd, file.path, true);
    const info = await lstat(path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
    if (!info?.isFile() || info.isSymbolicLink()) return false;
  }
  return true;
}

function publicData(task: MediaTask) {
  if (task.record.enhancement) return undefined;
  const data = task.record.checkpoint.providerData;
  if (!data || task.blobs.length || task.prepared?.blobs.length) return undefined;
  const pending: unknown[] = [data];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (/^data:/i.test(value)) return undefined;
      if (/^https?:\/\//i.test(value)) {
        try { const url = new URL(value); if (url.search || url.username || url.password) return undefined; }
        catch { return undefined; }
      }
    } else if (value && typeof value === "object") for (const child of Object.values(value)) pending.push(child);
  }
  return data;
}

function enhancementProgress(task: MediaTask): EnhancementTaskProgress | undefined {
  if (!task.record.enhancement) return;
  const { providerData, enhancementFileStage } = task.record.checkpoint;
  if (enhancementFileStage) return { stage: enhancementFileStage };
  if (providerData?.kind !== "officialTopazVideo") return;
  const stage = z.enum(["prepared", "accept", "upload", "complete", "poll", "download"]).safeParse(providerData.stage);
  if (!stage.success) return;
  const status = z.enum(["requested", "accepted", "initializing", "preprocessing", "processing", "postprocessing", "complete", "canceling"]).safeParse(providerData.remoteStatus);
  const percent = z.number().min(0).max(100).safeParse(providerData.progress);
  return { stage: stage.data, ...(status.success ? { remoteStatus: status.data } : {}), ...(percent.success ? { percent: percent.data } : {}) };
}

async function snapshot(task: MediaTask) {
  // 读取失败的原子写入可以修复，但不能先把未落盘的报价或结果作为成功返回。
  if (task.record.enhancement && task.persistenceError) await persist(task);
  const { taskId, state, nodeId, canvasPath, result } = task.record;
  const frozen = task.record.enhancement;
  const preparation = frozen ? { preparationId: frozen.preparationId, metadata: frozen.source.metadata,
    validUntil: frozen.validUntil, ...(frozen.quote ? { cost: frozen.quote.cost, seconds: frozen.quote.seconds } : {}) } : undefined;
  const progress = enhancementProgress(task);
  return { taskId, state, preparation, resumable: await resumable(task), nodeId, canvasPath, providerData: publicData(task), ...(progress ? { progress } : {}), ...(result ? { result } : {}) };
}

async function execute(task: MediaTask, resume: boolean) {
  const { record } = task;
  try {
    const execution = {
      taskId: record.taskId, resume, checkpoint: record.checkpoint,
      save: (patch: Partial<MediaGenerationCheckpoint>) => locked(task.key, async () => {
        if (record.state !== "running") throw new Error("生成已停止");
        Object.assign(record.checkpoint, patch);
        await persist(task);
      }),
    };
    const files = record.enhancement
      ? await executeEnhancement(record.cwd, record.mediaType as "video", record.request!, record.enhancement, execution, task.controller!.signal)
      : await generateMedia(record.cwd, record.mediaType!, record.request!, task.controller!.signal, execution);
    await locked(task.key, async () => {
      if (record.state !== "running") return;
      record.state = "succeeded";
      record.result = success(files);
      await persist(task);
    });
  } catch (cause) {
    try {
      await locked(task.key, async () => {
        if (record.state !== "running") return;
        record.state = (cause as { code?: string } | null)?.code === "MEDIA_TASK_FAILED" ? "failed" : "interrupted";
        const result = errorFromCause(cause);
        if (record.enhancement) result.message = result.message.replace(/https?:\/\/[^\s<>"']+/gi, "[私有媒体地址]");
        record.result = { ...result, code: result.code === 200 ? 500 : result.code, data: null };
        await persist(task);
      });
    } catch (failure) { task.persistenceError = failure; console.error("保存媒体任务失败", failure); }
  } finally {
    await locked(task.key, async () => {
      task.active = false;
      task.controller = undefined;
      task.settledAt = Date.now();
      activeCount--;
      if (task.prepared && task.prepared.source === record.checkpoint.providerData && task.prepared.blobs.length) {
        record.checkpoint.providerData = task.prepared.data;
        task.blobs = task.prepared.blobs;
        task.prepared = undefined;
      }
    });
  }
}

async function launch(task: MediaTask, resume: boolean, exclusive = false) {
  if (task.active) return;
  if (activeCount >= 1000) invalid("生成任务过多，请稍后重试", 429);
  task.active = true;
  activeCount++;
  const previousState = task.record.state;
  const previousResult = task.record.result;
  try {
    await restoreBlobs(task);
    task.record.state = "running";
    task.record.result = undefined;
    task.controller = new AbortController();
    await persist(task, exclusive);
  } catch (cause) {
    task.record.state = previousState;
    task.record.result = previousResult;
    task.controller = undefined;
    task.active = false;
    activeCount--;
    throw cause;
  }
  void execute(task, resume);
}

export async function start(cwd: string, taskId: string, mediaType: "image" | "video" | "audio", request: MediaGenerationRequest, owner: TaskOwner = {}) {
  cwd = await realpath(cwd);
  const key = taskPath(cwd, taskId);
  const parsed = requestSchemas[mediaType].parse(request);
  if ("operation" in parsed && parsed.operation === "upscale") invalid("增强须使用明确的准备与提交入口");
  if (owner.nodeId !== undefined) z.string().min(1).max(512).parse(owner.nodeId);
  if (owner.canvasPath !== undefined) {
    relativePathSchema.parse(owner.canvasPath);
    const resolved = await resolveWorkspacePath(cwd, owner.canvasPath, true);
    owner = { ...owner, canvasPath: relative(cwd, resolved.path).replace(/\\/g, "/") };
  }
  return locked(key, async () => {
    const current = await load(cwd, taskId, key);
    if (current) {
      if (current.record.request && serialize({ mediaType: current.record.mediaType, request: current.record.request, nodeId: current.record.nodeId, canvasPath: current.record.canvasPath })
        !== serialize({ mediaType, request: parsed, nodeId: owner.nodeId, canvasPath: owner.canvasPath })) invalid("相同任务 ID 不能用于不同的生成请求", 409);
      if (current.persistenceError) await persist(current);
      return snapshot(current);
    }
    const now = Date.now();
    const task: MediaTask = { key, blobs: [], active: false, record: {
      version: 1, taskId, cwd, mediaType, request: parsed, ...owner, state: "running", createdAt: now, updatedAt: now, checkpoint: {},
    } };
    tasks.set(key, task);
    try { await launch(task, false, true); }
    catch (cause) { tasks.delete(key); throw cause; }
    return snapshot(task);
  });
}

export async function status(cwd: string, taskIds: string[], resume = false) {
  cwd = await realpath(cwd);
  return Promise.all(taskIds.map(taskId => {
    const key = taskPath(cwd, taskId);
    return locked(key, async () => {
      const task = await load(cwd, taskId, key);
      if (!task) return { taskId, state: "interrupted" as const, resumable: false, result: error<GeneratedMedia[]>("生成任务不存在", null, 404) };
      if (task.persistenceError) await persist(task);
      if (!task.record.enhancement && !task.active && (task.record.state === "running" || (resume && task.record.state === "interrupted"))) {
        if (await resumable(task)) await launch(task, true);
        else {
          task.record.state = "interrupted";
          task.record.result ??= error("上次生成已中断，缺少可恢复的任务凭据，请先确认供应商任务状态", null, 409);
          await persist(task);
        }
      }
      return snapshot(task);
    });
  }));
}

export async function cancel(cwd: string, taskIds: string[]) {
  cwd = await realpath(cwd);
  await Promise.all(taskIds.map(taskId => {
    const key = taskPath(cwd, taskId);
    return locked(key, () => cancelTask(cwd, taskId, key));
  }));
}

function ownedEnhancement(task: MediaTask, owner: TaskOwner) {
  return task.record.nodeId === owner.nodeId && task.record.canvasPath === owner.canvasPath
    && (task.record.enhancement || task.record.state === "cancelled" && !task.record.request);
}

async function cancelTask(cwd: string, taskId: string, key: string, owner?: TaskOwner) {
  let task = await load(cwd, taskId, key);
  if (task && owner && !ownedEnhancement(task, owner)) invalid("增强任务不属于此节点或画布", 403);
  if (!task) {
    const now = Date.now();
    task = { key, blobs: [], active: false, settledAt: now, record: {
      version: 1, taskId, cwd, ...owner, state: "cancelled", checkpoint: {}, createdAt: now, updatedAt: now,
      result: error<GeneratedMedia[]>(owner ? "已放弃本地增强任务" : "生成已取消", null, 499),
    } };
    // 先持久创建围栏，晚到的准备或提交不能绕开它。
    await persist(task, true);
    tasks.set(key, task);
  } else if (!["succeeded", "failed", "cancelled"].includes(task.record.state)) {
    task.record.state = "cancelled";
    task.record.result = error<GeneratedMedia[]>(owner ? "已放弃本地增强任务" : "生成已取消", null, 499);
    await persist(task);
  } else if (task.persistenceError) await persist(task);
  return task;
}

// 与既有任务共用私有记录、原子写入和操作锁；不另建报价数据库。
async function enhancementOwner(cwd: string, owner: TaskOwner) {
  z.string().min(1).max(512).parse(owner.nodeId);
  relativePathSchema.parse(owner.canvasPath);
  const resolved = await resolveWorkspacePath(cwd, owner.canvasPath!, true);
  return { nodeId: owner.nodeId!, canvasPath: relative(cwd, resolved.path).replace(/\\/g, "/") };
}
export async function prepareEnhancement(cwd: string, taskId: string, mediaType: "video", request: MediaGenerationRequest, owner: TaskOwner) {
  if (mediaType !== "video") invalid("当前仅支持视频超分");
  cwd = await realpath(cwd);
  owner = await enhancementOwner(cwd, owner);
  const parsed = requestSchemas[mediaType].parse(request);
  const key = taskPath(cwd, taskId);
  const ownerKey = serialize([cwd, owner.canvasPath, owner.nodeId]);
  return locked(ownerKey, () => locked(key, async () => {
    const current = await load(cwd, taskId, key);
    if (current) {
      if (serialize([current.record.request, current.record.mediaType, current.record.nodeId, current.record.canvasPath]) !== serialize([parsed, mediaType, owner.nodeId, owner.canvasPath])) invalid("任务 ID 已绑定其他请求", 409);
      return snapshot(current);
    }
    // 重新启动后仍扫描持久记录，防止同一所有者用新 ID 重复接受未知任务。
    if (await privateDirectory(dirname(key), false)) {
      for (const name of await readdir(dirname(key))) {
        if (!/^task[0-9a-f]{32}\.json$/.test(name)) continue;
        const stored = recordSchema.parse(JSON.parse((await readPrivateFile(join(dirname(key), name), maxRecordSize)).toString("utf8")));
        if (stored.enhancement && stored.nodeId === owner.nodeId && stored.canvasPath === owner.canvasPath
          && !["succeeded", "failed", "cancelled"].includes(stored.state)) invalid("此节点已有增强准备或未确认任务，请查询原任务或明确放弃", 409);
      }
    }
    if (activeCount >= 1000) invalid("增强任务过多，请稍后重试", 429);
    const context = await enhancementProvider(cwd, mediaType, parsed);
    const now = Date.now();
    const task: MediaTask = { key, blobs: [], active: false, record: {
      version: 1, cwd, taskId, mediaType, request: parsed, ...owner, state: "preparing", createdAt: now, updatedAt: now, checkpoint: {},
      enhancement: { preparationId: randomUUID(), source: frozenEnhancementSchema.shape.source.parse(context.source), revision: context.revision, configRevision: context.configRevision, capabilities: context.capabilities },
    } };
    await persist(task, true);
    tasks.set(key, task);
    task.active = true;
    activeCount++;
    void createEnhancementPreparation(task);
    return snapshot(task);
  }));
}
async function createEnhancementPreparation(task: MediaTask) {
  const record = task.record;
  try {
    const context = await enhancementProvider(record.cwd, record.mediaType as "video", record.request!, data => locked(task.key, async () => {
      if (record.state !== "preparing") invalid("准备已停止");
      record.checkpoint.providerData = data;
      await persist(task);
    }), record.enhancement);
    const quote = await context.provider.prepareVideoUpscale!({ operation: "upscale", model: record.request!.modelId,
      source: context.scoped, options: (record.request! as MediaGenerationRequest).enhancement!.options });
    await locked(task.key, async () => {
      if (record.state !== "preparing") return;
      record.enhancement!.quote = quote;
      // 本地提交期限，不冒充供应商期限；已提交任务的同 ID 恢复不受此期限限制。
      record.enhancement!.validUntil = Math.min(Date.now() + 30 * 60 * 1000, quote?.expiresAt ?? Infinity);
      record.state = "prepared";
      await persist(task);
    });
  } catch {
    await locked(task.key, async () => {
      if (record.state !== "preparing") return;
      record.state = "preparationUnknown";
      record.result = error("准备结果未知；不得自动重新创建，请核对供应商请求或明确放弃", null, 409);
      await persist(task);
    }).catch(cause => { task.persistenceError = cause; });
  } finally { task.active = false; activeCount--; task.settledAt = Date.now(); }
}
export async function readEnhancement(cwd: string, taskId: string, owner: TaskOwner, resume = false, abandon = false) {
  cwd = await realpath(cwd);
  owner = await enhancementOwner(cwd, owner);
  const key = taskPath(cwd, taskId);
  return locked(key, async () => {
    if (abandon) return snapshot(await cancelTask(cwd, taskId, key, owner));
    const task = await load(cwd, taskId, key);
    if (!task) return { taskId, ...owner, state: "missing" as const, resumable: false };
    if (!ownedEnhancement(task, owner)) invalid("增强任务不属于此节点或画布", 403);
    if (!task.active && task.record.state === "preparing") {
      task.record.state = "preparationUnknown";
      task.record.result = error("准备响应丢失，请核对原供应商请求；不能自动重新估价", null, 409);
      await persist(task);
    }
    if (!task.active && task.record.state === "running") {
      task.record.state = "interrupted";
      task.record.result = error("原增强任务已中断，请复查同一任务", null, 409);
      await persist(task);
    }
    if (resume && !task.active && ["running", "interrupted"].includes(task.record.state)) {
      await enhancementProvider(cwd, task.record.mediaType as "video", task.record.request!, undefined, task.record.enhancement);
      if (!await resumable(task)) invalid("缺少同 ID 恢复凭据，不能自动重提", 409);
      task.record.checkpoint.enhancementFileStage = undefined;
      await launch(task, true);
    }
    return snapshot(task);
  });
}
export async function submitEnhancement(cwd: string, taskId: string, preparationId: string, mediaType: "video", request: MediaGenerationRequest, owner: TaskOwner) {
  if (mediaType !== "video") invalid("当前仅支持视频超分");
  cwd = await realpath(cwd);
  owner = await enhancementOwner(cwd, owner);
  const parsed = requestSchemas[mediaType].parse(request);
  const key = taskPath(cwd, taskId);
  return locked(key, async () => {
    const task = await load(cwd, taskId, key);
    const frozen = task?.record.enhancement;
    if (!task || !frozen || frozen.preparationId !== preparationId || serialize([task.record.request, task.record.mediaType, task.record.nodeId, task.record.canvasPath]) !== serialize([parsed, mediaType, owner.nodeId, owner.canvasPath])) invalid("准备凭据与原请求、节点或画布不匹配", 403);
    if (task.record.state !== "prepared") return snapshot(task);
    if (!frozen.validUntil || frozen.validUntil < Date.now()) invalid("准备已过期，请明确放弃后重新准备", 409);
    await enhancementProvider(cwd, mediaType, parsed, undefined, frozen);
    // launch 原子保存 running 提交意图后才调用实际供应商；重复 submit 只读取原任务。
    await launch(task, false);
    return snapshot(task);
  });
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, task] of tasks) {
    if (!task.active && !task.persistenceError && !operations.has(key) && task.settledAt !== undefined && task.settledAt + 300000 <= now) tasks.delete(key);
  }
}, 30000);
cleanupTimer.unref();
