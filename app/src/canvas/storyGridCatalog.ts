import { db, type EntityRow } from '../data/db';
import { listEntitySummaries } from '../data/entityCatalog';
import { getProjectAssetMedia, type AssetProjectContext } from '../assetLibrary/projectAssets';
import { getSharedAssetMedia, getSharedAssetView, listSharedAssets, listSharedAssetAppearances } from '../assetLibrary/store';
import { readAssetMedia } from '../assetLibrary/assetMedia';
import { shotAppearanceText } from '../scriptSetup/shotSetup';
import { sceneShots, storyScenes, type Shot } from '../storyboard/shotModel';
import { UNASSIGNED_SCENE } from '../script/sceneIdentity';
import type { ScriptBlock } from '../script/editor';
import {
  storyGridPageSize, type StoryGridAsset, type StoryGridCatalogQuery, type StoryGridImageInput, type StoryGridShotDetail,
} from '../../../vendor/lum/packages/nodeShared/src/storyGridSources';

export async function storyGridHash(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const metadata = (value: string, limit: number) => value.replaceAll('\0', '').trim().slice(0, limit);
const imageDataType = (value?: string) => /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(value?.slice(0, 80) ?? '')?.[1];
const sharedCategory = (category: string) => category === 'scene' ? 'location' : category === 'prop' ? 'prop' : 'character';
const projectAssetKey = (id: string) => 'project:' + encodeURIComponent(id);
const sharedAssetKey = (id: string, appearance: string, view: string) => 'shared:' + [id, appearance, view].map(encodeURIComponent).join(':');

async function describeProjectAsset(row: EntityRow): Promise<StoryGridAsset | undefined> {
  if (!row.assetSnapshot && !imageDataType(row.image)) return;
  const pin = row.assetSnapshot;
  const version = await storyGridHash(JSON.stringify([row.id, row.kind, row.name, pin ?? row.image]));
  const label = pin ? [row.name, pin.appearanceName, pin.view.name].join(' · ') : row.name;
  return { id: projectAssetKey(row.id), version, label: metadata(label, 450), category: row.kind, scope: 'project' };
}

type SharedView = Awaited<ReturnType<typeof getSharedAssetView>>;
function describeSharedView({asset, appearance, view}: SharedView): StoryGridAsset {
  return {
    id: sharedAssetKey(asset.id, appearance.id, view.id), version: [asset.version, appearance.revision, view.mediaId].join(':'),
    label: metadata([asset.name, appearance.name, view.name].join(' · '), 450),
    category: sharedCategory(asset.category), scope: 'shared',
  };
}

export async function readStoryGridAssets(query: StoryGridCatalogQuery) {
  const matches = (category: StoryGridAsset['category'], label: string) => (!query.category || category === query.category)
    && label.toLocaleLowerCase().includes(query.search);
  const assets: StoryGridAsset[] = [];
  if (query.scope === 'project') {
    const rows = (await listEntitySummaries()).filter(row => (row.imageMimeType || row.assetSnapshot)
      && matches(row.kind, [row.name, row.assetSnapshot?.appearanceName, row.assetSnapshot?.view.name].filter(Boolean).join(' ')));
    for (const row of rows.slice(query.offset, query.offset + storyGridPageSize)) {
      const current = await db.entities.get(row.id);
      const asset = current && await describeProjectAsset(current);
      if (asset) assets.push(asset);
    }
    return { assets, more: rows.length > query.offset + storyGridPageSize };
  }
  let skipped = 0;
  for (const asset of await listSharedAssets()) {
    const category = sharedCategory(asset.category);
    if (query.category && query.category !== category) continue;
    const versions = await listSharedAssetAppearances(asset.id);
    for (const appearance of versions.appearances) {
      for (const view of appearance.views) {
        const item = describeSharedView({ asset: versions.asset, appearance, view });
        if (!matches(category, item.label)) continue;
        if (skipped++ < query.offset) continue;
        if (assets.length === storyGridPageSize) return { assets, more: true };
        assets.push(item);
      }
    }
  }
  return { assets, more: false };
}

export async function resolveStoryGridAsset(id: string, context: AssetProjectContext, loadImage: boolean) {
  const [scope, ...parts] = id.split(':');
  const [assetId, appearanceId, viewId] = parts.map(decodeURIComponent);
  if (scope === 'project' && parts.length === 1) {
    const row = await context.database.entities.get(assetId);
    const asset = row && await describeProjectAsset(row);
    if (!row || !asset || asset.id !== id) throw new Error('项目资产已移除，请刷新并重新选择');
    const pin = row.assetSnapshot;
    const blob = !loadImage ? undefined : pin ? await getProjectAssetMedia(pin.view.mediaId, context) : await (await fetch(row.image!)).blob();
    const imageSource = pin && { assetId: pin.assetId, appearanceId: pin.appearanceId, revision: pin.appearanceVersion, viewId: pin.view.id, mediaId: pin.view.mediaId };
    return { asset, image: blob && storyGridImage(asset, blob, 'entity:' + row.id, imageSource) };
  }
  if (scope === 'shared' && parts.length === 3) {
    const current = await getSharedAssetView(assetId, appearanceId, viewId);
    const asset = describeSharedView(current);
    if (asset.id !== id) throw new Error('共用视图已变化，请刷新并重新选择');
    if (!loadImage) return { asset };
    const { appearance, view } = current;
    const blob = await getSharedAssetMedia(view.mediaId);
    // Project imports pin legacy views by content. Derive the same validated pin for the same saved view.
    const legacy = view.mediaId.startsWith('legacy:') ? await readAssetMedia(blob) : undefined;
    const imageSource = { assetId, appearanceId, revision: appearance.revision, viewId, mediaId: legacy?.id ?? view.mediaId };
    const key = ['assetView', assetId, appearanceId, appearance.revision, viewId].join(':');
    return { asset, image: storyGridImage(asset, legacy?.original ?? blob, key, imageSource) };
  }
  throw new Error('素材来源标识无效');
}
function storyGridImage(asset: StoryGridAsset, blob: Blob, legacyKey: string, imageSource?: StoryGridImageInput['imageSource']): StoryGridImageInput {
  const sourceKey = imageSource
    ? ['assetView', imageSource.assetId, imageSource.appearanceId, imageSource.revision, imageSource.viewId].join(':')
    : legacyKey + ':' + asset.version;
  return { id: asset.id, sourceKey, legacyKey, label: asset.label, category: asset.category as StoryGridImageInput['category'], blob, imageSource };
}

type ShotRow = Omit<StoryGridShotDetail, 'version'> & { sceneKey: string };
export async function readStoryGridShots(episodes?: ReadonlySet<string>) {
  return db.transaction('r', db.docs, async () => {
    const index = await db.docs.get('episode:ep_001');
    const chapters = (index?.payload as { chapters?: {episodeId: string; title: string}[] })?.chapters ?? [];
    const shots: ShotRow[] = [];
    const scenes: { id: string; label: string }[] = [];
    for (const [chapterIndex, chapter] of chapters.entries()) {
      if (episodes && !episodes.has(chapter.episodeId)) continue;
      const [script, board] = await db.docs.bulkGet(['script:' + chapter.episodeId, 'storyboard:' + chapter.episodeId]);
      const rows = Array.isArray(board?.payload) ? board.payload as Shot[] : [];
      const actualScenes = storyScenes(Array.isArray(script?.payload) ? script.payload as ScriptBlock[] : []);
      const sceneRows = [...actualScenes, { id: UNASSIGNED_SCENE, title: '未关联场次' }];
      for (const [sceneIndex, scene] of sceneRows.entries()) {
        const sceneKey = [chapter.episodeId, scene.id].map(encodeURIComponent).join(':');
        const sceneLabel = metadata([chapter.title, scene.title].filter(Boolean).join(' · '), 450);
        const group = sceneShots(rows, scene.id, actualScenes);
        if (group.length) scenes.push({ id: sceneKey, label: sceneLabel });
        for (const [index, shot] of group.entries()) {
          const order = chapterIndex * 100000000 + sceneIndex * 100000 + index;
          const label = metadata(shot.no && !/^(?:SHOT\s*)?\d+(?:-\d+)?$/i.test(shot.no.trim())
            ? shot.no : (scene.id === UNASSIGNED_SCENE ? '未关联' : String(sceneIndex + 1).padStart(2, '0')) + '-' + String(index + 1).padStart(2, '0'), 200);
          const id = 'shot:' + [chapter.episodeId, shot.id].map(encodeURIComponent).join(':');
          const text = [
            shot.desc, shot.staging && '场面调度：' + shot.staging, shot.notes && '备注：' + shot.notes,
            '景别 ' + shot.type + ' · 角度 ' + shot.angle + ' · 运镜 ' + shot.movement + ' · 焦段 ' + shot.lens,
            shot.duration && '时长 ' + shot.duration + ' 秒', shotAppearanceText(shot),
          ].filter(Boolean).join('\n');
          shots.push({ id, shotId: shot.id, order, label, scene: sceneLabel, sceneKey, summary: metadata(shot.desc ?? '', 240), text });
        }
      }
    }
    return { shots, scenes };
  });
}

export async function describeStoryGridShot({ sceneKey, text, ...shot }: ShotRow): Promise<StoryGridShotDetail> {
  const version = await storyGridHash(JSON.stringify([shot, sceneKey, text]));
  return { ...shot, version, text };
}
