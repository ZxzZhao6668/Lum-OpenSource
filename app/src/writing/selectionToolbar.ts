import { getActiveWritingEditor } from '../script/editor';
import { showToast } from '../ui/toast';
import { openSelectionWriter } from './selectionPanel';

const actions = { 改写: 'rewrite', 扩写: 'expand', 描写: 'describe' } as const;

export function createSelectionToolbar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'lumSelectionTools';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'AI 写作工具');
  for (const [label, use] of Object.entries(actions)) {
    const pair = document.createElement('div');
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.textContent = label;
    primary.dataset.selectionAction = use;
    const options = document.createElement('button');
    options.type = 'button';
    options.textContent = '›';
    options.dataset.selectSkill = use;
    options.setAttribute('aria-label', label + '：选择 Skill');
    pair.append(primary, options);
    toolbar.append(pair);
  }
  return toolbar;
}

export function mountSelectionToolbar(root: HTMLElement): () => void {
  const toolbar = root.querySelector<HTMLElement>('[role="toolbar"][aria-label="AI 写作工具"]');
  if (!toolbar) return () => {};
  toolbar.dataset.selectionToolbar = '1';
  const rows: { wrapper: HTMLElement; buttons: HTMLButtonElement[] }[] = [];
  const removers: (() => void)[] = [];
  for (const use of Object.values(actions)) {
    const primary = toolbar.querySelector<HTMLButtonElement>(`[data-selection-action="${use}"]`);
    const options = toolbar.querySelector<HTMLButtonElement>(`[data-select-skill="${use}"]`);
    const wrapper = primary?.parentElement;
    if (!primary || !options || !wrapper) continue;
    for (const button of [primary, options]) {
      button.setAttribute('aria-haspopup','dialog');
      button.classList.remove('pointer-events-none');
      const clicked = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        void openSelectionWriter(use, button === options).catch(reason => showToast(reason instanceof Error ? reason.message : String(reason)));
      };
      button.addEventListener('click', clicked);
      removers.push(() => button.removeEventListener('click', clicked));
    }
    rows.push({ wrapper, buttons: [primary, options] });
  }
  const update = () => {
    if (!toolbar.isConnected) return;
    const editor = getActiveWritingEditor();
    const enabled = !!editor?.selectedText();
    for (const {wrapper, buttons} of rows) {
      wrapper.title = !editor ? '请先打开剧本，再在正文中拉选文字' : !enabled ? '请先在正文中拉选文字' : '只处理选中文字；可选择 Skill 和模型';
      for (const button of buttons) {
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', String(!enabled));
        button.classList.toggle('opacity-50', !enabled);
        button.classList.toggle('cursor-not-allowed', !enabled);
        button.classList.toggle('cursor-pointer', enabled);
      }
    }
  };
  // Keep the real selection when clicking either half of the split button.
  const preserveSelection = (event: MouseEvent) => {
    if (event.button === 0 && event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  };
  toolbar.addEventListener('mousedown', preserveSelection);
  document.addEventListener('selectionchange', update);
  root.addEventListener('input', update);
  root.addEventListener('compositionend', update);
  update();
  return () => {
    removers.forEach(remove => remove());
    toolbar.removeEventListener('mousedown', preserveSelection);
    document.removeEventListener('selectionchange', update);
    root.removeEventListener('input', update);
    root.removeEventListener('compositionend', update);
  };
}
