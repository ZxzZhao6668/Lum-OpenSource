/** Brand introduction only; it never waits for or represents a model/project task. */
export function installLumStartup() {
  let cover: HTMLElement | undefined;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let removalTimer: ReturnType<typeof setTimeout> | undefined;
  let previousFocus: HTMLElement | undefined;
  const inertSiblings = new Map<HTMLElement, boolean>();
  const sessionKey = 'lum:startupSeen:v1';
  const remove = () => {
    clearTimeout(dismissTimer); clearTimeout(removalTimer);
    const restoreFocus = Boolean(cover?.contains(document.activeElement));
    cover?.remove(); cover = undefined;
    for (const [element, wasInert] of inertSiblings) element.inert = wasInert;
    inertSiblings.clear();
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = undefined;
  };
  const dismiss = () => {
    if (!cover) return;
    clearTimeout(dismissTimer);
    if (document.documentElement.dataset.lumMotion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches) { remove(); return; }
    cover.classList.add('lumStartupLeaving');
    removalTimer = setTimeout(remove, 240);
  };
  const show = (preview = false) => {
    if (!preview && document.documentElement.dataset.lumStartup === 'off') return;
    if (!preview) {
      try { if (sessionStorage.getItem(sessionKey)) return; sessionStorage.setItem(sessionKey, '1'); } catch { /* The cover can still be skipped when storage is restricted. */ }
    }
    remove();
    cover = document.createElement('section');
    cover.className = 'lumStartup';
    cover.setAttribute('aria-label', 'Lum 启动封面');
    cover.setAttribute('role', 'dialog');
    cover.setAttribute('aria-modal', 'true');
    cover.innerHTML = `<div class="lumStartupAura" aria-hidden="true"></div>
      <svg class="lumStartupOrbit" viewBox="0 0 1000 600" fill="none" aria-hidden="true"><defs><linearGradient id="lumStartupGradient" x1="160" y1="470" x2="830" y2="130" gradientUnits="userSpaceOnUse"><stop stop-color="#12b9ce"/><stop offset=".4" stop-color="#7136cf"/><stop offset=".7" stop-color="#e74d8f"/><stop offset="1" stop-color="#ffc567"/></linearGradient></defs><path class="lumStartupRibbon" d="M 180 380 C -20 550 680 480 846 205 C 940 40 515 158 292 280" stroke="url(#lumStartupGradient)"/><path class="lumStartupThread" d="M 160 360 C 50 515 740 425 866 170 C 911 58 544 160 292 275" stroke="url(#lumStartupGradient)"/><g class="lumStartupSparks" fill="url(#lumStartupGradient)"><circle cx="196" cy="422" r="2"/><circle cx="738" cy="176" r="3"/><circle cx="855" cy="236" r="2"/><circle cx="312" cy="450" r="2.5"/><circle cx="610" cy="129" r="2"/></g></svg>
      <div class="lumStartupArt"><img src="/brand/lumLogo.png" alt="Lum 影纪" draggable="false"><div class="lumStartupCopy"><p class="lumStartupChinese">Lum · 影纪：让想象先成为画面</p><p class="lumStartupEnglish" lang="en">Lum — Trace the light, record the scene</p></div></div><button class="lumStartupSkip" type="button">跳过 <span aria-hidden="true">↗</span></button>`;
    cover.querySelector('button')?.addEventListener('click', dismiss);
    cover.querySelector('img')?.addEventListener('error', remove, { once: true });
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    for (const element of document.body.children) {
      if (!(element instanceof HTMLElement) || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') continue;
      inertSiblings.set(element, element.inert); element.inert = true;
    }
    document.body.append(cover);
    cover.querySelector('button')?.focus({ preventScroll: true });
    const reduced = document.documentElement.dataset.lumMotion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    dismissTimer = setTimeout(dismiss, reduced ? 180 : 2800);
  };
  const preview = () => show(true);
  const escape = (event: KeyboardEvent) => {
    if (!cover) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); dismiss(); }
    if (event.key === 'Tab') { event.preventDefault(); cover.querySelector('button')?.focus({ preventScroll: true }); }
  };
  const preferences = () => { if (document.documentElement.dataset.lumStartup === 'off') remove(); };
  window.addEventListener('lum:startupPreview', preview);
  window.addEventListener('lum:appearanceChanged', preferences);
  window.addEventListener('keydown', escape, true);
  if (window.parent === window) show();
  return () => { remove(); window.removeEventListener('lum:startupPreview', preview); window.removeEventListener('lum:appearanceChanged', preferences); window.removeEventListener('keydown', escape, true); };
}
