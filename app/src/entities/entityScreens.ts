import { writingWorkspace } from '../projects/projectIdentity';
import './entityScreens.css';
import { openEntityDetails } from './entityDetails';
import { db,createEntity,ensureSeed,type EntityKind,type EntityRow } from '../data/db';
import { listEntitySummaries, type EntitySummary } from '../data/entityCatalog';
import { action,modal,node,mainPanel } from '../ui/localUi';
import {openImageViewer} from '../ui/imageViewer';
import {getProjectAssetMedia} from '../assetLibrary/projectAssets';
import {mountLazyThumbnail} from '../ui/lazyThumbnail';
import {mountImageDefaults} from '../storyboard/imageDefaults';
import {openEntityBatch} from './entityBatchPanel';
import {attachImageImport} from './entityImageImport';
export async function upgradeEntities(root:HTMLElement,kind:EntityKind){
  const label={character:'人物',location:'地点',prop:'道具'}[kind];
  const {page,body,header}=mainPanel(root,label);page.classList.add('entityPage');await ensureSeed();if(!page.isConnected)return;
  if (!writingWorkspace) body.before(mountImageDefaults(page));
  const search=node('input','','localSearch');search.placeholder=`搜索${label}`;search.setAttribute('aria-label',`搜索${label}`);const grid=node('div','','localGrid');
  const selected=new Set<string>();let visibleRows:readonly EntitySummary[]=[],allRows:readonly EntitySummary[]=[],renderVersion=0;
  const thumbnails:Array<()=>void>=[];
  const clearThumbnails=()=>{thumbnails.splice(0).forEach(dispose=>dispose());};
  const tools=node('section','','entityBatchToolbar');tools.setAttribute('aria-label',`${label}批量操作`);
  const count=node('span','已选 0 项','localMuted');count.setAttribute('role','status');
  const batch=node('button','批量 Skill / 生图','localButton');batch.type='button';
  const updateSelection=()=>{count.textContent=`已选 ${selected.size} 项`;batch.disabled=!selected.size;grid.querySelectorAll<HTMLInputElement>('input[data-entity-select]').forEach(check=>{check.checked=selected.has(check.dataset.entitySelect!);check.closest('.entityCard')?.classList.toggle('isSelected',check.checked);});};
  tools.append(action(`全选全部${label}`,()=>{for(const row of allRows)selected.add(row.id);updateSelection();}),action('全选当前结果',()=>{for(const row of visibleRows)selected.add(row.id);updateSelection();}),action('只选无图资产',()=>{selected.clear();for(const row of visibleRows)if(!row.hasImage)selected.add(row.id);updateSelection();}),action('取消选择',()=>{selected.clear();updateSelection();}),count,batch);
  batch.onclick=()=>{void openEntityBatch(kind,[...selected]);};body.append(search);if (!writingWorkspace) body.append(tools);body.append(grid);
  async function edit(row:Pick<EntityRow,'id'>){ await openEntityDetails(row.id); }
  async function render(){
    const version=++renderVersion,rows=await listEntitySummaries(kind);
    if(!page.isConnected||version!==renderVersion)return;
    allRows=rows;const ids=new Set(rows.map(row=>row.id));for(const id of selected)if(!ids.has(id))selected.delete(id);
    paint();
  }
  function paint(){
    if(!page.isConnected)return;
    const visible=allRows.filter(r=>`${r.name}\n${r.meta}\n${r.desc}`.includes(search.value));
    visibleRows=visible;
    const hasImages=!writingWorkspace && visible.some(row=>row.hasImage);grid.classList.add('entityGrid');grid.dataset.hasImages=String(hasImages);clearThumbnails();grid.replaceChildren();
    for(const row of visible){
      const card=node('article','','localCard entityCard');card.dataset.entityId=row.id;
      if(hasImages){
        const media=node('div','','entityCardMedia');
        if(row.hasImage){
          const original=async()=>{const image=(await db.entities.get(row.id))?.image;if(!image)throw Error('图片已移除');return image;};
          media.tabIndex=0;media.setAttribute('role','button');media.setAttribute('aria-label',`查看${row.name}原图`);
          const showOriginal=async()=>{
            const entity=await db.entities.get(row.id);
            if(entity?.assetSnapshot)return getProjectAssetMedia(entity.assetSnapshot.view.mediaId);
            if(!entity?.image)throw Error('图片已移除');
            return entity.image;
          };
          const show=()=>openImageViewer(showOriginal(),row.name);
          media.onclick=show;
          media.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();show();}};
          thumbnails.push(mountLazyThumbnail(media,row.name,()=>({key:row.id,load:original})).dispose);
        }else media.setAttribute('aria-hidden','true');card.append(media);
      }
      const heading=node('h3'),select=node('label','','entityCardSelection'),check=node('input');check.type='checkbox';check.dataset.entitySelect=row.id;check.setAttribute('aria-label',`选择${label} ${row.name}`);check.onchange=()=>{if(check.checked)selected.add(row.id);else selected.delete(row.id);updateSelection();};select.append(check,node('span',row.name));if (writingWorkspace) heading.textContent=row.name;else heading.append(select);
      card.append(heading,node('p',row.meta,'localMuted'),node('p',row.desc,'entityDescription'),action('编辑资料',()=>edit(row)));grid.append(card);
    }
    if(!grid.children.length)grid.append(node('p',`暂无${label}，点击“新建${label}”开始。`,'localMuted'));
    updateSelection();
  }
  header.append(action(`新建${label}`,async()=>{const row=await createEntity(kind);await render();await edit(row);}),action('恢复已删除资料',async()=>{const {body}=modal('恢复资料');const rows=await db.docs.where('key').startsWith('entity:deleted:').toArray();for(const item of rows){const row=item.payload as EntityRow;if(row.kind!==kind||await db.entities.get(row.id))continue;body.append(action(`恢复 ${row.name}`,async()=>{await db.entities.add(row);await render();body.replaceChildren(node('p','已恢复，可关闭窗口继续。'));}));}if(!body.children.length)body.append(node('p','没有可恢复的资料'));}));
  if (!writingWorkspace) attachImageImport(header,{title:()=>`上传${label}图片`,save:async(name,image)=>{await createEntity(kind,{name,meta:'',image});},complete:()=>{search.value='';window.dispatchEvent(new CustomEvent('dsh:content-updated',{detail:{kind:'entity'}}));}});
  let searchTimer:ReturnType<typeof setTimeout>|undefined;
  search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(paint,80);};
  const updated=()=>{if(page.isConnected)void render();};window.addEventListener('dsh:content-updated',updated);
  const detach=new MutationObserver(()=>{if(page.isConnected)return;renderVersion++;clearTimeout(searchTimer);clearThumbnails();allRows=[];visibleRows=[];window.removeEventListener('dsh:content-updated',updated);detach.disconnect();});
  detach.observe(root,{childList:true,subtree:true});await render();
}
