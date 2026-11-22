export interface MenuItem {
  label: string;
  hint?: string;
  onPick: () => void;
}

let dismiss: (() => void) | undefined;
export const closeScriptMenu = () => dismiss?.();

export function openScriptMenu(anchor: HTMLElement, items: MenuItem[], page: AbortSignal) {
  closeScriptMenu();
  if (page.aborted) return;
  const menu = document.createElement('div');
  menu.id = 'dsh-script-menu';
  menu.className = 'dsh-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '本章 TXT 文件');
  const rect = anchor.getBoundingClientRect();
  menu.style.left = Math.round(rect.left) + 'px';
  menu.style.top = Math.round(rect.bottom + 6) + 'px';
  const events = new AbortController();
  const close = () => {
    events.abort();
    page.removeEventListener('abort', close);
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    dismiss = undefined;
  };
  dismiss = close;
  for (const item of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dsh-menu-item';
    row.setAttribute('role', 'menuitem');
    const main = document.createElement('span');
    main.className = 'dsh-menu-label';
    main.textContent = item.label;
    row.append(main);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'dsh-menu-hint';
      hint.textContent = item.hint;
      row.append(hint);
    }
    row.onclick = () => { close(); item.onPick(); };
    menu.append(row);
  }
  document.body.append(menu);
  anchor.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();
  page.addEventListener('abort', close, { once: true });
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !menu.contains(event.target) && !anchor.contains(event.target)) close();
  }, { capture: true, signal: events.signal });
  document.addEventListener('focusin', event => {
    if (event.target instanceof Node && !menu.contains(event.target) && event.target !== anchor) close();
  }, { signal: events.signal });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      anchor.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(menu.querySelectorAll('button'));
    if (!rows.length) return;
    const current = rows.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : current + (event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    rows[(next + rows.length) % rows.length].focus();
  });
}
