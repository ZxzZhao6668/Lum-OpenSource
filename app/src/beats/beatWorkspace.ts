import { db,loadDoc,saveDoc } from '../data/db';
import { action,field,mainPanel,modal,node,downloadText } from '../ui/localUi';
import { showToast } from '../ui/toast';
import { registerContentEditor } from '../writing/contentEditor';
import { openWritingExport } from '../export/writingExport';
import { beatColors,changeBeats,validateBeats,type Beat } from './beatModel';
import './beatWorkspace.css';

const nav=(screen:string)=>window.dispatchEvent(new CustomEvent('dsh:nav',{detail:screen}));
const contrast=(color:string)=>{const channels=[1,3,5].map(at=>parseInt(color.slice(at,at+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2]>.179?'#263a30':'#f8fbf9';};
export function mountBeatEntry(root:HTMLElement) {
  root.querySelector('[data-outline-actions]')?.prepend(action('节拍',()=>{nav('13-beats');}));
}

export async function mountBeatWorkspace(root:HTMLElement,episodeId:string,isCurrent=()=>true) {
  const key=`beats:${episodeId}`,viewKey=`beatView:${episodeId}`;
  let beats=validateBeats(await loadDoc(key)??[]),saved=JSON.stringify(beats),active=()=>false;
  const preference=await loadDoc<{mode?:string;zoom?:number}>(viewKey);
  let mode=preference?.mode==='arrangement'?'arrangement':'beats',zoom=Math.min(4,Math.max(.5,preference?.zoom??1));
  if(!root.isConnected||!isCurrent())return;
  const {page,header,body}=mainPanel(root,'节拍');page.classList.add('beatWorkspace');
  const toc=root.querySelector<HTMLElement>('[data-page-index]');
  if(toc){toc.dataset.beatToc='true';toc.setAttribute('role','navigation');toc.setAttribute('aria-label','节拍目录');}
  const count=node('span',String(beats.length),'beatCount'),tabs=node('div','','beatTabs');header.querySelector('h2')?.append(count);
  const paperButton=action('节拍',()=>switchMode('beats')),timelineButton=action('编排',()=>switchMode('arrangement'));
  tabs.append(action('大纲',()=>{nav('03-outline');}),paperButton,timelineButton);
  const controls=node('div','','beatActions');controls.append(action('导出',()=>openWritingExport(episodeId,'beats')),action('新增节拍',()=>edit()));header.append(tabs,controls);
  const toolbar=node('div','','beatToolbar'),status=node('span','已保存','beatStatus');status.setAttribute('role','status');
  let timer:ReturnType<typeof setTimeout>|undefined,queue=Promise.resolve(),composing=false;
  const history:Array<{before:Beat[];after:string}>=[];
  const undo=action('撤销上一步',async()=>{await flush();const last=history.at(-1);if(!last||last.after!==saved)throw Error('内容已变化，不能撤销旧操作');beats=structuredClone(last.before);await save();history.pop();render();});
  const reload=action('重新载入',async()=>{if(dirty()&&!confirm('舍弃当前节拍草稿并重新载入已保存内容？可先导出草稿。'))return;clearTimeout(timer);await queue.catch(()=>{});if(!active())return;beats=validateBeats(await loadDoc(key)??[]);saved=JSON.stringify(beats);history.length=0;status.textContent='已载入';render();});
  toolbar.append(status,undo,action('导出草稿',()=>downloadText('节拍草稿.json',JSON.stringify(beats,null,2),'application/json')),reload);
  const content=node('div','','beatContent');body.append(toolbar,content);
  function dirty(){return JSON.stringify(beats)!==saved;}
  function assertActive(){if(!active())throw Error('节拍页面已离开，未保存旧页面数据');}
  function save():Promise<void> {
    clearTimeout(timer);const snapshot=structuredClone(beats);
    const pending=queue.catch(()=>{}).then(async()=>{
      assertActive();const serialized=JSON.stringify(snapshot);if(serialized===saved)return;
      validateBeats(snapshot);
      await db.transaction('rw',db.docs,async()=>{
        assertActive();const latest=JSON.stringify(await loadDoc(key)??[]);
        if(latest!==saved)throw Error('节拍已被其他操作更新，草稿已保留。请导出草稿或重新载入后再修改。');
        await saveDoc(key,snapshot);
      });
      saved=serialized;status.textContent=dirty()?'正在编辑…':'已保存';count.textContent=String(beats.length);
    });
    queue=pending;return pending.catch(error=>{status.textContent=error instanceof Error?error.message:String(error);throw error;});
  }
  async function flush(){assertActive();do{await save();}while(dirty());}
  function schedule(){status.textContent='正在编辑…';clearTimeout(timer);if(!composing)timer=setTimeout(()=>{void save().catch(error=>{if(active())showToast(String(error));});},500);}
  async function commit(input:unknown){await flush();const before=structuredClone(beats);beats=changeBeats(beats,input);await save();history.push({before,after:saved});if(history.length>50)history.shift();render();}
  async function switchMode(value:string){await flush();mode=value;await saveDoc(viewKey,{mode,zoom});render();}
  async function edit(current?:Beat){
    await flush();const {dialog,body:form}=modal(current?'编辑节拍':'新增节拍');
    const name=field('名称',current?.name??''),description=field('描述',current?.description??'',true),start=field('开始（分钟）',String(current?.startTime??Math.ceil(beats.at(-1)?.endTime??0))),end=field('结束（分钟）',String(current?.endTime??Math.ceil(beats.at(-1)?.endTime??0)+10)),color=field('颜色',current?.color??beatColors[beats.length%beatColors.length]);
    name.input.maxLength=120;description.input.maxLength=20000;
    for(const f of [start,end]){const input=f.input as HTMLInputElement;input.type='number';input.step='0.25';input.min='0';input.max='10000';}
    (color.input as HTMLInputElement).type='color';form.append(name.wrap,description.wrap,start.wrap,end.wrap,color.wrap,action('保存节拍',async()=>{
      if(!start.input.value.trim()||!end.input.value.trim())throw Error('请输入起止分钟');
      await commit({op:current?'update':'add',beats:[{...(current?{id:current.id}:{}),name:name.input.value,description:description.input.value,startTime:Number(start.input.value),endTime:Number(end.input.value),color:color.input.value}]});dialog.close();
    }));
  }
  function render(){
    const focusId=(document.activeElement as HTMLElement|null)?.closest<HTMLElement>('.beatBar')?.dataset.beatId;
    const oldScroll=content.querySelector('.beatTimelineScroll'),scrollLeft=oldScroll?.scrollLeft??0,scrollTop=oldScroll?.scrollTop??0;
    if(!root.isConnected)return;content.replaceChildren();count.textContent=String(beats.length);undo.disabled=!history.length;
    if(toc){toc.replaceChildren();beats.forEach((beat,i)=>{const button=action(`${i+1} ${beat.name}`,()=>{const row=content.querySelector<HTMLElement>(`[data-beat-id="${beat.id}"]`);row?.scrollIntoView({block:'center',inline:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});(row?.querySelector('input')??row)?.focus({preventScroll:true});});button.dataset.beatTarget=beat.id;toc.append(button);});if(!beats.length)toc.append(node('p','暂无节拍','localMuted'));}
    paperButton.setAttribute('aria-pressed',String(mode==='beats'));timelineButton.setAttribute('aria-pressed',String(mode==='arrangement'));
    if(!beats.length){const empty=node('div','','beatEmpty');empty.append(node('h3','还没有节拍'),node('p','用节拍安排故事的转折与节奏。新增节拍，或让 Agent 按本章内容生成。'));content.append(empty);return;}
    if(mode==='arrangement'){renderTimeline();const scroll=content.querySelector('.beatTimelineScroll');if(scroll){scroll.scrollLeft=scrollLeft;scroll.scrollTop=scrollTop;}if(focusId)content.querySelector<HTMLElement>(`[data-beat-id="${focusId}"]`)?.focus({preventScroll:true});return;}
    const paper=node('div','','beatPaper');paper.append(node('h3','节拍表'));
    beats.forEach((beat,i)=>{
      const row=node('article','','beatRow');row.dataset.beatId=beat.id;const number=node('span',String(i+1),'beatNumber');number.style.backgroundColor=beat.color;number.style.color=contrast(beat.color);
      const name=node('input'),description=node('textarea');name.value=beat.name;description.value=beat.description;name.maxLength=120;description.maxLength=20000;name.setAttribute('aria-label','节拍名称');description.setAttribute('aria-label','节拍描述');description.rows=3;
      const fields=node('div','','beatFields'),actions=node('div','','beatRowActions');
      for(const [input,key] of [[name,'name'],[description,'description']] as const){
        input.oninput=()=>{const current=beats.find(b=>b.id===beat.id);if(current){current[key]=input.value;schedule();}};
        input.addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);});input.addEventListener('compositionend',()=>{composing=false;schedule();});
      }
      const up=action('↑',()=>reorder(i,-1)),down=action('↓',()=>reorder(i,1));up.setAttribute('aria-label','上移');down.setAttribute('aria-label','下移');up.disabled=i===0;down.disabled=i===beats.length-1;
      const remove=action('删除节拍',async()=>{if(confirm(`删除节拍“${beat.name}”？可以撤销本次操作。`))await commit({op:'delete',beatIds:[beat.id]});});
      actions.append(node('span',`${beat.startTime}–${beat.endTime} 分钟`),up,down,action('编辑节拍',()=>edit(beats.find(b=>b.id===beat.id))),remove);fields.append(name,description,actions);row.append(number,fields);paper.append(row);
    });content.append(paper);
  }
  async function reorder(index:number,direction:number){const ids=beats.map(b=>b.id);[ids[index],ids[index+direction]]=[ids[index+direction],ids[index]];await commit({op:'reorder',orderedIds:ids});}
  function renderTimeline(){
    const zoomer=node('div','','beatZoom');for(const [label,delta] of [['缩小',-.25],['放大',.25]] as const)zoomer.append(action(label,async()=>{await flush();zoom=Math.min(4,Math.max(.5,zoom+delta));await saveDoc(viewKey,{mode,zoom});render();}));zoomer.append(node('span','拖动色条移动节拍，两端调整长度；方向键移动 1 分钟。'));
    const scroll=node('div','','beatTimelineScroll'),track=node('div','','beatTimeline');track.setAttribute('aria-label','节拍编排');
    const px=16*zoom,duration=Math.max(60,...beats.map(b=>b.endTime))+10,width=Math.max(720,duration*px);track.style.width=width+'px';track.style.height=(beats.length*64+70)+'px';
    const step=Math.max(5,Math.ceil(duration/20/5)*5);for(let t=0;t<=duration;t+=step){const tick=node('span',`${t}′`,'beatTick');tick.style.left=t*px+'px';track.append(tick);}
    beats.forEach((beat,i)=>{
      const bar=node('div','','beatBar');bar.dataset.beatId=beat.id;bar.tabIndex=0;bar.setAttribute('role','button');bar.setAttribute('aria-label',`${beat.name}，${beat.startTime}至${beat.endTime}分钟`);bar.title='双击编辑节拍';bar.style.backgroundColor=beat.color;bar.style.top=(i*64+45)+'px';bar.style.left=beat.startTime*px+'px';bar.style.width=(beat.endTime-beat.startTime)*px+'px';
      bar.style.color=contrast(beat.color);const start=node('span','','beatHandle'),end=node('span','','beatHandle');start.dataset.edge='start';end.dataset.edge='end';start.setAttribute('aria-label','调整开始');end.setAttribute('aria-label','调整结束');
      bar.append(start,node('strong',beat.name),node('small',`${beat.startTime}–${beat.endTime}′`),end);
      bar.ondblclick=()=>{void edit(beat).catch(error=>showToast(String(error)));};
      bar.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void edit(beat).catch(error=>showToast(String(error)));return;}if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const current=beats.find(b=>b.id===beat.id)!;const delta=event.key==='ArrowLeft'?-1:1;if(current.startTime+delta<0||current.endTime+delta>10000)return;void commit({op:'update',beats:[{id:beat.id,startTime:current.startTime+delta,endTime:current.endTime+delta}]}).catch(error=>showToast(String(error)));};
      bar.onpointerdown=event=>{
        if(event.button!==0)return;const edge=(event.target as HTMLElement).dataset.edge,x=event.clientX,origin={...beat};let a=origin.startTime,b=origin.endTime;
        bar.setPointerCapture(event.pointerId);
        const move=(e:PointerEvent)=>{const delta=Math.round((e.clientX-x)/px*4)/4;
          if(edge==='start')a=Math.max(0,Math.min(origin.endTime-.25,origin.startTime+delta));
          else if(edge==='end')b=Math.min(10000,Math.max(origin.startTime+.25,origin.endTime+delta));
          else {const d=Math.max(-origin.startTime,Math.min(10000-origin.endTime,delta));a=origin.startTime+d;b=origin.endTime+d;}
          bar.style.left=a*px+'px';bar.style.width=(b-a)*px+'px';bar.querySelector('small')!.textContent=`${a}–${b}′`;
        };
        const finish=(e:PointerEvent)=>{bar.removeEventListener('pointermove',move);bar.removeEventListener('pointerup',finish);bar.removeEventListener('pointercancel',cancel);if(bar.hasPointerCapture(e.pointerId))bar.releasePointerCapture(e.pointerId);if(!active())return;if(a===origin.startTime&&b===origin.endTime)return;void commit({op:'update',beats:[{id:beat.id,startTime:a,endTime:b}]}).catch(error=>{showToast(String(error));render();});};
        const cancel=()=>{bar.removeEventListener('pointermove',move);bar.removeEventListener('pointerup',finish);bar.removeEventListener('pointercancel',cancel);if(active())render();};
        bar.addEventListener('pointermove',move);bar.addEventListener('pointerup',finish);bar.addEventListener('pointercancel',cancel);
      };track.append(bar);
    });scroll.append(track);content.append(zoomer,scroll);
  }
  active=registerContentEditor(page,{flush,hasUnsavedChanges:dirty,reload:async()=>{assertActive();if(dirty())throw Error('节拍仍有未保存草稿');await queue;beats=validateBeats(await loadDoc(key)??[]);saved=JSON.stringify(beats);render();}});
  render();
}
