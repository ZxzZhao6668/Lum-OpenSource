import { linkAsset } from './assetLinkStore';
export { linkAsset } from './assetLinkStore';
import { db, loadDoc, listEntities, type EntityRow } from '../data/db';
import { getActiveWritingEditor, type ScriptBlock } from '../script/editor';
import { openEntityDetails } from './entityDetails';
import { action, modal, node } from '../ui/localUi';
import { showToast } from '../ui/toast';
import './assetLinks.css';

async function showLinks(episodeId:string,blockId:string) {
  const {body}=modal('段落关联资料');const links=await loadDoc<Record<string,string[]>>(`entities:links:${episodeId}`)??{};let linked=links[blockId]??[];
  const search=node('input');search.placeholder='搜索人物、地点、道具';search.setAttribute('aria-label','搜索关联资产');const list=node('div','','assetLinkList');body.append(node('p','此处引用项目资产库中的同一条记录。名称和设定在所有关联处共用。','localMuted'),search,list);
  const rows=await listEntities();
  const render=()=>{
    list.replaceChildren();
    for(const row of rows.filter(row=>`${row.name}\n${row.desc}`.includes(search.value))){
      const item=node('div','','assetLinkRow');const toggle=action(linked.includes(row.id)?'解除关联':'关联',async()=>{const remove=linked.includes(row.id);await linkAsset(episodeId,blockId,row.id,remove);linked=remove?linked.filter(id=>id!==row.id):[...linked,row.id];render();});
      item.append(node('span',`${{character:'人物',location:'地点',prop:'道具'}[row.kind]} · ${row.name}`),action('查看资料',()=>openEntityDetails(row.id)),toggle);list.append(item);
    }
    if(!list.children.length)list.append(node('p','暂无匹配资料，可让 Agent 提取人物、地点和道具。','localMuted'));
  };search.oninput=render;render();
}
export async function showSceneAssets(episodeId:string,reference?:string) {
  const blocks=await loadDoc<ScriptBlock[]>(`script:${episodeId}`)??[];
  const start=blocks.findIndex(block=>`block:${block.id}`===reference&&block.type==='scene');
  if(start<0)throw Error('此镜头尚未关联有效场次，请先编辑镜头选择场次');
  let end=start+1;while(end<blocks.length&&blocks[end].type!=='scene')end++;
  const links=await loadDoc<Record<string,string[]>>(`entities:links:${episodeId}`)??{};
  const ids=new Set(blocks.slice(start,end).flatMap(block=>links[block.id]??[]));
  const rows=await readLinkedAssets(ids);
  const {body}=modal('本场共用资料');body.append(node('p',blocks[start].text));
  for(const row of rows)body.append(action(`${{character:'人物',location:'地点',prop:'道具'}[row.kind]} · ${row.name}`,()=>openEntityDetails(row.id)));
  if(!rows.length)body.append(node('p','本场还没有关联资料，可在正文中提取或手动关联。','localMuted'));
  body.append(action('关联场次资料',()=>showLinks(episodeId,blocks[start].id)));
}
const mounts=new WeakMap<HTMLElement,()=>void>();
async function readLinkedAssets(ids: Set<string>) {
  if (!ids.size) return [];
  const rows = await db.entities.bulkGet([...ids]);
  return rows.filter((row): row is EntityRow => !!row).sort((a, b) => a.order - b.order);
}
export async function mountAssetLinks(root:HTMLElement,episodeId:string) {
  mounts.get(root)?.();
  const isScript = root.dataset.screen === '01-script';
  if (!isScript && !root.querySelector('[data-scene-block-id]:not(button)')) return;
  const anchor=root.firstChild;let disposed=false,version=0;
  const active=()=>!disposed&&root.isConnected&&root.firstChild===anchor;
  const label={character:'人物',location:'地点',prop:'道具'};
  const toolbar=node('div','','assetLinkToolbar');
  const disclosure=node('details','','assetLinkDisclosure');
  const summary=node('summary');
  const selectionChips=node('div','','assetLinkSelection');
  disclosure.hidden=true;
  disclosure.append(summary,selectionChips);
  let shownRows: Pick<EntityRow,'id'|'kind'|'name'>[]=[];
  let currentLinks:Record<string,string[]>={},currentRows=new Map<string, Pick<EntityRow, 'id' | 'kind' | 'name'>>();
  const showSelection=()=>{
    if(!active()||!toolbar.isConnected)return;
    const ids=currentRows.size ? getActiveWritingEditor()?.selectedBlockIds()??[] : [];
    const linked=new Set(ids.flatMap(id=>currentLinks[id]??[]));
    const rows=[...currentRows.values()].filter(row=>linked.has(row.id));
    if(rows.length===shownRows.length && rows.every((row,index)=>row===shownRows[index]))return;
    shownRows=rows;
    disclosure.hidden=rows.length===0;
    summary.textContent=`已关联 ${rows.length}`;
    selectionChips.replaceChildren(...rows.map(row=>{
      const chip=action(`${label[row.kind]} · ${row.name}`,()=>openEntityDetails(row.id));
      chip.dataset.entityId=row.id;
      return chip;
    }));
  };
  if(isScript){
    toolbar.append(action('关联资料',async()=>{
      const editor=getActiveWritingEditor();const ids=editor?.selectedBlockIds()??[];await editor?.flush();
      if(!ids.length)throw Error('先把光标放到需要关联的段落或场次标题内');await showLinks(episodeId,ids[0]);
    }),action('提取人物 / 地点 / 道具',()=>{window.dispatchEvent(new CustomEvent('dsh:request-writing',{detail:'请从本集正文提取所有人物、地点（场景资产）和道具，复用已有资产，并关联到实际出现的正文段落及场次。'}));}));
    toolbar.append(disclosure);
    root.querySelector('[data-script-toolbar]')?.append(toolbar);
  }
  async function render(){
    const ticket=++version;
    const cards=root.querySelectorAll<HTMLElement>('[data-scene-block-id]:not(button)');
    const [links,blocks]=await Promise.all([
      loadDoc<Record<string,string[]>>(`entities:links:${episodeId}`),
      cards.length ? loadDoc<ScriptBlock[]>(`script:${episodeId}`) : null,
    ]);
    if(!active()||ticket!==version)return;
    const rows=await readLinkedAssets(new Set(Object.values(links??{}).flat()));
    if(!active()||ticket!==version)return;root.querySelectorAll('.assetLinkChips').forEach(n=>n.remove());
    currentLinks=links??{};
    currentRows=new Map(rows.map(({id,kind,name})=>[id,{id,kind,name}]));
    showSelection();
    for(const card of cards){
      const start=(blocks??[]).findIndex(b=>b.id===card.dataset.sceneBlockId);if(start<0)continue;
      let end=start+1;while(end<(blocks?.length??0)&&blocks![end].type!=='scene')end++;
      const ids=new Set(blocks!.slice(start,end).flatMap(b=>links?.[b.id]??[]));const chips=node('div','','assetLinkChips');
      for(const row of rows.filter(row=>ids.has(row.id))){const chip=action(`${label[row.kind]} · ${row.name}`,()=>openEntityDetails(row.id));chip.dataset.entityId=row.id;chips.append(chip);}
      chips.append(action('关联资料',()=>showLinks(episodeId,card.dataset.sceneBlockId!)));card.append(chips);
    }
    for(const block of root.querySelectorAll<HTMLElement>('.slate-editor [data-block-id]')){
      const linked=(currentLinks[block.dataset.blockId!]??[]).flatMap(id=>currentRows.get(id)??[]);
      block.classList.toggle('hasLinkedAssets',linked.length>0);block.title=linked.length?`关联：${linked.map(row=>row.name).join('、')}。Ctrl+单击或右键查看资料`:'';
    }
  }
  const onBlock=(event:MouseEvent)=>{
    const block=(event.target as Element).closest<HTMLElement>('.slate-editor [data-block-id]');if(!block||event.type==='click'&&!event.ctrlKey)return;
    event.preventDefault();event.stopPropagation();void (async()=>{await getActiveWritingEditor()?.flush();await showLinks(episodeId,block.dataset.blockId!);})().catch(error=>showToast(String(error)));
  };
  root.addEventListener('click',onBlock);root.addEventListener('contextmenu',onBlock);
  document.addEventListener('selectionchange',showSelection);
  const update=()=>{if(!active()){dispose();return;}void render();};window.addEventListener('dsh:content-updated',update);window.addEventListener('dsh:script-written',update);
  const observer=new MutationObserver(()=>{if(!active())dispose();});observer.observe(root,{childList:true});
  function dispose(){disposed=true;toolbar.remove();root.removeEventListener('click',onBlock);root.removeEventListener('contextmenu',onBlock);document.removeEventListener('selectionchange',showSelection);window.removeEventListener('dsh:content-updated',update);window.removeEventListener('dsh:script-written',update);observer.disconnect();}
  mounts.set(root,dispose);await render();
}
