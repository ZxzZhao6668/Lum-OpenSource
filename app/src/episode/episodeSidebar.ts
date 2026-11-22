import { node } from '../ui/localUi';
import './episodeSidebar.css';

function createSidebarGroup(title: string, listId: string) {
  const group = node('section', '', 'episodeSidebarGroup');
  group.setAttribute('aria-label', title);
  const header = node('div', '', 'episodeSidebarHeading');
  const toggle = node('button', title, 'episodeSidebarToggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', listId);
  header.append(toggle);
  const list = node('div', '', 'episodeSidebarList');
  list.id = listId;
  group.append(header, list);
  return { group, header, toggle, list };
}

/** The chapter index and current episode's script populate these two lists. */
export function createEpisodeSidebar(): HTMLElement {
  const sidebar = node('div', '', 'episodeSidebar');
  const chapters = createSidebarGroup('章节目录', 'lum-episode-list');
  chapters.toggle.dataset.episodeToggle = '';
  chapters.list.dataset.episodeList = '';
  const add = node('button', '+', 'episodeSidebarAdd');
  add.type = 'button';
  add.title = '添加剧集';
  add.setAttribute('aria-label', '添加剧集');
  chapters.header.append(add);

  const scenes = createSidebarGroup('本集场次', 'lum-scene-list');
  scenes.toggle.dataset.sceneToggle = '';
  scenes.list.dataset.sceneList = '';
  sidebar.append(chapters.group, scenes.group);
  return sidebar;
}
