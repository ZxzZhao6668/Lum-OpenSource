import { applyWritingSetupStyle } from "@lum/node-shared/writingSetup";
import { getPromptText } from "@lum/node-shared/promptText";
import { parseVideoContinuity } from "@lum/node-shared/videoContinuity";
import type { ReferenceMention } from "@lum/node-shared/useNodeReferences";
import type { NodeInputValue } from "@lum/nodes-scaffold/runtime";
import type { GraphNode } from "@vue-flow/core";

import type {MediaPromptContext as VideoPromptContext} from "@lum/node-shared/mediaPromptEditing";
export type {MediaPromptContext as VideoPromptContext,MediaPromptAnalysisState as VideoPromptAnalysisState} from "@lum/node-shared/mediaPromptEditing";
export function videoReferenceKey(input: {source: string; sourceHandle: string}) {
  return encodeURIComponent(JSON.stringify([input.source, input.sourceHandle]));
}
export function isVideoAssetReference(input: NodeInputValue, nodes: GraphNode[], identityIds: string[]) {
  return input.dataType === "IMAGE" && (/^(entity|assetView|styleRef):/.test(nodes.find(node => node.id === input.source)?.data.writingSource?.sourceKey ?? "") || identityIds.includes(videoReferenceKey(input)));
}
export function readVideoPrompt(node: GraphNode, mentions: ReferenceMention[]) {
  const prompt = node.data.promptModel?.length ? getPromptText(node.data.promptModel, id => {
    const reference = mentions.find(item => item.id === id);
    if (!reference) throw Error("提示词中的资产引用已失效，请重新 @ 选择资产");
    return reference.value;
  }) : String(node.data.prompt ?? "");
  return applyWritingSetupStyle(prompt, node.data.writingProduction);
}
/** 未被 @ 的自动资料与资产只供分析，不能隐式进入供应商请求。 */
export function selectVideoReferences(prompt: string, inputs: NodeInputValue[], nodes: GraphNode[], identityIds: string[], explicitOnly = false) {
  const mentioned = new Set([...prompt.matchAll(/\{\{ref\s+(\d+)\}\}/g)].map(match => Number(match[1]) - 1));
  for (const index of mentioned) if (!inputs[index]) throw Error("提示词中的参考编号已失效，请重新 @ 选择对应资产");
  const indexes = inputs.flatMap((input, index) => {
    const source = nodes.find(node => node.id === input.source);
    const candidate = source?.data.writingSource?.sourceKey || isVideoAssetReference(input, nodes, identityIds);
    // 保留普通画布中用户手动连入的音视频/文本用途；自动导入资料必须显式选用。
    return mentioned.has(index) || source?.data.writingSource?.sourceKey?.startsWith('styleRef:') || (!explicitOnly && !candidate) ? [index] : [];
  });
  return {references: indexes.map(index => inputs[index]), prompt: prompt.replace(/\{\{ref\s+(\d+)\}\}/g, (_token, number: string) => `{{ref ${indexes.indexOf(Number(number) - 1) + 1}}}`)};
}
export function readVideoPromptContext(node: GraphNode, nodes: GraphNode[], inputs: NodeInputValue[], mentions: ReferenceMention[], identityIds: string[]): VideoPromptContext {
  const prompt = readVideoPrompt(node, mentions);
  const continuity = parseVideoContinuity(node.data.writingProduction?.continuity);
  const warnings: string[] = [];
  const references = inputs.map((input, index) => {
    const source = nodes.find(item => item.id === input.source);
    const key = source?.data.writingSource?.sourceKey;
    const id = videoReferenceKey(input);
    const textNode = key && nodes.find(item => item.data.writingSource?.sourceKey === key && item.type === "remote-textNode" && item.data.writingProduction?.clipId === node.data.writingProduction?.clipId);
    const text = textNode?.data.outputs?.text?.value ?? textNode?.data.textSnapshot ?? textNode?.data.writingSource?.content;
    const available = input.value !== undefined && (input.dataType !== "STRING" || !!input.value.trim());
    const role = key?.startsWith("styleRef:") ? "画风参考（只用于光线、色彩和材质）" : /^(entity|assetView):/.test(key ?? "") || identityIds.includes(id) ? "资产外观参考" : key?.startsWith("shot:") ? "分镜构图参考" : "用户引用";
    return {id, token: `{{ref ${index + 1}}}`, name: String(source?.data.label || input.source).replace(/ · 图片$/, ""),
      type: String(input.dataType), role, available, description: input.dataType === "STRING" ? String(input.value ?? "") : typeof text === "string" ? text : "未提供文字外观描述；以参考图为准",
      path: input.dataType !== "STRING" && input.value && typeof input.value === "object" && "url" in input.value ? String(input.value.url) : undefined};
  });
  const storyboard = node.data.writingProduction?.clipId ? nodes.filter(source => source.type === "remote-textNode" && source.data.writingProduction?.clipId === node.data.writingProduction.clipId && source.data.writingSource?.sourceKey?.startsWith("shot:"))
    .map(source => ({label: String(source.data.label || "分镜脚本"), text: String(source.data.outputs?.text?.value ?? source.data.textSnapshot ?? source.data.writingSource?.content ?? "")})) : [];
  const linkedAssets = new Set(inputs.filter(input => input.dataType === "IMAGE").map(input => nodes.find(item => item.id === input.source)?.data.writingSource?.sourceKey));
  if (node.data.writingProduction?.clipId) for (const source of nodes) {
    if (source.type === "remote-textNode" && source.data.writingProduction?.clipId === node.data.writingProduction.clipId && source.data.writingSource?.sourceKey?.startsWith("entity:") && !linkedAssets.has(source.data.writingSource.sourceKey)) warnings.push(`「${source.data.label}」未连接资产图片，仅有文字资料`);
  }
  const neighbor = (item: NonNullable<typeof continuity>["previous"]) => {
    if (!item || !continuity) return;
    const candidates = nodes.filter(candidate => candidate.id !== node.id && candidate.type === "remote-videoGenerationNode"
      && candidate.data.writingProduction?.continuity?.episodeId === continuity.episodeId
      && candidate.data.writingProduction?.continuity?.shotIds?.includes(item.shotId));
    const sameBatch = candidates.filter(candidate => node.data.writingProduction?.batchId && candidate.data.writingProduction?.batchId === node.data.writingProduction.batchId);
    const sibling = sameBatch.length === 1 ? sameBatch[0] : candidates.length === 1 ? candidates[0] : undefined;
    const live = sibling?.data.promptModel?.length ? getPromptText(sibling.data.promptModel, id => {
      try { const [sourceId] = JSON.parse(decodeURIComponent(id)); return `[${nodes.find(source => source.id === sourceId)?.data.label ?? "失效引用"}]`; }
      catch { return "[失效引用]"; }
    }) : String(sibling?.data.prompt ?? "").replace(/\{\{ref \d+\}\}/g, "[相邻镜头参考]");
    return {label: item.label, sameScene: item.sceneId === continuity.sceneId, text: `${item.text}${live ? `\n画布中的镜头提示词：\n${live.slice(0, 8000)}` : ""}`};
  };
  if (!continuity) warnings.push("没有相邻分镜资料，可在提示词中补充上一镜结束状态与下一镜起始要求");
  return {prompt, storyboard, references, previous: neighbor(continuity?.previous), next: neighbor(continuity?.next),
    settings: {duration: node.data.duration, ratio: node.data.ratio, model: node.data.model, mode: node.data.mode, promptReferenceSelection: node.data.promptReferenceSelection === true}, warnings};
}
