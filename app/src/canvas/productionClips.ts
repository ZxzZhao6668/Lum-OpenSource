import { shotAppearanceText, type ShotSetupSnapshot } from '../scriptSetup/shotSetup';
import { db, loadDoc, saveDoc } from '../data/db';
import type { ScriptBlock } from '../script/editor';
import { storyScenes, type Shot } from '../storyboard/shotModel';
import { collectProductionMaterials, readProductionSnapshot, type ProductionMaterial } from './productionMaterials';

export interface ProductionClip {
  id: string;
  episodeId: string;
  sceneId: string;
  title: string;
  shotIds: string[];
  assetIds: string[];
  extraPrompt: string;
  style: string;
  canvasId?: string;
  batchId?: string;
  setupSnapshots?: readonly ShotSetupSnapshot[];
  updatedAt: number;
}
export interface ProductionScene { id: string; title: string; text: string; shotIds: string[]; assetIds: string[] }
export interface ProductionChapter { episodeId: string; title: string; text: string; unavailable?: boolean; scenes: ProductionScene[]; shots: Shot[] }
export interface ProductionCatalog { chapters: ProductionChapter[]; materials: ProductionMaterial[] }
export interface VideoContinuity {
  episodeId: string; sceneId: string; shotIds: string[];
  previous?: {shotId: string; sceneId: string; label: string; text: string};
  next?: {shotId: string; sceneId: string; label: string; text: string};
}
const storageKey = 'production:clips';

export async function loadProductionCatalog(episodeId?: string): Promise<ProductionCatalog> {
  return db.transaction('r', db.docs, db.entities, async () => {
    const snapshot = await readProductionSnapshot(episodeId);
    const materials = await collectProductionMaterials(snapshot);
    const {docs} = snapshot;
    const index = docs.get('episode:ep_001') as { chapters?: { episodeId: string; title: string }[]; archived?: { episodeId: string; title: string }[] } | undefined;
    const entries: {episodeId: string; title: string; unavailable?: boolean}[] = [...(index?.chapters ?? [])];
    const stored = docs.get(storageKey) as {clips?: ProductionClip[]} | undefined;
    for (const clip of stored?.clips ?? []) if (!entries.some(entry => entry.episodeId === clip.episodeId)) {
      entries.push({ episodeId: clip.episodeId, title: index?.archived?.find(entry => entry.episodeId === clip.episodeId)?.title ?? '原章节已移除', unavailable: true });
    }
    const chapters = entries.filter(chapter => !episodeId || chapter.episodeId === episodeId).map(chapter => {
      const blocks = (docs.get(`script:${chapter.episodeId}`) ?? []) as ScriptBlock[];
      const shots = (docs.get(`storyboard:${chapter.episodeId}`) ?? []) as Shot[];
      const links = (docs.get(`entities:links:${chapter.episodeId}`) ?? {}) as Record<string, string[]>;
      const text = blocks.map(block => block.text).join('\n');
      const scenes: ProductionScene[] = storyScenes(blocks).map(scene => ({
        id: scene.id, title: scene.title, text: scene.blocks.map(block => block.text).join('\n'),
        shotIds: shots.filter(shot => shot.sceneId === scene.id).map(shot => shot.id),
        assetIds: [...new Set(scene.blocks.flatMap(block => links[block.id] ?? []))],
      }));
      const unassigned = shots.filter(shot => !scenes.some(scene => scene.id === shot.sceneId));
      if (unassigned.length) scenes.push({ id: 'unassigned', title: '未分场镜头', text, shotIds: unassigned.map(shot => shot.id), assetIds: [] });
      return { ...chapter, text, scenes, shots };
    });
    return { chapters, materials };
  });
}

export async function loadProductionClips(): Promise<ProductionClip[]> {
  return (await loadDoc<{ clips: ProductionClip[] }>(storageKey))?.clips ?? [];
}

export async function createProductionClip(episodeId: string, sceneId: string): Promise<ProductionClip> {
  return db.transaction('rw', db.docs, db.entities, async () => {
    const catalog = await loadProductionCatalog(episodeId);
    const chapter = catalog.chapters.find(chapter => chapter.episodeId === episodeId);
    if (chapter?.unavailable || !chapter?.scenes.some(scene => scene.id === sceneId)) throw Error('章节已归档或场次已变更，请刷新分镜页');
    const clips = await loadProductionClips();
    const number = clips.filter(item => item.episodeId === episodeId && item.sceneId === sceneId).length + 1;
    const clip: ProductionClip = { id: crypto.randomUUID(), episodeId, sceneId, title: `胶卷 ${number}`, shotIds: [], assetIds: [], extraPrompt: '', style: '', updatedAt: Date.now() };
    await saveDoc(storageKey, { clips: [...clips, clip] });
    return clip;
  });
}

type ClipPatch = Partial<Pick<ProductionClip, 'title' | 'shotIds' | 'assetIds' | 'extraPrompt' | 'style' | 'canvasId' | 'batchId' | 'setupSnapshots'>>;
export async function updateProductionClip(id: string, patch: ClipPatch): Promise<ProductionClip> {
  return db.transaction('rw', db.docs, async () => {
    const clips = await loadProductionClips();
    const index = clips.findIndex(clip => clip.id === id);
    if (index < 0) throw Error('胶卷不存在，请刷新');
    const next = { ...clips[index], ...patch, id, updatedAt: Date.now() };
    next.title = next.title.trim();
    if (!next.title || next.title.length > 120) throw Error('胶卷名称需为 1—120 个字');
    if (next.extraPrompt.length > 10000 || next.style.length > 2000) throw Error('提示词过长，请精简后保存');
    next.shotIds = [...new Set(next.shotIds)];
    next.assetIds = [...new Set(next.assetIds)];
    if (next.setupSnapshots && patch.shotIds) next.setupSnapshots = next.setupSnapshots.filter(s => next.shotIds.includes(s.shotId));
    clips[index] = next;
    await saveDoc(storageKey, { clips });
    return next;
  });
}

export function resolveProductionClip(clip: ProductionClip, catalog: ProductionCatalog) {
  const chapter = catalog.chapters.find(item => item.episodeId === clip.episodeId);
  const scene = chapter?.scenes.find(item => item.id === clip.sceneId);
  const warnings: string[] = [];
  if (!chapter || chapter.unavailable || !scene) warnings.push('原章节已归档或场次已变更，请回到剧本核对；已制作的画布仍然保留。');
  const shots = clip.shotIds.flatMap(id => {
    const shot = chapter?.shots.find(item => item.id === id);
    if (!shot || !scene?.shotIds.includes(id)) { warnings.push(`镜头 ${shot?.no ?? id} 已删除或移到其他场次，请重新选择。`); return []; }
    return [shot];
  });
  const keys = new Set(shots.map(shot => `shot:${clip.episodeId}:${shot.id}`));
  const assetIds = new Set([...clip.assetIds, ...shots.flatMap(shot => shot.entityIds ?? [])]);
  for (const id of assetIds) {
    if (catalog.materials.some(material => material.key === `entity:${id}`)) keys.add(`entity:${id}`);
    else warnings.push(`引用资产 ${id} 已不存在，请核对资产关联。`);
  }
  const materials = [...keys].flatMap(key => { const material = catalog.materials.find(item => item.key === key); return material ? [material] : []; });
  const setupSnapshots = clip.setupSnapshots ?? shots.flatMap(shot => shot.setupSnapshot ? [shot.setupSnapshot] : []);
  const setupByShot = new Map(setupSnapshots.map(snapshot => [snapshot.shotId, snapshot]));
  if (clip.style.trim() && setupSnapshots.some(snapshot => snapshot.locked)) warnings.push('所选镜头的项目画风已锁定，不能应用胶卷风格覆盖。');
  const duration = Math.round(shots.reduce((total, shot) => total + (shot.duration && shot.duration > 0 ? shot.duration : 5), 0) * 100) / 100;
  const prompt = [
    `${chapter?.title ?? '原章节已删除'} · ${scene?.title ?? '原场次已删除'} · ${clip.title}`,
    `按以下镜头顺序制作，参考总时长 ${duration} 秒（最终时长按所选模型能力设置）。`,
    ...shots.map((shot, index) => `${index + 1}. 镜头 ${shot.no} · ${shot.duration ?? 5} 秒\n${shot.type} / ${shot.angle} / ${shot.movement} / ${shot.lens}\n${shot.desc}${shot.staging ? `\n调度：${shot.staging}` : ''}${shot.notes ? `\n备注：${shot.notes}` : ''}${shotAppearanceText({...shot,setupSnapshot:setupByShot.get(shot.id)}) ? `\n本镜可见人物造型：${shotAppearanceText({...shot,setupSnapshot:setupByShot.get(shot.id)})}` : ''}`),
    clip.style ? `美术风格：${clip.style}` : '',
    clip.extraPrompt ? `额外提示词：${clip.extraPrompt}` : '',
  ].filter(Boolean).join('\n\n');
  const brief: ProductionMaterial = { key: `clip:${clip.id}`, kind: 'clip', title: `${clip.title} · 制作说明`, text: prompt, episodeId: clip.episodeId, dependencies: [] };
  const sequence = chapter?.shots ?? [];
  const positions = shots.map(shot => sequence.findIndex(item => item.id === shot.id)).filter(index => index >= 0);
  const selectedIds = new Set(shots.map(shot => shot.id));
  const neighbor = (index: number, step: number): VideoContinuity['previous'] => {
    while (sequence[index] && selectedIds.has(sequence[index].id)) index += step;
    const shot = sequence[index]; if (!shot) return;
    const scene = chapter?.scenes.find(item => item.shotIds.includes(shot.id));
    return {shotId: shot.id, sceneId: scene?.id ?? 'unassigned', label: `镜头 ${shot.no} · ${scene?.title ?? '未分场'}`,
      text: [shot.desc, `景别 ${shot.type}；角度 ${shot.angle}；运镜 ${shot.movement}；时长 ${shot.duration ?? 5} 秒`, shot.staging, shot.notes].filter(Boolean).join('\n').slice(0, 8000)};
  };
  const continuity: VideoContinuity = {episodeId: clip.episodeId, sceneId: clip.sceneId, shotIds: shots.map(shot => shot.id),
    previous: positions.length ? neighbor(positions[0] - 1, -1) : undefined,
    next: positions.length ? neighbor(positions[positions.length - 1] + 1, 1) : undefined};
  return { chapter, scene, shots, materials: [brief, ...materials.map(material => {
    if (material.kind !== 'shot') return material;
    const setupSnapshot = setupByShot.get(material.key.slice(`shot:${clip.episodeId}:`.length));
    return {...material, setupSnapshot};
  })], duration, prompt, warnings, continuity, setupSnapshots };
}
