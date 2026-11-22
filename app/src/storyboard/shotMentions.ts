import { db, type EntityRow } from '../data/db';
import { listEntitySummaries } from '../data/entityCatalog';
import { openEntityDetails } from '../entities/entityDetails';
import { showToast } from '../ui/toast';
import { initializeMentions, mapMentionEdit, mapMentionReplacement, validMentions, type ShotMention } from './mentionModel';
import type { Shot } from './shotModel';

const CLIPBOARD_TYPE='application/x-writing-shot-mentions';
type State={text:string;mentions:ShotMention[]};
type MentionEntity = Pick<EntityRow,'id'|'name'|'kind'>;
const mentionPaints=new WeakMap<Element,HTMLElement>();
const mentionSizes=new ResizeObserver(entries=>{
  for(const entry of entries){const paint=mentionPaints.get(entry.target);if(paint)paint.style.width=`${entry.contentRect.width}px`;}
});
import.meta.hot?.dispose(()=>mentionSizes.disconnect());
export async function listMentionEntities(): Promise<MentionEntity[]> {
  return (await listEntitySummaries()).map(({id,name,kind})=>({id,name,kind}));
}

/** Native textarea owns IME, selection and undo. Explicit ranges own reference identity. */
export function mountShotMentions(input:HTMLTextAreaElement,shot:Shot,changed:()=>void) {
  const wrap=document.createElement('div');wrap.className='sbMentionEditor';input.replaceWith(wrap);
  const paint=document.createElement('div');paint.className='sbMentionPaint';paint.setAttribute('aria-hidden','true');
  const pop=document.createElement('div');pop.className='sbMentionChoices';pop.setAttribute('role','listbox');pop.setAttribute('aria-label','引用人物、地点或道具');pop.id='mentions-'+shot.id;pop.hidden=true;
  wrap.append(paint,input,pop);input.setAttribute('aria-controls',pop.id);input.setAttribute('aria-autocomplete','list');
  mentionPaints.set(input,paint);mentionSizes.observe(input);
  let rows:MentionEntity[]=[],matches:MentionEntity[]=[],index=0,start=-1,disposed=false,composing=false,inserting=false;
  let last=input.value,history:State[]=[{text:last,mentions:validMentions(last,shot.descMentions)}],historyAt=0;
  let pendingEdit:{text:string;start:number;end:number;type:string}|undefined;
  let scrollTop=0,scrollLeft=0;
  const syncScroll=()=>{scrollTop=input.scrollTop;scrollLeft=input.scrollLeft;paint.scrollTop=scrollTop;paint.scrollLeft=scrollLeft;};
  const hide=()=>{pop.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const remember=()=>{
    const state={text:input.value,mentions:structuredClone(shot.descMentions??[])};
    if(history[historyAt]?.text===state.text&&JSON.stringify(history[historyAt]?.mentions)===JSON.stringify(state.mentions))history[historyAt]=state;
    else{history=history.slice(0,historyAt+1);history.push(state);historyAt=history.length-1;}
    while(history.length>100||history.length>1&&history.reduce((sum,s)=>sum+s.text.length,0)>2_000_000){history.shift();historyAt--;}
  };
  const paintText=()=>{
    paint.replaceChildren();let at=0;
    for(const ref of validMentions(input.value,shot.descMentions)){
      paint.append(document.createTextNode(input.value.slice(at,ref.start)));const mark=document.createElement('mark');mark.textContent=input.value.slice(ref.start,ref.end);mark.dataset.entityId=ref.entityId;
      if(!rows.some(row=>row.id===ref.entityId)){mark.classList.add('sbMentionMissing');mark.title='资产已删除，恢复后继续关联';}paint.append(mark);at=ref.end;
    }
    paint.append(document.createTextNode(input.value.slice(at)+'\n'));
    // Width arrives in a single resize batch. Only the actively scrolled editor
    // needs scroll offsets; measuring every newly mounted textarea forces layout.
    if(scrollTop)paint.scrollTop=scrollTop;if(scrollLeft)paint.scrollLeft=scrollLeft;
  };
  const insert=(text:string,refs:ShotMention[]=[],from=input.selectionStart,to=input.selectionEnd)=>{
    const before=input.value,previous=validMentions(before,shot.descMentions);
    input.focus();input.setSelectionRange(from,to);inserting=true;
    pendingEdit=undefined;
    try{if(!document.execCommand('insertText',false,text))input.setRangeText(text,from,to,'end');}finally{inserting=false;}
    shot.descMentions=validMentions(input.value,[...mapMentionReplacement(before,input.value,previous,from,to),...refs.map(m=>({...m,start:from+m.start,end:from+m.end}))]);
    shot.desc=input.value;last=input.value;
    shot.entityIds=[...new Set([...(shot.entityIds??[]),...refs.map(m=>m.entityId)])];remember();hide();paintText();changed();
  };
  const choose=(entity:MentionEntity)=>{
    if(start<0||disposed)return;
    insert('@'+entity.name+' ',[{entityId:entity.id,start:0,end:entity.name.length+1,label:entity.name}],start,input.selectionStart);
  };
  const renderChoices=()=>{
    pop.replaceChildren();matches.forEach((entity,i)=>{const item=document.createElement('button');item.type='button';item.id=pop.id+'-'+i;item.setAttribute('role','option');item.setAttribute('aria-selected',String(index===i));item.textContent=({character:'人物',location:'地点',prop:'道具'}[entity.kind])+' · '+entity.name;item.onpointerdown=e=>e.preventDefault();item.onclick=()=>choose(entity);pop.append(item);});
    if(!matches.length){const empty=document.createElement('p');empty.textContent='没有匹配的资料，请先提取或建立资产。';pop.append(empty);}input.setAttribute('aria-activedescendant',matches.length?pop.id+'-'+index:'');
  };
  const suggest=()=>{
    if(composing||document.activeElement!==input){hide();return;}
    const before=input.value.slice(0,input.selectionStart),match=/@([^\s@，。！？、；："“”]{0,40})$/.exec(before);
    if(!match||input.selectionStart!==input.selectionEnd||(shot.descMentions??[]).some(m=>input.selectionStart>m.start&&input.selectionStart<=m.end)){hide();return;}
    start=before.length-match[0].length;matches=rows.filter(row=>row.name.toLocaleLowerCase().includes(match[1].toLocaleLowerCase())).slice(0,20);index=0;renderChoices();pop.hidden=false;input.setAttribute('aria-expanded','true');
  };
  const onInput=(event?:Event)=>{
    if(inserting)return;
    const type=(event as InputEvent|undefined)?.inputType;let restored=false;
    if(type==='historyUndo'||type==='historyRedo'){
      const step=type==='historyUndo'?-1:1;
      for(let i=historyAt+step;i>=0&&i<history.length;i+=step)if(history[i].text===input.value){historyAt=i;shot.descMentions=structuredClone(history[i].mentions);restored=true;break;}
    }
    if(!restored){
      const edit=pendingEdit;
      if(edit?.text===last){
        let {start,end}=edit;const removed=last.length-input.value.length;
        if(start===end&&removed>0&&edit.type.startsWith('delete')){
          if(edit.type.endsWith('Backward'))start-=removed;else end+=removed;
        }
        shot.descMentions=mapMentionReplacement(last,input.value,shot.descMentions??[],start,end);
      }else shot.descMentions=mapMentionEdit(last,input.value,shot.descMentions??[]);
      remember();
    }
    pendingEdit=undefined;
    shot.desc=input.value;last=input.value;paintText();suggest();changed();
  };
  const beforeInput=(event:InputEvent)=>{if(!inserting)pendingEdit={text:input.value,start:input.selectionStart,end:input.selectionEnd,type:event.inputType};};
  const onKey=(e:KeyboardEvent)=>{
    if(composing||e.isComposing||pop.hidden)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide();}
    else if(['ArrowDown','ArrowUp'].includes(e.key)&&matches.length){e.preventDefault();index=(index+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;renderChoices();pop.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});}
    else if((e.key==='Enter'||e.key==='Tab')&&matches[index]){e.preventDefault();e.stopPropagation();choose(matches[index]);}
  };
  const onCopy=(e:ClipboardEvent)=>{
    if(!e.clipboardData||input.selectionStart===input.selectionEnd)return;
    const from=input.selectionStart,to=input.selectionEnd,text=input.value.slice(from,to);
    const mentions=validMentions(input.value,shot.descMentions).filter(m=>m.start>=from&&m.end<=to).map(m=>({...m,start:m.start-from,end:m.end-from}));
    e.preventDefault();e.clipboardData.setData('text/plain',text);e.clipboardData.setData(CLIPBOARD_TYPE,JSON.stringify({version:1,project:db.name,text,mentions}));
    if(e.type==='cut')insert('');
  };
  const onPaste=(e:ClipboardEvent)=>{
    if(!e.clipboardData||composing)return;
    const text=e.clipboardData.getData('text/plain');let refs:ShotMention[]=[];
    try{const raw=e.clipboardData.getData(CLIPBOARD_TYPE);if(raw.length<1_000_000){const data=JSON.parse(raw);if(data.version===1&&data.project===db.name&&data.text===text)refs=validMentions(text,data.mentions).filter(m=>rows.some(row=>row.id===m.entityId));}}catch{/* Foreign clipboard data is plain text. */}
    let current='',at=0;const renamed:ShotMention[]=[];
    for(const ref of refs){current+=text.slice(at,ref.start);const label=rows.find(row=>row.id===ref.entityId)!.name;const start=current.length;current+='@'+label;renamed.push({...ref,label,start,end:current.length});at=ref.end;}
    current+=text.slice(at);e.preventDefault();insert(current,renamed);
  };
  const onClick=(e:MouseEvent)=>{
    if(!e.ctrlKey&&!e.metaKey){suggest();return;}
    const ref=validMentions(input.value,shot.descMentions).find(m=>input.selectionStart>=m.start&&input.selectionStart<=m.end);
    if(ref)void openEntityDetails(ref.entityId).catch(error=>showToast(String(error)));
  };
  const compositionStart=()=>{composing=true;hide();},compositionEnd=()=>{composing=false;suggest();};
  const load=async()=>{const next=await listMentionEntities();if(disposed)return;rows=next;initializeMentions(shot,rows);history[historyAt]={text:input.value,mentions:structuredClone(shot.descMentions??[])};paintText();};
  const refresh=()=>{void load().catch(error=>showToast(String(error)));};
  input.title='输入 @ 引用人物、地点或道具；Ctrl / ⌘ 单击引用可编辑共用资料';
  const events:{[key:string]:EventListener}={beforeinput:beforeInput as EventListener,input:onInput,keydown:onKey as EventListener,click:onClick as EventListener,blur:hide,scroll:syncScroll,compositionstart:compositionStart,compositionend:compositionEnd,copy:onCopy as EventListener,cut:onCopy as EventListener,paste:onPaste as EventListener};
  Object.entries(events).forEach(([event,listener])=>input.addEventListener(event,listener));window.addEventListener('dsh:content-updated',refresh);paintText();refresh();
  return ()=>{disposed=true;mentionSizes.unobserve(input);mentionPaints.delete(input);window.removeEventListener('dsh:content-updated',refresh);Object.entries(events).forEach(([event,listener])=>input.removeEventListener(event,listener));};
}
