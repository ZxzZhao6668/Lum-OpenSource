import { loadDoc } from '../data/db';
import type { EpisodeIndex } from '../episode/episodeManager';
import { addBlankEpisode,openEpisodeMenu } from '../episode/episodeActions';
import {openWritingExport} from '../export/writingExport';
import type { ScriptBlock } from '../script/editor';
import { action, mainPanel, node } from '../ui/localUi';

/** The overview and episode document are two presentations of the outline view. */
export async function mountEpisodeOverview(root: HTMLElement, isCurrent: () => boolean) {
  const index = await loadDoc<EpisodeIndex>('episode:ep_001');
  const chapters = (index?.chapters ?? []).filter(chapter => !chapter.draft);
  const cards = await Promise.all(chapters.map(async (chapter, i) => {
    const [outline, blocks] = await Promise.all([
      loadDoc<{docs: {id: string; title: string; html: string}[]}>(`outline:${chapter.episodeId}`),
      loadDoc<ScriptBlock[]>(`script:${chapter.episodeId}`),
    ]);
    const doc = outline?.docs.find(d => d.title === '本章大纲') ?? outline?.docs.find(d => d.id !== 'world');
    const plain = new DOMParser().parseFromString(doc?.html ?? '', 'text/html');
    plain.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,br').forEach(el=>el.append('\n'));
    const text = plain.body.textContent?.trim() ?? '';
    const script = blocks == null ? chapter.content ?? '' : blocks.map(b => b.text).join('');
    const card = node('button', '', 'episodeOutlineCard');
    card.type = 'button'; card.dataset.outlineEpisode = chapter.episodeId;
    card.setAttribute('aria-label', `${chapter.title} · 查看大纲`);
    card.append(node('strong', chapter.title), node('p', text || '这一集还没写大纲'), node('footer', `Ep ${i + 1} · ${script.replace(/\s/g, '').length} 字 · ${(blocks ?? []).filter(b => b.type === 'scene').length} 场`));
    card.onclick = () => window.dispatchEvent(new CustomEvent('dsh:open-outline', {detail: {episodeId: chapter.episodeId, title: chapter.title, docId: doc?.id}}));
    card.oncontextmenu=e=>openEpisodeMenu(card,chapter.episodeId,e);
    card.onkeydown=e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')openEpisodeMenu(card,chapter.episodeId,e);};
    return card;
  }));
  if (!isCurrent() || !root.isConnected) return;
  const {page, body,header} = mainPanel(root, '集纲看板');
  const exportButton=action('↥',()=>openWritingExport(root.dataset.episodeId??'ep_001','outline'));exportButton.setAttribute('aria-label','导出');exportButton.title='导出';exportButton.className='episodeOutlineExport';header.append(exportButton);
  page.classList.add('episodeOutlineOverview'); page.dataset.outlineBoard = 'true';
  const grid = node('div', '', 'episodeOutlineGrid'); grid.append(...cards);
  const add = action('＋', addBlankEpisode);
  add.className = 'episodeOutlineCard episodeOutlineAdd'; add.setAttribute('aria-label', '添加剧集'); add.title = '添加剧集';
  grid.append(add); body.append(grid);
  if (!chapters.length) body.append(node('p', '还没有剧集。添加剧集，或让 Agent 规划章节并写作。', 'localMuted'));
}
