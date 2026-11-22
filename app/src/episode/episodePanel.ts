import { db, loadDoc, saveDoc } from '../data/db';
import { node } from '../ui/localUi';
import { showToast } from '../ui/toast';
import { openEpisodeMenu } from './episodeActions';
import { changeEpisodes, type EpisodeIndex, type EpisodeEntry } from './episodeManager';

export interface Chapter {
  id: string;
  title: string;
  episodeId?: string;
  draft?: boolean;
}

const indexKey = 'episode:ep_001';

export async function loadEpisodeIndex(): Promise<EpisodeIndex> {
  return db.transaction('rw', db.docs, async () => {
    const index = await loadDoc<EpisodeIndex>(indexKey);
    if (!index) {
      const draft = { id: 'ep_001', episodeId: 'ep_001', title: '未分章草稿', draft: true };
      const initial = { chapters: [draft], collapsed: false };
      await saveDoc(indexKey, initial);
      return initial;
    }
    // Before per-episode documents, the first chapter's script was always ep_001.
    if (index.chapters.some(chapter => !chapter.episodeId)) {
      index.chapters.forEach((chapter, order) => {
        chapter.episodeId ??= order === 0 ? 'ep_001' : chapter.id;
      });
      await saveDoc(indexKey, index);
    }
    return index;
  });
}

async function archiveChapter(entry: EpisodeEntry) {
  if (!confirm(`归档「${entry.title}」？正文和分镜会保留，可在“管理剧集”恢复。`)) return;
  await changeEpisodes(index => {
    if (index.chapters.length <= 1) throw Error('请至少保留一集');
    const position = index.chapters.findIndex(chapter => chapter.id === entry.id);
    if (position < 0) throw Error('该剧集已归档或不存在');
    (index.archived ??= []).push(...index.chapters.splice(position, 1));
  });
  window.dispatchEvent(new Event('dsh:episodes-changed'));
}

function chapterRow(chapter: EpisodeEntry, selected: string | undefined, canArchive: boolean) {
  const row = node('button', chapter.title);
  row.type = 'button';
  row.title = chapter.title;
  if (chapter.draft) row.dataset.draftEpisode = chapter.episodeId;
  else row.dataset.chapterId = chapter.id;
  const active = chapter.episodeId === selected;
  row.dataset.active = String(active);
  if (active) row.setAttribute('aria-current', 'true');
  const archive = chapter.draft ? undefined : async () => {
    if (canArchive) await archiveChapter(chapter);
    else showToast('请至少保留一集');
  };
  const menu = (event: MouseEvent | KeyboardEvent) => openEpisodeMenu(row, chapter.episodeId, event, archive);
  row.oncontextmenu = menu;
  row.onkeydown = event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) menu(event);
  };
  row.onclick = event => {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('dsh:open-episode', {
      detail: { episodeId: chapter.episodeId, title: chapter.title },
    }));
  };
  return row;
}

export async function upgradeEpisodePanel(root: HTMLElement, index?: EpisodeIndex) {
  const list = root.querySelector<HTMLElement>('[data-episode-list]');
  const toggle = root.querySelector<HTMLButtonElement>('[data-episode-toggle]');
  if (!list || !toggle) return;
  const state = index ?? await loadEpisodeIndex();
  if (!root.contains(list)) return;
  const count = state.chapters.filter(chapter => !chapter.draft).length;
  const board = root.querySelector<HTMLButtonElement>('[data-sidebar-page="episode-board"]');
  if (board) {
    const badge = board.querySelector<HTMLElement>('[data-episode-count]');
    if (badge) badge.textContent = String(count);
    board.onclick = event => {
      event.stopPropagation();
      window.dispatchEvent(new Event('dsh:open-episode-board'));
    };
  }
  list.replaceChildren(...state.chapters.map(chapter => chapterRow(chapter, root.dataset.episodeId, state.chapters.length > 1)));
  if (!count) {
    const hint = node('p', '尚未分章，可交给 Agent 自动规划并写作');
    hint.dataset.emptyEpisodes = '';
    list.append(hint);
  }
  const setCollapsed = (collapsed: boolean) => {
    list.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  setCollapsed(!!state.collapsed);
  toggle.onclick = async () => {
    toggle.disabled = true;
    try {
      const next = await changeEpisodes(current => { current.collapsed = !current.collapsed; });
      setCollapsed(next.collapsed);
    } catch (error) {
      showToast(String(error));
    } finally {
      toggle.disabled = false;
    }
  };
}