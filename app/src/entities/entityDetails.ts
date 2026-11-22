import { writingWorkspace } from '../projects/projectIdentity';
import './entityScreens.css';
import { db, type EntityRow, loadDoc, saveDoc, updateEntity } from '../data/db';
import {refreshWorkspaceView} from '../writing/workspaceFeedback';
import { getActiveContentEditor } from '../writing/contentEditor';
import { action, modal, field, node } from '../ui/localUi';
import type { EpisodeIndex } from '../episode/episodeManager';
import type { ScriptBlock } from '../script/editor';
import {openEntityImage} from './entityImagePanel';
import {bindImagePreview,openImageViewer} from '../ui/imageViewer';
import {prepareEntityImage} from './entityImageUpload';
import {getProjectAssetMedia} from '../assetLibrary/projectAssets';

export async function openEntityDetails(id:string) {
  await getActiveContentEditor()?.flush();
  const row=await db.entities.get(id);if(!row)throw Error('这条资产已删除，可在资产页面恢复');
  const label={character:'人物',location:'地点',prop:'道具'}[row.kind];
  const {dialog,body}=modal(`编辑${label}`);dialog.dataset.entityId=id;dialog.classList.add('entityDetails');
  const name=field('名称',row.name),meta=field('简介',row.meta),desc=field('设定',row.desc,true);let image=row.image;
  const file=node('input');file.type='file';file.accept='image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';file.setAttribute('aria-label','资料图片');
  const preview=node('img');preview.alt=row.name;preview.hidden=!image;if(image&&!writingWorkspace)preview.src=image;preview.style.maxHeight='180px';bindImagePreview(preview);
  const imageHint=node('p','支持 PNG、JPG、WebP，单张最大 32MB。大图自动压缩为资产引用图，最长边 4096 像素；电脑上的原文件不变。','localMuted');
  const imageStatus=node('p','','entityImageStatus');imageStatus.setAttribute('role','status');
  let uploadVersion=0,uploading=false;
  file.onchange=async()=>{
    const f=file.files?.[0];if(!f)return;const version=++uploadVersion;
    uploading=true;file.disabled=save.disabled=generate.disabled=remove.disabled=true;imageStatus.textContent='正在读取并处理图片…';
    try{
      const result=await prepareEntityImage(f);if(version!==uploadVersion||!dialog.open)return;
      image=result.dataUrl;preview.src=image;preview.hidden=false;
      imageStatus.textContent=result.adjusted?`已自动压缩为 ${result.width} × ${result.height} 资产引用图，点击“保存资料”完成保存。`:'图片已读取，点击“保存资料”完成保存。';
    }catch(error){if(version===uploadVersion&&dialog.open)imageStatus.textContent=`${error instanceof Error?error.message:'图片读取失败'}。${image?'原有资产图片已保留。':'未更改资产资料。'}`;}
    finally{if(version===uploadVersion){uploading=false;file.disabled=save.disabled=generate.disabled=remove.disabled=false;file.value='';}}
  };
  dialog.addEventListener('close',()=>{uploadVersion++;preview.removeAttribute('src');image=undefined;},{once:true});
  const changed=()=>window.dispatchEvent(new CustomEvent('dsh:content-updated',{detail:{kind:'entity',id}}));
  const generate=action('生成资产图片',async()=>{
    if(uploading)return;
    if(name.input.value!==row.name||meta.input.value!==row.meta||desc.input.value!==row.desc||image!==row.image)throw Error('请先保存资料，再按最新设定生成图片');
    dialog.close();await openEntityImage(id);
  });if (!writingWorkspace) body.append(generate);
  const media=node('div','','entityMedia'),actions=node('div','','entityActions');
  const remove=action('移除图片',()=>{if(uploading)return;image='';preview.removeAttribute('src');preview.hidden=true;file.value='';imageStatus.textContent='图片已移除，点击“保存资料”完成保存。';});
  media.append(preview,file,remove);
  const pin=row.assetSnapshot;
  if(pin){
    const original=action('查看已固定的原图',()=>openImageViewer(getProjectAssetMedia(pin.view.mediaId),pin.view.name));
    media.append(original,node('span',pin.appearanceName+' · '+pin.view.name,'localMuted'));
  }
  body.append(name.wrap,meta.wrap,desc.wrap);
  if (!writingWorkspace) body.append(media,imageHint,imageStatus);
  body.append(actions);
  const save=action('保存资料',async()=>{
    if(uploading)return;
    if(!name.input.value.trim()||name.input.value.length>200)throw Error('名称需为1—200字');
    await db.transaction('rw',db.entities,db.docs,async()=>{const current=await db.entities.get(id);if(JSON.stringify(current)!==JSON.stringify(row))throw Error('资料已在其他页面修改，请保留输入并重新打开');await updateEntity(id,{name:name.input.value.trim(),meta:meta.input.value,desc:desc.input.value,...(image!==undefined?{image}:{})});});dialog.close();changed();
  });actions.append(save,action('删除资料',async()=>{
    if(!confirm(`删除「${row.name}」？剧本文字和引用记录保留，可在资产页恢复。`))return;
    await db.transaction('rw',db.entities,db.docs,async()=>{const current=await db.entities.get(id);if(JSON.stringify(current)!==JSON.stringify(row))throw Error('资料已变化，请重新打开');await db.docs.put({key:`entity:deleted:${id}`,payload:current,updatedAt:Date.now()});await db.entities.delete(id);});dialog.close();changed();
  }));
  await appendEntityReferences(body,row,()=>dialog.close());
}
export async function appendEntityReferences(body:HTMLElement,row:EntityRow,beforeNavigate:()=>void) {
  const references=await db.docs.where('key').startsWith('entities:links:').toArray();
  const index=await loadDoc<EpisodeIndex>('episode:ep_001');const entries=[...(index?.chapters??[]),...(index?.archived??[])];
  const section=node('section','','entityReferences');section.append(node('h3','关联正文与场次'));let count=0;
  for(const reference of references){
    const episodeId=reference.key.slice('entities:links:'.length);const entry=entries.find(e=>e.episodeId===episodeId);if(!entry)continue;
    const blocks=await loadDoc<ScriptBlock[]>(`script:${episodeId}`)??[];
    for(const [blockId,ids] of Object.entries(reference.payload as Record<string,string[]>)){
      if(!Array.isArray(ids)||!ids.includes(row.id))continue;const block=blocks.find(b=>b.id===blockId);if(!block)continue;count++;
      const archived=!index?.chapters.some(e=>e.episodeId===episodeId);
      const link=action(`${entry.title} · ${block.type==='scene'?'场次':'段落'} · ${block.text.slice(0,70)}`,()=>{beforeNavigate();window.dispatchEvent(new CustomEvent('dsh:reveal-script',{detail:{episodeId,blockIds:[blockId]}}));});link.disabled=archived;if(archived)link.title='此章已归档，请先在管理剧集恢复';section.append(link);
    }
  }
  if(!count)section.append(node('p','暂无正文引用。在正文的“关联资料”中添加，或让 Agent 提取并关联。','localMuted'));
  if(body.isConnected)body.append(section);
  if (writingWorkspace) return;
  const shotSection=node('section','','entityReferences');shotSection.append(node('h3','关联分镜'));let shotCount=0;
  for(const entry of entries){
    const shots=await loadDoc<{id:string;no:string;desc:string;sceneId?:string;entityIds?:string[]}[]>(`storyboard:${entry.episodeId}`)??[];
    for(const shot of shots.filter(s=>s.entityIds?.includes(row.id))){shotCount++;
      const link=action(`${entry.title} · ${shot.no} · ${shot.desc.slice(0,60)}`,async()=>{beforeNavigate();await saveDoc(`storyboard:${entry.episodeId}:activeScene`,shot.sceneId??'unassigned');await saveDoc(`storyboard:${entry.episodeId}:mode`,'canvas');await refreshWorkspaceView(entry.episodeId,'04-storyboard');});
      link.disabled=!index?.chapters.some(c=>c.episodeId===entry.episodeId);shotSection.append(link);
    }
  }
  if(shotCount&&body.isConnected)body.append(shotSection);
}
