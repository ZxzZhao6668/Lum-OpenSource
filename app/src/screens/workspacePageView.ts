import { node } from '../ui/localUi';
import './workspacePageView.css';

function control(text: string, label = text) {
  const button = node('button', text, 'lumPageButton');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

function outlinePage() {
  const page = node('section', '', 'lumOutlinePage');
  page.setAttribute('aria-label', '大纲编辑');
  const tools = node('div', '', 'lumOutlineTools');
  const formats = node('div', '', 'lumFormatGroup');
  formats.setAttribute('role', 'group');
  formats.setAttribute('aria-label', '大纲格式');
  for (const [id, text, label] of [
    ['paragraph', '正文', '正文段落'], ['h1', 'H1', '一级标题'], ['h2', 'H2', '二级标题'],
    ['h3', 'H3', '三级标题'], ['bold', 'B', '粗体'], ['italic', 'I', '斜体'],
    ['quote', '引文', '引用'], ['hr', '分隔线', '插入分隔线'],
  ]) {
    const button = control(text, label);
    button.dataset.formatId = id;
    formats.append(button);
  }
  const actions = node('div', '', 'lumOutlineActions');
  actions.dataset.outlineActions = '';
  const save = control('保存');
  save.dataset.outlineSave = '';
  actions.append(save);
  tools.append(formats, actions);

  const scroll = node('div', '', 'lumOutlineScroll');
  const paper = node('article', '', 'lumOutlinePaper');
  const metadata = node('header', '', 'lumOutlineHeading');
  const project = node('span');
  project.dataset.projectName = 'true';
  const title = node('h2', '大纲');
  title.dataset.outlineTitle = '';
  const updated = node('time');
  updated.dataset.outlineDate = '';
  updated.title = '最后保存日期';
  metadata.append(project, updated, title);
  const editor = node('div', '', 'outline-prose');
  editor.dataset.outlineEditor = '';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  editor.setAttribute('aria-label', '大纲正文');
  editor.contentEditable = 'true';
  editor.append(node('p'));
  paper.append(metadata, editor);
  scroll.append(paper);

  const pager = node('nav', '', 'lumOutlinePager');
  pager.setAttribute('aria-label', '大纲翻页');
  pager.dataset.outlinePager = '';
  const input = node('input');
  input.setAttribute('aria-label', '页码');
  input.inputMode = 'numeric';
  const total = node('span');
  total.dataset.pageTotal = '';
  pager.append(control('上一页'), input, total, control('下一页'));
  page.append(tools, scroll, pager);
  return page;
}

function storyboardPage() {
  const page = node('section', '', 'lumStoryboardPage');
  page.setAttribute('aria-label', '分镜工作区');
  const header = node('header', '', 'lumStoryboardHeader');
  const modes = node('div', '', 'lumStoryboardModes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', '分镜视图');
  for (const [mode, label] of [['board', '分镜板'], ['canvas','画布'], ['table','镜头表']]) {
    const tab = control(label);
    tab.dataset.shotMode = mode;
    modes.append(tab);
  }
  const count = node('output');
  count.dataset.shotCount = '';
  header.append(modes, count);
  const tools = node('div', '', 'lumStoryboardTools');
  tools.dataset.sbCanvasToolbar = '1';
  for (const [key, label] of [['previous','上一场'],['next','下一场'],['add','新增镜头'],['arrange','整理画布']]) {
    const button = control(label);
    button.dataset.shotAction = key;
    tools.append(button);
  }
  const viewport = node('div', '', 'sbViewport');
  viewport.dataset.canvasContainer = '';
  const world = node('div', '', 'sbWorld');
  world.dataset.shotWorld = '';
  viewport.append(world);
  page.append(header, tools, viewport);
  return page;
}

/** Data-backed pages replace their mount after reading the active project. */
export function createWorkspacePageView(id: string): HTMLElement {
  if (id === '03-outline') return outlinePage();
  if (id === '04-storyboard') return storyboardPage();
  if (id === '05-scenes') {
    const page = node('section', '', 'lumScenesPage');
    page.setAttribute('aria-label', '场次工作区');
    const header = node('header', '', 'lumScenesHeader');
    const count = node('output', '0');
    count.dataset.sceneCardCount = '';
    count.dataset.sceneCount = '';
    header.append(count, node('span', '场'));
    const list = node('div', '', 'lumSceneList');
    list.dataset.sceneCards = '';
    page.append(header, list);
    return page;
  }
  return node('div');
}
