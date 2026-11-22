import { node } from '../ui/localUi';
import './scriptFind.css';

type Match = { block: HTMLElement; start: number };
type FindOptions = {
  editor: HTMLElement;
  toolbar: HTMLElement;
  scope: HTMLElement;
  canOpen: () => boolean;
  blocks: () => HTMLElement[];
  text: (block: HTMLElement) => string;
  isDialogue: (block: HTMLElement) => boolean;
  rangeFor: (block: HTMLElement, start: number, end: number) => Range;
  signal: AbortSignal;
};

export function mountScriptFind({ editor, toolbar, scope, canOpen, blocks, text, isDialogue, rangeFor, signal }: FindOptions) {
  const button = (label: string, click: () => void) => {
    const control = node('button', label, 'localButton');
    control.type = 'button';
    control.addEventListener('click', click, { signal });
    return control;
  };
  const launch = button('查找本章', open);
  launch.title = '查找本章（Ctrl / ⌘ + F）';
  launch.setAttribute('aria-expanded', 'false');
  launch.setAttribute('aria-keyshortcuts', 'Control+F Meta+F');
  launch.classList.add('scriptFindLaunch');
  const formatRow = toolbar.querySelector('[data-format-id]')?.parentElement ?? toolbar;
  formatRow.prepend(launch);

  const panel = node('div', '', 'scriptFind');
  panel.hidden = true;
  panel.setAttribute('role', 'search');
  panel.setAttribute('aria-label', '查找本章');
  const input = node('input');
  input.type = 'text';
  input.setAttribute('aria-label', '查找本章正文');
  input.placeholder = '查找本章正文';
  input.autocomplete = 'off';
  const filter = node('label');
  const dialogue = node('input');
  dialogue.type = 'checkbox';
  filter.append(dialogue, '仅对白');
  const count = node('span');
  count.setAttribute('role', 'status');
  const prev = button('上一处', () => step(-1));
  const next = button('下一处', () => step(1));
  prev.title = '上一处（Shift + Enter）';
  next.title = '下一处（Enter）';
  const locate = button('定位到正文', close);
  const dismiss = button('关闭', close);
  dismiss.setAttribute('aria-label', '关闭查找');
  panel.append(input, count, prev, next, filter, locate, dismiss);
  toolbar.append(panel);

  let composing = false;
  let needle = '';
  let matches: Match[] = [];
  let index = 0;
  let current: Range | null = null;
  let origin: Range | null = null;
  let marked: HTMLElement | null = null;
  const highlight = 'lum-script-find-current';
  const observer = new MutationObserver(() => refresh(true, false));

  function clearMark() {
    if (!marked) return;
    CSS.highlights?.delete(highlight);
    marked.removeAttribute('data-script-find-current');
    marked = null;
  }

  function display(scroll: boolean) {
    clearMark();
    const match = matches[index];
    current = match ? rangeFor(match.block, match.start, match.start + needle.length) : null;
    count.textContent = match ? `${index + 1} / ${matches.length}` : needle ? '没有匹配' : '';
    prev.disabled = next.disabled = matches.length < 2;
    locate.disabled = !match;
    if (!current || !match) return;
    marked = match.block;
    if (typeof Highlight === 'function' && CSS.highlights) {
      CSS.highlights.set(highlight, new Highlight(current));
    } else {
      marked.setAttribute('data-script-find-current', '');
    }
    if (scroll) {
      const scroller = toolbar.closest<HTMLElement>('[data-script-scroll="main"]');
      if (scroller) {
        const rect = current.getClientRects()[0];
        if (!rect) return;
        const top = Math.max(scroller.getBoundingClientRect().top, toolbar.getBoundingClientRect().bottom);
        const bottom = scroller.getBoundingClientRect().bottom;
        if (rect.top < top || rect.bottom > bottom) scroller.scrollTop += rect.top - (top + bottom - rect.height) / 2;
      } else {
        marked.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function refresh(keep: boolean, scroll: boolean) {
    const old = keep ? matches[index] : undefined;
    matches = [];
    if (needle) {
      for (const block of blocks()) {
        if (dialogue.checked && !isDialogue(block)) continue;
        const value = text(block);
        for (let start = value.indexOf(needle); start >= 0; start = value.indexOf(needle, start + needle.length)) {
          matches.push({ block, start });
        }
      }
    }
    const retained = old ? matches.findIndex(m => m.block === old.block && m.start === old.start) : -1;
    index = retained >= 0 ? retained : 0;
    display(scroll);
  }

  function step(direction: number) {
    if (!matches.length) return;
    index = (index + direction + matches.length) % matches.length;
    display(true);
  }

  function open() {
    if (!canOpen()) return;
    if (panel.hidden) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      origin = range && editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
      panel.hidden = false;
      launch.setAttribute('aria-expanded', 'true');
      observer.observe(editor, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-block-type'] });
      refresh(false, true);
    }
    input.focus({ preventScroll: true });
    input.select();
  }

  function close() {
    const selection = current ?? origin;
    observer.disconnect();
    clearMark();
    current = origin = null;
    matches = [];
    panel.hidden = true;
    composing = false;
    launch.setAttribute('aria-expanded', 'false');
    editor.focus({ preventScroll: true });
    if (selection && editor.contains(selection.commonAncestorContainer)) {
      const browserSelection = window.getSelection();
      browserSelection?.removeAllRanges();
      browserSelection?.addRange(selection);
    }
  }

  function updateQuery() {
    if (composing || needle === input.value) return;
    needle = input.value;
    refresh(false, true);
  }
  input.addEventListener('compositionstart', () => { composing = true; }, { signal });
  input.addEventListener('compositionend', () => { composing = false; updateQuery(); }, { signal });
  input.addEventListener('input', updateQuery, { signal });
  dialogue.addEventListener('change', () => refresh(false, true), { signal });
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || composing || e.keyCode === 229 || !canOpen()) return;
    const target = e.target;
    if (!(target instanceof Element) || target.closest('dialog,[role="dialog"]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      if (target !== document.body && !scope.contains(target)) return;
      if (!panel.contains(target) && !editor.contains(target) && target.closest('input,textarea,[contenteditable=true]')) return;
      e.preventDefault();
      open();
    } else if (panel.contains(target) && (e.key === 'Escape' || (e.key === 'Enter' && target === input))) {
      e.preventDefault();
      if (e.key === 'Escape') close(); else step(e.shiftKey ? -1 : 1);
    }
  }, { signal });
  signal.addEventListener('abort', () => { observer.disconnect(); clearMark(); launch.remove(); panel.remove(); }, { once: true });
}
