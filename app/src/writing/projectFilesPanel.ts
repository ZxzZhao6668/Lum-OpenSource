import { action,modal,node,field,downloadText } from '../ui/localUi';
import { importProjectFile,listProjectFiles,updateProjectFile,type ProjectFile } from './projectFiles';
import { writingStyles } from './styles';
import {listSkills} from '../skills/skillStore';

export async function openProjectFiles(onReference:(file:ProjectFile)=>void){
 const advisors=[...writingStyles.map(s=>({id:s.id,label:s.label})),...(await listSkills('agent')).map(s=>({id:s.id,label:s.name}))];
 const {dialog,body}=modal('项目资料');
 body.append(node('p','资料保存在当前项目，随写作备份保存。支持 TXT、Markdown、CSV、JSON、PDF、DOCX；PDF / Word 单份10MiB，PDF最多200页，提取文本最多2MiB。项目100份/20MiB（含归档）。仅提取文字，扫描件需先识别文字。','localMuted'));
 const upload=node('input');upload.type='file';upload.accept='.txt,.md,.markdown,.csv,.json,.pdf,.docx';upload.multiple=true;upload.setAttribute('aria-label','添加资料文件');
 const uploadLabel=node('label','','localField');uploadLabel.append(node('span','添加文件'),upload);
 const search=node('input','','localSearch');search.placeholder='搜索资料名称';search.setAttribute('aria-label','搜索资料名称');
 const archived=node('input');archived.type='checkbox';archived.setAttribute('aria-label','显示已归档资料');const archiveLabel=node('label','','localRow');archiveLabel.append(archived,node('span','显示已归档资料'));
 const status=node('p','正在加载资料…','localStatus');status.dataset.filesStatus='true';status.setAttribute('role','status');const list=node('div','','localGrid');list.setAttribute('aria-busy','true');body.append(uploadLabel,search,archiveLabel,status,list);let renderId=0;
 async function render(){
  const id=++renderId,files=await listProjectFiles(archived.checked);if(id!==renderId||!dialog.isConnected)return;list.replaceChildren();
  for(const file of files.filter(f=>f.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))){
   const card=node('article','','localCard');card.dataset.projectFile=file.id;
   card.append(node('h3',file.name),node('p',`${(file.bytes/1024).toFixed(1)} KiB · ${file.encoding}${file.advisorId?' · '+(advisors.find(s=>s.id===file.advisorId)?.label??'顾问已移除，可重新分配'):''}${file.archivedAt?' · 已归档':''}`,'localMuted'));
   const controls=node('div','','localRow');
   controls.append(action('预览 / 编辑资料信息',()=>{
    const detail=modal('资料信息');const name=field('资料名称',file.name);const owner=node('select');owner.setAttribute('aria-label','所属顾问');
    const common=node('option','通用项目资料');common.value='';owner.append(common);for(const style of advisors){const option=node('option',style.label);option.value=style.id;owner.append(option);}if(file.advisorId&&!advisors.some(s=>s.id===file.advisorId)){const missing=node('option','原顾问已移除（保留归属）');missing.value=file.advisorId;owner.append(missing);}owner.value=file.advisorId??'';
    const label=node('label','','localField');label.append(node('span','所属顾问'),owner);const content=node('pre',file.text.slice(0,100000));content.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:35vh;overflow:auto;font:13px/1.7 monospace';content.setAttribute('aria-label','资料正文预览');
    detail.body.append(name.wrap,label,action('保存资料信息',async()=>{await updateProjectFile(file.id,file.revision,{name:name.input.value,advisorId:owner.value});detail.dialog.close();await render();}),content);
    if(file.text.length>100000)detail.body.append(node('p','预览仅显示前100000字符，下载可取得全部正文。','localMuted'));
    const extracted=['PDF','DOCX'].includes(file.encoding);detail.body.append(action(extracted?'下载提取文本':'下载全文',()=>downloadText(extracted?file.name+'.txt':file.name,file.text)));
   }));
   if(!file.archivedAt)controls.append(action('引用到对话',()=>{onReference(file);dialog.close();}),action('归档',async()=>{await updateProjectFile(file.id,file.revision,{archived:true});await render();}));
   else controls.append(action('恢复',async()=>{await updateProjectFile(file.id,file.revision,{archived:false});await render();}));
   card.append(controls);list.append(card);
  }
  if(!list.children.length)list.append(node('p','暂无符合条件的资料。','localMuted'));
  list.setAttribute('aria-busy','false');if(status.textContent==='正在加载资料…')status.textContent=`共 ${files.length} 份资料`;
 }
 const refresh=()=>void render().catch(error=>{status.textContent=error instanceof Error?error.message:String(error);});search.oninput=refresh;archived.onchange=refresh;
 upload.onchange=async()=>{const files=Array.from(upload.files??[]);if(!files.length)return;upload.disabled=true;let count=0;try{for(const file of files){await importProjectFile(file);count++;}status.textContent=`已导入 ${count} 个文件`;}catch(error){status.textContent=`已导入 ${count} 个文件；${error instanceof Error?error.message:error}`;}finally{upload.disabled=false;upload.value='';await render();}};
 await render();
}
