import Dexie, { liveQuery } from 'dexie';
import { blobDataUrl } from '../entities/entityImageUpload';
import { assetMediaLimits, imageDataUrlBlob, prepareAssetMedia, type AssetMedia, type PreparedAssetMedia } from './assetMedia';
import { assetCategories, validateAssetViewFields, type AssetCategory, type AssetView, type AssetViewPurpose, type AssetViewSource } from './assetSnapshot';

export { assetCategories, assetViewPurposes } from './assetSnapshot';
export type { AssetCategory, AssetView, AssetViewPurpose, AssetViewSource, ProjectAssetSnapshot } from './assetSnapshot';
export { addSharedAssetsToProject, addSharedAssetViewToProject, captureAssetProject, assertAssetProject, getProjectAssetMedia } from './projectAssets';
export type { AssetProjectContext } from './projectAssets';

export interface SharedAsset {
  id: string;
  category: AssetCategory;
  name: string;
  notes: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Undefined on legacy rows. Metadata edits leave this token unchanged. */
  appearanceVersion?: number;
  activeAppearanceId?: string;
  activeMediaId?: string;
}

export interface AssetAppearance {
  id: string;
  assetId: string;
  revision: number;
  name: string;
  createdAt: number;
  views: AssetView[];
}

export type AssetViewInput = { name: string; purpose: AssetViewPurpose; source?: AssetViewSource } &
  ({ image: Blob; mediaId?: never } | { image?: never; mediaId: string });
export interface AssetAppearanceInput { name: string; views: readonly AssetViewInput[] }

class AssetLibraryDB extends Dexie {
  assets!: Dexie.Table<SharedAsset, string>;
  images!: Dexie.Table<{ id: string; dataUrl: string }, string>;
  appearances!: Dexie.Table<AssetAppearance, string>;
  media!: Dexie.Table<AssetMedia, string>;
  thumbnails!: Dexie.Table<{ id: string; dataUrl: string }, string>;

  constructor() {
    super('lum-shared-asset-library');
    this.version(1).stores({ assets: 'id,category,createdAt', images: 'id' });
    this.version(2).stores({ appearances: 'id,[assetId+revision]', media: 'id', thumbnails: 'id' });
  }
}
const library = new AssetLibraryDB();
const compatBytes = 4 * 1024 * 1024;
const legacyAppearanceId = 'legacy';
const legacyMediaId = (id: string) => 'legacy:' + id;
const legacyAssetId = (mediaId: string) => mediaId.startsWith('legacy:') ? mediaId.slice(7) : undefined;
const mediaIdPattern = /^(?:sha256:[a-f0-9]{64}|legacy:[a-zA-Z0-9_-]{1,128})$/;

function legacyAppearance(asset: SharedAsset): AssetAppearance {
  return {
    id: legacyAppearanceId, assetId: asset.id, revision: 1, name: '默认造型', createdAt: asset.createdAt,
    views: [{ id: 'original', mediaId: legacyMediaId(asset.id), name: '原图', purpose: 'reference' }],
  };
}

function validateFields(value: { category: AssetCategory; name: string; notes: string }) {
  if (!Object.prototype.hasOwnProperty.call(assetCategories, value.category)) throw Error('资产分类无效');
  const name = value.name.trim();
  if (!name || name.length > 200) throw Error('名称需为 1—200 字');
  if (value.notes.length > 12000) throw Error('备注最多 12000 字');
  return { category: value.category, name, notes: value.notes };
}

export const listSharedAssets = () => library.assets.orderBy('createdAt').reverse().toArray();
export const getSharedAsset = (id: string) => library.assets.get(id);
export const observeSharedAssets = (next: (rows: SharedAsset[]) => void, error: (error: unknown) => void) =>
  liveQuery(listSharedAssets).subscribe({ next, error });

async function requireAsset(id: string) {
  const asset = await library.assets.get(id);
  if (!asset) throw Error('资产不存在，请刷新资产库');
  return asset;
}

async function requireAppearance(asset: SharedAsset, appearanceId = asset.activeAppearanceId ?? legacyAppearanceId) {
  if (appearanceId === legacyAppearanceId) {
    if (await library.images.where('id').equals(asset.id).count()) return legacyAppearance(asset);
  } else {
    const appearance = await library.appearances.get(appearanceId);
    if (appearance?.assetId === asset.id) return appearance;
  }
  throw Error('指定造型不存在');
}

export async function getSharedAssetAppearance(assetId: string, appearanceId?: string) {
  return library.transaction('r', library.assets, library.appearances, library.images, async () =>
    requireAppearance(await requireAsset(assetId), appearanceId));
}

export async function listSharedAssetAppearances(assetId: string) {
  return library.transaction('r', library.assets, library.appearances, library.images, async () => {
    const asset = await requireAsset(assetId);
    const appearances = await library.appearances.where('[assetId+revision]')
      .between([assetId, Dexie.minKey], [assetId, Dexie.maxKey], true, true).reverse().toArray();
    if (await library.images.where('id').equals(assetId).count()) appearances.push(legacyAppearance(asset));
    return { asset, appearances };
  });
}

export async function getSharedAssetView(assetId: string, appearanceId?: string, viewId?: string) {
  return library.transaction('r', library.assets, library.appearances, library.images, async () => {
    const asset = await requireAsset(assetId);
    const appearance = await requireAppearance(asset, appearanceId);
    const view = viewId === undefined ? appearance.views[0] : appearance.views.find(item => item.id === viewId);
    if (!view) throw Error('指定视图不存在');
    return { asset, appearance, view };
  });
}

async function legacyImage(id: string) {
  const image = await library.images.get(id);
  if (!image) throw Error('资产图片不存在');
  return image.dataUrl;
}

/** Compatibility dataURL, with a bounded preview for active originals larger than 4 MiB. */
export async function sharedAssetImage(id: string) {
  const asset = await requireAsset(id);
  const mediaId = asset.activeMediaId ?? legacyMediaId(id);
  const legacyId = legacyAssetId(mediaId);
  if (legacyId !== undefined) return legacyImage(legacyId);
  const original = await getSharedAssetMedia(mediaId);
  return original.size <= compatBytes ? blobDataUrl(original) : getSharedAssetThumbnail(mediaId);
}

/** Fetches original bytes on demand, including when viewing a legacy default appearance. */
export async function getSharedAssetMedia(mediaId: string): Promise<Blob> {
  const oldId = legacyAssetId(mediaId);
  if (oldId !== undefined) return imageDataUrlBlob(await legacyImage(oldId), compatBytes);
  const media = await library.media.get(mediaId);
  if (!media) throw Error('视图原图不存在');
  return media.original;
}

function rawMedia(media: PreparedAssetMedia): AssetMedia {
  const { id, original, bytes, width, height } = media;
  return { id, original, bytes, width, height };
}

// Legacy rows acquire just a small thumbnail on first visible use. The original is never rewritten.
let legacyThumbnailQueue: Promise<unknown> = Promise.resolve();
export async function getSharedAssetThumbnail(mediaId: string): Promise<string> {
  const existing = await library.thumbnails.get(mediaId);
  if (existing) return existing.dataUrl;
  if (legacyAssetId(mediaId) === undefined) throw Error('视图缩略图不存在');
  const next = legacyThumbnailQueue.then(async () => {
    const stored = await library.thumbnails.get(mediaId);
    if (stored) return stored.dataUrl;
    const { thumbnail } = await prepareAssetMedia(await getSharedAssetMedia(mediaId));
    await library.thumbnails.put({ id: mediaId, dataUrl: thumbnail });
    return thumbnail;
  });
  legacyThumbnailQueue = next.catch(() => {});
  return next;
}

export const sharedAssetCoverId = (asset: SharedAsset) => asset.activeMediaId ?? legacyMediaId(asset.id);

async function prepareAppearance(input: AssetAppearanceInput) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw Error('造型名称需为 1—120 字');
  if (!input.views.length || input.views.length > 25) throw Error('每个造型需包含 1—25 张视图');
  const views: AssetView[] = [];
  const media = new Map<string, PreparedAssetMedia>();
  let bytes = 0;
  // Serial decoding bounds memory for a multi-view revision.
  for (const inputView of input.views) {
    const fields = validateAssetViewFields(inputView);
    let mediaId = inputView.mediaId;
    if (inputView.image !== undefined) {
      const prepared = await prepareAssetMedia(inputView.image);
      mediaId = prepared.id;
      if (!media.has(mediaId)) bytes += prepared.bytes;
      if (bytes > 128 * 1024 * 1024) throw Error('单次保存的视图原图合计最多 128 MiB');
      media.set(mediaId, prepared);
    }
    if (!mediaId || !mediaIdPattern.test(mediaId)) throw Error('视图媒体无效');
    views.push({ id: crypto.randomUUID(), mediaId, ...fields });
  }
  return { name, views, media };
}

async function writeAppearance(asset: SharedAsset, revision: number, prepared: Awaited<ReturnType<typeof prepareAppearance>>) {
  for (const view of prepared.views) {
    const oldId = legacyAssetId(view.mediaId);
    if (oldId !== undefined) {
      if (oldId !== asset.id || !await library.images.where('id').equals(oldId).count()) throw Error('旧资产原图不存在或不属于此资产');
    } else if (!await library.media.where('id').equals(view.mediaId).count()) {
      const media = prepared.media.get(view.mediaId);
      if (!media) throw Error('视图原图不存在');
      await library.media.add(rawMedia(media));
      await library.thumbnails.add({ id: media.id, dataUrl: media.thumbnail });
    }
  }
  const appearance = { id: crypto.randomUUID(), assetId: asset.id, revision, name: prepared.name, createdAt: Date.now(), views: prepared.views };
  await library.appearances.add(appearance);
  return appearance;
}

export interface AssetWriteOptions { assertCurrent?: () => void }

export async function createSharedAssetWithAppearance(value: {
  category: AssetCategory; name: string; notes?: string; appearance: AssetAppearanceInput;
}, options: AssetWriteOptions = {}) {
  const fields = validateFields({ ...value, notes: value.notes ?? '' });
  const prepared = await prepareAppearance(value.appearance);
  return library.transaction('rw', [library.assets, library.appearances, library.images, library.media, library.thumbnails], async () => {
    options.assertCurrent?.();
    const now = Date.now();
    const asset: SharedAsset = { ...fields, id: crypto.randomUUID(), version: 1, appearanceVersion: 1, createdAt: now, updatedAt: now };
    const appearance = await writeAppearance(asset, 1, prepared);
    asset.activeAppearanceId = appearance.id;
    asset.activeMediaId = appearance.views[0].mediaId;
    options.assertCurrent?.();
    await library.assets.add(asset);
    options.assertCurrent?.();
    return { asset, appearance };
  });
}

export async function createSharedAsset(value: { category: AssetCategory; name: string; notes?: string; image: string }) {
  const image = await imageDataUrlBlob(value.image, compatBytes);
  const { asset } = await createSharedAssetWithAppearance({
    category: value.category, name: value.name, notes: value.notes,
    appearance: { name: '默认造型', views: [{ name: '原图', purpose: 'reference', image }] },
  });
  return asset;
}

export async function updateSharedAsset(id: string, value: { category: AssetCategory; name: string; notes: string }, version: number) {
  const fields = validateFields(value);
  await library.transaction('rw', library.assets, async () => {
    const current = await requireAsset(id);
    if (current.version !== version) throw Error('资产资料已在其他窗口修改，请保留输入并重新打开');
    await library.assets.put({ ...current, ...fields, version: current.version + 1, updatedAt: Date.now() });
  });
}

function requireVersion(asset: SharedAsset, expectedAssetVersion: number, expectedAppearanceVersion: number) {
  if (asset.version !== expectedAssetVersion || (asset.appearanceVersion ?? 1) !== expectedAppearanceVersion) {
    throw Error('资产或当前造型已修改，请重新打开后确认');
  }
}

export async function createSharedAssetAppearance(assetId: string, input: AssetAppearanceInput,
  expectedAssetVersion: number, expectedAppearanceVersion: number, options: AssetWriteOptions = {}) {
  const prepared = await prepareAppearance(input);
  return library.transaction('rw', [library.assets, library.appearances, library.images, library.media, library.thumbnails], async () => {
    options.assertCurrent?.();
    const asset = await requireAsset(assetId);
    requireVersion(asset, expectedAssetVersion, expectedAppearanceVersion);
    const previous = await library.appearances.where('[assetId+revision]')
      .between([assetId, Dexie.minKey], [assetId, Dexie.maxKey], true, true).last();
    const appearance = await writeAppearance(asset, (previous?.revision ?? 1) + 1, prepared);
    const next = {
      ...asset, appearanceVersion: (asset.appearanceVersion ?? 1) + 1, updatedAt: Date.now(),
      activeAppearanceId: appearance.id, activeMediaId: appearance.views[0].mediaId,
    };
    options.assertCurrent?.();
    await library.assets.put(next);
    options.assertCurrent?.();
    return { asset: next, appearance };
  });
}

export async function setActiveSharedAssetAppearance(assetId: string, appearanceId: string,
  expectedAssetVersion: number, expectedAppearanceVersion: number) {
  return library.transaction('rw', [library.assets, library.appearances, library.images, library.media], async () => {
    const asset = await requireAsset(assetId);
    requireVersion(asset, expectedAssetVersion, expectedAppearanceVersion);
    const appearance = await requireAppearance(asset, appearanceId);
    for (const view of appearance.views) {
      const oldId = legacyAssetId(view.mediaId);
      const exists = oldId === undefined
        ? await library.media.where('id').equals(view.mediaId).count()
        : await library.images.where('id').equals(oldId).count();
      if (!exists) throw Error('造型视图原图缺失，无法切换');
    }
    if ((asset.activeAppearanceId ?? legacyAppearanceId) === appearance.id) return asset;
    const next = {
      ...asset, appearanceVersion: (asset.appearanceVersion ?? 1) + 1, updatedAt: Date.now(),
      activeAppearanceId: appearance.id, activeMediaId: appearance.views[0].mediaId,
    };
    await library.assets.put(next);
    return next;
  });
}

export { assetMediaLimits };

