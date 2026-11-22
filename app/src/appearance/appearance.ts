import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
export type LumAppearance = {
  theme: 'lime' | 'white' | 'black';
  motion: 'gentle' | 'full' | 'off';
  glass: boolean;
  primaryColor: string;
  fontScale: number;
  radius: number;
  startupAnimation: boolean;
};

const appearanceKey = 'lum:appearance:v1';

const defaults: LumAppearance = { theme: 'lime', motion: 'full', glass: true, primaryColor: '#b7f45a', fontScale: 100, radius: 12, startupAnimation: true };

function validateAppearance(value: unknown): LumAppearance | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  if (!['lime', 'white', 'black'].includes(String(item.theme)) || !['gentle', 'full', 'off'].includes(String(item.motion))
    || typeof item.glass !== 'boolean' || typeof item.primaryColor !== 'string' || !/^#[\da-f]{6}$/i.test(item.primaryColor)
    || typeof item.fontScale !== 'number' || !Number.isFinite(item.fontScale) || item.fontScale < 85 || item.fontScale > 125
    || typeof item.radius !== 'number' || !Number.isFinite(item.radius) || item.radius < 0 || item.radius > 16) return;
  return { theme: item.theme as LumAppearance['theme'], motion: item.motion as LumAppearance['motion'], glass: item.glass, primaryColor: item.primaryColor, fontScale: item.fontScale, radius: item.radius, startupAnimation: item.startupAnimation !== false };
}

export function foreground(color: string) {
  const values = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722 > .179 ? '#171a15' : '#ffffff';
}

export function initializeAppearance() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let appearance = defaults;
  try { appearance = validateAppearance(JSON.parse(localStorage.getItem(appearanceKey) || 'null')) || defaults; } catch { /* Storage may be unavailable; keep usable defaults. */ }
  const apply = () => {
    const root = document.documentElement;
    root.dataset.lumTheme = appearance.theme;
    root.dataset.lumMotion = reduce.matches ? 'off' : appearance.motion;
    root.dataset.lumGlass = appearance.glass ? 'on' : 'off';
    root.dataset.lumStartup = appearance.startupAnimation ? 'on' : 'off';
    root.classList.toggle('dark', appearance.theme === 'black');
    root.style.colorScheme = appearance.theme === 'black' ? 'dark' : 'light';
    root.style.fontSize = `${16 * appearance.fontScale / 100}px`;
    root.style.setProperty('--lum-accent', appearance.primaryColor);
    root.style.setProperty('--lum-on-accent', foreground(appearance.primaryColor));
    root.style.setProperty('--lum-radius', `${appearance.radius}px`);
    window.dispatchEvent(new Event('lum:appearanceChanged'));
  };
  const receive = (event: MessageEvent) => {
    if (event.origin !== canvasOrigin || !event.source) return;
    const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-production-frame]')].find(el => el.contentWindow === event.source);
    if (!frame) return;
    if (event.data?.type === 'lum:startupPreview') { window.dispatchEvent(new Event('lum:startupPreview')); return; }
    if (lumBridgeType(event.data?.type) === 'lum:ready') { frame.contentWindow?.postMessage({ type: 'lum:appearanceRequest' }, canvasOrigin); return; }
    if (event.data?.type !== 'lum:appearance') return;
    const next = validateAppearance(event.data.appearance);
    if (!next) return;
    appearance = next;
    try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)); } catch { /* Rendering is independent of caching. */ }
    apply();
  };
  window.addEventListener('message', receive);
  reduce.addEventListener('change', apply);
  apply();
  return () => { window.removeEventListener('message', receive); reduce.removeEventListener('change', apply); };
}
