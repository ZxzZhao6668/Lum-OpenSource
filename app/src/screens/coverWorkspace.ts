import { writingWorkspace } from '../projects/projectIdentity';
import {db,loadDoc,saveDoc} from '../data/db';
import {mainPanel,node,field,action,downloadText} from '../ui/localUi';
import {bindImagePreview} from '../ui/imageViewer';
import {registerContentEditor} from '../writing/contentEditor';
import {adoptCoverImage,type CoverDocument,type ReferenceImage} from '../storyboard/generationState';
import {mountCoverImagePanel} from './coverImagePanel';
import './coverWorkspace.css';

export async function mountCoverWorkspace(root:HTMLElement,episodeId:string,episodeTitle:string){
 const {page,header,body}=mainPanel(root,'剧本封面');page.classList.add('coverWorkspace');
 const key=`cover:${episodeId}`,loaded=await loadDoc<CoverDocument>(key);if(!page.isConnected)return;
 let current:CoverDocument=loaded??{title:episodeTitle,author:'',contact:'',synopsis:''};
 let committed=JSON.stringify(loaded),queue:Promise<void>=Promise.resolve(),active=()=>false;
 let invalidate:()=>void=()=>{};
 const status=node('span','已加载','localStatus');status.setAttribute('role','status');header.append(status);
 const top=node('div','','coverOverview'),form=node('section','','coverMetadata'),preview=node('section','','coverPreview');
 const fields=[['title','作品名称'],['author','作者'],['contact','联系方式'],['synopsis','作品简介']] as const;
 const inputs=fields.map(([id,label])=>{const f=field(label,current[id]??'',id==='synopsis');f.input.maxLength=id==='synopsis'?30000:1000;form.append(f.wrap);return{id,...f};});
 const renderPreview=()=>{
  preview.replaceChildren(node('h3','当前封面'));
  if(current.image){const img=node('img');img.src=current.image;img.alt=`${current.title||episodeTitle} · 已采用封面`;bindImagePreview(img,()=>Promise.resolve(current.image));preview.append(img);}
  else preview.append(node('div','生成并采用图片后，封面会显示在这里。','coverEmpty'));
  preview.append(node('p',current.image?'已采用 · 点击图片查看大图':'先填写作品信息，再选择 Skill 生成封面。','coverHint'));
 };
 top.append(form);
 if (!writingWorkspace) { renderPreview();top.append(preview); }
 else top.style.gridTemplateColumns = 'minmax(0, 44rem)';
 body.append(top);
 // Capture only edited text. Merge inside the queue so an intervening image adoption
 // cannot be overwritten by an autosave queued while its preview was downloading.
 const save=()=>{
  const patch=Object.fromEntries(inputs.map(f=>[f.id,f.input.value]));
  const op=queue.catch(()=>{}).then(()=>db.transaction('rw',db.docs,async()=>{
   if(!active())throw Error('页面已关闭');
   const latest=await loadDoc<CoverDocument>(key);
   if(JSON.stringify(latest)!==committed)throw Error('封面已在其他窗口修改或删除，请保留草稿后重新打开');
   const next={...current,...patch};
   await saveDoc(key,next);current=next;committed=JSON.stringify(next);status.textContent='已保存';
  }));queue=op;return op;
 };
 inputs.forEach(f=>f.input.addEventListener('input',()=>{invalidate();status.textContent='保存中…';void save().catch(e=>{if(page.isConnected)status.textContent=String(e);});}));
 active=registerContentEditor(page,{hasUnsavedChanges:()=>inputs.some(f=>f.input.value!==(current[f.id]??'')),flush:save,reload:async()=>{throw Error('请重新打开封面页面');}});
 const adopt=async(image:ReferenceImage)=>{
  await save();
  const op=queue.catch(()=>{}).then(async()=>{
   if(!active())throw Error('页面已关闭');
   current=await adoptCoverImage(episodeId,image,current,active);
   committed=JSON.stringify(current);renderPreview();status.textContent='已采用封面';
  });queue=op;await op;
 };
 header.append(action('返回剧本',()=>{window.dispatchEvent(new CustomEvent('dsh:nav',{detail:'01-script'}));}),action('导出封面文字',async()=>{await save();downloadText('剧本封面.txt',inputs.map(f=>`${fields.find(([id])=>id===f.id)![1]}：${f.input.value}`).join('\n\n'));}));
 if (writingWorkspace) return;
 header.append(action('导出封面图片',async()=>{
  await save();if(!current.image)throw Error('请先生成并采用一张封面图片');
  const a=node('a');a.href=current.image;const ext=/^data:image\/(\w+);/.exec(current.image)?.[1]??'png';a.download=`${(current.title||'封面').replace(/[<>:"/\\|?*]/g,'_')}-封面.${ext}`;a.click();
 }));
 // Model discovery can wait on an offline local service. Keep document editing
 // and navigation available while the optional AI controls initialize.
 void mountCoverImagePanel(body,{episodeId,isAlive:active,flush:save,adopt}).then(panel=>{
  if(active())invalidate=()=>panel.invalidate();
 }).catch(error=>{if(active())status.textContent=String(error);});
}
