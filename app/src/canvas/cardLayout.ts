export type LayoutPoint = { x: number; y: number };
export type LayoutItem = LayoutPoint & { id: string; element: HTMLElement; width: number; height: number };
export type LayoutMode = 'horizontal' | 'vertical' | 'grid';

/** Position-only layout: stable input order, variable card heights, no content mutation. */
export function arrangeCardPositions(items: Array<Omit<LayoutItem, 'element'>>, mode: LayoutMode) {
  const result: Record<string, LayoutPoint> = {};
  if (!items.length) return result;
  const left = Math.min(...items.map(item => item.x)), top = Math.min(...items.map(item => item.y));
  const columns = mode === 'horizontal' ? items.length : mode === 'vertical' ? 1 : Math.ceil(Math.sqrt(items.length));
  let y = top;
  for (let offset = 0; offset < items.length; offset += columns) {
    const row = items.slice(offset, offset + columns); let x = left;
    for (const item of row) { result[item.id] = { x, y }; x += item.width + 40; }
    y += Math.max(...row.map(item => item.height)) + 48;
  }
  return result;
}

export function mountCardLayout(options: {
  viewport: HTMLElement; toolbar: HTMLElement; cardSelector: string;
  items(): LayoutItem[]; active(): boolean;
  apply(positions: Record<string, LayoutPoint>): void;
  commit(): Promise<unknown>;
  error(message: string): void;
}) {
  const { viewport, toolbar } = options;
  const selected = new Set<string>();
  const history: Array<{ before: Record<string, LayoutPoint>; after: Record<string, LayoutPoint> }> = [];
  let selecting = false, busy = false;
  let gesture: { id: number; x: number; y: number; before: string[]; additive: boolean } | undefined;
  const controls = document.createElement('div'); controls.className = 'lumLayoutTools'; controls.setAttribute('role','group'); controls.setAttribute('aria-label','框选与排列');
  const makeButton = (label: string, fn: () => void) => { const button = document.createElement('button'); button.type='button';button.textContent=label;button.className='sbButton';button.onclick=fn;controls.append(button);return button; };
  const selectButton = makeButton('框选', () => { selecting=!selecting;refresh();viewport.focus({preventScroll:true}); });
  selectButton.title='切换框选工具；也可按住 Shift 在空白处拖动框选';
  const count = document.createElement('span');count.className='lumSelectionCount';count.setAttribute('role','status');controls.append(count);
  makeButton('全选', () => { options.items().forEach(item=>selected.add(item.id));refresh(); });
  makeButton('取消选择', () => { selected.clear();refresh(); });
  const modeSelect=document.createElement('select');modeSelect.setAttribute('aria-label','卡片排列方式');
  for(const [value,label] of [['grid','宫格排列'],['horizontal','横向排列'],['vertical','垂直排列']]){const option=document.createElement('option');option.value=value;option.textContent=label;modeSelect.append(option);}controls.append(modeSelect);
  const arrangeButton=makeButton('整理画布',()=>void arrange(modeSelect.value as LayoutMode));
  const undoButton=makeButton('撤销排列',()=>void undo());
  toolbar.append(controls);
  const marquee=document.createElement('div');marquee.className='lumSelectionMarquee';marquee.hidden=true;marquee.setAttribute('aria-hidden','true');viewport.append(marquee);
  if(viewport.tabIndex<0)viewport.tabIndex=0;
  const positions=(items:LayoutItem[])=>Object.fromEntries(items.map(item=>[item.id,{x:item.x,y:item.y}]));
  function refresh() {
    const items=options.items(), ids=new Set(items.map(item=>item.id));
    for(const id of selected)if(!ids.has(id))selected.delete(id);
    items.forEach(item=>item.element.classList.toggle('lumCardSelected',selected.has(item.id)));
    controls.hidden=!options.active();viewport.classList.toggle('lumSelecting',selecting&&options.active());
    selectButton.setAttribute('aria-pressed',String(selecting));count.textContent=selected.size?`已选 ${selected.size}`:'未选 · 整理全部';
    controls.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('button,select').forEach(button=>button.disabled=busy||!options.active());
    arrangeButton.disabled=busy||!items.length||!options.active();undoButton.disabled=busy||!history.length||!options.active();
  }
  async function arrange(mode:LayoutMode) {
    if(busy||!options.active())return;
    const items=options.items().filter(item=>!selected.size||selected.has(item.id));if(!items.length)return;
    const before=positions(items),after=arrangeCardPositions(items,mode);
    if(JSON.stringify(before)===JSON.stringify(after))return;
    history.push({before,after});if(history.length>30)history.shift();busy=true;
    try { options.apply(after);refresh();await options.commit(); }
    catch(error){options.error(error instanceof Error?error.message:String(error));}
    finally{busy=false;refresh();}
  }
  async function undo() {
    if(busy||!options.active())return;const last=history.at(-1);if(!last)return;
    const current=new Map(options.items().map(item=>[item.id,item]));
    if(Object.entries(last.after).some(([id,p])=>!current.has(id)||current.get(id)!.x!==p.x||current.get(id)!.y!==p.y)){options.error('卡片位置已发生其他修改，本次不会覆盖；请重新整理。');history.length=0;refresh();return;}
    busy=true;history.pop();
    try{options.apply(last.before);refresh();await options.commit();}
    catch(error){options.error(error instanceof Error?error.message:String(error));}
    finally{busy=false;refresh();}
  }
  function finish(cancel=false){
    if(!gesture)return;
    const previous=gesture;gesture=undefined;
    if(cancel){selected.clear();previous.before.forEach(id=>selected.add(id));}
    marquee.hidden=true;try{if(viewport.hasPointerCapture(previous.id))viewport.releasePointerCapture(previous.id);}catch{}
    refresh();
  }
  const interactive='button,input,textarea,select,summary,a,[contenteditable="true"],.sbScriptPanel,.lumLayoutTools,.sbControls,.dsh-canvas-tools';
  const down=(event:PointerEvent)=>{
    if(!options.active()||busy||event.button!==0||!(event.target instanceof Element)||event.target.closest(interactive))return;
    const card=event.target.closest(options.cardSelector), item=card?options.items().find(item=>item.element===card):undefined;
    if(item){
      if(event.shiftKey){if(selected.has(item.id))selected.delete(item.id);else selected.add(item.id);event.preventDefault();event.stopImmediatePropagation();}
      else if(!selected.has(item.id)){selected.clear();selected.add(item.id);}
      refresh();return;
    }
    if(!selecting&&!event.shiftKey){selected.clear();refresh();return;}
    event.preventDefault();event.stopImmediatePropagation();viewport.focus({preventScroll:true});
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,before:[...selected],additive:event.shiftKey};
    viewport.setPointerCapture(event.pointerId);marquee.hidden=false;move(event);
  };
  const move=(event:PointerEvent)=>{
    if(!gesture||event.pointerId!==gesture.id)return;event.preventDefault();event.stopImmediatePropagation();
    const left=Math.min(gesture.x,event.clientX),top=Math.min(gesture.y,event.clientY),right=Math.max(gesture.x,event.clientX),bottom=Math.max(gesture.y,event.clientY),box=viewport.getBoundingClientRect();
    Object.assign(marquee.style,{left:`${left-box.left}px`,top:`${top-box.top}px`,width:`${right-left}px`,height:`${bottom-top}px`});
    selected.clear();if(gesture.additive)gesture.before.forEach(id=>selected.add(id));
    if(right-left>3||bottom-top>3)options.items().forEach(item=>{const r=item.element.getBoundingClientRect();if(r.right>=left&&r.left<=right&&r.bottom>=top&&r.top<=bottom)selected.add(item.id);});refresh();
  };
  const up=(event:PointerEvent)=>{if(!gesture||event.pointerId!==gesture.id)return;event.preventDefault();event.stopImmediatePropagation();finish(event.type!=='pointerup');};
  const lost=(event:PointerEvent)=>{if(gesture?.id===event.pointerId)finish(true);};
  const wheel=(event:WheelEvent)=>{if(gesture){event.preventDefault();event.stopImmediatePropagation();}};
  const key=(event:KeyboardEvent)=>{
    if(!options.active()||event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(event.key==='Escape'){if(gesture)finish(true);else{selected.clear();selecting=false;refresh();}event.preventDefault();event.stopPropagation();}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();options.items().forEach(item=>selected.add(item.id));refresh();}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&history.length){event.preventDefault();event.stopPropagation();void undo();}
  };
  viewport.addEventListener('pointerdown',down,true);viewport.addEventListener('pointermove',move,true);viewport.addEventListener('pointerup',up,true);viewport.addEventListener('pointercancel',up,true);viewport.addEventListener('lostpointercapture',lost);viewport.addEventListener('wheel',wheel,{capture:true,passive:false});viewport.addEventListener('keydown',key);
  const reset=()=>{finish(true);selected.clear();history.length=0;refresh();};
  const destroy=()=>{finish(true);viewport.removeEventListener('pointerdown',down,true);viewport.removeEventListener('pointermove',move,true);viewport.removeEventListener('pointerup',up,true);viewport.removeEventListener('pointercancel',up,true);viewport.removeEventListener('lostpointercapture',lost);viewport.removeEventListener('wheel',wheel,true);viewport.removeEventListener('keydown',key);controls.remove();marquee.remove();};
  refresh();return {refresh,reset,destroy,arrange:()=>arrange(modeSelect.value as LayoutMode)};
}
