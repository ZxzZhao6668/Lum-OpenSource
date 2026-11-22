import { db, createEntity, type EntityKind } from '../data/db';
import { currentProjectId, projectDatabaseName } from '../projects/projectIdentity';
import { readAssetMedia } from './assetMedia';
import { assetCategories, type ProjectAssetSnapshot } from './assetSnapshot';
import { getSharedAssetView, getSharedAssetMedia, getSharedAssetThumbnail } from './store';

let projectEpoch = 0;
window.addEventListener('pagehide', () => { projectEpoch++; });

export interface AssetProjectContext {
  readonly projectId: string;
  readonly database: typeof db;
  readonly epoch: number;
}
export function captureAssetProject(): AssetProjectContext {
  if (!currentProjectId) throw Error('请返回项目首页，打开一个项目后再添加资产');
  const context = { projectId: currentProjectId, database: db, epoch: projectEpoch };
  assertAssetProject(context);
  return context;
}
export function assertAssetProject(context: AssetProjectContext) {
  if (new URLSearchParams(location.search).get('project') !== context.projectId || currentProjectId !== context.projectId
    || context.epoch !== projectEpoch || context.database !== db || context.database.name !== projectDatabaseName(context.projectId)) {
    throw Error('项目已切换，请在目标项目重新选择资产');
  }
}
export async function getProjectAssetMedia(mediaId: string, context = captureAssetProject()): Promise<Blob> {
  assertAssetProject(context);
  const media = await context.database.assetMedia.get(mediaId);
  assertAssetProject(context);
  if (!media) throw Error('项目已固定的视图原图缺失');
  return media.original;
}

interface AssetSelection { assetId: string; appearanceId?: string; viewId?: string }
interface ProjectImportOptions { context?: AssetProjectContext; assertCurrent?: () => void }

async function importView(selection: AssetSelection, context: AssetProjectContext, explicit: boolean, assertCurrent?: () => void) {
  const { database } = context;
  const confirmProject = () => { assertAssetProject(context); assertCurrent?.(); };
  confirmProject();
  const baseKey = `assetLibrary:import:${selection.assetId}`;
  const { asset, appearance, view } = await getSharedAssetView(selection.assetId, selection.appearanceId, selection.viewId);
  const docKey = `${baseKey}:${appearance.id}:${view.id}`;
  const findExisting = async () => {
    const entries = await database.docs.bulkGet(explicit ? [docKey, baseKey] : [baseKey]);
    for (const entry of entries) {
      const ledger = entry?.payload as { entityId?: string; appearanceId?: string } | undefined;
      if (!ledger?.entityId) continue;
      const existing = await database.entities.get(ledger.entityId);
      if (!existing) continue;
      const pin = existing.assetSnapshot;
      if (!explicit || (pin?.assetId === asset.id && pin.appearanceId === appearance.id && pin.view.id === view.id)
        || (appearance.id === 'legacy' && entry?.key === baseKey && !ledger.appearanceId && !pin)) return existing.id;
    }
  };
  const existing = await database.transaction('r', database.docs, database.entities, findExisting);
  confirmProject();
  if (existing) return { added: false, entityId: existing };
  const original = await getSharedAssetMedia(view.mediaId);
  const media = await readAssetMedia(original);
  if (!view.mediaId.startsWith('legacy:') && view.mediaId !== media.id) throw Error('共用视图原图校验失败');
  const image = await getSharedAssetThumbnail(view.mediaId);
  confirmProject();
  const pinned: ProjectAssetSnapshot = {
    assetId: asset.id, libraryVersion: asset.version, category: asset.category, name: asset.name, notes: asset.notes,
    appearanceId: appearance.id, appearanceVersion: appearance.revision, appearanceName: appearance.name,
    view: { ...view, mediaId: media.id },
  };
  return database.transaction('rw', [database.entities, database.docs, database.assetMedia], async () => {
    confirmProject();
    const existingId = await findExisting();
    if (existingId) {
      confirmProject();
      return { added: false, entityId: existingId };
    }
    if (!await database.assetMedia.where('id').equals(media.id).count()) await database.assetMedia.add(media);
    const kind: EntityKind = asset.category === 'scene' ? 'location' : asset.category === 'prop' ? 'prop' : 'character';
    confirmProject();
    const row = await createEntity(kind, {
      name: asset.name, meta: asset.category === 'male' ? '男' : asset.category === 'female' ? '女' : assetCategories[asset.category],
      desc: asset.notes, image, assetSnapshot: pinned,
    });
    const ledger = { entityId: row.id, libraryVersion: asset.version, appearanceId: appearance.id, viewId: view.id };
    const updatedAt = Date.now();
    const oldLedger = await database.docs.get(baseKey);
    const oldEntityId = (oldLedger?.payload as { entityId?: string } | undefined)?.entityId;
    if (!oldEntityId || !await database.entities.get(oldEntityId)) {
      await database.docs.put({ key: baseKey, payload: ledger, updatedAt });
    }
    await database.docs.put({ key: docKey, payload: ledger, updatedAt });
    confirmProject();
    return { added: true, entityId: row.id };
  });
}

function dispatchImport() {
  window.dispatchEvent(new CustomEvent('dsh:content-updated', { detail: { kind: 'entity' } }));
}

export async function addSharedAssetsToProject(ids: string[]) {
  const context = captureAssetProject();
  let added = 0, existing = 0;
  try {
    for (const assetId of new Set(ids)) {
      const result = await importView({ assetId }, context, false);
      if (result.added) added++; else existing++;
    }
  } finally {
    if (added) dispatchImport();
  }
  return { added, existing };
}

export async function addSharedAssetViewToProject(selection: Required<AssetSelection>, options: ProjectImportOptions = {}) {
  const context = options.context ?? captureAssetProject();
  const result = await importView(selection, context, true, options.assertCurrent);
  if (result.added) dispatchImport();
  return result;
}
