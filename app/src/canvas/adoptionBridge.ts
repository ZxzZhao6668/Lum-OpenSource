import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
import { db, type DocRow } from '../data/db';
import { captureAssetProject, assertAssetProject } from '../assetLibrary/projectAssets';
import { listSharedAssets, createSharedAssetWithAppearance, createSharedAssetAppearance, addSharedAssetViewToProject } from '../assetLibrary/store';
import { assetCategories, validateAssetViewSource, type AssetCategory } from '../assetLibrary/assetSnapshot';
import { prepareAssetMedia } from '../assetLibrary/assetMedia';
import { storyScenes, type Shot } from '../storyboard/shotModel';
import type { ScriptBlock } from '../script/editor';

type Adoption = { directory: string; canvasPath: string; sourceFingerprint: string; cells: { cellId: string; name: string; candidateId: string; childNodeId: string; prompt: string }[] };
type CanvasContext = { directory: string; canvasPath: string; projectId: string };
type Destination = { id: string; label: string; expected: string } & (
  { kind: 'asset'; assetId: string; version: number; appearanceVersion: number } |
  { kind: 'new'; category: AssetCategory } |
  { kind: 'shot'; episodeId: string; sceneId: string; shotId?: string; board?: DocRow; script: DocRow; index: DocRow }
);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function installAdoptionBridge(getFrame: () => Window | null | undefined) {
  let disposed = false, epoch = 0, running = false;
  const sessions = new Map<string, { context: CanvasContext; epoch: number; expires: number; targets: Destination[] }>();
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function proof<T>(method: string, adoption?: Adoption): Promise<T> {
    const frame = getFrame();
    if (!frame) return Promise.reject(Error('画布未连接'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('采用来源核对超时，候选已保留')); }, 120000);
      pending.set(id, { resolve, reject, timer });
      frame.postMessage({ type: 'lum:adoptionProofRequest', id, method, adoption }, canvasOrigin);
    });
  }
  async function catalog(): Promise<Destination[]> {
    const targets: Destination[] = (await listSharedAssets()).map(asset => ({ id: crypto.randomUUID(), kind: 'asset', assetId: asset.id,
      version: asset.version, appearanceVersion: asset.appearanceVersion ?? 1, label: `共用库 · ${asset.name} · ${asset.id}`,
      expected: `资料 v${asset.version} / 造型令牌 ${asset.appearanceVersion ?? 1} → 新造型版本` }));
    for (const category of Object.keys(assetCategories) as AssetCategory[]) targets.push({ id: crypto.randomUUID(), kind: 'new', category, label: `明确新建共用${assetCategories[category]}`, expected: '新建独立资产，不按名称合并' });
    await db.transaction('r', db.docs, async () => {
      const index = await db.docs.get('episode:ep_001');
      for (const chapter of (index?.payload as { chapters?: { episodeId: string; title: string }[] })?.chapters ?? []) {
        const script = await db.docs.get(`script:${chapter.episodeId}`), board = await db.docs.get(`storyboard:${chapter.episodeId}`);
        if (!script || !Array.isArray(script.payload) || !index) continue;
        for (const scene of storyScenes(script.payload as ScriptBlock[])) {
          const base = { kind: 'shot' as const, episodeId: chapter.episodeId, sceneId: scene.id, board, script, index,
            expected: `分镜文档 ${board?.updatedAt ?? 0} / 剧本 ${script.updatedAt}` };
          targets.push({ ...base, id: crypto.randomUUID(), label: `${chapter.title} · ${scene.title} → 新建镜头` });
          for (const shot of (Array.isArray(board?.payload) ? board.payload as Shot[] : []).filter(shot => shot.sceneId === scene.id)) {
            targets.push({ ...base, id: crypto.randomUUID(), shotId: shot.id, label: `${chapter.title} · ${scene.title} · ${shot.no} (${shot.id}) → 替换图片` });
          }
        }
      }
    });
    return targets;
  }
  const receive = (event: MessageEvent) => {
    if (event.origin !== canvasOrigin || event.source !== getFrame()) return;
    const message = event.data;
    if (lumBridgeType(message?.type) === 'lum:adoptionContextChanged') { epoch++; sessions.clear(); return; }
    if (lumBridgeType(message?.type) === 'lum:adoptionProofResponse') {
      const entry = pending.get(message.id); if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(Error(String(message.error))); else entry.resolve(message.result); return;
    }
    if (lumBridgeType(message?.type) !== 'lum:adoptionRequest' || typeof message.id !== 'string' || !/^[\w-]{1,100}$/.test(message.id)) return;
    const frame = getFrame();
    const reply = (value: object) => { if (!disposed && frame === getFrame()) frame?.postMessage({ type: 'lum:adoptionResponse', id: message.id, ...value }, canvasOrigin); };
    if (running) { reply({ error: '已有采用操作正在执行，请等待真实回执' }); return; }
    running = true;
    void (async () => {
      const receipts: object[] = [];
      try {
        const project = captureAssetProject(), startEpoch = epoch;
        const check = () => { assertAssetProject(project); if (disposed || frame !== getFrame() || epoch !== startEpoch) throw Error('项目或画布已切换，未继续采用'); };
        check();
        if (message.method === 'catalog') {
          const context = await proof<CanvasContext>('context'); check();
          if (context.projectId !== (project.projectId === 'legacy' ? 'localProject' : project.projectId)
            || context.directory !== message.directory || context.canvasPath !== message.canvasPath) throw Error('来源不属于当前项目画布');
          const targets = await catalog(); check();
          const token = crypto.randomUUID();
          for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
          if (sessions.size >= 10) sessions.delete(sessions.keys().next().value!);
          sessions.set(token, { context, epoch, expires: Date.now() + 600000, targets });
          reply({ result: { token, projectId: project.projectId, targets: targets.map(({ id, label, expected, kind }) => ({ id, label, expected, kind })) } }); return;
        }
        const session = sessions.get(message.token);
        if (message.method !== 'adopt' || !session || session.epoch !== epoch || session.expires < Date.now()) throw Error('采用目标预览已过期，请重新读取');
        const adoption = message.adoption as Adoption;
        if (!adoption || adoption.directory !== session.context.directory || adoption.canvasPath !== session.context.canvasPath) throw Error('采用画布绑定不一致');
        const choices = message.choices as { cellId: string; targetId: string; name: string; importProject?: boolean; appearanceName: string }[];
        if (!Array.isArray(choices) || !choices.length || choices.length > 100 || choices.length !== adoption.cells?.length
          || new Set(choices.map(choice => choice.cellId)).size !== choices.length) throw Error('采用格位列表无效');
        const selections = choices.map(choice => {
          const target = session.targets.find(target => target.id === choice.targetId), cell = adoption.cells.find(cell => cell.cellId === choice.cellId);
          if (!target || !cell || typeof choice.name !== 'string' || !choice.name.trim() || choice.name.length > 120 || (target.kind !== 'shot' && (typeof choice.appearanceName !== 'string' || !choice.appearanceName.trim() || choice.appearanceName.length > 120))) throw Error('请逐格确认真实目标及版本名称');
          validateAssetViewSource({ projectId: project.projectId, canvasId: adoption.canvasPath, candidateId: cell.candidateId, taskId: cell.candidateId, cellId: cell.cellId, fingerprint: adoption.sourceFingerprint });
          return { choice, target, cell };
        });
        const existingShots = selections.filter(item => item.target.kind === 'shot' && item.target.shotId).map(item => item.target.id);
        if (new Set(existingShots).size !== existingShots.length) throw Error('同一镜头一次只能替换一格，请分别确认');
        const assetGroups = new Map<string, typeof selections>();
        for (const item of selections.filter(item => item.target.kind !== 'shot')) {
          const group = assetGroups.get(item.target.id) ?? []; group.push(item); assetGroups.set(item.target.id, group);
        }
        for (const group of assetGroups.values()) {
          if (group.length > 25) throw Error('同一造型最多25个视图，请明确分批采用');
          if (group.some(item => item.choice.appearanceName !== group[0].choice.appearanceName || item.choice.importProject !== group[0].choice.importProject)) throw Error('同一资产的多格将保存为同一造型，请统一造型名称及项目导入选择');
        }
        sessions.delete(message.token);
        const verified = await proof<CanvasContext & { media: { cellId: string; blob: Blob }[] }>('verify', adoption); check();
        if (!equal({ directory: verified.directory, canvasPath: verified.canvasPath, projectId: verified.projectId }, session.context)) throw Error('来源项目或画布已变化');
        const prepared = new Map<string, Awaited<ReturnType<typeof prepareAssetMedia>>>();
        for (const { cell } of selections) {
          const image = verified.media.find(item => item.cellId === cell.cellId)?.blob;
          if (!(image instanceof Blob)) throw Error('缺少核对后的原图');
          prepared.set(cell.cellId, await prepareAssetMedia(image)); check();
        }
        await proof('check', adoption); check();
        // Shot rows sharing a document commit together against the exact preview snapshot.
        const shots = selections.filter(item => item.target.kind === 'shot');
        const shotReceipts: object[] = [];
        if (shots.length) await db.transaction('rw', db.docs, db.assetMedia, async () => {
          check(); const boards = new Map<string, Shot[]>();
          for (const { target } of shots) {
            if (target.kind !== 'shot') continue;
            const key = `storyboard:${target.episodeId}`;
            if (!equal(await db.docs.get(key), target.board) || !equal(await db.docs.get(target.script.key), target.script)
              || !equal(await db.docs.get(target.index.key), target.index)) throw Error('分镜、场次或剧集已修改，请重新预览目标');
            if (!boards.has(key)) boards.set(key, structuredClone((target.board?.payload ?? []) as Shot[]));
          }
          for (const { target, choice, cell } of shots) {
            if (target.kind !== 'shot') continue;
            const media = prepared.get(cell.cellId)!, board = boards.get(`storyboard:${target.episodeId}`)!;
            let shot = target.shotId ? board.find(shot => shot.id === target.shotId) : undefined;
            if (target.shotId && (!shot || shot.sceneId !== target.sceneId)) throw Error('目标镜头已变化');
            if (!shot) { shot = { id: crypto.randomUUID(), no: choice.name, type: '', angle: '', movement: '', lens: '', desc: cell.prompt, x: 0, y: 0, sceneId: target.sceneId }; board.push(shot); }
            if (shot.image || shot.mediaPin) (shot.mediaHistory ??= []).push({ image: shot.image, pin: shot.mediaPin });
            shotReceipts.push({cellId:cell.cellId,destination:target.label,saved:true,shotId:shot.id,episodeId:target.episodeId,sceneId:target.sceneId,mediaId:media.id});
            shot.image = media.thumbnail;
            shot.mediaPin = { mediaId: media.id, source: { projectId: project.projectId, canvasId: adoption.canvasPath, candidateId: cell.candidateId, taskId: cell.candidateId, cellId: cell.cellId, fingerprint: adoption.sourceFingerprint }, prompt: cell.prompt, adoptedAt: Date.now(), candidateId: cell.candidateId };
            if (!await db.assetMedia.get(media.id)) { const { thumbnail: _thumbnail, ...original } = media; await db.assetMedia.add(original); }
          }
          for (const [key, payload] of boards) await db.docs.put({ key, payload, updatedAt: Date.now() });
          check();
        });
        receipts.push(...shotReceipts);
        for (const group of assetGroups.values()) {
          const { target, choice } = group[0]; check(); if (target.kind === 'shot') continue;
          const appearance = { name: choice.appearanceName.trim(), views: group.map(({ choice, cell }) => ({ name: choice.name.trim(), purpose: 'reference' as const, image: prepared.get(cell.cellId)!.original,
            source: { projectId: project.projectId, canvasId: adoption.canvasPath, candidateId: cell.candidateId, taskId: cell.candidateId, cellId: cell.cellId, fingerprint: adoption.sourceFingerprint } })) };
          const saved = target.kind === 'new' ? await createSharedAssetWithAppearance({ category: target.category, name: choice.appearanceName.trim(), appearance }, { assertCurrent: check })
            : await createSharedAssetAppearance(target.assetId, appearance, target.version, target.appearanceVersion, { assertCurrent: check });
          const groupReceipts = group.map(({ cell }, index) => ({ cellId: cell.cellId, destination: target.label, saved: true, assetId: saved.asset.id, appearanceId: saved.appearance.id,
            revision: saved.appearance.revision, viewId: saved.appearance.views[index].id, mediaId: saved.appearance.views[index].mediaId, entityId: undefined as string | undefined }));
          receipts.push(...groupReceipts); check();
          // An optional project import chooses the first view explicitly shown in the group order.
          if (choice.importProject === true) groupReceipts[0].entityId = (await addSharedAssetViewToProject({ assetId: saved.asset.id, appearanceId: saved.appearance.id, viewId: saved.appearance.views[0].id }, { context: project, assertCurrent: check })).entityId;
        }
        window.dispatchEvent(new CustomEvent('dsh:content-updated', { detail: { kind: 'storyboard' } }));
        reply({ result: { receipts } });
      } catch (error) { reply({ result: { receipts, error: error instanceof Error ? error.message : String(error) } }); }
      finally { running = false; }
    })();
  };
  window.addEventListener('message', receive);
  return () => { disposed = true; sessions.clear(); window.removeEventListener('message', receive); for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('画布已关闭')); } pending.clear(); };
}
