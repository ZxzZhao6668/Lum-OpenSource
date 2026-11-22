import { db, loadDoc, saveDoc } from '../data/db';
import type { EpisodeIndex } from './episodeManager';
import type { ScriptBlock } from '../writing/documentStore';

/** Upgrade only an untouched, automatically named placeholder, never an authored chapter. */
export async function initializeProjectDraft() {
  await db.transaction('rw', db.docs, async () => {
    const meta = await loadDoc<Record<string, unknown>>('project:meta');
    if (meta?.emptyProjectVersion !== 2) return;
    const index = await loadDoc<EpisodeIndex>('episode:ep_001');
    const first = index?.chapters[0];
    const blocks = await loadDoc<ScriptBlock[]>('script:ep_001') ?? [];
    const outline = await loadDoc<{docs?: {html:string}[]}>('outline:ep_001');
    const shots = await loadDoc<unknown[]>('storyboard:ep_001') ?? [];
    if (index?.chapters.length === 1 && first?.episodeId === 'ep_001'
      && first.title === (meta.kind === 'novel' ? '第一章' : '第一集') && !first.content?.trim()
      && !blocks.some(block => block.text.trim()) && !shots.length
      && !outline?.docs?.some(doc => new DOMParser().parseFromString(doc.html,'text/html').body.textContent?.trim())) {
      first.draft = true;
      first.title = '未分章草稿';
      await saveDoc('episode:ep_001', index);
    }
    await saveDoc('project:meta', {...meta, emptyProjectVersion:3});
  });
}
