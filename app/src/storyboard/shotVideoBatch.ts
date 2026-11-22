import { shotAppearanceText, shotStyleLabel, shotStyleText } from '../scriptSetup/shotSetup';
import {db, loadDoc, saveDoc} from '../data/db';
import Dexie from 'dexie';
import type {WritingSkill} from '../skills/skillStore';
import {textFingerprint as digest, videoContentFingerprint, legacyBatchMatches} from './shotVideoFingerprint';
import {loadProductionCatalog, loadProductionClips, createProductionClip, updateProductionClip, resolveProductionClip, type ProductionCatalog} from '../canvas/productionClips';
import {sendProductionMaterials} from '../canvas/productionBridge';

export interface VideoSettings {skill: WritingSkill; style?: WritingSkill; extra: string}
export const videoStyleOverride = (style?: WritingSkill) => style ? [style.name, style.description].filter(Boolean).join('；').slice(0,2000) : '';
export async function shotVideoSource(catalog: ProductionCatalog, episodeId: string, shotId: string, settings: VideoSettings) {
  const chapter = catalog.chapters.find(c => c.episodeId === episodeId);
  const shot = chapter?.shots.find(s => s.id === shotId);
  const scene = chapter?.scenes.find(s => s.shotIds.includes(shotId));
  if (chapter?.unavailable || !shot || !scene) throw Error('分镜已删除或场次已变化，请重新打开视频制作');
  const assets = new Set(shot.entityIds ?? []);
  const materials = catalog.materials.filter(m => m.key === `shot:${episodeId}:${shotId}` || m.kind === 'entity' && assets.has(m.key.slice(7)));
  // Hash image bytes once per shared reference, never serialize them per shot or into saved batch records.
  const contentSignature = await videoContentFingerprint(shot, scene.id, materials);
  return withVideoSettings({shot, scene, materials, contentSignature}, settings);
}
export function withVideoSettings(source: Pick<VideoSource, 'shot' | 'scene' | 'materials' | 'contentSignature'>, settings: VideoSettings): VideoSource {
  const {shot, contentSignature} = source;
  const signature = JSON.stringify({contentSignature, settings});
  const style = videoStyleOverride(settings.style) || shotStyleText(shot.setupSnapshot);
  const styleLabel = settings.style ? `本次覆盖 · ${settings.style.name}` : shotStyleLabel(shot.setupSnapshot);
  const appearance = shotAppearanceText(shot);
  const original = [`镜头 ${shot.no} · ${shot.duration ?? 5} 秒\n景别 ${shot.type}；角度 ${shot.angle}；运镜 ${shot.movement}；焦段 ${shot.lens}`, shot.desc, shot.staging ? `调度：${shot.staging}` : '', shot.notes ? `备注：${shot.notes}` : '', style ? `视频风格：${style}` : '', appearance ? `仅对本镜已引用且可见的人物应用造型：\n${appearance}` : '', settings.extra ? `补充要求：${settings.extra}` : ''].filter(Boolean).join('\n\n');
  return {...source, signature, original, styleLabel};
}
export interface VideoSource {
  shot: ProductionCatalog['chapters'][number]['shots'][number];
  scene: ProductionCatalog['chapters'][number]['scenes'][number];
  materials: ProductionCatalog['materials'];
  contentSignature: string; signature: string; original: string; styleLabel: string;
}
export interface VideoDraft {source: VideoSource; prompt: string}

/** Each shot remains a separate clip; a batch owns one canvas and can be safely retried. */
export async function sendShotVideoBatch(episodeId: string, drafts: VideoDraft[], settings: VideoSettings, alive: () => boolean, progress: (index: number, message: string) => void) {
  if (!drafts.length) throw Error('请先选择分镜');
  for (const draft of drafts) if (!draft.prompt.trim() || draft.prompt.length > 10000) throw Error(`镜头 ${draft.source.shot.no} 的提示词需为 1—10000 个字`);
  const ids = drafts.map(d => d.source.shot.id);
  const mapKey = `video:batch:${episodeId}:${await digest(JSON.stringify(ids))}`;
  const signature = await digest(JSON.stringify(drafts.map(d => [d.source.signature, d.prompt])));
  const clips = await db.transaction('rw', db.docs, db.entities, async () => {
    if (!alive()) throw Error('操作已停止');
    const catalog = await loadProductionCatalog(episodeId);
    // WebCrypto runs outside IndexedDB; keep this validation/write transaction alive and atomic.
    await Dexie.waitFor((async () => {
      for (const draft of drafts) if ((await shotVideoSource(catalog, episodeId, draft.source.shot.id, settings)).signature !== draft.source.signature) throw Error('分镜或素材已变化，请重新打开视频制作');
    })());
    const previous = await loadDoc<{signature: string; ids: string[]}>(mapKey);
    const stored = await loadProductionClips();
    const matches = previous && (previous.signature === signature || await Dexie.waitFor(legacyBatchMatches(previous.signature, drafts)));
    if (!alive()) throw Error('操作已停止');
    const found = matches ? previous.ids.map(id => stored.find(c => c.id === id)) : [];
    if (found.length === drafts.length && found.every((clip, i) => clip && clip.episodeId === episodeId && clip.sceneId === drafts[i].source.scene.id && clip.shotIds.length === 1 && clip.shotIds[0] === ids[i] && clip.extraPrompt === drafts[i].prompt && clip.style === videoStyleOverride(settings.style) && (!drafts[i].source.shot.setupSnapshot || clip.setupSnapshots?.[0]?.visual?.setupVersionId === drafts[i].source.shot.setupSnapshot?.visual?.setupVersionId) && clip.batchId === found[0]?.batchId)) {
      if (previous!.signature !== signature) await saveDoc(mapKey, {signature, ids: previous!.ids});
      return found.map(c => c!);
    }
    const batchId = drafts.length > 1 ? crypto.randomUUID() : undefined;
    const created = [];
    for (const draft of drafts) {
      const clip = await createProductionClip(episodeId, draft.source.scene.id);
      created.push(await updateProductionClip(clip.id, {title: `镜头 ${draft.source.shot.no} · 视频制作`, shotIds: [draft.source.shot.id], extraPrompt: draft.prompt, style: videoStyleOverride(settings.style), setupSnapshots: draft.source.shot.setupSnapshot ? [draft.source.shot.setupSnapshot] : [], batchId}));
    }
    await saveDoc(mapKey, {signature, ids: created.map(c => c.id)});
    return created;
  });
  window.dispatchEvent(new CustomEvent('dsh:nav', {detail: 'canvas'}));
  const ready = () => document.querySelector('.dsh-lum-workspace:not([hidden])[data-connection="ready"]');
  const deadline = Date.now() + 20000;
  while (!ready() && Date.now() < deadline && alive()) await new Promise(resolve => setTimeout(resolve, 150));
  if (!alive()) throw Error('操作已停止；已准备的分镜胶卷保留');
  if (!ready()) throw Error('画布尚未连接，胶卷已保留，请稍后重试');
  let canvasId = clips.find(c => c.canvasId)?.canvasId, completed = 0;
  const warnings = new Set<string>(), failures: string[] = [];
  for (const [i, initial] of clips.entries()) {
    if (!alive()) break;
    try {
      progress(i, '正在创建画布节点…');
      const catalog = await loadProductionCatalog(episodeId);
      if ((await shotVideoSource(catalog, episodeId, drafts[i].source.shot.id, settings)).signature !== drafts[i].source.signature) throw Error('原分镜已变化，请重新打开视频制作');
      const resolved = resolveProductionClip(initial, catalog);
      if (resolved.warnings.length) throw Error(resolved.warnings.join('；'));
      const result = await sendProductionMaterials(resolved.materials, {
        clip: {id: initial.id, batchId: initial.batchId, canvasId: canvasId ?? initial.canvasId},
        duration: resolved.duration, mode: 'video', continuity: resolved.continuity, setupSnapshots: resolved.setupSnapshots, styleOverride: initial.style,
        onBound: async bound => {
          canvasId = bound;
          await updateProductionClip(initial.id, {canvasId: bound});
        },
      });
      if (result.conflicts.length) warnings.add('部分节点有手工修改，已保留，请在画布核对。');
      if (result.warnings?.some(w => w.includes('手工调整'))) warnings.add('部分参考连线有手工调整，已保留，请在画布核对资产引用。');
      if (result.warnings?.some(w => w.includes('尚无分镜图'))) warnings.add('部分分镜暂无图片，可在画布使用文生视频，或补图后同步。');
      completed++;
      progress(i, result.conflicts.length ? '已送入画布 · 保留手工修改' : '已送入画布');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`镜头 ${drafts[i].source.shot.no}：${message}`);
      progress(i, `未完成：${message}`);
      // A failed or timed-out receipt is ambiguous. Keep saved work, stop, and let the user retry.
      break;
    }
  }
  return {completed, total: drafts.length, warnings: [...warnings], failures};
}
