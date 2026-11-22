import { createHash } from "node:crypto";
import type { MediaGenerationRequest, GeneratedMedia } from "@lum/tools-scaffold/runtime";
import type { ProviderTaskData } from "@lum/providers";
import { z } from "zod";
import conf from "@/utils/conf";
import { getMediaProvider, loadMediaProviderSource } from "./provider";
import { enhancementCapabilitiesSchema, enhancementMetadataSchema, enhancementQuoteSchema } from "./enhancementSchemas";
import { inspectEnhancementFile, createEnhancementSource, validateEnhancementOptions, downloadEnhancementOutput } from "./enhancementFiles";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import type { MediaGenerationTask } from "./generation";

export const frozenEnhancementSchema = z.strictObject({
  preparationId: z.uuid(), source: z.strictObject({ path: z.string(), metadata: enhancementMetadataSchema }),
  revision: z.string(), configRevision: z.string(), capabilities: enhancementCapabilitiesSchema,
  quote: enhancementQuoteSchema.optional(), validUntil: z.number().optional(),
});
export type FrozenEnhancement = z.infer<typeof frozenEnhancementSchema>;
type ApiKeyRule = Record<string, unknown>;
export function hasEnhancementConfiguration(rules: readonly ApiKeyRule[], config: Record<string, unknown>) {
  const rule = rules.find(item => item.field === "apiKey");
  if (!rule) return true;
  const apiKey = Object.hasOwn(config, "apiKey") ? config.apiKey : rule.value;
  return typeof apiKey === "string" && !!apiKey.trim();
}
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 409 }); }
function stable(value: unknown): string { return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
export async function enhancementProvider(cwd: string, type: "video", request: MediaGenerationRequest,
  save?: (data: ProviderTaskData) => Promise<void>, frozen?: FrozenEnhancement, signal?: AbortSignal) {
  if (type !== "video") invalid("当前仅支持视频超分");
  if (request.operation !== "upscale" || !request.enhancement) invalid("缺少明确的增强源和参数");
  const allowed = new Set(["operation", "enhancement", "providerId", "modelId", "prompt", "outputDirectory"]);
  if (Object.keys(request).some(key => !allowed.has(key) && request[key as keyof MediaGenerationRequest] !== undefined)) invalid("增强请求不能混入生成或编辑参数");
  const info = await getMediaProvider(request.providerId);
  const model = info.models.find(model => model.id === request.modelId && model.type === type && model.operation === "upscale");
  if (!model?.enhancementCapabilities) invalid("模型没有明确的增强能力");
  const capabilities = enhancementCapabilitiesSchema.parse(model.enhancementCapabilities);
  const configs = conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  const config = configs?.[info.id] ?? {};
  if (!hasEnhancementConfiguration(info.rules, config)) invalid("请先在媒体模型设置中配置供应商 API Key");
  const revision = createHash("sha256").update(info.source).digest("hex");
  const configRevision = createHash("sha256").update(stable(config)).digest("hex");
  if (frozen && (frozen.revision !== revision || frozen.configRevision !== configRevision || stable(frozen.capabilities) !== stable(capabilities))) invalid("供应商代码、配置或模型能力已变化，不能推进原任务");
  const source = await inspectEnhancementFile(cwd, request.enhancement!.source.path, type, Math.min(500000000, capabilities.maxInputBytes), signal);
  if (request.enhancement.sourceSha256 && request.enhancement.sourceSha256 !== source.metadata.sha256) invalid("原视频内容已变化，请重新读取源并准备报价");
  if (frozen && stable(source) !== stable(frozen.source)) invalid("增强源已变化，不能提交或恢复原任务");
  validateEnhancementOptions(source.metadata, request.enhancement!.options, capabilities, type);
  await resolveWorkspacePath(cwd, request.outputDirectory ?? "assets/generated", true);
  const scoped = await createEnhancementSource(cwd, source, signal);
  const provider = await loadMediaProviderSource(info.source, config, signal, undefined, cwd, save, scoped);
  if (typeof provider.resumeTask !== "function" || (typeof provider.upscaleVideo !== "function" || typeof provider.prepareVideoUpscale !== "function")) invalid("供应商缺少实际增强或同 ID 恢复方法");
  return { provider, source, scoped, revision, configRevision, capabilities };
}

export async function executeEnhancement(cwd: string, type: "video", request: MediaGenerationRequest, frozen: FrozenEnhancement,
  task: MediaGenerationTask, signal?: AbortSignal): Promise<GeneratedMedia[]> {
  const context = await enhancementProvider(cwd, type, request, data => task.save({ providerData: data }), frozen, signal);
  const options = request.enhancement!.options;
  const saved = task.checkpoint.files;
  if (saved?.length) {
    const file = saved[0]!;
    const checked = await inspectEnhancementFile(cwd, file.path, type, Math.min(2000000000, frozen.capabilities.maxOutputBytes), signal);
    if (checked.metadata.sha256 !== file.hash) invalid("已验证的增强输出已变化");
    return [{ path: file.path, mediaType: type, mimeType: checked.metadata.mimeType }];
  }
  let assets: MediaAsset[];
  if (task.resume) {
    if (!task.checkpoint.providerData) invalid("缺少同 ID 恢复凭据；不得重新提交增强任务");
    assets = await context.provider.resumeTask!(task.checkpoint.providerData);
  } else {
    if (!frozen.quote) invalid("缺少已准备的供应商报价");
    assets = await context.provider.upscaleVideo!({ operation: "upscale", model: request.modelId, source: context.scoped, options, preparation: frozen.quote });
  }
  if (assets.length !== 1 || assets[0]?.type !== "url" || assets[0].mediaType !== type) invalid("增强供应商须返回一个可流式下载的结果 URL");
  await task.save({ assets: [assets[0]], assetCount: 1 });
  const output = await downloadEnhancementOutput(cwd, request.outputDirectory ?? "assets/generated", assets[0].url, type,
    frozen.source.metadata, options, frozen.capabilities,
    path => task.save({ partialPaths: [...(task.checkpoint.partialPaths ?? []), path], enhancementFileStage: "download" }), signal,
    () => task.save({ enhancementFileStage: "validate" }));
  const file = { path: output.path, mimeType: output.metadata.mimeType, mediaType: type, index: 0, hash: output.metadata.sha256 };
  await task.save({ files: [file] });
  return [{ path: file.path, mimeType: file.mimeType, mediaType: type }];
}
