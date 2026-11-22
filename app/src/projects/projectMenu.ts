import {db,loadDoc,type ProjectVersionRow} from '../data/db';
import {action,downloadText,field,modal,node} from '../ui/localUi';
import {showToast} from '../ui/toast';
import {flushWorkspace} from '../ui/workspaceTools';
import {isWritingBusy} from '../writing/writingSession';
import {restoreLocalWorkspaceVersion} from '../storage/workspaceBackup';
import {collectWritingExport,exportContents,openWritingExport,writingExportHtml,type ExportOptions} from '../export/writingExport';
import type {EpisodeIndex} from '../episode/episodeManager';
import {currentProjectId} from './projectIdentity';
import {trashProject} from './projectStore';
import {openProjectWriting} from './projectWritingPanel';
import './projectMenu.css';

let closeMenu:(()=>void)|undefined;
export function openProjectMenu(anchor:HTMLElement,episodeId:string) {
  closeMenu?.();const menu=node('div','','episodeContextMenu projectContextMenu');
  menu.setAttribute('role','menu');menu.setAttribute('aria-label','项目操作');
  const events=new AbortController();const close=()=>{events.abort();menu.remove();if(closeMenu===close)closeMenu=undefined;};closeMenu=close;
  const item=(label:string,run:()=>Promise<unknown>)=>{const button=node('button',label);button.type='button';button.setAttribute('role','menuitem');button.onclick=()=>{close();void run().catch(error=>showToast(error instanceof Error?error.message:String(error)));};menu.append(button);};
  item('项目设置',()=>openProjectWriting(episodeId,'项目设置'));
  item('历史版本',openProjectHistory);item('发布',openPublication);
  item('导出',()=>openWritingExport(episodeId,'script'));item('删除',openTrashProject);
  document.body.append(menu);const rect=anchor.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(rect.bottom+4,innerHeight-menu.offsetHeight-8))}px`;
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target as Node))close();},{capture:true,signal:events.signal});
  window.addEventListener('dsh:nav',close,{signal:events.signal});
  menu.addEventListener('keydown',e=>{const buttons=[...menu.querySelectorAll('button')],at=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='Escape'){e.preventDefault();close();anchor.focus();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}else if(e.key==='Tab')close();});
  menu.querySelector('button')?.focus();
}

async function requireIdle() {
  if(isWritingBusy())throw Error('请先停止当前 AI 写作任务');
  const generation=await loadDoc<{shots?:Record<string,{history?:{state:string}[]}>}>('storyboard:ep_001:generation');
  if(Object.values(generation?.shots??{}).some(s=>s.history?.some(h=>['submitting','running','unknown','interrupted','cancelling'].includes(h.state))))throw Error('图片任务尚未结束，请先完成或取消任务');
}
async function saveVersion(label:string) {
  await requireIdle();await flushWorkspace();
  return db.transaction('rw',db.docs,db.entities,db.versions,async()=>{
    const docs=(await db.docs.toArray()).filter(row=>row.key!=='workspace:beforeRestore'),entities=await db.entities.toArray();
    const version:ProjectVersionRow={id:crypto.randomUUID(),label:label.trim().slice(0,120)||'手动保存',createdAt:Date.now(),docs,entities};
    await db.versions.add(version);return version;
  });
}
function previewVersion(version:ProjectVersionRow) {
  const {body}=modal('版本预览');body.append(node('h3',version.label),node('p',new Date(version.createdAt).toLocaleString(),'localMuted'));
  const index=version.docs.find(d=>d.key==='episode:ep_001')?.payload as EpisodeIndex|undefined;
  for(const chapter of index?.chapters??[]){
    body.append(node('h4',chapter.title));
    const blocks=version.docs.find(d=>d.key===`script:${chapter.episodeId}`)?.payload as {text:string}[]|undefined;
    body.append(node('pre',blocks?.map(b=>b.text).join('\n')||'暂无剧本正文','projectVersionText'));
    const outline=version.docs.find(d=>d.key===`outline:${chapter.episodeId}`)?.payload as {docs:{title:string;html:string}[]}|undefined;
    for(const doc of outline?.docs??[]){const parsed=new DOMParser().parseFromString(doc.html,'text/html');body.append(node('h4',doc.title),node('pre',parsed.body.textContent??'','projectVersionText'));}
  }
  body.append(node('p',`包含 ${version.docs.length} 份文档、${version.entities.length} 项资产。恢复时会一起恢复这些写作数据。`,'localMuted'));
}
async function openProjectHistory() {
  await flushWorkspace();const {dialog,body}=modal('历史版本');dialog.classList.add('projectHistory');
  body.append(node('p','保存重要稿件，查看或恢复本项目的写作数据。版本保存在当前浏览器；外部媒体和 Lum 制片工程不随版本回退。','localMuted'));
  const name=field('版本名称',''),list=node('div','','projectVersionList');
  const render=async()=>{const versions=await db.versions.orderBy('createdAt').reverse().toArray();if(!dialog.isConnected)return;list.replaceChildren();
    for(const version of versions){const card=node('article','','localCard');card.dataset.projectVersion=version.id;const controls=node('div','','localRow');
      controls.append(action('查看',()=>previewVersion(version)),action('恢复此版本',async()=>{
        await requireIdle();if(!confirm(`恢复“${version.label}”？当前写作内容会先保存为“恢复前自动备份”。`))return;
        await saveVersion('恢复前自动备份');await requireIdle();await restoreLocalWorkspaceVersion(version);location.reload();
      }));card.append(node('h3',version.label),node('p',new Date(version.createdAt).toLocaleString(),'localMuted'),controls);list.append(card);
    }
    if(!versions.length)list.append(node('p','还没有保存版本。','localMuted'));
  };
  body.append(name.wrap,action('保存版本',async()=>{await saveVersion(name.input.value);name.input.value='';await render();}),list);await render();
}
async function openPublication() {
  await flushWorkspace();const {dialog,body}=modal('发布');dialog.classList.add('projectPublication');
  body.append(node('p','生成可分享的只读 HTML 阅读版，下载后可独立打开。','localMuted'));
  const index=await loadDoc<EpisodeIndex>('episode:ep_001');if(!dialog.isConnected)return;
  const episodes=new Set(index?.chapters.map(c=>c.episodeId)??[]),contents=new Set<ExportOptions['contents'][number]>(['script','outline']);
  let rendered='';let filename='';const preview=node('div','','projectPublicationPreview');
  const download=action('下载阅读版',()=>downloadText(filename,rendered,'text/html;charset=utf-8'));download.disabled=true;
  const invalidate=()=>{rendered='';download.disabled=true;preview.replaceChildren();};
  const checks=node('div','','projectPublicationChoices');
  for(const chapter of index?.chapters??[]){const label=node('label'),check=node('input');check.type='checkbox';check.checked=true;check.onchange=()=>{if(check.checked)episodes.add(chapter.episodeId);else episodes.delete(chapter.episodeId);invalidate();};label.append(check,node('span',chapter.title));checks.append(label);}
  body.append(node('h3','章节'),checks,node('h3','内容'));
  const contentChecks=node('div','','projectPublicationChoices');
  for(const [key,title]of exportContents){const label=node('label'),check=node('input');check.type='checkbox';check.checked=contents.has(key);check.onchange=()=>{if(check.checked)contents.add(key);else contents.delete(key);invalidate();};label.append(check,node('span',title));contentChecks.append(label);}
  body.append(contentChecks,action('生成阅读版',async()=>{
    await flushWorkspace();const options:ExportOptions={episodes:[...episodes],contents:[...contents],fields:['no','desc','type','angle','movement','lens','duration'],watermark:''};
    const data=await collectWritingExport(options);if(!dialog.isConnected)return;
    rendered=writingExportHtml(data);filename=`${data.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)}-阅读版.html`;
    const frame=node('iframe');frame.title='阅读版预览';frame.setAttribute('sandbox','');frame.srcdoc=rendered;preview.replaceChildren(frame);download.disabled=false;
  }),download,preview);
}
async function openTrashProject() {
  const {dialog,body}=modal('删除项目');
  body.append(node('p','将项目移入回收站。正文、分镜和资产会保留，可以从首页回收站恢复。'),action('取消',()=>dialog.close()),action('移入回收站',async()=>{await requireIdle();await flushWorkspace();await trashProject(currentProjectId??'legacy',true);location.assign('/?view=writing');}));
}
