import Dexie, {type Table} from 'dexie';
import type {DocRow} from '../data/db';
import type {EpisodeEntry, EpisodeIndex} from '../episode/episodeManager';
import {currentProjectId, projectDatabaseName} from '../projects/projectIdentity';
import type {ScriptBlock} from '../script/editor';
import {storyScenes, type Shot} from '../storyboard/shotModel';

export interface WritingManuscript {
  key: string;
  kind: 'script' | 'outline' | 'scene' | 'shot';
  title: string;
  text: string;
  episodeId: string;
  episodeTitle: string;
}

interface OutlineDocument {id?: string; title: string; html: string}

function cleanText(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/\u200B/g, '');
}

function outlineText(html: string) {
  // A template fragment stays inert, including pasted image and iframe URLs.
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  content.querySelectorAll('script,style,noscript,template,svg,math,iframe,object,embed,video,audio').forEach(el => el.remove());
  content.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  content.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr').forEach(el => el.append('\n'));
  return cleanText(content.textContent ?? '').trim();
}

async function collectChapter(docs: Table<DocRow,string>, projectId: string, chapter: EpisodeEntry, episodeId: string) {
  const [body, outline, descriptions, storyboard] = await docs.bulkGet([
    'script:' + episodeId, 'outline:' + episodeId, 'scene:desc:' + episodeId, 'storyboard:' + episodeId,
  ]);
  const rows: WritingManuscript[] = [];
  const episodeTitle = chapter.title || '未分章草稿';
  const add = (kind: WritingManuscript['kind'], id: string, title: string, value: string) => {
    const text = cleanText(value);
    if (!text.trim()) return;
    rows.push({key:JSON.stringify([kind, projectId, episodeId, id]), kind, title, text, episodeId, episodeTitle});
  };

  const blocks = (body?.payload ?? []) as ScriptBlock[];
  let script = blocks.map(block => block.text).join('\n');
  // Match the writing editor's one-time migration without restoring cleared drafts.
  if (!cleanText(script).trim() && chapter.content?.trim() &&
      !await docs.where(':id').equals('chapter:migrated:' + chapter.id).count()) script = chapter.content;
  add('script', '', episodeTitle, script);
  const outlines = (outline?.payload as {docs: OutlineDocument[]}|undefined)?.docs ?? [];
  outlines.forEach((doc, i) => add('outline', doc.id || 'legacy-' + i, doc.title || '大纲', outlineText(doc.html)));

  const scenes = storyScenes(blocks);
  const labels = scenes.map(scene =>
    [scene.intExt, scene.location, scene.timeOfDay && '- ' + scene.timeOfDay].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  );
  const labelCounts = new Map<string, number>();
  for (const [i, scene] of scenes.entries()) {
    for (const label of new Set([scene.title, labels[i]])) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const descriptionsById = new Map(Object.entries((descriptions?.payload ?? {}) as Record<string,string>));
  for (const [i, scene] of scenes.entries()) {
    const heading = scene.title || '第 ' + (i + 1) + ' 场';
    const saved = descriptionsById.get(scene.id) ?? descriptionsById.get(scene.blockId) ??
      (labelCounts.get(scene.title) === 1 ? descriptionsById.get(scene.title) : undefined) ??
      (labelCounts.get(labels[i]) === 1 ? descriptionsById.get(labels[i]) : undefined);
    const text = [heading, saved, scene.blocks.slice(1).map(block => block.text).join('\n')].filter(Boolean).join('\n\n');
    add('scene', scene.blockId, heading, text);
  }

  const shots = (storyboard?.payload ?? []) as Shot[];
  const headings = new Map(scenes.map(scene => [scene.id, scene.title]));
  for (const [i, shot] of shots.entries()) {
    const number = shot.no || '镜头 ' + (i + 1);
    const scene = headings.get(shot.sceneId ?? '');
    const title = scene ? scene + ' · ' + number : number;
    const fields = [
      ['景别',shot.type], ['角度',shot.angle], ['运镜',shot.movement], ['焦段',shot.lens],
      ['时长',shot.duration == null ? '' : shot.duration + ' 秒'], ['画面',shot.desc],
      ['调度',shot.staging], ['备注',shot.notes],
    ];
    const text = [title, ...fields.filter(([, value]) => value).map(([label,value]) => label + '：' + value)].join('\n');
    add('shot', shot.id, title, text);
  }
  return rows;
}

/** Standalone canvas callers supply the selected project. Read the existing schema
 * directly so opening this catalog never creates or upgrades a writing database. */
export async function collectWritingManuscripts(projectId: string | null = currentProjectId): Promise<WritingManuscript[]> {
  if (!projectId) return [];
  const source = new Dexie(projectDatabaseName(projectId));
  try {
    await source.open();
    const docs = source.table<DocRow,string>('docs');
    return await source.transaction('r', docs, async () => {
      const index = (await docs.get('episode:ep_001'))?.payload as EpisodeIndex | undefined;
      const chapters = index?.chapters ?? [{id:'ep_001', episodeId:'ep_001', title:'未分章草稿'}];
      const result: WritingManuscript[] = [];
      // Read one chapter at a time. Older storyboard rows embed full images.
      for (const [i, chapter] of chapters.entries()) {
        const id = chapter.episodeId || (i === 0 ? 'ep_001' : chapter.id);
        const entries = await collectChapter(docs, projectId, chapter, id);
        for (const entry of entries) result.push(entry);
      }
      return result;
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchDatabaseError') throw Error('所选写作项目的数据暂不可用');
    throw error;
  } finally {
    source.close();
  }
}
