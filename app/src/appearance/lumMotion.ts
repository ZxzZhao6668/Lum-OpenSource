const animations = new Map<Element, Animation>();

function allowed() { return document.documentElement.dataset.lumMotion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches; }

export function revealLumSurface(element: HTMLElement) {
  if (!allowed() || !element.isConnected || element.hidden) return;
  animations.get(element)?.cancel();
  const animation = element.animate([{ opacity: .1 }, { opacity: 1 }], { duration: document.documentElement.dataset.lumMotion === 'full' ? 240 : 140, easing: 'cubic-bezier(.2,.8,.2,1)' });
  animations.set(element, animation);
  const release = () => { if (animations.get(element) === animation) animations.delete(element); };
  animation.finished.then(release).catch(release);
}

export function closeLumDialog(dialog: HTMLDialogElement) {
  if (!dialog.open) return;
  animations.get(dialog)?.cancel();
  if (!allowed()) { dialog.close(); return; }
  dialog.inert = true;
  const animation = dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in' });
  animations.set(dialog, animation);
  const finish = () => { if (animations.get(dialog) !== animation) return; animations.delete(dialog); dialog.inert = false; if (dialog.open) dialog.close(); };
  animation.finished.then(finish).catch(finish);
}

export function installLumMotion() {
  const selector = '.localDialog[open],.sbGenPanel,.dsh-dialog,.dsh-entity-dialog,.dsh-pv-dialog,.localPage,.productionMaterials,.wp-panel:not([hidden])';
  const queue = new Set<HTMLElement>();
  let frame = 0;
  const flush = () => { frame = 0; for (const el of queue) revealLumSurface(el); queue.clear(); };
  const observer = new MutationObserver(records => {
    if (!allowed()) return;
    for (const record of records) {
      if (record.type === 'attributes') { if (record.target instanceof HTMLElement && record.target.matches(selector)) queue.add(record.target); continue; }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(selector)) queue.add(node);
        else node.querySelectorAll<HTMLElement>(selector).forEach(el => queue.add(el));
      }
    }
    if (queue.size && !frame) frame = requestAnimationFrame(flush);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  const stop = () => { if (allowed() && !document.hidden) return; for (const animation of animations.values()) animation.cancel(); };
  window.addEventListener('lum:appearanceChanged', stop);
  document.addEventListener('visibilitychange', stop);
  return () => { observer.disconnect(); cancelAnimationFrame(frame); queue.clear(); for (const animation of animations.values()) animation.cancel(); animations.clear(); window.removeEventListener('lum:appearanceChanged', stop); document.removeEventListener('visibilitychange', stop); };
}
