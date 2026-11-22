import { action } from './localUi';
import './writingFocus.css';

export function mountFocusMode(root: HTMLElement, fallback: HTMLElement) {
  const editor = root.querySelector<HTMLElement>('.slate-editor');
  const home = root.querySelector('.lumHeaderHome');
  if (!editor) return;
  const toggle = action('专注写作', () => setFocus(toggle.getAttribute('aria-pressed') !== 'true'));
  toggle.classList.add('writingFocusToggle');
  toggle.setAttribute('aria-pressed', 'false');

  if (home) home.after(toggle);
  else fallback.append(toggle);
  function setFocus(active: boolean) {
    toggle.setAttribute('aria-pressed', String(active));
    toggle.textContent = active ? '退出专注' : '专注写作';
    if (active) editor?.focus({preventScroll:true});
  }
  // This subtree is replaced on chapter navigation together with its listener.
  editor.closest('[data-workspace-content]')?.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('[role="search"], dialog, [role="dialog"]')) return;
    if (event instanceof KeyboardEvent && event.key === 'Escape' && !event.defaultPrevented &&
        !event.isComposing && toggle.getAttribute('aria-pressed') === 'true') setFocus(false);
  });
}
