import { createSelectionToolbar } from './selectionToolbar';
import { node } from '../ui/localUi';
import { createEpisodeSidebar } from '../episode/episodeSidebar';
import { createScriptView } from '../script/scriptView';
import { createWorkspacePageView } from '../screens/workspacePageView';
import { projectStorageKey, writingWorkspace } from '../projects/projectIdentity';
import type { ProjectKind } from '../projects/projectStore';

const writingRoutes: Record<string, string> = {
  '01-script': '剧本', '02-cover': '封面', '03-outline': '大纲', '04-storyboard': '分镜',
  '05-scenes': '场次', '06-characters': '人物', '07-locations': '地点', '08-props': '道具',
  '09-worldview': '世界观', '11-consultant': '技能', '13-beats': '节拍',
  '14-bible': '小说设定', '15-whiteboard': '写作白板', '16-asset-library': '资产库',
};

function button(label: string, className = '') {
  const control = node('button', label, className);
  control.type = 'button';
  return control;
}

function routeButton(route: string, label: string, current: string) {
  const control = button(label);
  control.dataset.workspaceRoute = route;
  control.setAttribute('aria-label', label);
  if (route === current) control.setAttribute('aria-current', 'page');
  return control;
}

export function createCanvasRail(id: string) {
  const rail = node('nav', '', 'lumWritingRail');
  rail.dataset.dshRail = '1';
  rail.setAttribute('aria-label', '工作区导航');
  const home = routeButton('home', '主页', id);
  home.dataset.dshHome = '1';
  const logo = node('img');
  logo.src = '/brand/lumLogo.png';
  logo.alt = '';
  home.prepend(logo);
  rail.append(home);
  const routes = ['01-script','06-characters','07-locations','08-props','09-worldview','11-consultant'];
  if (!writingWorkspace) routes.push('16-asset-library','canvas','virtualStage');
  for (const route of routes) {
    const label = route === '01-script' ? '写作' : route === 'canvas' ? '画布' : route === 'virtualStage' ? '虚拟片场' : writingRoutes[route];
    const item = routeButton(route, label, id);
    if (route === '16-asset-library') item.dataset.assetLibraryEntry = 'true';
    if (route === 'virtualStage') item.dataset.virtualStageEntry = 'true';
    rail.append(item);
  }
  const settings = button('设置', 'lumRailSettings');
  settings.setAttribute('aria-label', '设置');
  settings.onclick = () => window.dispatchEvent(new Event('dsh:settings'));
  rail.append(settings);
  return rail;
}

const narrowSidebar = () => window.matchMedia('(max-width: 640px)').matches;
function sidebarPreference(key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(projectStorageKey('lum:sidebar:' + key));
    return stored === null ? fallback : stored === 'true';
  } catch { return fallback; }
}
function rememberSidebar(key: string, value: boolean) {
  try { localStorage.setItem(projectStorageKey('lum:sidebar:' + key), String(value)); } catch { /* Preferences are optional. */ }
}

function sidebarGroup(key: string, label: string, body: HTMLElement, expanded = true) {
  const group = node('details', '', 'lumSidebarGroup');
  group.open = sidebarPreference(key, expanded);
  group.append(node('summary', label), body);
  group.ontoggle = () => { if (group.isConnected) rememberSidebar(key, group.open); };
  return group;
}

function sidebarToggle(show: boolean) {
  const label = show ? '展开侧栏' : '隐藏侧栏';
  const toggle = button('', 'lumSidebarToggle');
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  toggle.setAttribute('aria-controls', 'lum-project-sidebar');
  toggle.setAttribute('aria-expanded', String(!show));
  toggle.dataset.sidebarToggle = show ? 'show' : 'hide';
  const icon = node('span', '', 'lumSidebarIcon');
  icon.setAttribute('aria-hidden', 'true');
  toggle.append(icon);
  return toggle;
}

function referenceSidebar() {
  const section = node('div', '', 'lumWritingReferences');
  const links = node('div', '', 'lumWorldLinks');
  links.dataset.worldLinks = '';
  const world = sidebarGroup('world', '总世界观', links);
  const inspiration = node('section', '', 'lumInspiration');
  inspiration.dataset.inspirationDock = '';
  const open = button('灵感盒');
  open.setAttribute('aria-label', '打开灵感盒');
  const composer = node('div', '', 'lumInspirationComposer');
  const input = node('textarea', '', 'inspiration-field');
  input.setAttribute('aria-label', '新灵感');
  input.placeholder = '记下一条灵感…';
  input.rows = 2;
  const surface = node('div');
  surface.append(input);
  const attach = button('添加图片');
  attach.setAttribute('aria-label', '添加图片');
  const file = node('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.multiple = true;
  file.hidden = true;
  file.setAttribute('aria-label', '灵感图片');
  const actions = node('div', '', 'lumInspirationActions');
  actions.append(attach, file, button('保存'));
  composer.append(surface, actions);
  inspiration.append(open, composer);
  section.append(world, sidebarGroup('inspiration', '灵感', inspiration));
  return section;
}

function projectSidebar(id: string, kind: ProjectKind, overview: boolean) {
  const aside = node('aside', '', 'bg-panel lumProjectSidebar');
  aside.id = 'lum-project-sidebar';
  aside.dataset.dshSidePanel = '1';
  aside.dataset.dshRail = '1';
  aside.setAttribute('aria-label', '项目侧栏');
  const projectHead = node('div', '', 'lumProjectHeading');
  const menu = button('···');
  menu.setAttribute('aria-label', '项目菜单');
  menu.title = '项目菜单';
  projectHead.append(node('h3', '', 'truncate'), menu, sidebarToggle(false));
  const tabs = node('nav', '', 'lumWritingTabs');
  tabs.setAttribute('aria-label', '写作页面');
  const board = button('集纲看板');
  board.dataset.sidebarPage = 'episode-board';
  if (overview) board.setAttribute('aria-current', 'page');
  const count = node('span');
  count.dataset.episodeCount = '';
  board.append(count);
  tabs.append(board);
  const routes = ['01-script','03-outline',...(!writingWorkspace ? ['04-storyboard'] : []),'05-scenes','15-whiteboard'];
  if (kind === 'novel') routes.push('14-bible');
  for (const route of routes) {
    const item = routeButton(route, writingRoutes[route], overview ? '' : id);
    item.dataset.sidebarPage = route;
    tabs.append(item);
  }
  const index = node('div', '', 'lumPageIndex');
  index.dataset.pageIndex = '';
  const materials = node('nav', '', 'lumSidebarLinks');
  materials.setAttribute('aria-label', '资料页面');
  for (const route of ['06-characters','07-locations','08-props','09-worldview','11-consultant']) {
    materials.append(routeButton(route, writingRoutes[route], id));
  }
  const tools = node('div', '', 'localProjectTools lumSidebarLinks');
  tools.dataset.projectActions = '';
  const home = routeButton('home', '首页', id);
  home.dataset.dshHome = '1';
  const settings = button('设置');
  settings.onclick = () => window.dispatchEvent(new Event('dsh:settings'));
  tools.append(home);
  aside.append(projectHead, sidebarGroup('writing','写作',tabs), createEpisodeSidebar(), sidebarGroup('page-index','页面目录',index),
    sidebarGroup('materials','项目资料',materials));
  if (!writingWorkspace) {
    const production = node('nav', '', 'lumSidebarLinks');
    production.setAttribute('aria-label', '制作页面');
    for (const [route, label] of [['16-asset-library','资产库'],['canvas','画布'],['virtualStage','虚拟片场']]) {
      const entry = routeButton(route, label, id);
      if (route === '16-asset-library') entry.dataset.assetLibraryEntry = 'true';
      if (route === 'virtualStage') entry.dataset.virtualStageEntry = 'true';
      production.append(entry);
    }
    aside.append(sidebarGroup('production','制作',production));
  }
  aside.append(sidebarGroup('selection','选区写作',createSelectionToolbar()), referenceSidebar(),
    sidebarGroup('project','项目管理',tools), settings);
  return aside;
}

function pageHeader(id: string) {
  const header = node('header', '', 'lumWritingHeader');
  const sections = node('div', '', 'lumHeaderSegments');
  if (id === '01-script' || id === '02-cover') {
    const script = button('剧本', 'segment-btn');
    if (id === '01-script') script.dataset.scriptMenu = '';
    else script.dataset.workspaceRoute = '01-script';
    const cover = routeButton('02-cover','封面',id);
    cover.className = 'segment-btn';
    script.setAttribute('aria-pressed', String(id === '01-script'));
    cover.setAttribute('aria-pressed', String(id === '02-cover'));
    sections.append(script, cover);
  } else {
    sections.append(node('span', writingRoutes[id] ?? '', 'lumPageName'));
  }
  const home = routeButton('home', '返回首页', id);
  home.className = 'lumHeaderHome';
  header.append(sidebarToggle(true), sections, home);
  if (id === '01-script') {
    for (const [name, label] of [['undo','撤销'],['redo','重做']]) {
      const control = button(label);
      control.dataset.scriptHistory = name;
      control.setAttribute('aria-label', label);
      header.append(control);
    }
  }
  const exportButton = button(id === '01-script' && writingWorkspace ? '导出稿件' : '导出');
  exportButton.dataset.writingExport = '';
  header.append(exportButton);
  return header;
}

export function createWritingWorkspace(id: string, kind: ProjectKind, overview: boolean) {
  const shell = node('div', '', 'lumWritingWorkspace');
  const main = node('main', '', 'bg-panel lumWorkMain');
  main.dataset.dshMain = '';
  const content = node('div', '', 'lumWorkspaceContent');
  content.dataset.workspaceContent = '';
  content.append(id === '01-script' ? createScriptView() : createWorkspacePageView(id));
  main.append(pageHeader(id), content);
  const aside = projectSidebar(id, kind, overview);
  const opener = main.querySelector<HTMLButtonElement>('[data-sidebar-toggle="show"]')!;
  const closer = aside.querySelector<HTMLButtonElement>('[data-sidebar-toggle="hide"]')!;
  shell.dataset.sidebarWideHidden = String(sidebarPreference('hidden', false));
  shell.dataset.sidebarNarrowHidden = String(sidebarPreference('hidden-narrow', true));
  function setSidebarHidden(hidden: boolean) {
    const narrow = narrowSidebar();
    shell.dataset[narrow ? 'sidebarNarrowHidden' : 'sidebarWideHidden'] = String(hidden);
    rememberSidebar(narrow ? 'hidden-narrow' : 'hidden', hidden);
    (hidden ? opener : closer).focus({preventScroll:true});
  }
  opener.onclick = () => setSidebarHidden(false);
  closer.onclick = () => setSidebarHidden(true);
  aside.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
      event.preventDefault();
      setSidebarHidden(true);
    }
  });
  aside.addEventListener('click', event => {
    if (narrowSidebar() && event.target instanceof Element &&
        event.target.closest('[data-workspace-route],[data-sidebar-page],[data-chapter-id],[data-scene-block-id]')) {
      setSidebarHidden(true);
    }
  }, true);
  const scrim = button('', 'lumSidebarScrim');
  scrim.tabIndex = -1;
  scrim.setAttribute('aria-hidden', 'true');
  scrim.onclick = () => setSidebarHidden(true);
  shell.append(aside, main, scrim);
  return shell;
}

export function markRailRoute(rail: HTMLElement | null, id: string) {
  if (!rail) return;
  const routes = Array.from(rail.querySelectorAll<HTMLButtonElement>('[data-workspace-route]'));
  const exact = routes.some(item => item.dataset.workspaceRoute === id);
  for (const item of routes) {
    if (item.dataset.workspaceRoute === (exact ? id : '01-script')) item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  }
}
