import { inject, ref } from "vue";
import { useVueFlow, type GraphNode, type Node } from "@vue-flow/core";
import { validateConnection, type NodeData } from "@lum/nodes-scaffold/connection";
import type { NodePersistenceContext } from "@lum/nodes-scaffold/nodeDocument";
import { uploadNodeFile, useNodeFiles } from "@lum/nodes-scaffold/runtime";
import type { ImageWorkbenchCandidate, ImageWorkbenchCandidateOutput, ImageWorkbenchReference, ImageWorkbenchState } from "./imageWorkbench";
import { readWorkbenchReference } from "./imageWorkbenchChildren";
import { getImageWorkbenchTemplate, type ImageWorkbenchTemplate, type ImageWorkbenchTemplateId } from "./imageWorkbenchTemplates";
import {
  composeWorkbenchImages, getWorkbenchCropRectangles, splitWorkbenchImage,
  type ImageCompositionFit, type ImageCompositionResult, type ImageCompositionSize, type ImageNormalizedRect, type ImageWorkbenchSplitLayout,
} from "./imageComposition";

type ResultBinding = {
  context: NodePersistenceContext;
  plan: ImageWorkbenchState;
  source: ImageWorkbenchResultMedia;
  check(signal?: AbortSignal): void;
};
export type ImageWorkbenchResultMedia = Readonly<ImageWorkbenchCandidateOutput & { nodeId: string }>;
export type ImageWorkbenchSavedImage = ImageWorkbenchResultMedia & ImageCompositionSize & { name: string; cellId?: string };
type LocalResultOptions = {
  signal?: AbortSignal;
  progress?(completed: number, total: number): void;
};
export type ImageWorkbenchCropProvenance = Readonly<{
  version: 1;
  sourceFingerprint: string;
  templateId: ImageWorkbenchTemplateId;
  candidateId: string;
  sheet: ImageWorkbenchResultMedia;
  cellId: string;
  nodeId: string;
  output: ImageWorkbenchCandidateOutput;
  rect: ImageNormalizedRect;
}>;

export type ImageWorkbenchAdoptionSelection = Readonly<{ cellId: string; resultNodeId?: string }>;
export type ImageWorkbenchAdoption = Readonly<{
  version: 1;
  directory: string;
  canvasPath: string;
  source: ImageWorkbenchResultMedia;
  sourceFingerprint: string;
  sourceRevision?: string;
  templateId: ImageWorkbenchTemplateId;
  mode: ImageWorkbenchState["mode"];
  cells: readonly Readonly<{
    cellId: string;
    name: string;
    prompt: string;
    candidateId: string;
    childNodeId: string;
    candidateOutput: ImageWorkbenchResultMedia;
    output: ImageWorkbenchResultMedia;
    references: readonly ImageWorkbenchReference[];
    crop?: ImageNormalizedRect;
  }>[];
}>;

const imageNodeType = "remote-imageNode";
const outputHandle = "image";
const pngMimeType = "image/png";

function sameMedia(a: ImageWorkbenchCandidateOutput | undefined, b: ImageWorkbenchCandidateOutput) {
  return a?.handleId === b.handleId && a.path === b.path && a.mimeType === b.mimeType;
}

function readName(name: string | undefined, fallback: string) {
  if (name === undefined) return fallback;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120 || /[\x00-\x1f]/.test(trimmed)) throw new Error("结果名称需要 1 至 120 个字符");
  return trimmed;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useImageWorkbenchResults(
  parent: GraphNode<NodeData>,
  bind: () => ResultBinding,
  findChild: (candidate: ImageWorkbenchCandidate) => GraphNode | undefined,
  lifetime: AbortSignal,
  sourceRevision?: () => string | undefined,
) {
  const flow = useVueFlow();
  const files = useNodeFiles();
  const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
  const busy = ref(false);

  function selected(plan: ImageWorkbenchState, cellId?: string) {
    if (cellId === undefined) return plan.sheetCandidates.find(item => item.id === plan.selectedSheetCandidateId);
    const cell = plan.cells.find(item => item.id === cellId);
    return cell?.candidates.find(item => item.id === cell.selectedCandidateId);
  }

  function bindCandidate(binding: ResultBinding, label: string, cellId?: string, previewId?: string) {
    const { plan } = binding;
    const findCandidate = () => previewId === undefined ? selected(plan, cellId)
      : (cellId === undefined ? plan.sheetCandidates : plan.cells.find(cell => cell.id === cellId)?.candidates)?.find(item => item.id === previewId);
    const candidate = findCandidate();
    if (!candidate || candidate.status !== "succeeded" || !candidate.output) throw new Error(label + "需要选择已完成的候选图片");
    const child = findChild(candidate);
    const candidateId = candidate.id;
    const media = Object.freeze({ ...candidate.output, nodeId: candidate.childNodeId });
    const snapshot = candidate.snapshot;
    const outputSlot = child?.data.outputs?.[media.handleId];
    const check = () => {
      const result = child?.data.imageWorkbenchResult;
      if (!child || findCandidate() !== candidate || candidate.id !== candidateId || candidate.status !== "succeeded"
        || candidate.snapshot !== snapshot || snapshot.sourceFingerprint !== plan.sourceFingerprint
        || (snapshot.sourceMimeType !== undefined && snapshot.sourceMimeType !== binding.source.mimeType)
        || candidateId !== result?.taskId || candidate.childNodeId !== media.nodeId || findChild(candidate) !== child
        || child.data.outputs?.[media.handleId] !== outputSlot || !sameMedia(candidate.output, media)
        || !sameMedia(result, media) || !sameMedia(readWorkbenchReference(child, media.handleId), media)) {
        throw new Error(label + "的选中候选、子节点或原始输出已变化，请核对候选图片");
      }
    };
    check();
    return { candidate, media, snapshot, check };
  }

  function getSelectedCandidate(cellId?: string) {
    return readCandidate(cellId);
  }

  function readCandidate(cellId?: string, previewId?: string) {
    try {
      const binding = bind();
      const { candidate, media } = bindCandidate(binding, cellId === undefined ? "整张图片" : "当前格位", cellId, previewId);
      return { candidateId: candidate.id, output: media };
    } catch {
      return undefined;
    }
  }

  function operation(binding: ResultBinding, options: LocalResultOptions, guards: readonly (() => void)[]) {
    const signal = options.signal ? AbortSignal.any([lifetime, options.signal]) : lifetime;
    const { mode, templateId, sourceFingerprint } = binding.plan;
    function check() {
      binding.check(signal);
      if (binding.plan.mode !== mode || binding.plan.templateId !== templateId || binding.plan.sourceFingerprint !== sourceFingerprint
        || binding.plan.source.nodeId !== binding.source.nodeId || binding.plan.source.handleId !== binding.source.handleId
        || binding.plan.source.path !== binding.source.path) {
        throw new Error("工作台模板、模式或原图已变化，请重新操作");
      }
      guards.forEach(guard => guard());
    }
    check();
    return { signal, check, progress: options.progress };
  }

  async function run<T>(action: (binding: ResultBinding, template: ImageWorkbenchTemplate) => Promise<T>) {
    if (busy.value) throw new Error("图像工作台正在处理结果");
    const binding = bind();
    busy.value = true;
    try { return await action(binding, getImageWorkbenchTemplate(binding.plan.templateId, binding.plan.cells.length)); }
    finally { busy.value = false; }
  }

  async function addSavedImages(
    binding: ResultBinding,
    entries: readonly { media: ImageWorkbenchSavedImage; sources: readonly ImageWorkbenchResultMedia[]; crop?: ImageWorkbenchCropProvenance }[],
    columns: number,
    { signal, check }: ReturnType<typeof operation>,
  ) {
    check();
    if (!flow.nodeTypes?.value?.[imageNodeType]) throw new Error("请先启用图片节点插件");
    const nodeWidth = Math.max(320, ...entries.map(({ media }) => 240 * media.width / media.height + 18));
    const nodeHeight = 300;
    const gap = 40;
    const width = columns * (nodeWidth + gap) - gap;
    const height = Math.ceil(entries.length / columns) * (nodeHeight + gap) - gap;
    const x = parent.computedPosition.x + (parent.dimensions.width || 320) + 80;
    let y = parent.computedPosition.y;
    for (const other of [...flow.getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + width && position.x + (other.dimensions.width || 320) > x
        && position.y < y + height && position.y + (other.dimensions.height || nodeHeight) > y) {
        y = position.y + (other.dimensions.height || nodeHeight) + gap;
      }
    }
    const nodes = entries.map(({ media, crop }, index): Node => ({
      id: media.nodeId, type: imageNodeType,
      position: { x: x + index % columns * (nodeWidth + gap), y: y + Math.floor(index / columns) * (nodeHeight + gap) },
      data: {
        label: media.name,
        handles: [{ id: "in", type: "target", dataType: "IMAGE", label: "来源图片" }, { id: outputHandle, type: "source", dataType: "IMAGE", label: "图片输出" }],
        outputs: { image: { dataType: "IMAGE", value: { url: media.path, mimeType: media.mimeType } } },
        ...(crop ? { imageWorkbenchCrop: crop } : {}),
      },
    }));
    const edges = entries.flatMap(({ media, sources }) => sources.map(source => ({
      id: crypto.randomUUID(), source: source.nodeId, sourceHandle: source.handleId, target: media.nodeId, targetHandle: "in",
    })));
    const checkAdded = () => {
      check();
      const liveEdges = flow.getEdges.value;
      if (entries.some(({ media, crop }) => {
        const node = flow.findNode(media.nodeId);
        return node?.type !== imageNodeType || !sameMedia(readWorkbenchReference(node, outputHandle), media)
          || (crop && JSON.stringify(node.data.imageWorkbenchCrop) !== JSON.stringify(crop));
      })
        || edges.some(edge => !liveEdges.some(live => live.id === edge.id && live.source === edge.source
          && live.sourceHandle === edge.sourceHandle && live.target === edge.target && live.targetHandle === edge.targetHandle))) {
        throw new Error("新建的结果节点或来源引用已变化");
      }
    };
    await batchHistory(async () => {
      check();
      if (!flow.nodeTypes?.value?.[imageNodeType]) throw new Error("请先启用图片节点插件");
      try {
        flow.addNodes(nodes);
        for (const edge of edges) {
          const sourceNode = flow.findNode(edge.source);
          const targetNode = flow.findNode(edge.target);
          if (!sourceNode || !targetNode || !validateConnection(edge, {
            sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value,
          })) throw new Error("来源图片无法连接到结果节点");
        }
        flow.addEdges(edges);
        checkAdded();
      } catch (error) {
        flow.removeNodes(nodes.map(({ id }) => id), true, false);
        throw error;
      }
    });
    checkAdded();
    try {
      await binding.context.save(signal);
      checkAdded();
    } catch (error) {
      // An in-flight canvas save can already have written these nodes. Leave the nodes and their files available for retry.
      check();
      throw new Error("结果已添加到画布，但保存尚未确认，可重试保存画布：" + errorText(error), { cause: error });
    }
  }

  async function uploadPicture(
    workspace: ReturnType<typeof files.getWorkspaceFiles>,
    picture: ImageCompositionResult,
    name: string,
    check: () => void,
    cellId?: string,
  ): Promise<ImageWorkbenchSavedImage> {
    check();
    const nodeId = crypto.randomUUID();
    const path = await uploadNodeFile(workspace, nodeId, new File([picture.blob], "image.png", { type: pngMimeType }));
    check();
    return { nodeId, handleId: outputHandle, path, mimeType: pngMimeType, width: picture.width, height: picture.height, name, cellId };
  }

  async function compose(options: LocalResultOptions & { size: ImageCompositionSize; fit?: ImageCompositionFit; name?: string }) {
    return run(async (binding, template) => {
      if (binding.plan.mode !== "quality") throw new Error("请使用逐格生成模式拼版");
      if (!flow.nodeTypes?.value?.[imageNodeType]) throw new Error("请先启用图片节点插件");
      const candidates = template.cells.map(cell => bindCandidate(binding, cell.label, cell.id));
      const work = operation(binding, options, candidates.map(item => item.check));
      const workspace = files.getWorkspaceFiles();
      const name = readName(options.name, (parent.data.label || "图片") + " · " + template.name + "拼版");
      const picture = await composeWorkbenchImages(template.grid, { ...options.size }, options.fit ?? "contain", candidates.map(({ media }, index) => ({
        label: template.cells[index].label, load: () => workspace.read(media.path),
      })), work);
      const media = await uploadPicture(workspace, picture, name, work.check);
      await addSavedImages(binding, [{ media, sources: candidates.map(candidate => candidate.media) }], 1, work);
      return media;
    });
  }

  async function split(options: LocalResultOptions & {
    candidateId: string;
    layout: ImageWorkbenchSplitLayout;
    names?: Readonly<Partial<Record<string, string>>>;
  }) {
    return run(async (binding, template) => {
      if (binding.plan.mode !== "sheet") throw new Error("请使用整张生成模式拆图");
      if (!flow.nodeTypes?.value?.[imageNodeType]) throw new Error("请先启用图片节点插件");
      const sheet = bindCandidate(binding, "整张图片");
      if (sheet.candidate.id !== options.candidateId) throw new Error("已选整张候选变化，请重新确认裁剪区域");
      const rects = getWorkbenchCropRectangles(options.layout, template.cells.map(cell => cell.id), template.id === "characterSheet");
      const columns = options.layout.columns;
      const names = template.cells.map(cell => readName(options.names?.[cell.id], cell.label));
      const work = operation(binding, options, [sheet.check]);
      const workspace = files.getWorkspaceFiles();
      const entries: { media: ImageWorkbenchSavedImage; sources: readonly ImageWorkbenchResultMedia[]; crop: ImageWorkbenchCropProvenance }[] = [];
      await splitWorkbenchImage(() => workspace.read(sheet.media.path), rects, template.cells.map(cell => cell.label), async (picture, index) => {
        const cellId = template.cells[index].id;
        const media = await uploadPicture(workspace, picture, names[index], work.check, cellId);
        entries.push({ media, sources: [sheet.media], crop: {
          version: 1, sourceFingerprint: binding.plan.sourceFingerprint, templateId: template.id, candidateId: sheet.candidate.id,
          sheet: sheet.media, cellId, nodeId: media.nodeId,
          output: { handleId: media.handleId, path: media.path, mimeType: media.mimeType }, rect: rects[index],
        } });
      }, work);
      await addSavedImages(binding, entries, columns, work);
      return entries.map(({ media }) => media);
    });
  }

  function bindCrop(binding: ResultBinding, sheet: ReturnType<typeof bindCandidate>, selection: ImageWorkbenchAdoptionSelection, label: string) {
    const node = selection.resultNodeId ? flow.findNode(selection.resultNodeId) : undefined;
    const crop = node?.data.imageWorkbenchCrop as ImageWorkbenchCropProvenance | undefined;
    const fail = () => new Error(label + "需要选择当前候选中已保存的真实拆图结果");
    if (!node || node.type !== imageNodeType || !crop || crop.version !== 1 || crop.nodeId !== node.id
      || crop.sourceFingerprint !== binding.plan.sourceFingerprint || crop.templateId !== binding.plan.templateId
      || crop.candidateId !== sheet.candidate.id || crop.cellId !== selection.cellId || crop.sheet?.nodeId !== sheet.media.nodeId
      || !sameMedia(crop.sheet, sheet.media) || crop.output?.handleId !== outputHandle || crop.output.mimeType !== pngMimeType
      || typeof crop.output.path !== "string" || !crop.output.path.startsWith("assets/" + node.id + "/")) throw fail();
    const media = Object.freeze({ nodeId: node.id, handleId: outputHandle, path: crop.output.path, mimeType: pngMimeType });
    const rect = Object.freeze(getWorkbenchCropRectangles({
      kind: "rectangles", confirmed: true, columns: 1, rows: 1, rectangles: [{ cellId: selection.cellId, rect: crop.rect }],
    }, [selection.cellId], true)[0]);
    const outputSlot = node.data.outputs?.[outputHandle];
    const frozenCrop = JSON.stringify(crop);
    const check = () => {
      if (flow.findNode(node.id) !== node || node.data.outputs?.[outputHandle] !== outputSlot || !sameMedia(readWorkbenchReference(node, outputHandle), media)
        || JSON.stringify(node.data.imageWorkbenchCrop) !== frozenCrop || !flow.getEdges.value.some(edge => edge.source === sheet.media.nodeId
          && edge.sourceHandle === sheet.media.handleId && edge.target === node.id && edge.targetHandle === "in")) throw fail();
    };
    check();
    return { media, rect, check, name: node.data.label || label };
  }

  async function buildAdoption(selections: readonly ImageWorkbenchAdoptionSelection[], signal?: AbortSignal): Promise<ImageWorkbenchAdoption> {
    return run(async (binding, template) => {
      const { plan, context } = binding;
      if (!selections.length || selections.length > template.cells.length || new Set(selections.map(item => item.cellId)).size !== selections.length) {
        throw new Error("请选择需要采用的有效格位");
      }
      const guards: (() => void)[] = [];
      const sheet = plan.mode === "sheet" ? bindCandidate(binding, "整张图片") : undefined;
      if (sheet) guards.push(sheet.check);
      const cells = selections.map(selection => {
        const cell = template.cells.find(item => item.id === selection.cellId);
        if (!cell) throw new Error("采用的格位不属于当前模板");
        if (!sheet && selection.resultNodeId !== undefined) throw new Error("逐格采用需要使用已选候选的原始图片");
        const result = sheet ?? bindCandidate(binding, cell.label, cell.id);
        const crop = sheet && bindCrop(binding, sheet, selection, cell.label);
        guards.push(crop ? crop.check : result.check);
        const local = crop ? result.snapshot.sheetCells?.find(item => item.id === cell.id) : undefined;
        const references = result.snapshot.references.filter(reference => !local || local.referenceIds.includes(reference.id));
        return Object.freeze({
          cellId: cell.id, name: crop ? crop.name : cell.label, prompt: local?.prompt ?? result.snapshot.prompt,
          candidateId: result.candidate.id, childNodeId: result.media.nodeId, candidateOutput: result.media,
          output: crop ? crop.media : result.media, references: Object.freeze(references.map(item => Object.freeze({ ...item }))),
          ...(crop ? { crop: crop.rect } : {}),
        });
      });
      const work = operation(binding, { signal }, guards);
      const revision = sourceRevision?.();
      const payload: ImageWorkbenchAdoption = Object.freeze({
        version: 1, directory: context.directory, canvasPath: context.canvasPath,
        source: binding.source, sourceFingerprint: plan.sourceFingerprint,
        ...(revision === undefined ? {} : { sourceRevision: revision }), templateId: template.id, mode: plan.mode, cells: Object.freeze(cells),
      });
      await context.save(work.signal);
      work.check();
      return payload;
    });
  }

  return { busy, getSelectedCandidate, getCandidatePreview: (id: string, cellId?: string) => readCandidate(cellId, id), compose, split, buildAdoption };
}
