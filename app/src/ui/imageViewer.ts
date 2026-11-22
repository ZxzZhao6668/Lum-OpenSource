import './imageViewer.css';

let closeCurrent: (() => void) | undefined;

/** Opens only the supplied image; viewing never changes a selected output. */
export function openImageViewer(source: string | Blob | Promise<string | Blob>, label = '图片') {
  closeCurrent?.();
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const lifetime = new AbortController();
  const dialog = document.createElement('dialog');
  dialog.className = 'imageViewer';
  dialog.setAttribute('aria-label', '查看图片');
  const header = document.createElement('header');
  const title = document.createElement('strong'); title.textContent = label;
  const toolbar = document.createElement('div'); toolbar.className = 'imageViewerToolbar';
  const stage = document.createElement('div'); stage.className = 'imageViewerStage';
  const img = document.createElement('img'); img.className = 'imageViewerImage'; img.alt = label; img.draggable = false; img.hidden = true;
  const status = document.createElement('p'); status.className = 'imageViewerStatus'; status.setAttribute('role', 'status'); status.textContent = '正在读取图片…';
  const percent = document.createElement('output'); percent.setAttribute('aria-label', '缩放比例');
  let ownUrl = '';
  let ready = false, closed = false, scale = 1, x = 0, y = 0, fitting = true;
  let pointer: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | undefined;
  let dragged = false, backdropPressed = false;
  const close = () => {
    if (closed) return;
    closed = true; lifetime.abort(); img.removeAttribute('src'); dialog.close(); dialog.remove();
    if (ownUrl) URL.revokeObjectURL(ownUrl);
    if (closeCurrent === close) closeCurrent = undefined;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const button = (text: string, label: string, run: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label);
    b.addEventListener('click', run, { signal: lifetime.signal }); return b;
  };
  const render = () => {
    img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    percent.textContent = `${Math.round(scale * 100)}%`;
  };
  const fit = () => {
    if (!ready) return;
    fitting = true; x = y = 0;
    scale = Math.min(1, Math.max(1, stage.clientWidth - 32) / img.naturalWidth, Math.max(1, stage.clientHeight - 32) / img.naturalHeight);
    render();
  };
  const zoom = (value: number, px = 0, py = 0) => {
    if (!ready) return;
    fitting = false;
    const next = Math.max(0.01, Math.min(8, value));
    x = px - (px - x) * next / scale; y = py - (py - y) * next / scale; scale = next; render();
  };
  const zoomOut = button('−', '缩小', () => zoom(scale / 1.25));
  const zoomIn = button('＋', '放大', () => zoom(scale * 1.25));
  const actual = button('100%', '100%', () => { x = y = 0; zoom(1); });
  const fitButton = button('适应窗口', '适应窗口', fit);
  const controls = [zoomOut, zoomIn, actual, fitButton]; controls.forEach(b => b.disabled = true);
  const download = document.createElement('a'); download.textContent = '下载图片'; download.download = `${label}.png`; download.hidden = true;
  const closeButton = button('关闭', '关闭', close);
  toolbar.append(zoomOut, percent, zoomIn, actual, fitButton, download, closeButton);
  header.append(title, toolbar); stage.append(img, status); dialog.append(header, stage);
  const fail = () => {
    if (closed) return;
    ready = false; img.hidden = true; controls.forEach(b => b.disabled = true); download.hidden = true;
    status.hidden = false; status.textContent = '图片加载失败，请关闭后重试。';
  };
  img.addEventListener('load', () => {
    if (closed || !img.naturalWidth) return;
    ready = true; img.hidden = false; status.hidden = true; controls.forEach(b => b.disabled = false); download.hidden = false; fit();
  }, { signal: lifetime.signal });
  img.addEventListener('error', fail, { signal: lifetime.signal });
  stage.addEventListener('wheel', event => {
    event.preventDefault(); const rect = stage.getBoundingClientRect();
    zoom(scale * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  }, { passive: false, signal: lifetime.signal });
  stage.addEventListener('pointerdown', event => {
    dragged = false;
    backdropPressed = event.target === stage;
    if (event.button !== 0 || !ready) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: x, startY: y, moved: false };
    stage.setPointerCapture(event.pointerId); stage.classList.add('isDragging'); event.preventDefault();
  }, { signal: lifetime.signal });
  stage.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 4) pointer.moved = true;
    if (pointer.moved) { fitting = false; x = pointer.startX + dx; y = pointer.startY + dy; render(); }
  }, { signal: lifetime.signal });
  const endPointer = () => {
    dragged = !!pointer?.moved;
    if (pointer && stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
    pointer = undefined; stage.classList.remove('isDragging');
  };
  stage.addEventListener('pointerup', endPointer, { signal: lifetime.signal });
  stage.addEventListener('pointercancel', endPointer, { signal: lifetime.signal });
  stage.addEventListener('lostpointercapture', () => { pointer = undefined; stage.classList.remove('isDragging'); }, { signal: lifetime.signal });
  dialog.addEventListener('click', event => { if (!dragged && (event.target === dialog || event.target === stage && backdropPressed)) close(); }, { signal: lifetime.signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal: lifetime.signal });
  dialog.addEventListener('close', close, { signal: lifetime.signal });
  // Capture before document-level shortcuts so Esc cannot close the underlying editor.
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); zoom(scale * (event.key === '-' ? 0.8 : 1.25)); }
  }, { capture: true, signal: lifetime.signal });
  window.addEventListener('resize', () => { if (fitting) fit(); }, { signal: lifetime.signal });
  window.addEventListener('dsh:nav', close, { signal: lifetime.signal });
  document.body.append(dialog); dialog.showModal(); closeCurrent = close; closeButton.focus();
  void Promise.resolve(source).then(value => {
    if (closed) return;
    if (!value) { fail(); return; }
    const url = typeof value === 'string' ? value : (ownUrl = URL.createObjectURL(value));
    if (value instanceof Blob) {
      const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[value.type];
      if (ext) download.download = label + '.' + ext;
    }
    download.href = url; img.src = url;
  }).catch(fail);
}

export function bindImagePreview(img: HTMLImageElement, source: () => string | Promise<string> = () => img.currentSrc || img.getAttribute('src') || '', label = img.alt || '图片') {
  img.classList.add('imagePreviewTrigger'); img.draggable = false; img.tabIndex = 0;
  img.setAttribute('role', 'button'); img.setAttribute('aria-label', `放大查看${label}`); img.title = '点击放大查看';
  const open = () => { const value = source(); if (value) openImageViewer(value, label); };
  img.addEventListener('click', event => { event.stopPropagation(); img.focus({ preventScroll: true }); open(); });
  img.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(); }
  });
}
