import { db, loadDoc, saveDoc } from "../data/db";
import { registerContentEditor } from '../writing/contentEditor';
import {mountCardLayout} from '../canvas/cardLayout';

type ViewState = { x: number; y: number; scale: number };
type CardPos = { x: number; y: number };
type CanvasState = { view: ViewState; nodes: Record<string, CardPos> };



const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export async function mountSceneCanvas(root: HTMLElement, episodeId = "ep_001") {
  const KEY = `scenes:canvas:${episodeId}`;
  const host = root.querySelector<HTMLElement>('[data-scene-cards]');
  if (!host || host.querySelector('.dsh-canvas')) return;
  const cards = Array.from(host.querySelectorAll<HTMLElement>('article[data-scene-block-id]'));
  if (!cards.length) return;

  const canvas = document.createElement("div");
  canvas.className = "dsh-canvas";

  const layer = document.createElement("div");
  layer.className = "dsh-canvas-layer";
  canvas.appendChild(layer);

  const stored=await loadDoc<CanvasState>(KEY);
  let storedJson=JSON.stringify(stored);
  const state: CanvasState = stored ?? {
    view: { x: 0, y: 0, scale: 1 },
    nodes: {},
  };
  if (!cards[0].isConnected) return;

  // 把卡片搬进画布节点
  const nodes: { el: HTMLElement; label: string }[] = [];
  cards.forEach((card, i) => {
    const label = `block:${card.dataset.sceneBlockId}`;
    const node = document.createElement("div");
    node.className = "dsh-canvas-node";
    node.dataset.sceneLabel = label;

    card.style.width = "100%";
    node.appendChild(card);

    const pos = state.nodes[label] ?? {
      x: (i % 3) * 320,
      y: Math.floor(i / 3) * 360,
    };
    state.nodes[label] = pos;
    node.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    node.style.zIndex = String(i + 1);

    layer.appendChild(node);
    nodes.push({ el: node, label });
  });

  host.replaceChildren(canvas);

  const applyView = () => {
    layer.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
    zoomLabel.textContent = `${Math.round(state.view.scale * 100)}%`;
    // 点阵随文档坐标缩放和平移。
    const step = 23 * state.view.scale;
    const r = Math.min(1.8, Math.max(0.7, state.view.scale));
    canvas.style.setProperty("--dsh-dot", `${step}px`);
    canvas.style.backgroundImage = `radial-gradient(circle, var(--lum-dot,#d1d5db) ${r}px, transparent ${r}px)`;
    canvas.style.backgroundPosition = `${state.view.x}px ${state.view.y}px`;
  };

  // 缩放工具条
  const tools = document.createElement("div");
  tools.className = "dsh-canvas-tools";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "dsh-canvas-tool";
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "缩小画布");

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "dsh-canvas-zoom";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "dsh-canvas-tool";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "放大画布");

  const fit = document.createElement("button");
  fit.type = "button";
  fit.className = "dsh-canvas-tool";
  fit.title = "适应画面";
  fit.setAttribute("aria-label", "适应画面");
  fit.textContent = "⤢";

  tools.append(zoomOut, zoomLabel, zoomIn, fit);
  canvas.appendChild(tools);

  let timer:ReturnType<typeof setTimeout>|undefined;let queue=Promise.resolve();let committed=JSON.stringify(state);
  const status=document.createElement('span');status.className='localStatus';tools.append(status);
  let isActive=()=>false;
  const persist=()=>{
    clearTimeout(timer);const snapshot=structuredClone(state),serialized=JSON.stringify(snapshot);
    queue=queue.catch(()=>{}).then(async()=>{
      if(!isActive())throw Error('场次页面已离开，未保存旧页面布局');
      if(serialized===committed)return;
      await db.transaction('rw',db.docs,async()=>{
        if(JSON.stringify(await loadDoc(KEY))!==storedJson)throw Error('场次布局已在其他页面修改，请重新打开后再编辑');
        await saveDoc(KEY,snapshot);storedJson=serialized;
      });committed=serialized;
    });return queue.then(()=>{status.textContent=JSON.stringify(state)===committed?'已保存':'保存中…';});
  };
  const save=()=>{clearTimeout(timer);status.textContent='保存中…';timer=setTimeout(()=>void persist().catch(()=>{status.textContent='保存失败，请勿关闭页面';}),300);};
  isActive=registerContentEditor(canvas,{hasUnsavedChanges:()=>JSON.stringify(state)!==committed,flush:persist,reload:async()=>{throw Error('请重新打开场次页以刷新布局');}});

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const next = clamp(state.view.scale * factor, 0.25, 2);
    const k = next / state.view.scale;
    state.view.x = cx - (cx - state.view.x) * k;
    state.view.y = cy - (cy - state.view.y) * k;
    state.view.scale = next;
    applyView();
    save();
  };

  const rect = () => canvas.getBoundingClientRect();

  const fitView = () => {
    const r = rect();
    const boxes = nodes.map((n) => {
      const p = state.nodes[n.label];
      return { x: p.x, y: p.y, w: n.el.offsetWidth, h: n.el.offsetHeight };
    });
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const pad = 48;
    const scale = clamp(
      Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY), 1),
      0.25,
      1.4,
    );
    state.view.scale = scale;
    state.view.x = (r.width - (maxX - minX) * scale) / 2 - minX * scale;
    state.view.y = (r.height - (maxY - minY) * scale) / 2 - minY * scale;
    applyView();
    save();
  };

  zoomOut.onclick = () => {
    const r = rect();
    zoomAt(1 / 1.15, r.width / 2, r.height / 2);
  };
  zoomIn.onclick = () => {
    const r = rect();
    zoomAt(1.15, r.width / 2, r.height / 2);
  };
  fit.onclick = () => fitView();

  // 滚轮：平移 / Ctrl 缩放
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = rect();
        zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.x, e.clientY - r.y);
      } else {
        state.view.x -= e.deltaX;
        state.view.y -= e.deltaY;
        applyView();
        save();
      }
    },
    { passive: false },
  );

  // 空白处拖拽平移
  let panning = false;
  let panStart = { x: 0, y: 0, vx: 0, vy: 0 };

  canvas.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".dsh-canvas-node, .dsh-canvas-tools")) return;
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
    canvas.classList.add("is-panning");
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!panning) return;
    state.view.x = panStart.vx + (e.clientX - panStart.x);
    state.view.y = panStart.vy + (e.clientY - panStart.y);
    applyView();
  });

  const endPan = (e: PointerEvent) => {
    if (!panning) return;
    panning = false;
    canvas.classList.remove("is-panning");
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    save();
  };
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);

  // 卡片拖动
  for (const entry of nodes) {
    const node: HTMLElement = entry.el;
    let dragging = false;
    let start = { x: 0, y: 0, nx: 0, ny: 0 };
    let moved = false;

    node.addEventListener("pointerdown", (e) => {
      const target = e.target as HTMLElement;
      // 按钮与卡片内容照常点击
      if (target.closest("button")) return;
      dragging = true;
      moved = false;
      const p = state.nodes[entry.label];
      start = { x: e.clientX, y: e.clientY, nx: p.x, ny: p.y };
      node.classList.add("is-dragging");
      node.style.zIndex = String(1000 + nodes.length);

      const onMove = (ev: PointerEvent) => {
        if (!dragging) return;
        const dx = (ev.clientX - start.x) / state.view.scale;
        const dy = (ev.clientY - start.y) / state.view.scale;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (!moved) return;
        const cur = state.nodes[entry.label];
        cur.x = start.nx + dx;
        cur.y = start.ny + dy;
        node.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (!dragging) return;
        dragging = false;
        node.classList.remove("is-dragging");
        if (moved) {
          node.dataset.dshMoved = "1";
          save();
          window.setTimeout(() => delete node.dataset.dshMoved, 120);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      e.preventDefault();
      e.stopPropagation();
    });

    node.addEventListener(
      "click",
      (e) => {
        if (node.dataset.dshMoved === "1") {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
  }

  const cardLayout=mountCardLayout({viewport:canvas,toolbar:tools,cardSelector:'.dsh-canvas-node',active:()=>isActive(),
    items:()=>nodes.map(entry=>({id:entry.label,element:entry.el,...state.nodes[entry.label],width:entry.el.offsetWidth,height:entry.el.offsetHeight})),
    apply:positions=>{for(const entry of nodes){const p=positions[entry.label];if(!p)continue;state.nodes[entry.label]={...p};entry.el.style.transform=`translate3d(${p.x}px, ${p.y}px, 0)`;}},
    commit:persist,error:message=>{status.textContent=message;}});
  const sceneList = root.querySelector<HTMLElement>('[data-scene-list]');
  const jump = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button[data-scene-block-id]') : null;
    if (!button || !isActive()) return;
    const entry = nodes.find(node => node.label === 'block:' + button.dataset.sceneBlockId);
    if (!entry) return;
    const pos = state.nodes[entry.label];
    const bounds = rect();
    state.view.x = bounds.width / 2 - (pos.x + entry.el.offsetWidth / 2) * state.view.scale;
    state.view.y = bounds.height / 2 - (pos.y + entry.el.offsetHeight / 2) * state.view.scale;
    applyView();
    save();
  };
  sceneList?.addEventListener('click', jump);
  const detach = new MutationObserver(() => {
    if (canvas.isConnected) return;
    clearTimeout(timer);
    sceneList?.removeEventListener('click', jump);
    cardLayout.destroy();
    detach.disconnect();
  });
  detach.observe(root, { childList: true, subtree: true });
  applyView();
  if (!stored) fitView();
}
