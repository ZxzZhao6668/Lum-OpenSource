import { inject, nextTick } from "vue";
import { useVueFlow, type GraphNode } from "@vue-flow/core";
import { isTypeCompatible, validateConnection, type NodeData } from "@lum/nodes-scaffold/connection";
import { isNodeOutput } from "@lum/nodes-scaffold/values";
import type { NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import { referencePromptModel } from "@lum/node-shared/promptText";
import { imageWorkbenchLimits, type ImageWorkbenchCandidate, type ImageWorkbenchReference, type ImageWorkbenchStoredPlan } from "./imageWorkbench";
import { getImageWorkbenchTemplate } from "./imageWorkbenchTemplates";

const childType = "remote-imageGenerationNode";
export type ImageWorkbenchNamedReference = ImageWorkbenchReference & { name: string };

export function imageWorkbenchReferenceId(source: string, sourceHandle: string) {
  return encodeURIComponent(JSON.stringify([source, sourceHandle]));
}

export function readWorkbenchReference(node: GraphNode<NodeData> | undefined, handleId: string): ImageWorkbenchNamedReference | undefined {
  if (!node) return;
  const handle = node.data.handles?.find(item => item.id === handleId && item.type === "source");
  const value = node.data.outputs?.[handleId];
  if (!handle || !isTypeCompatible(handle.dataType, "IMAGE") || !isNodeOutput(value) || value.dataType !== "IMAGE") return;
  const { url: path, mimeType } = value.value;
  if (path.length > 2048 || /^[\\/]|[<>:"|?*\x00-\x1f]/.test(path)
    || path.split(/[\\/]/).some(part => !part || part === "." || part === "..") || !/^image\/[a-z0-9.+-]+$/i.test(mimeType)) return;
  return { id: imageWorkbenchReferenceId(node.id, handleId), nodeId: node.id, handleId, path, mimeType, name: node.data.label || node.id };
}

function imageReferenceLimit(model: NodeMediaModel) {
  // ACT: these installed adapters enforce tighter limits than their catalog's generic multiReference mode.
  if (model.providerId === "compshare") {
    const name = model.modelId.toLowerCase();
    if (name.includes("seedream")) return /seedream-5-0-(pro|flash)/.test(name) ? 10 : 14;
    if (name.startsWith("qwen-image-3")) return 3;
    if (name.startsWith("gpt-image") || name.includes("qwen-image-edit") || name.includes("step1x")) return 1;
  }
  return imageWorkbenchLimits.referenceIds;
}

export function validateWorkbenchReferenceCount(model: NodeMediaModel, count: number) {
  const limit = imageReferenceLimit(model);
  if (count > limit) throw new Error("当前图片模型最多可使用 " + limit + " 张参考图");
  if (!model.mode?.length) return;
  const supported = model.mode.some(mode => {
    if (mode === "text") return count === 0;
    if (mode === "singleImage") return count === 1;
    if (mode === "multiReference") return count > 0;
    return (Array.isArray(mode) ? mode : [mode]).some(entry => {
      const match = /^imageReference:(\d+)$/.exec(entry);
      return match && count > 0 && count <= Number(match[1]);
    });
  });
  if (!supported) throw new Error("当前图片模型不支持 " + count + " 张参考图的输入方式");
}

export function describeWorkbenchAttempt(
  plan: ImageWorkbenchStoredPlan,
  cellId: string | undefined,
  model: NodeMediaModel,
  references: ReadonlyMap<string, ImageWorkbenchNamedReference>,
) {
  const template = getImageWorkbenchTemplate(plan.templateId, plan.cells.length);
  const cells = cellId === undefined ? plan.cells : plan.cells.filter(cell => cell.id === cellId);
  if (!cells.length) throw new Error("图片工作台格位已变化");
  const ids = [...new Set(cells.flatMap(cell => cell.referenceIds))];
  validateWorkbenchReferenceCount(model, ids.length);
  const snapshots = ids.map(id => {
    const reference = references.get(id);
    if (!reference) throw new Error("已选参考图已变化或失效，请重新选择");
    const { nodeId, handleId, path, mimeType } = reference;
    return { id, nodeId, handleId, path, mimeType };
  });
  const group = cellId === undefined ? plan.sheetCandidates : cells[0].candidates;
  if (group.length >= imageWorkbenchLimits.attempts) throw new Error("此格的候选尝试已达到存档上限");
  const cellSnapshots = cells.map(cell => {
    const prompt = cell.prompt.trim();
    const label = template.cells.find(item => item.id === cell.id)!.label;
    if (!prompt || /\{\{\s*ref\b/i.test(prompt)) throw new Error(label + "需要有效提示词，请通过参考图列表选择素材");
    return { id: cell.id, prompt, referenceIds: [...cell.referenceIds], ...(cell.sourceShotId ? { sourceShotId: cell.sourceShotId } : {}) };
  });
  const instructions = cellSnapshots.map(cell => {
    const label = template.cells.find(item => item.id === cell.id)!.label;
    const tokens = cell.referenceIds.map(id => "{{ref " + (ids.indexOf(id) + 1) + "}}");
    return label + "：" + cell.prompt + (tokens.length ? "\n本格使用的参考图：" + tokens.join("、") : "");
  });
  const { columns, rows } = template.grid;
  const layout = cellId === undefined && cells.length > 1
    ? "生成一张由 " + columns + " 列 " + rows + " 行组成的等尺寸联系表，按行从左到右排列，格线整齐、无边框及叠字。实际画面共 " + cells.length + " 格，末尾 " + (columns * rows - cells.length) + " 格必须留空，不增加剧情或人物。"
    : "生成一张完整静态画面。";
  const requirements = plan.requirements.trim();
  if (/\{\{\s*ref\b/i.test(requirements)) throw new Error("制作要求中的参考编号无效，请通过各格参考图列表选择素材");
  const prompt = [layout, requirements ? "本次要求：" + requirements : "", "模板约束：" + template.aiInstruction, ...instructions].filter(Boolean).join("\n\n");
  const size = plan.imageModel.size || undefined;
  const ratio = plan.imageModel.ratio || undefined;
  if ((size !== undefined && !model.imageSizes?.includes(size)) || (ratio !== undefined && !model.imageRatios?.includes(ratio))) {
    throw new Error("当前图片模型未声明所选分辨率或比例，请改用模型默认值或选择已声明的选项");
  }
  return { group, prompt, snapshots, cellSnapshots, size, ratio, label: cellId === undefined ? template.name + "整张" : template.cells.find(cell => cell.id === cellId)!.label };
}

export function prepareWorkbenchAttempt(
  plan: ImageWorkbenchStoredPlan,
  cellId: string | undefined,
  model: NodeMediaModel,
  references: ReadonlyMap<string, ImageWorkbenchNamedReference>,
  sourceMimeType: string,
) {
  const { group, prompt, snapshots, cellSnapshots, size, ratio, label } = describeWorkbenchAttempt(plan, cellId, model, references);
  const candidate: ImageWorkbenchCandidate = {
    id: crypto.randomUUID(), childNodeId: crypto.randomUUID(), attempt: (group.at(-1)?.attempt ?? 0) + 1, status: "queued",
    snapshot: {
      prompt, references: snapshots, sourceMimeType, sourceFingerprint: plan.sourceFingerprint, createdAt: Date.now(),
      ...(cellId === undefined ? { sheetCells: cellSnapshots } : cellSnapshots[0].sourceShotId ? { sourceShotId: cellSnapshots[0].sourceShotId } : {}),
      ...(plan.storyPlanning ? { attachmentDigests: plan.storyPlanning.attachments
        .filter(reference => (reference.nodeId === plan.source.nodeId && reference.handleId === plan.source.handleId)
          || snapshots.some(item => item.id === reference.id))
        .map(reference => ({ ...reference })) } : {}),
      imageModel: { providerId: model.providerId, modelId: model.modelId, ...(size ? { size } : {}), ...(ratio ? { ratio } : {}) },
    },
  };
  return { candidate, group, label };
}
export type ImageWorkbenchPreparedAttempt = ReturnType<typeof prepareWorkbenchAttempt>;

export function useImageWorkbenchChildren(parent: GraphNode<NodeData>) {
  const flow = useVueFlow();
  const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());

  function findChild(candidate: ImageWorkbenchCandidate) {
    const child = flow.findNode(candidate.childNodeId);
    const origin = child?.data.imageWorkbenchAttempt;
    return child?.type === childType && origin?.sourceNodeId === parent.id && origin.candidateId === candidate.id ? child : undefined;
  }

  function validateReferences(child: GraphNode, references: readonly ImageWorkbenchReference[], checkingExisting: boolean) {
    const edges = flow.getEdges.value;
    const nodes = flow.getNodes.value;
    const reachable = new Set([child.id]);
    const outgoing = Map.groupBy(edges, edge => edge.source);
    for (const nodeId of reachable) {
      for (const edge of outgoing.get(nodeId) ?? []) reachable.add(edge.target);
    }
    if (checkingExisting && edges.filter(edge => edge.target === child.id && edge.targetHandle === "in").length !== references.length) {
      throw new Error("图片生成子节点的参考连线已变化");
    }
    return references.map(reference => {
      const sourceNode = flow.findNode<NodeData>(reference.nodeId);
      const current = readWorkbenchReference(sourceNode, reference.handleId);
      const connection = { source: reference.nodeId, sourceHandle: reference.handleId, target: child.id, targetHandle: "in" };
      if (!sourceNode || current?.path !== reference.path || current.mimeType !== reference.mimeType || reachable.has(reference.nodeId)
        || !flow.nodesConnectable.value || sourceNode.connectable === false || child.connectable === false
        || !validateConnection(connection, { sourceNode, targetNode: child, nodes, edges })) {
        throw new Error("参考素材或连接已变化，请重新选择参考图");
      }
      if (checkingExisting && !edges.some(edge => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle
        && edge.target === child.id && edge.targetHandle === "in")) throw new Error("图片生成子节点的参考连线已变化");
      return connection;
    });
  }

  async function createChildren(attempts: ImageWorkbenchPreparedAttempt[], check: () => void, attach: () => void) {
    if (!flow.nodeTypes?.value?.[childType]) throw new Error("请先启用图片生成节点插件");
    await batchHistory(async () => {
      check();
      const nodes = flow.getNodes.value;
      const x = parent.computedPosition.x + (parent.dimensions.width || 320) + 80;
      let y = parent.computedPosition.y;
      const prepared = attempts.map(({ candidate, label }) => {
        const { providerId, modelId, size, ratio } = candidate.snapshot.imageModel;
        const { prompt, references } = candidate.snapshot;
        const [width, height] = (ratio ?? "16:9").split(":").map(Number);
        const outputWidth = Number.isFinite(width / height) && width > 0 && height > 0 ? Math.max(320, 240 * width / height + 18) : 320;
        for (const other of [...nodes].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
          const position = other.computedPosition;
          if (position.x < x + outputWidth && position.x + (other.dimensions.width || 320) > x && position.y < y + 300
            && position.y + (other.dimensions.height || 300) > y) y = position.y + (other.dimensions.height || 300) + 40;
        }
        const position = { x, y };
        y += 340;
        return { id: candidate.childNodeId, type: childType, position, data: {
          label: (parent.data.label || "图片") + " · " + label + (candidate.attempt > 1 ? " · 尝试 " + candidate.attempt : ""),
          // The plugin declares this handle as well. Seed it so graph validation runs before anything is added.
          handles: [{ id: "in", type: "target", dataType: ["IMAGE", "STRING"] }],
          imageWorkbenchAttempt: { sourceNodeId: parent.id, candidateId: candidate.id },
          prompt, promptModel: referencePromptModel(prompt, references.map((reference, index) => ({
            id: reference.id, value: "{{ref " + (index + 1) + "}}", label: flow.findNode(reference.nodeId)?.data.label,
          }))),
          promptReferenceSelection: true, referenceOrder: { in: references.map(reference => reference.id) },
          model: JSON.stringify([providerId, modelId]), size, ratio, followDefaultModel: false,
        } };
      });
      const edges = prepared.flatMap((child, index) => validateReferences(child as unknown as GraphNode, attempts[index].candidate.snapshot.references, false))
        .map(connection => ({ id: crypto.randomUUID(), ...connection }));
      attach();
      flow.addNodes(prepared);
      flow.addEdges(edges);
      await nextTick();
      check();
    });
    check();
  }

  return { createChildren, findChild, validateReferences };
}
