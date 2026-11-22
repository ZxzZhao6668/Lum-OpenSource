/** Desktop builds use an isolated loopback service without changing the browser edition. */
export const canvasOrigin = import.meta.env.VITE_CANVAS_ORIGIN || 'http://127.0.0.1:5181';

/** Older embedded canvases use the original prefix for the same response types. */
export function lumBridgeType(type: unknown): string | undefined {
  if (typeof type !== 'string') return undefined;
  return type.startsWith('toonflow:') ? 'lum:' + type.slice('toonflow:'.length) : type;
}
