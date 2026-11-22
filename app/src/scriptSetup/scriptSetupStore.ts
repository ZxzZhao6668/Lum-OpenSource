import type { AssetMedia } from '../assetLibrary/assetMedia';
import { db, saveDoc, type DocRow } from '../data/db';
import { currentProjectId, projectDatabaseName } from '../projects/projectIdentity';
import { isProjectAssetMediaId } from '../assetLibrary/assetSnapshot';
import {
  SCRIPT_SETUP_SCHEMA, setupInteger, validateCharacterEdits, validateScriptSetupPayload, validateScriptSetupRecord,
  type CharacterEdit, type ScriptSetupPayload, type ScriptSetupRecord, type SetupStatus,
} from './scriptSetupModel';

export const SCRIPT_SETUP_KEY = 'project:scriptSetup';
export const SCRIPT_SETUP_DRAFT_KEY = `${SCRIPT_SETUP_KEY}:draft`;
export const SCRIPT_SETUP_HISTORY = `${SCRIPT_SETUP_KEY}:history:`;
export const SCRIPT_SETUP_WORKSPACE_EPOCH = `${SCRIPT_SETUP_KEY}:workspaceEpoch`;
const historyKey = (revision: number) => SCRIPT_SETUP_HISTORY + String(revision).padStart(16, '0');
export const scriptSetupProjectId = currentProjectId ?? 'legacy';
const stamp = (record: ScriptSetupRecord | null) => record ? {revision: record.revision, versionId: record.versionId} : null;
export interface ScriptSetupVersion {
  projectId: string;
  workspaceEpoch: string;
  confirmed: ReturnType<typeof stamp>;
  draft: ReturnType<typeof stamp>;
}
export interface ScriptSetupState { confirmed: ScriptSetupRecord | null; draft: ScriptSetupRecord | null; version: ScriptSetupVersion }
export class ScriptSetupConflict extends Error {
  constructor(message = '其他窗口已修改设定。当前输入保留；请核对最新版本后再保存。') { super(message); this.name = 'ScriptSetupConflict'; }
}
export function assertScriptSetupProject(expectedProjectId = scriptSetupProjectId) {
  const requested = new URLSearchParams(location.search).get('project');
  const active = requested === 'legacy' || /^[a-f0-9-]{36}$/i.test(requested ?? '') ? requested : 'legacy';
  if (scriptSetupProjectId !== expectedProjectId || active !== scriptSetupProjectId || db.name !== projectDatabaseName(scriptSetupProjectId))
    throw new ScriptSetupConflict('项目已切换，当前操作未保存。');
}
export async function readScriptSetupWorkspaceEpoch() {
  const row = await db.docs.get(SCRIPT_SETUP_WORKSPACE_EPOCH);
  if (!row) return '';
  return validateScriptSetupWorkspaceEpoch(row.payload);
}
export function validateScriptSetupWorkspaceEpoch(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) throw Error('剧本设定工作区版本无效');
  return value;
}
async function readRecord(key: string, status: SetupStatus) {
  const row = await db.docs.get(key);
  return row ? validateScriptSetupRecord(row.payload, status) : null;
}
/** The only project setting that constrains newly started tasks. */
export async function readScriptSetup() {assertScriptSetupProject();return readRecord(SCRIPT_SETUP_KEY, 'confirmed');}
export async function readScriptSetupDraft() {assertScriptSetupProject();return readRecord(SCRIPT_SETUP_DRAFT_KEY, 'draft');}
async function readState(): Promise<ScriptSetupState> {
  const [confirmed, draft, workspaceEpoch] = await Promise.all([readScriptSetup(), readScriptSetupDraft(), readScriptSetupWorkspaceEpoch()]);
  return {confirmed, draft, version: {projectId: scriptSetupProjectId, workspaceEpoch, confirmed: stamp(confirmed), draft: stamp(draft)}};
}
export async function readScriptSetupState() {
  assertScriptSetupProject();
  return db.transaction('r', db.docs, readState);
}
export async function readScriptSetupHistory() {
  assertScriptSetupProject();
  const rows = await db.docs.where('key').startsWith(SCRIPT_SETUP_HISTORY).reverse().toArray();
  return rows.map(row => validateHistoryRow(row));
}
function validateHistoryRow(row: DocRow) {
  const record = validateScriptSetupRecord(row.payload, 'confirmed');
  if (row.key !== historyKey(record.revision)) throw Error('设定历史键与版本不符');
  return record;
}
function checkVersion(state: ScriptSetupState, expected: ScriptSetupVersion) {
  assertScriptSetupProject(expected.projectId);
  const same = (a: ReturnType<typeof stamp>, b: ReturnType<typeof stamp>) => a === b || (!!a && !!b && a.revision === b.revision && a.versionId === b.versionId);
  if (state.version.workspaceEpoch !== expected.workspaceEpoch || !same(state.version.confirmed, expected.confirmed) || !same(state.version.draft, expected.draft))
    throw new ScriptSetupConflict();
}
function nextRevision(state: ScriptSetupState) { return Math.max(state.confirmed?.revision ?? 0, state.draft?.revision ?? 0) + 1; }
function makeRecord(payload: ScriptSetupPayload, revision: number, status: SetupStatus, extra: {restoredFrom?: number; characterEdits?: CharacterEdit[]} = {}) {
  return validateScriptSetupRecord({ schemaVersion: SCRIPT_SETUP_SCHEMA, revision, versionId: crypto.randomUUID(), updatedAt: Date.now(), status, payload, ...extra }, status);
}
async function writeConfirmed(record: ScriptSetupRecord) {
  await db.docs.add({key: historyKey(record.revision), payload: record, updatedAt: record.updatedAt});
  await saveDoc(SCRIPT_SETUP_KEY, record);
}
async function checkReferenceMedia(payload: ScriptSetupPayload) {
  const id = payload.visualStyle.referenceMediaId;
  if (id && (!isProjectAssetMediaId(id) || !await db.assetMedia.where('id').equals(id).count())) throw Error('找不到画风参考原图，请重新选择。');
}
function characterIds(payload?: ScriptSetupPayload) {
  return new Set(payload?.characters.flatMap(c => 'entityId' in c ? [c.entityId] : c.profile.relationships.map(rel => rel.entityId)));
}
async function checkNewCharacterReferences(payload: ScriptSetupPayload, state: ScriptSetupState) {
  const previous = new Set([...characterIds(state.confirmed?.payload), ...characterIds(state.draft?.payload)]);
  for (const id of characterIds(payload)) {
    if (previous.has(id)) continue;
    const found = await db.entities.get(id);
    if (found?.kind !== 'character') throw new ScriptSetupConflict('有新引用的人物不存在或不是角色，请核对人物 ID。');
  }
}
/** Returns a transaction-consistent receipt and CAS for the next operation. */
export async function saveScriptSetup(
  draft: ScriptSetupPayload, expectedRevision: ScriptSetupVersion, status: SetupStatus, characterEdits?: CharacterEdit[], referenceMedia?: AssetMedia, onConfirmed?: (record: ScriptSetupRecord) => Promise<void>,
): Promise<ScriptSetupState> {
  assertScriptSetupProject(expectedRevision.projectId);
  const payload = validateScriptSetupPayload(structuredClone(draft));
  // A caller that edits settings only should not erase another panel's pending profile edits.
  const providedEdits = characterEdits === undefined ? undefined : structuredClone(characterEdits);
  return db.transaction('rw', db.docs, db.assetMedia, db.entities, async () => {
    const state = await readState(); checkVersion(state, expectedRevision);
    await checkNewCharacterReferences(payload,state);
    const present = new Set(payload.characters.flatMap(c => 'entityId' in c ? [c.entityId] : []));
    const edits = providedEdits ?? state.draft?.characterEdits?.filter(edit => present.has(edit.entityId)) ?? [];
    validateCharacterEdits(edits, payload);
    const revision = nextRevision(state);
    const record = makeRecord(payload, revision, status, status === 'draft' && edits.length ? {characterEdits: edits} : {});
    if (referenceMedia) {
      if (referenceMedia.id !== payload.visualStyle.referenceMediaId || !isProjectAssetMediaId(referenceMedia.id))
        throw Error('画风参考图与当前设定不一致。');
      if (!await db.assetMedia.where('id').equals(referenceMedia.id).count()) await db.assetMedia.add(referenceMedia);
    }
    await checkReferenceMedia(payload);
    if (status === 'draft') await saveDoc(SCRIPT_SETUP_DRAFT_KEY, record);
    else {
      await writeConfirmed(record);
      await onConfirmed?.(record);
      if (edits.length) await saveDoc(SCRIPT_SETUP_DRAFT_KEY, makeRecord(payload, revision + 1, 'draft', {characterEdits: edits}));
      else await db.docs.delete(SCRIPT_SETUP_DRAFT_KEY);
    }
    assertScriptSetupProject(expectedRevision.projectId);
    return readState();
  });
}
export async function restoreScriptSetupRevision(revision: number, expectedRevision: ScriptSetupVersion): Promise<ScriptSetupState> {
  assertScriptSetupProject(expectedRevision.projectId);
  return db.transaction('rw', db.docs, db.assetMedia, async () => {
    const state = await readState(); checkVersion(state, expectedRevision);
    const row = await db.docs.get(historyKey(setupInteger(revision, 1, Number.MAX_SAFE_INTEGER, '恢复版本')));
    if (!row) throw Error('找不到要恢复的设定版本');
    const source = validateHistoryRow(row);
    await checkReferenceMedia(source.payload);
    await writeConfirmed(makeRecord(source.payload, nextRevision(state), 'confirmed', {restoredFrom: revision}));
    assertScriptSetupProject(expectedRevision.projectId);
    return readState();
  });
}
export function validateScriptSetupBackup(rows: readonly DocRow[]) {
  const related = rows.filter(row => row.key === SCRIPT_SETUP_KEY || row.key.startsWith(`${SCRIPT_SETUP_KEY}:`));
  const history = new Map<number, ScriptSetupRecord>();
  const versionIds = new Set<string>();
  let active: ScriptSetupRecord | undefined, draft: ScriptSetupRecord | undefined, latest = 0;
  for (const row of related) {
    if (row.key === SCRIPT_SETUP_KEY) { active = validateScriptSetupRecord(row.payload, 'confirmed'); continue; }
    if (row.key === SCRIPT_SETUP_DRAFT_KEY) { draft = validateScriptSetupRecord(row.payload, 'draft'); continue; }
    if (row.key === SCRIPT_SETUP_WORKSPACE_EPOCH) { validateScriptSetupWorkspaceEpoch(row.payload); continue; }
    const record = validateHistoryRow(row);
    if (!row.key.startsWith(SCRIPT_SETUP_HISTORY) || history.has(record.revision) || versionIds.has(record.versionId)) throw Error('备份中有重复的剧本设定历史版本');
    latest = Math.max(latest, record.revision);
    history.set(record.revision, record); versionIds.add(record.versionId);
  }
  if (!!active !== !!history.size || (active && (active.revision !== latest || JSON.stringify(active) !== JSON.stringify(history.get(latest)))))
    throw Error('备份中的已确认设定与历史不一致');
  if (draft && (history.has(draft.revision) || versionIds.has(draft.versionId))) throw Error('备份中的设定草稿版本重复');
  for (const record of history.values()) if (record.restoredFrom !== undefined && !history.has(record.restoredFrom)) throw Error('备份缺少剧本设定的恢复来源');
  return related.flatMap(row => row.key === SCRIPT_SETUP_WORKSPACE_EPOCH ? [] : [(row.payload as ScriptSetupRecord).payload.visualStyle.referenceMediaId]).filter((id): id is string => !!id);
}

