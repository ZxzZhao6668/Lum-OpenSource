import Dexie from 'dexie';
import { db, createEntity, type EntityRow, type DocRow } from '../data/db';
import { validateCharacterProfile, validateCharacterProfileRecord, type CharacterProfile } from './scriptSetupModel';
import { assertScriptSetupProject, readScriptSetupWorkspaceEpoch, ScriptSetupConflict, scriptSetupProjectId } from './scriptSetupStore';

export const CHARACTER_PROFILE_PREFIX = 'project:characterProfile:';
export interface CharacterProfileSource {
  entityId: string; name: string; meta: string; appearanceName?: string; hasImage: boolean;
  fingerprint: string; workspaceEpoch: string;
}
export interface CharacterProfileReceipt {
  projectId: string; key: string; record: ReturnType<typeof validateCharacterProfileRecord>; source: CharacterProfileSource;
}
const profileKey = (id: string) => CHARACTER_PROFILE_PREFIX + id;
export async function scriptSetupFingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const hash = crypto.subtle.digest('SHA-256', bytes);
  const digest = await (Dexie.currentTransaction?.db === db ? Dexie.waitFor(hash) : hash);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function checkedEntity(entityId: string) {
  const row = await db.entities.get(entityId);
  if (!row || row.kind !== 'character') throw new ScriptSetupConflict('找不到该人物，请保留为待绑定草稿或选择仍存在的角色。');
  return row;
}
async function sourceOf(row: EntityRow): Promise<CharacterProfileSource> {
  const {id, name, meta, desc, kind, image, assetSnapshot: pin} = row;
  const epoch = await readScriptSetupWorkspaceEpoch();
  const fingerprint = await scriptSetupFingerprint([scriptSetupProjectId, epoch, id, kind, name, meta, desc, pin ? [pin.assetId, pin.libraryVersion, pin.appearanceId, pin.appearanceVersion, pin.view.mediaId] : null, !!image]);
  return {entityId: id, name, meta, ...(pin?.appearanceName ? {appearanceName: pin.appearanceName} : {}), hasImage: !!(image || pin), fingerprint, workspaceEpoch: epoch};
}
export async function readCharacterProfile(entityId: string) {
  assertScriptSetupProject();
  const row = await db.docs.get(profileKey(entityId));
  return row ? validateCharacterProfileRecord(row.payload, entityId) : null;
}
export async function readCharacterProfileEditor(entityId: string) {
  assertScriptSetupProject();
  return db.transaction('r', db.docs, db.entities, async () => {
    const entity = await checkedEntity(entityId);
    const [source, record] = await Promise.all([sourceOf(entity), readCharacterProfile(entityId)]);
    return {source, record};
  });
}
async function writeProfile(source: CharacterProfileSource, profile: CharacterProfile, revision: number): Promise<CharacterProfileReceipt> {
  for (const relation of profile.relationships) {
    const entity = await db.entities.get(relation.entityId);
    if (!entity || entity.kind !== 'character') throw Error(`人物关系 ID 已失效：${relation.entityId}。请先修正该关系。`);
  }
  const key = profileKey(source.entityId);
  const record = validateCharacterProfileRecord({
    schemaVersion: 1, entityId: source.entityId, revision, entityFingerprint: source.fingerprint, updatedAt: Date.now(), profile,
  }, source.entityId);
  await db.docs.put({key, payload: record, updatedAt: record.updatedAt});
  return {projectId: scriptSetupProjectId, key, record, source};
}
export async function applyCharacterProfile(
  entityId: string, profile: CharacterProfile, expectedRevision: number, expectedEntityFingerprint: string,
  expectedScope?: {projectId?: string; workspaceEpoch: string},
): Promise<CharacterProfileReceipt> {
  assertScriptSetupProject(expectedScope?.projectId);
  const payload = validateCharacterProfile(structuredClone(profile), entityId);
  return db.transaction('rw', db.docs, db.entities, async () => {
    const entity = await checkedEntity(entityId);
    const [source, previous] = await Promise.all([sourceOf(entity), readCharacterProfile(entityId)]);
    if ((previous?.revision ?? 0) !== expectedRevision || source.fingerprint !== expectedEntityFingerprint
      || (expectedScope && source.workspaceEpoch !== expectedScope.workspaceEpoch))
      throw new ScriptSetupConflict('人物资料或档案已变更，当前输入保留。核对当前档案及造型后再应用。');
    const receipt = await writeProfile(source, payload, expectedRevision + 1);
    assertScriptSetupProject(expectedScope?.projectId);
    return receipt;
  });
}
export async function createCharacterWithProfile(name: string, profile: CharacterProfile, scope: {projectId?: string; workspaceEpoch: string}) {
  assertScriptSetupProject(scope.projectId);
  const clean = name.trim();
  if (!clean || clean.length > 120) throw Error('人物名称需为 1—120 字');
  const payload = validateCharacterProfile(structuredClone(profile));
  return db.transaction('rw', db.docs, db.entities, async () => {
    if (await readScriptSetupWorkspaceEpoch() !== scope.workspaceEpoch) throw new ScriptSetupConflict('工作区已恢复，当前人物未创建。');
    const entity = await createEntity('character', {name: clean});
    const receipt = await writeProfile(await sourceOf(entity), payload, 1);
    assertScriptSetupProject(scope.projectId);
    return {entity, receipt};
  });
}
export function validateCharacterProfileBackup(rows: readonly DocRow[]) {
  for (const row of rows) if (row.key.startsWith(CHARACTER_PROFILE_PREFIX))
    validateCharacterProfileRecord(row.payload, row.key.slice(CHARACTER_PROFILE_PREFIX.length));
}

