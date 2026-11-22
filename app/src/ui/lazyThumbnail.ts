type ThumbnailSource = {key: string; load(): Promise<string>; prepared?: boolean};
const cache = new Map<string, Blob>();
let cacheBytes = 0;
let queue = Promise.resolve();
const visibility = new WeakMap<Element, (visible: boolean) => void>();
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) visibility.get(entry.target)?.(entry.isIntersecting);
}, {rootMargin: '120px'});

async function thumbnail(source: string) {
  // Hash inline originals rather than retaining their large data URLs as cache keys.
  const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const existing = cache.get(key);
  if (existing) { cache.delete(key); cache.set(key, existing); return existing; }
  const response = await fetch(source);
  if (!response.ok) throw Error('图片无法读取');
  let bitmap:ImageBitmap|HTMLImageElement;
  try{bitmap=await createImageBitmap(await response.blob());}
  catch{
    // Chromium's bitmap decoder rejects some uploads that its image decoder supports.
    const image=new Image();image.src=source;
    try{await image.decode();bitmap=image;}catch(error){image.removeAttribute('src');throw error;}
  }
  const canvas = document.createElement('canvas');
  try {
    const width=bitmap instanceof HTMLImageElement?bitmap.naturalWidth:bitmap.width;
    const height=bitmap instanceof HTMLImageElement?bitmap.naturalHeight:bitmap.height;
    const scale = Math.min(1, 640 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('缩略图生成失败')), 'image/webp', .86));
    cache.set(key, blob); cacheBytes += blob.size;
    while (cache.size > 128 || cacheBytes > 16 * 1024 * 1024) {
      const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.size; cache.delete(oldest);
    }
    return blob;
  } finally { if(bitmap instanceof HTMLImageElement)bitmap.removeAttribute('src');else bitmap.close(); canvas.width = canvas.height = 1; }
}

/** Serial original decoding, bounded small-image cache, and offscreen URL release. */
export function mountLazyThumbnail(box: HTMLElement, label: string, source: () => ThumbnailSource | undefined) {
  let visible = false, disposed = false, version = 0, current = '', url = '';
  let image: HTMLImageElement | undefined;
  const clear = () => {
    image?.removeAttribute('src'); image?.remove(); image = undefined;
    if (url) URL.revokeObjectURL(url);
    url = ''; box.classList.remove('hasImage');
  };
  const refresh = () => {
    if (disposed || !visible) return;
    const next = source();
    if ((next?.key ?? '') === current) return;
    current = next?.key ?? ''; const request = ++version; clear();
    if (!next) return;
    const active = () => !disposed && visible && request === version && box.isConnected;
    queue = queue.then(async () => {
      if (!active()) return;
      const original = await next.load();
      if (!active()) return;
      const blob = next.prepared ? await (await fetch(original)).blob() : await thumbnail(original);
      if (!active()) return;
      url = URL.createObjectURL(blob); image = document.createElement('img');
      image.src = url; image.alt = label; image.draggable = false; image.decoding = 'async';
      box.prepend(image); box.classList.add('hasImage'); box.title = '';
    }).catch(() => { if (active()) { current = ''; box.title = '图片暂时无法读取，请重试'; } });
  };
  visibility.set(box, inView => {
    visible = inView;
    if (visible) refresh(); else { version++; current = ''; clear(); }
  });
  observer.observe(box);
  return {refresh, dispose() { disposed = true; version++; observer.unobserve(box); visibility.delete(box); clear(); }};
}
