import { db, loadDoc, saveDoc, type DocRow } from '../data/db';
import { validateSkill, type WritingSkill } from '../skills/skillStore';
import { taskObject, taskText } from '../scriptSetup/scriptSetupAi';
import { scriptSetupFingerprint } from '../scriptSetup/characterProfiles';
import { validateScriptSetupSnapshot, type ScriptSetupSnapshot } from '../scriptSetup/scriptSetupContext';
import { setupFingerprint, setupInteger } from '../scriptSetup/scriptSetupModel';
import { assertScriptSetupProject, readScriptSetupWorkspaceEpoch } from '../scriptSetup/scriptSetupStore';
import {
  DOCUMENT_LIMITS, proposalKey, validateBlocks, validateSelectionProposalSource, type DocumentSnapshot, type Proposal, type SelectionProposalSource,
} from './documentStore';
import { prepareSelectionChange, selectionText, type TextSelection } from './selectionWriting';
import type { TextModel } from './writingClient';

const PREFIX = 'writing:selectionRun:';
const runKey = (id: string) => PREFIX + id;
export const selectionUses = { rewrite: '改写', expand: '扩写', describe: '描写' } as const;
type SelectionUse = keyof typeof selectionUses;
interface SelectionRun extends SelectionProposalSource {
  schemaVersion: 1;
  use: SelectionUse;
  status: 'running' | 'generated' | 'failed' | 'cancelled';
  createdAt: number;
  episodeId: string;
  revision: number;
  bodyFingerprint: string;
  start: TextSelection['start'];
  end: TextSelection['end'];
  original: string;
  request: string;
  model: Pick<TextModel, 'providerId' | 'modelId' | 'providerLabel' | 'label'>;
  skill: WritingSkill;
  scriptSetup: ScriptSetupSnapshot | null;
  result?: string;
  error?: string;
  proposalId?: string;
}

async function checkOrigin(run: SelectionProposalSource) {
  assertScriptSetupProject(run.projectId);
  if (await readScriptSetupWorkspaceEpoch() !== run.workspaceEpoch) throw Error('工作区已恢复，旧选区任务保持历史状态。');
}
function validateSelectionRun(value: unknown, key: string): SelectionRun {
  const v = taskObject(value, ['schemaVersion', 'id', 'projectId', 'workspaceEpoch', 'use', 'status', 'createdAt', 'episodeId', 'revision',
    'bodyFingerprint', 'start', 'end', 'original', 'request', 'model', 'skill', 'scriptSetup', 'result', 'error', 'proposalId']);
  const identity = validateSelectionProposalSource({ id: v.id, projectId: v.projectId, workspaceEpoch: v.workspaceEpoch });
  if (v.schemaVersion !== 1 || key !== runKey(identity.id) || typeof v.use !== 'string' || !Object.hasOwn(selectionUses, v.use)
    || !['running', 'generated', 'failed', 'cancelled'].includes(String(v.status))) throw Error('选区写作记录格式无效。');
  const episodeId = taskText(v.episodeId, DOCUMENT_LIMITS.id);
  if (/[:\s]/.test(episodeId)) throw Error('选区写作剧集 ID 无效。');
  setupInteger(v.revision, 0, Number.MAX_SAFE_INTEGER, '选区正文版本');
  setupInteger(v.createdAt, 1, Number.MAX_SAFE_INTEGER, '选区请求时间');
  setupFingerprint(v.bodyFingerprint, '选区正文指纹');
  for (const raw of [v.start, v.end]) {
    const point = taskObject(raw, ['id', 'offset']);
    taskText(point.id, DOCUMENT_LIMITS.id);
    setupInteger(point.offset, 0, DOCUMENT_LIMITS.blockText, '选区偏移');
  }
  taskText(v.original, DOCUMENT_LIMITS.totalText + DOCUMENT_LIMITS.blocks);
  taskText(v.request, 12000, true);
  const model = taskObject(v.model, ['providerId', 'modelId', 'providerLabel', 'label']);
  taskText(model.providerId, 1000); taskText(model.modelId, 1000); taskText(model.providerLabel, 1000, true); taskText(model.label, 1000, true);
  if (!validateSkill(v.skill).uses.includes(v.use as SelectionUse)) throw Error('选区写作 Skill 用途无效。');
  if (v.scriptSetup !== null) {
    const setup = validateScriptSetupSnapshot(v.scriptSetup);
    if (setup.purpose !== 'writing' || setup.projectId !== identity.projectId || setup.workspaceEpoch !== identity.workspaceEpoch || setup.episodeId !== episodeId)
      throw Error('选区写作和设定快照的来源不一致。');
  }
  if (v.status === 'generated') taskText(v.result, 100000);
  else if (v.result !== undefined || v.proposalId !== undefined) throw Error('选区写作结果状态无效。');
  if (v.error !== undefined) taskText(v.error, 12000);
  if (v.proposalId !== undefined && !/^[a-f0-9-]{36}$/.test(taskText(v.proposalId, 36))) throw Error('选区写作提案 ID 无效。');
  return value as SelectionRun;
}

export async function startSelectionRun(input: {
  origin: SelectionProposalSource;
  use: SelectionUse;
  document: DocumentSnapshot;
  selection: TextSelection;
  request: string;
  model: TextModel;
  skill: WritingSkill;
  scriptSetup: ScriptSetupSnapshot | null;
}) {
  const { origin, use, document, selection, request, model, skill, scriptSetup } = input;
  const original = selectionText(document, selection);
  const bodyFingerprint = await scriptSetupFingerprint(document.blocks);
  const run = validateSelectionRun({
    ...origin, schemaVersion: 1, use, status: 'running', createdAt: Date.now(), episodeId: document.episodeId, revision: document.revision,
    bodyFingerprint, start: selection.start, end: selection.end, original, request,
    model: { providerId: model.providerId, modelId: model.modelId, providerLabel: model.providerLabel, label: model.label }, skill, scriptSetup,
  }, runKey(origin.id));
  await db.transaction('rw', db.docs, async () => {
    await checkOrigin(run);
    await db.docs.add({ key: runKey(run.id), payload: run, updatedAt: run.createdAt });
  });
  return run.id;
}
export async function readSelectionRun(id: string) { return validateSelectionRun(await loadDoc(runKey(id)), runKey(id)); }
type SelectionRunSummary = Pick<SelectionRun, 'id' | 'episodeId' | 'status' | 'use' | 'createdAt' | 'proposalId'>;
export async function listSelectionRuns() {
  const runs: SelectionRunSummary[] = [];
  await db.docs.where('key').startsWith(PREFIX).each(row => {
    const run = row.payload as SelectionRun;
    if (run?.schemaVersion === 1 && row.key === runKey(run.id) && Object.hasOwn(selectionUses, run.use))
      runs.push({ id: run.id, episodeId: run.episodeId, status: run.status, use: run.use, createdAt: run.createdAt, proposalId: run.proposalId });
  });
  return runs;
}
export async function finishSelectionRun(id: string, outcome: { result: string } | { status: 'failed' | 'cancelled'; error: string }) {
  await db.transaction('rw', db.docs, async () => {
    const run = await readSelectionRun(id);
    await checkOrigin(run);
    if (run.status !== 'running') return;
    const next = 'result' in outcome ? { ...run, status: 'generated', result: outcome.result } : { ...run, ...outcome };
    await saveDoc(runKey(id), validateSelectionRun(next, runKey(id)));
  });
  window.dispatchEvent(new Event('dsh:selection-writing-updated'));
}
export async function createSelectionRunProposal(id: string, document: DocumentSnapshot, selection: TextSelection, replacement: string) {
  return db.transaction('rw', db.docs, async () => {
    const run = await readSelectionRun(id);
    await checkOrigin(run);
    if (run.status !== 'generated' || run.proposalId) throw Error('此预览已处理，请查看写入记录。');
    if (document.episodeId !== run.episodeId || document.revision !== run.revision || await scriptSetupFingerprint(document.blocks) !== run.bodyFingerprint
      || JSON.stringify(selection.start) !== JSON.stringify(run.start) || JSON.stringify(selection.end) !== JSON.stringify(run.end)
      || selectionText(document, selection) !== run.original) throw Error('选区原文或范围已变化，请重新拉选。');
    const proposal = await prepareSelectionChange(document, selection, replacement, {
      id: run.id, projectId: run.projectId, workspaceEpoch: run.workspaceEpoch,
    });
    await saveDoc(runKey(id), { ...run, proposalId: proposal.id });
    return proposal;
  });
}

export function validateSelectionRunBackup(rows: readonly DocRow[]) {
  const indexed = new Map(rows.map(row => [row.key, row.payload]));
  const media: string[] = [];
  const linked = new Set<string>();
  for (const row of rows) {
    if (!row.key.startsWith(PREFIX)) continue;
    const run = validateSelectionRun(row.payload, row.key);
    if (run.proposalId) {
      const key = proposalKey(run.episodeId, run.proposalId);
      const proposal = indexed.get(key) as Proposal | undefined;
      if (!proposal || proposal.id !== run.proposalId || proposal.episodeId !== run.episodeId || proposal.baseRevision !== run.revision
        || !['pending', 'applied', 'undone', 'rejected'].includes(proposal.status)) throw Error('备份缺少选区写作真实提案。');
      const origin = validateSelectionProposalSource(proposal.selectionRun);
      if (origin.id !== run.id || origin.projectId !== run.projectId || origin.workspaceEpoch !== run.workspaceEpoch || linked.has(key))
        throw Error('备份中选区写作提案来源不一致。');
      const blocks = validateBlocks(proposal.before);
      validateBlocks(proposal.after);
      if (selectionText({ episodeId: run.episodeId, revision: run.revision, updatedAt: 0, blocks },
        { start: run.start, end: run.end, blocks }) !== run.original) throw Error('备份中选区写作提案原文不一致。');
      linked.add(key);
    }
    const reference = run.scriptSetup?.visual.style.referenceMediaId;
    if (reference) media.push(reference);
  }
  for (const row of rows) {
    if (row.key.startsWith('writing:proposal:') && (row.payload as Proposal | undefined)?.selectionRun !== undefined && !linked.has(row.key))
      throw Error('备份缺少提案对应的选区写作记录。');
  }
  return media;
}

