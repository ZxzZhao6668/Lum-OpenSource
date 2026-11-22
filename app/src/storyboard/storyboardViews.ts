import { getProjectAssetMedia } from '../assetLibrary/projectAssets';
import { blobDataUrl } from '../entities/entityImageUpload';
import { effectiveShotGenerationImage } from './shotMedia';
import { type Shot, type ShotField, type BoardField, type StoryScene, sceneShots, shotNumber, shotFields, boardFields, validDuration } from './shotModel';
import { UNASSIGNED_SCENE } from '../script/sceneIdentity';
import { initializeGeneration, getShotGeneration, previewImage, subscribeGeneration } from './generationState';
import {openImageViewer} from '../ui/imageViewer';
import {mountLazyThumbnail} from '../ui/lazyThumbnail';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls='', text='') => { const node=document.createElement(tag);node.className=cls;node.textContent=text;return node; };
const btn = (text:string,fn:()=>void) => {const b=el('button','sbButton',text);b.type='button';b.onclick=fn;return b;};
let closeFloating: (()=>void)|undefined;
export function showShotMenu(anchor:HTMLElement,items:Array<[string,()=>void|Promise<void>]>,options:{label?:string;selected?:string}={}) {
  closeFloating?.();const pop=el('div','sbShotMenu');pop.setAttribute('role','menu');pop.setAttribute('aria-label',options.label??'镜头更多');if(options.selected!==undefined)pop.classList.add('sbChoiceMenu');anchor.setAttribute('aria-expanded','true');
  const close=()=>{pop.remove();anchor.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('dsh:nav',close);if(closeFloating===close)closeFloating=undefined;};
  const outside=(event:PointerEvent)=>{if(!pop.contains(event.target as Node)&&!anchor.contains(event.target as Node))close();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();anchor.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&pop.contains(document.activeElement)){event.preventDefault();const buttons=[...pop.querySelectorAll('button')],current=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}else if(event.key==='Tab')close();};
  for(const [label,run] of items){const b=btn(label,()=>{close();void Promise.resolve().then(run).catch(error=>alert(String(error)));anchor.focus();});b.setAttribute('role',options.selected!==undefined?'menuitemradio':'menuitem');if(options.selected!==undefined)b.setAttribute('aria-checked',String(options.selected===label));pop.append(b);}
  document.body.append(pop);const rect=anchor.getBoundingClientRect();pop.style.left=`${Math.max(8,Math.min(rect.right-160,innerWidth-168))}px`;pop.style.top=`${Math.max(8,Math.min(rect.bottom+5,innerHeight-pop.offsetHeight-8))}px`;
  closeFloating=close;document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);window.addEventListener('dsh:nav',close);(pop.querySelector<HTMLButtonElement>('[aria-checked=true]')??pop.querySelector('button'))?.focus();
}
export interface ViewOptions { boardFields: BoardField[]; tableFields: ShotField[]; sort: ShotField; descending: boolean; collapsed: string[] }
export const defaultViewOptions = (): ViewOptions => ({boardFields:['image'],tableFields:shotFields.map(([key])=>key),sort:'no',descending:false,collapsed:[]});
type Context = { shots:Shot[];scenes:StoryScene[];options:ViewOptions;changed():void;optionsChanged():void;open(sceneId:string,shotId?:string):void;edit(shot:Shot):void;generate(scene:StoryScene):void;image(box:HTMLElement,shot:Shot,label:string):void;assets(shot:Shot):void;mentions(input:HTMLTextAreaElement,shot:Shot):void };

async function selectedShotOriginal(shot:Shot):Promise<string|Blob> {
  await initializeGeneration();const meta=getShotGeneration(shot.id);
  const selected=effectiveShotGenerationImage(shot.mediaPin,meta);
  if (selected) return previewImage(selected);
  return shot.mediaPin ? getProjectAssetMedia(shot.mediaPin.mediaId) : shot.image??'';
}
export async function selectedShotImage(shot:Shot) {
  const original=await selectedShotOriginal(shot);
  return original instanceof Blob ? blobDataUrl(original) : original;
}
export function mountShotThumbnail(box:HTMLElement,shot:Shot,label:string) {
  const thumbnail=mountLazyThumbnail(box,label,()=>{
    const selected=effectiveShotGenerationImage(shot.mediaPin,getShotGeneration(shot.id));
    const key=selected?.path||shot.image||'';
    return key?{key,load:()=>selected?previewImage(selected,false):Promise.resolve(shot.image??'')}:undefined;
  });
  const unsubscribe=subscribeGeneration(thumbnail.refresh);
  void initializeGeneration().then(thumbnail.refresh).catch(()=>{if(box.isConnected)box.title='图片暂时无法读取，请检查本地服务';});
  return ()=>{unsubscribe();thumbnail.dispose();};
}
export async function viewShotImage(shot:Shot) {
  openImageViewer(selectedShotOriginal(shot),shot.no);
}
export function renderStoryboardBoard(container:HTMLElement,ctx:Context) {
  const groups=[...ctx.scenes];if(sceneShots(ctx.shots,UNASSIGNED_SCENE,ctx.scenes).length)groups.push({id:UNASSIGNED_SCENE,blockId:'',title:'未关联场次',index:0,intExt:'',location:'未关联镜头',timeOfDay:'',blocks:[]});
  if(!groups.length){container.append(el('div','sbEmpty','剧本还没有场次。请先在剧本中分场，或让 Agent 分场并生成分镜。'));return;}
  for(const scene of groups){
    const column=el('section','sbSceneColumn');column.dataset.sceneRef=scene.id;column.setAttribute('aria-label',scene.title);
    const slate=el('div','sbSlate');const meta=el('div','sbSlateMeta');
    for(const [label,value] of [['SCENE',scene.index?String(scene.index).padStart(2,'0'):'—'],['I/E',scene.intExt||'—'],['LOCATION',scene.location],['D/N',scene.timeOfDay||'—']]){const cell=el('div');cell.append(el('small','',label),el('strong','',value));meta.append(cell);}
    const actions=el('div','sbSlateActions');
    const enter=(automatic=false)=>{if(column.classList.contains('sbClapping'))return;column.classList.add('sbClapping');actions.querySelectorAll('button').forEach(b=>b.disabled=true);setTimeout(()=>{if(!column.isConnected)return;ctx.open(scene.id);if(automatic)ctx.generate(scene);},matchMedia('(prefers-reduced-motion: reduce)').matches?0:540);};actions.append(btn('打开',()=>enter()));
    if(scene.blockId){const auto=btn('自动分镜',()=>enter(true));auto.classList.add('sbPrimary');auto.setAttribute('aria-label',`${scene.title} 自动分镜`);actions.append(auto);}
    slate.append(meta,actions);column.append(slate);
    const shotList=el('div','sbSceneShots');column.append(shotList);
    const list=sceneShots(ctx.shots,scene.id,ctx.scenes);
    if(ctx.options.sort!=='no'||ctx.options.descending)list.sort((a,b)=>{const key=ctx.options.sort;const cmp=key==='no'?ctx.shots.indexOf(a)-ctx.shots.indexOf(b):key==='duration'?(a.duration??0)-(b.duration??0):String(a[key]??'').localeCompare(String(b[key]??''),'zh');return cmp*(ctx.options.descending?-1:1);});
    list.forEach(shot=>{
      const card=el('article','sbBoardShot');card.dataset.shotId=shot.id;
      const number=`SHOT ${shotNumber(shot,ctx.shots,ctx.scenes)}`;
      const image=el('button','sbBoardImage');image.type='button';image.setAttribute('aria-label',`${number} 查看图片`);
      image.append(el('span','sbBoardNumber',number),el('small','sbBoardEmpty','请打开场次板进行编辑'));
      if(ctx.options.boardFields.includes('image'))ctx.image(image,shot,number);else image.classList.add('sbCompactImage');image.onclick=()=>{if(image.querySelector('img'))void viewShotImage(shot);else ctx.open(scene.id,shot.id);};card.append(image);
      if(ctx.options.boardFields.some(key=>key!=='image')){const info=el('div','sbBoardInfo');ctx.options.boardFields.filter(key=>key!=='image').forEach(key=>{const value=key==='duration'?(shot.duration?`${shot.duration}s`:'—'):shot[key as Exclude<BoardField,'image'>];if(value)info.append(el(['desc','staging','notes'].includes(key)?'p':'span','',String(value)));});card.append(info);}
      shotList.append(card);
    });
    if(!list.length)shotList.append(el('p','sbSceneEmpty','尚无分镜，点击自动分镜开始。'));
    container.append(column);
  }
}
export function renderStoryboardTable(container:HTMLElement,ctx:Context) {
  const table=el('table','sbTable');table.setAttribute('aria-label','镜头表');
  const head=el('thead'),header=el('tr');header.append(el('th','','分镜图'));
  const fields=shotFields.filter(([key])=>ctx.options.tableFields.includes(key));
  for(const [key,label] of fields){const th=el('th');th.scope='col';if(['no','type','duration'].includes(key)){
    const b=btn(`${label} ${ctx.options.sort===key?(ctx.options.descending?'↓':'↑'):'↕'}`,()=>{if(ctx.options.sort===key)ctx.options.descending=!ctx.options.descending;else{ctx.options.sort=key;ctx.options.descending=false;}ctx.optionsChanged();});b.setAttribute('aria-label',`按${label}排序`);th.setAttribute('aria-sort',ctx.options.sort===key?(ctx.options.descending?'descending':'ascending'):'none');th.append(b);
  }else th.textContent=label;header.append(th);}
  head.append(header);table.append(head);
  const groups=ctx.scenes.map(scene=>({id:scene.id,title:`${String(scene.index).padStart(2,'0')} - ${scene.intExt==='内'?'INT.':scene.intExt==='外'?'EXT.':scene.intExt} ${scene.location}`}));
  if(sceneShots(ctx.shots,UNASSIGNED_SCENE,ctx.scenes).length)groups.push({id:UNASSIGNED_SCENE,title:'未关联镜头'});
  for(const scene of groups){
    const list=sceneShots(ctx.shots,scene.id,ctx.scenes);if(!list.length)continue;
    const body=el('tbody');body.dataset.sceneRef=scene.id;
    const group=el('tr','sbTableGroup'),cell=el('td');cell.colSpan=fields.length+1;const collapsed=ctx.options.collapsed.includes(scene.id);
    const toggle=btn(`${collapsed?'›':'⌄'}  ${scene.title}  (${list.length})`,()=>{ctx.options.collapsed=collapsed?ctx.options.collapsed.filter(id=>id!==scene.id):[...ctx.options.collapsed,scene.id];ctx.optionsChanged();});toggle.setAttribute('aria-expanded',String(!collapsed));cell.append(toggle);group.append(cell);body.append(group);
    const sorted=[...list].sort((a,b)=>{const key=ctx.options.sort;const order=key==='no'?list.indexOf(a)-list.indexOf(b):key==='duration'?(a.duration??0)-(b.duration??0):String(a[key]??'').localeCompare(String(b[key]??''),'zh');return order*(ctx.options.descending?-1:1);});
    if(!collapsed)for(const shot of sorted){
      const row=el('tr');row.dataset.shotId=shot.id;
      const imageCell=el('td','sbTableImageCell'),image=el('button','sbTableImage');image.type='button';image.setAttribute('aria-label',`${shotNumber(shot,ctx.shots,ctx.scenes)} 查看图片`);image.append(el('span','','▧'));ctx.image(image,shot,shotNumber(shot,ctx.shots,ctx.scenes));image.onclick=()=>{void viewShotImage(shot).catch(()=>ctx.open(scene.id,shot.id));};imageCell.append(image);row.append(imageCell);
      for(const [key,label] of fields){const cell=el('td');
        if(key==='no'){const link=btn(shotNumber(shot,ctx.shots,ctx.scenes),()=>ctx.open(scene.id,shot.id));link.title='打开镜头';cell.append(link);}
        else{const input=key==='desc'?el('textarea','sbDescription'):el('input');input.value=String(shot[key]??'');input.setAttribute('aria-label',`${shot.no} ${key==='desc'?'画面描述':label}`);input.dataset.shotField=key;
          if(key==='duration'&&input instanceof HTMLInputElement){input.type='number';input.min='0.01';input.max='3600';input.step='0.01';input.placeholder='秒';}
          input.onchange=()=>{try{if(key==='duration'){if(!input.value)delete shot.duration;else shot.duration=validDuration(input.value);}else shot[key]=input.value;input.setCustomValidity('');ctx.changed();}catch(error){input.setCustomValidity(String(error));input.reportValidity();}};
          if(key!=='duration')input.oninput=input.onchange;cell.append(input);
          if(key==='desc'){input.oninput=null;input.onchange=null;ctx.mentions(input as HTMLTextAreaElement,shot);}
        }
        row.append(cell);
      }
      row.oncontextmenu=e=>{e.preventDefault();ctx.edit(shot);};body.append(row);
    }
    table.append(body);
  }
  container.append(table);
  if(!ctx.shots.length)container.append(el('p','sbSceneEmpty','尚无镜头。请先在分镜板中自动分镜或新增镜头。'));
}
export function showDisplayOptions(anchor:HTMLElement,options:ViewOptions,mode:'board'|'table',changed:()=>void) {
  closeFloating?.();
  const pop=el('div','sbDisplayOptions');pop.setAttribute('role','dialog');pop.setAttribute('aria-label',mode==='board'?'分镜板显示选项':'镜头表显示选项');pop.tabIndex=-1;
  const close=()=>{pop.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);anchor.focus();if(closeFloating===close)closeFloating=undefined;};
  const outside=(e:PointerEvent)=>{if(!pop.contains(e.target as Node)&&!anchor.contains(e.target as Node))close();};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();close();}};
  const render=()=>{pop.replaceChildren();{
    const sort=el('label','sbSort','排序');const select=el('select');select.setAttribute('aria-label','排序字段');
    for(const [key,label] of shotFields.filter(([key])=>['no','type','duration'].includes(key))){const option=el('option','',label);option.value=key;select.append(option);}select.value=options.sort;
    select.onchange=()=>{options.sort=select.value as ShotField;changed();};sort.append(select,btn(options.descending?'降序 ↓':'升序 ↑',()=>{options.descending=!options.descending;changed();render();}));pop.append(sort);
  }
  pop.append(el('p','','显示属性'));const toggles=el('div','sbDisplayFields');const key=mode==='board'?'boardFields':'tableFields';
  const choices:readonly(readonly[string,string])[]=mode==='board'?boardFields:shotFields;
  choices.forEach(([field,label])=>{const selected=options[key] as string[];const b=btn(label,()=>{const next=selected.includes(field)?selected.filter(item=>item!==field):[...selected,field];if(mode==='board')options.boardFields=next as BoardField[];else options.tableFields=next as ShotField[];changed();render();});b.setAttribute('aria-pressed',String(selected.includes(field)));toggles.append(b);});
  pop.append(toggles,btn('重置',()=>{const defaults=defaultViewOptions();if(mode==='board')options.boardFields=defaults.boardFields;else options.tableFields=defaults.tableFields;options.sort='no';options.descending=false;changed();render();}),btn('关闭',close));};
  render();document.body.append(pop);const rect=anchor.getBoundingClientRect();pop.style.top=`${rect.bottom+8}px`;pop.style.left=`${Math.max(8,Math.min(rect.right-288,innerWidth-296))}px`;pop.focus();closeFloating=close;document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
}
