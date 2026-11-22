import './paragraphControls.css';

/** One gutter outside the editable DOM: UI labels never enter text, selection or IME. */
export function mountParagraphControls(editor: HTMLElement, canEdit: () => boolean, moveBlock: (sourceId: string, targetId: string, after: boolean) => void) {
  const gutter = document.createElement('div'); gutter.className = 'dsh-paragraph-gutter'; gutter.hidden = true;
  const number = document.createElement('span'); number.className = 'dsh-paragraph-number'; number.setAttribute('aria-hidden', 'true');
  const grip = document.createElement('button'); grip.type = 'button'; grip.className = 'dsh-paragraph-grip'; grip.textContent = '⠿';
  grip.setAttribute('aria-label', '拖动段落排序'); grip.title = '拖动排序；Alt + ↑ / ↓ 移动段落';
  gutter.append(number, grip);
  const line = document.createElement('div'); line.className = 'dsh-paragraph-drop'; line.hidden = true;
  const announcer = document.createElement('div'); announcer.className = 'dsh-paragraph-announcer'; announcer.setAttribute('role', 'status');
  document.body.append(gutter, line, announcer);
  let hovered: HTMLElement | null = null;
  let drag: { id: string; pointerId: number; x: number; y: number; moving: boolean; target?: string; after: boolean } | null = null;
  const blocks = () => Array.from(editor.querySelectorAll<HTMLElement>('[data-block-id]'));
  const findBlock = (target: EventTarget | null) => {
    const node = target instanceof Element ? target.closest<HTMLElement>('[data-block-id]') : null;
    return node && editor.contains(node) ? node : null;
  };
  const hide = () => { if (!drag && !gutter.contains(document.activeElement)) { gutter.hidden = true; hovered = null; } };
  const position = (block: HTMLElement) => {
    const rect = block.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight || !block.isConnected) { hide(); return; }
    hovered = block; number.textContent = String(blocks().indexOf(block) + 1);
    gutter.style.left = `${Math.max(0, rect.left - 48)}px`; gutter.style.top = `${rect.top + 2}px`;
    gutter.hidden = false;
  };
  const onMove = (event: PointerEvent) => {
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      if (!drag.moving && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      drag.moving = true; editor.classList.add('dsh-dragging-paragraph');
      const target = findBlock(document.elementFromPoint(event.clientX, event.clientY));
      if (!target || target.dataset.blockId === drag.id) { drag.target = undefined; line.hidden = true; return; }
      const rect = target.getBoundingClientRect(); drag.target = target.dataset.blockId;
      drag.after = event.clientY > rect.top + rect.height / 2;
      line.style.cssText = `left:${rect.left}px;top:${drag.after ? rect.bottom : rect.top}px;width:${rect.width}px`;
      line.hidden = false; event.preventDefault(); return;
    }
    if (event.pointerType !== 'mouse' || event.buttons || !canEdit()) { hide(); return; }
    if (event.target instanceof Node && gutter.contains(event.target)) return;
    const block = findBlock(event.target);
    if (block) position(block);
    else if (hovered && event.target instanceof Node && editor.parentElement?.contains(event.target)) {
      const rect = hovered.getBoundingClientRect();
      if (event.clientX < rect.left - 52 || event.clientX > rect.left || event.clientY < rect.top || event.clientY > rect.bottom) hide();
    } else hide();
  };
  const stopDrag = (commit = false) => {
    const current = drag; drag = null; line.hidden = true; editor.classList.remove('dsh-dragging-paragraph');
    if (current && grip.hasPointerCapture(current.pointerId)) grip.releasePointerCapture(current.pointerId);
    if (commit && current?.moving && current.target && canEdit()) {
      moveBlock(current.id, current.target, current.after);
      announcer.textContent = '段落位置已调整，可用 Ctrl + Z 撤销';
      const moved = blocks().find(block => block.dataset.blockId === current.id);
      if (moved) position(moved);
    }
  };
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || !hovered || !canEdit()) return;
    event.preventDefault();
    drag = { id: hovered.dataset.blockId!, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moving: false, after: false };
    grip.setPointerCapture(event.pointerId);
  };
  const onUp = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) stopDrag(true); };
  const cancel = () => stopDrag();
  const onKey = (event: KeyboardEvent) => {
    if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopDrag(); return; }
    if (document.activeElement === grip && hovered && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && canEdit()) {
      event.preventDefault(); const all = blocks(); const index = all.indexOf(hovered), after = event.key === 'ArrowDown';
      const target = all[index + (after ? 1 : -1)];
      if (target) { moveBlock(hovered.dataset.blockId!, target.dataset.blockId!, after); position(hovered); grip.focus(); announcer.textContent = `段落已移动到第 ${all.indexOf(target) + 1} 段，可撤销`; }
    }
  };
  const onScroll = () => { if (hovered) position(hovered); line.hidden = true; };
  const onLeave = (event: PointerEvent) => { if (!event.relatedTarget && !drag) hide(); };
  const onInput = () => { gutter.hidden = true; hovered = null; };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('pointerout', onLeave);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('blur', cancel); window.addEventListener('resize', onScroll);
  grip.addEventListener('pointerdown', onDown);
  editor.addEventListener('beforeinput', onInput);
  return () => {
    stopDrag(); gutter.remove(); line.remove(); announcer.remove();
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cancel); document.removeEventListener('pointerout', onLeave);
    document.removeEventListener('keydown', onKey, true); document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('blur', cancel); window.removeEventListener('resize', onScroll);
    editor.removeEventListener('beforeinput', onInput);
  };
}
