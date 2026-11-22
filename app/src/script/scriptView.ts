import { node } from '../ui/localUi';
import type { BlockType } from './editor';
import './scriptView.css';

const formats: ReadonlyArray<[BlockType, string]> = [
  ['scene', '场次'], ['action', '动作'], ['character', '角色'], ['parenthetical', '括号'],
  ['dialogue', '对白'], ['transition', '转场'], ['comment', '注释'], ['subtitle', '字幕'],
];

export function createScriptView(): HTMLElement {
  const view = node('section', '', 'lumScriptView');
  view.dataset.scriptScroll = 'main';
  view.setAttribute('aria-label', '剧本写作');

  const toolbar = node('div', '', 'lumScriptToolbar');
  toolbar.dataset.scriptToolbar = '';
  const formatsRow = node('div', '', 'lumParagraphFormats');
  formatsRow.setAttribute('role', 'group');
  formatsRow.setAttribute('aria-label', '段落格式');
  for (const [type, label] of formats) {
    const button = node('button', label);
    button.type = 'button';
    button.dataset.formatId = type;
    button.setAttribute('aria-pressed', 'false');
    formatsRow.append(button);
  }
  toolbar.append(formatsRow);

  const paper = node('article', '', 'lumManuscript');
  const editor = node('div', '', 'slate-editor');
  editor.dataset.scriptEditor = '';
  editor.dataset.slateEditor = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-label', '剧本正文');
  editor.setAttribute('aria-multiline', 'true');
  editor.contentEditable = 'false';
  editor.spellcheck = false;
  paper.append(editor);
  view.append(toolbar, paper);
  return view;
}
