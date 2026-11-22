/** Page-independent launcher position; remounting the writing page keeps the same place. */
export function mountFloatingLauncher(launch: HTMLElement): () => void {
  const view = launch.ownerDocument.defaultView!;
  const storageKey = 'writing:launcher-position';
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  type Point = { x: number; y: number };
  let position: Point | undefined;
  let drag: { id: number; x: number; y: number; left: number; top: number; original?: Point; moved: boolean } | undefined;
  let suppressClick = false;

  function place(next: Point) {
    const width = launch.offsetWidth || 130, height = launch.offsetHeight || 44;
    const gapX = Math.min(8, Math.max(0, view.innerWidth - width) / 2);
    const gapY = Math.min(8, Math.max(0, view.innerHeight - height) / 2);
    position = {
      x: Math.max(gapX, Math.min(next.x, view.innerWidth - width - gapX)),
      y: Math.max(gapY, Math.min(next.y, view.innerHeight - height - gapY)),
    };
    Object.assign(launch.style, { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' });
  }
  function save() {
    try { view.localStorage.setItem(storageKey, JSON.stringify(position)); } catch { /* Storage restrictions do not disable dragging. */ }
  }
  try {
    const saved = JSON.parse(view.localStorage.getItem(storageKey) ?? 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved);
  } catch { /* Keep the default corner position when storage is unavailable. */ }

  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    event.preventDefault();
    drag.moved = true; suppressClick = true;
    launch.classList.add('wp-launch-dragging');
    place({ x: drag.left + dx, y: drag.top + dy });
  }
  function finish(event?: PointerEvent, cancelled = false) {
    if (!drag || event && event.pointerId !== drag.id) return;
    if (!cancelled && event) move(event);
    const current = drag; drag = undefined;
    if (cancelled) {
      suppressClick = true;
      position = current.original;
      if (position) place(position);
      else for (const key of ['left', 'top', 'right', 'bottom']) launch.style.removeProperty(key);
    } else if (current.moved) save();
    launch.classList.remove('wp-launch-dragging');
    if (launch.hasPointerCapture(current.id)) launch.releasePointerCapture(current.id);
  }
  const cancel = () => finish(undefined, true);
  launch.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    const rect = launch.getBoundingClientRect();
    suppressClick = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, original: position, moved: false };
    launch.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }, options);
  launch.addEventListener('pointermove', move, options);
  launch.addEventListener('pointerup', event => finish(event), options);
  launch.addEventListener('pointercancel', event => finish(event, true), options);
  launch.addEventListener('lostpointercapture', event => finish(event, true), options);
  launch.addEventListener('dragstart', event => event.preventDefault(), options);
  launch.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    suppressClick = false;
  }, { ...options, capture: true });
  view.addEventListener('blur', cancel, options);
  view.addEventListener('resize', () => { cancel(); if (position) place(position); }, options);
  return () => { cancel(); lifetime.abort(); };
}
