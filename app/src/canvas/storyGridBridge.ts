import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
import { assertAssetProject, captureAssetProject } from '../assetLibrary/projectAssets';
import { requestProduction } from './productionBridge';
import { describeStoryGridShot, readStoryGridAssets, readStoryGridShots, resolveStoryGridAsset } from './storyGridCatalog';
import {
  storyGridBatchBytes, storyGridImageBytes, storyGridImageLimit, storyGridPageSize,
  type StoryGridAsset, type StoryGridCatalog, type StoryGridCatalogQuery, type StoryGridContext, type StoryGridImageInput,
  type StoryGridImageReceipt, type StoryGridPrepared, type StoryGridShot,
} from '../../../vendor/lum/packages/nodeShared/src/storyGridSources';

type CanvasProof = StoryGridContext & { session: string; projectId: string; target?: string };
const bounded = (value: unknown, size: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= size && !value.includes('\0');

function selectedIds(value: unknown, max: number, pattern: RegExp): Pick<StoryGridAsset, 'id' | 'version'>[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('所选剧情素材或分镜数量无效');
  const ids = new Set<string>();
  for (const item of value) {
    if (!bounded(item?.id, 1200) || !pattern.test(item.id) || !bounded(item.version, 180) || ids.has(item.id)) throw new Error('所选素材标识或版本无效');
    ids.add(item.id);
  }
  return value.map(({ id, version }) => ({ id, version }));
}

function catalogQuery(value: StoryGridCatalogQuery): StoryGridCatalogQuery {
  if (!value || !['project', 'shared', 'shots'].includes(value.scope) || typeof value.search !== 'string' || value.search.length > 120
    || !Number.isSafeInteger(value.offset) || value.offset < 0
    || (value.category && !['character', 'location', 'prop'].includes(value.category)) || (value.scene && !bounded(value.scene, 1200))) throw new Error('剧情素材筛选条件无效');
  return { ...value, search: value.search.toLocaleLowerCase().trim() };
}

export function installStoryGridBridge(getFrame: () => HTMLIFrameElement | null) {
  let disposed = false;
  let importing = false;
  const receive = (event: MessageEvent) => {
    const frame = getFrame();
    const message = event.data;
    const target = frame?.contentWindow;
    if (!frame || !target || event.source !== target || event.origin !== canvasOrigin || lumBridgeType(message?.type) !== 'lum:storyGridSourcesRequest'
      || !bounded(message.id, 100) || !['catalog', 'prepare', 'validate'].includes(message.method)) return;
    const reply = (payload: { result?: StoryGridCatalog | StoryGridPrepared; error?: string }) => {
      if (!disposed && frame === getFrame() && target === frame.contentWindow) target.postMessage({ type: 'lum:storyGridSourcesResponse', id: message.id, ...payload }, canvasOrigin);
    };
    const prepare = message.method === 'prepare';
    if (prepare && importing) { reply({ error: '已有剧情素材正在导入，请等待读取回执' }); return; }
    if (prepare) importing = true;
    void (async () => {
      const project = captureAssetProject();
      const context = message.context as StoryGridContext | undefined;
      const projectId = project.projectId === 'legacy' ? 'localProject' : project.projectId.toLowerCase();
      if (message.projectId !== projectId || !bounded(context?.directory, 4096) || !bounded(context?.canvasPath, 4096)) throw new Error('剧情素材来源不属于当前项目画布');
      const check = () => {
        assertAssetProject(project);
        if (disposed || frame !== getFrame() || !frame.isConnected || frame.contentWindow !== target) throw new Error('项目或画布已切换');
      };
      async function proof(bindImport = false) {
        check();
        const binding = await requestProduction<CanvasProof>(frame!, 'storyContext', { context, projectId, bindImport });
        check();
        if (binding.projectId !== projectId || binding.directory !== context!.directory || binding.canvasPath !== context!.canvasPath
          || !bounded(binding.session, 100) || (bindImport && !bounded(binding.target, 100))) throw new Error('剧情素材来源与当前画布不一致');
        return binding;
      }
      const initial = await proof();
      const checkCanvas = async (bindImport = false) => {
        const current = await proof(bindImport);
        if (initial.session !== current.session || (message.session !== undefined && message.session !== current.session)) {
          throw new Error('剧情画布已变化，请在当前画布重新选择或规划');
        }
        return current;
      };
      if (message.method === 'catalog') {
        const query = catalogQuery(message.query);
        let assets: StoryGridAsset[] = [], shots: StoryGridShot[] = [], scenes: StoryGridCatalog['scenes'] = [], more = false;
        if (query.scope === 'shots') {
          const result = await readStoryGridShots();
          scenes = result.scenes;
          const matches = result.shots.filter(item => (!query.scene || item.sceneKey === query.scene)
            && [item.label, item.scene, item.summary].join(' ').toLocaleLowerCase().includes(query.search));
          more = matches.length > query.offset + storyGridPageSize;
          shots = await Promise.all(matches.slice(query.offset, query.offset + storyGridPageSize).map(async row => {
            const { text: _text, ...shot } = await describeStoryGridShot(row);
            return shot;
          }));
        } else {
          ({ assets, more } = await readStoryGridAssets(query));
        }
        await checkCanvas();
        reply({ result: { projectId, assets, shots, scenes, more } });
        return;
      }
      const assets = selectedIds(message.assets, storyGridImageLimit - 1, /^(project|shared):/);
      const shots = selectedIds(message.shots, 100, /^shot:/);
      const resolveShots = async () => {
        const episodes = new Set(shots.map(item => decodeURIComponent(item.id.split(':')[1] ?? '')));
        const rows = shots.length ? (await readStoryGridShots(episodes)).shots : [];
        const byId = new Map(rows.map(row => [row.id, row]));
        const selected = await Promise.all(shots.map(async item => {
          const row = byId.get(item.id);
          if (!row) throw new Error('所选分镜已移除，请刷新并重新选择');
          const shot = await describeStoryGridShot(row);
          if (shot.version !== item.version) throw new Error('所选分镜已修改，请刷新并重新选择');
          return shot;
        }));
        return selected.sort((left, right) => left.order - right.order);
      };
      const selectedShots = await resolveShots();
      check();
      if (selectedShots.reduce((length, item) => length + item.text.length, 0) > 40000) throw new Error('所选分镜文字超过 4 万字，请减少所选镜头');
      const imageInputs: StoryGridImageInput[] = [];
      let totalBytes = 0;
      for (const item of assets) {
        const { asset, image } = await resolveStoryGridAsset(item.id, project, prepare);
        check();
        if (asset.version !== item.version) throw new Error('「' + asset.label + '」的版本已变化，请刷新并重新选择');
        if (!prepare) continue;
        if (!image || !image.blob.size || image.blob.size > storyGridImageBytes) throw new Error('「' + asset.label + '」的原图无效或超过 32 MiB');
        totalBytes += image.blob.size;
        if (totalBytes > storyGridBatchBytes) throw new Error('所选原图超过 64 MiB，请减少所选素材');
        imageInputs.push(image);
      }
      const binding = await checkCanvas(!!imageInputs.length);
      let images: StoryGridImageReceipt[] = [];
      if (imageInputs.length) {
        const receipt = await requestProduction<{ images: StoryGridImageReceipt[] }>(frame, 'storyImport', { target: binding.target, images: imageInputs });
        check();
        images = receipt.images;
        if (!Array.isArray(images) || images.length !== imageInputs.length || images.some((image, index) => image.id !== imageInputs[index].id)) {
          throw new Error('图片导入回执不完整。已导入的节点保留，再次导入时会按来源复用');
        }
        await checkCanvas();
        for (const item of assets) {
          const { asset } = await resolveStoryGridAsset(item.id, project, false);
          check();
          if (asset.version !== item.version) throw new Error('所选原图在导入期间发生变化，请刷新并重新选择。已导入的旧版本图片仍在画布');
        }
        await resolveShots();
        await checkCanvas();
      }
      reply({ result: { session: binding.session, shots: selectedShots, images } });
    })().catch(error => reply({ error: error instanceof Error ? error.message : String(error) }))
      .finally(() => { if (prepare) importing = false; });
  };
  window.addEventListener('message', receive);
  return () => { disposed = true; window.removeEventListener('message', receive); };
}
