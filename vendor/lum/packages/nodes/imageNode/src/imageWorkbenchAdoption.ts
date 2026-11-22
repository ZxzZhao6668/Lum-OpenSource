import { loadImageWorkbenchState, getImageWorkbenchSourceFingerprint } from './imageWorkbench';
import type { ImageWorkbenchAdoption } from './useImageWorkbenchResults';

type SavedNode = { id: string; type?: string; data?: Record<string, any> };
type SavedCanvas = { lumCanvas?: boolean; toonflowCanvas?: boolean; nodes?: SavedNode[]; edges?: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }[] };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
/** Reconstruct authority from the saved document, never from posted image bytes or paths. */
export function verifyWorkbenchAdoption(canvas: SavedCanvas, request: ImageWorkbenchAdoption) {
  const fail = () => { throw new Error('已保存的原图、候选或裁剪结果已变化，请重新核对采用预览'); };
  if ((canvas?.lumCanvas !== true && canvas?.toonflowCanvas !== true) || !Array.isArray(canvas.nodes) || request?.version !== 1
    || !Array.isArray(request.cells) || !request.cells.length || request.cells.length > 100) return fail();
  const nodes = new Map(canvas.nodes.map(node => [node.id, node]));
  const source = nodes.get(request.source?.nodeId);
  const plan = loadImageWorkbenchState(source?.data?.imageWorkbench);
  const output = (nodeId: string, handleId: string, allowGif = false) => {
    const slot = nodes.get(nodeId)?.data?.outputs?.[handleId];
    const value = slot?.value;
    if (slot?.dataType !== 'IMAGE' || typeof value?.url !== 'string' || !(allowGif ? /^image\/(png|jpeg|webp|gif)$/ : /^image\/(png|jpeg|webp)$/).test(value?.mimeType)
      || /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(value.url) || /[\x00-\x1f]/.test(value.url) || value.url.split(/[\\/]/).includes('..')) return fail();
    return { nodeId, handleId, path: value.url as string, mimeType: value.mimeType as string };
  };
  if (plan.sourceFingerprint !== request.sourceFingerprint || plan.sourceFingerprint !== getImageWorkbenchSourceFingerprint(plan.source, request.sourceRevision)
    || !same(output(plan.source.nodeId, plan.source.handleId, true), request.source) || plan.templateId !== request.templateId || plan.mode !== request.mode) return fail();
  const unique = new Set<string>();
  return request.cells.map(cell => {
    if (unique.has(cell.cellId)) return fail(); unique.add(cell.cellId);
    const savedCell = plan.cells.find(item => item.id === cell.cellId);
    if (!savedCell) return fail();
    const candidates = plan.mode === 'sheet' ? plan.sheetCandidates : savedCell.candidates;
    const selectedId = plan.mode === 'sheet' ? plan.selectedSheetCandidateId : savedCell.selectedCandidateId;
    const candidate = candidates.find(item => item.id === selectedId);
    if (!candidate || candidate.status !== 'succeeded' || candidate.id !== cell.candidateId || candidate.childNodeId !== cell.childNodeId
      || candidate.snapshot.sourceFingerprint !== plan.sourceFingerprint) return fail();
    const child = nodes.get(candidate.childNodeId), result = child?.data?.imageWorkbenchResult;
    if (child?.type !== 'remote-imageGenerationNode' || child?.data?.imageWorkbenchAttempt?.sourceNodeId !== source!.id || child.data.imageWorkbenchAttempt.candidateId !== candidate.id
      || result?.taskId !== candidate.id || !candidate.output) return fail();
    const media = output(candidate.childNodeId, candidate.output.handleId);
    if (!same(media, cell.candidateOutput) || result.path !== media.path || result.mimeType !== media.mimeType || result.handleId !== media.handleId
      || candidate.output.path !== media.path || candidate.output.mimeType !== media.mimeType) return fail();
    let adopted = media;
    if (plan.mode === 'sheet') {
      const node = nodes.get(cell.output?.nodeId), crop = node?.data?.imageWorkbenchCrop;
      if (!node || node.type !== 'remote-imageNode' || crop?.version !== 1 || crop.nodeId !== node.id || crop.cellId !== cell.cellId
        || crop.sourceFingerprint !== plan.sourceFingerprint || crop.templateId !== plan.templateId || crop.candidateId !== candidate.id
        || !same(crop.sheet, media) || !same(crop.rect, cell.crop) || !crop.output?.path?.startsWith('assets/' + node.id + '/')
        || !canvas.edges?.some(edge => edge.source === media.nodeId && edge.sourceHandle === media.handleId && edge.target === node.id && edge.targetHandle === 'in')) return fail();
      adopted = output(node.id, crop.output.handleId);
      if (crop.output.path !== adopted.path || crop.output.mimeType !== adopted.mimeType) return fail();
    } else if (cell.crop !== undefined) return fail();
    const local = plan.mode === 'sheet' ? candidate.snapshot.sheetCells?.find(item => item.id === cell.cellId) : undefined;
    const references = candidate.snapshot.references.filter(item => !local || local.referenceIds.includes(item.id));
    if (!same(adopted, cell.output) || cell.prompt !== (local?.prompt ?? candidate.snapshot.prompt) || !same(references, cell.references)) return fail();
    return { cellId: cell.cellId, ...adopted };
  });
}
