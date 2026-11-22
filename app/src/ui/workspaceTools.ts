import { mountFocusMode } from './writingFocus';
import {openScriptSetup} from '../scriptSetup/scriptSetupPanel';
import {mountWritingSidebar} from './writingSidebar';
import {openProjectWriting} from '../projects/projectWritingPanel';
import {openProjectMenu} from '../projects/projectMenu';
import { loadDoc,saveDoc } from '../data/db';
import { action,modal,node,field,downloadText } from './localUi';
import { showEpisodeManager } from '../episode/episodeManager';
import {addBlankEpisode} from '../episode/episodeActions';
import { closeChapterDraft } from '../episode/chapterView';
import { getActiveWritingEditor } from '../script/editor';
import { getActiveContentEditor } from '../writing/contentEditor';
import { isWritingBusy } from '../writing/writingSession';
import { exportWorkspace,parseWorkspaceBackup,restoreWorkspace,previousWorkspace,workspaceBackupLimit } from '../storage/workspaceBackup';
import { currentProjectId, projectStorageKey, writingWorkspace } from '../projects/projectIdentity';
import { renameProject } from '../projects/projectStore';
import { templateCleanupBackup,restoreTemplateShots } from '../storyboard/templateMigration';

export async function flushWorkspace(){await closeChapterDraft();await getActiveWritingEditor()?.flush();await getActiveContentEditor()?.flush();}
async function projectDialog(){
  await flushWorkspace();const {dialog,body}=modal('项目与备份');const meta=await loadDoc<{name:string}>('project:meta');const name=field('项目名称',meta?.name??'我的写作项目');
  body.append(name.wrap,action('保存项目名称',async()=>{if(!name.input.value.trim())throw Error('请输入项目名称');if(currentProjectId)await renameProject(currentProjectId,name.input.value);else await saveDoc('project:meta',{...meta,name:name.input.value.trim().slice(0,120)});dialog.close();document.querySelectorAll<HTMLElement>('[data-project-name]').forEach(title=>{title.textContent=name.input.value.trim();title.title=name.input.value.trim();});document.title=`${name.input.value.trim()} · Lum`;window.dispatchEvent(new Event('dsh:project-renamed'));}));
  const storageHint=window.lumDesktop?'写作数据保存在本机 Lum 数据目录中。':`写作数据保存在当前浏览器中，请固定使用 ${location.host}。`;
  body.append(node('p',storageHint+'备份包含剧集、正文、大纲、分镜、资料、写作会话和项目已固定的资产原图。Lum 的外部项目文件、模型密钥和其他外部媒体需要另外备份。','localMuted'));
  if (!writingWorkspace) { const legacyCanvas=node('a','打开旧版共享画布','localButton');legacyCanvas.href='/?view=canvas';legacyCanvas.target='_blank';legacyCanvas.rel='noopener';body.append(legacyCanvas,node('p','每个项目现在使用独立画布。升级前的共享画布保留在此入口。','localMuted')); }
  body.append(action('导出写作备份',async()=>{await flushWorkspace();const data=await exportWorkspace();const json=JSON.stringify(data);if(new Blob([json]).size>workspaceBackupLimit)throw Error('写作备份超过 100MB，无法导出为单个文件');downloadText(`写作备份-${new Date().toISOString().slice(0,10)}.json`,json,'application/json');}));
  const file=node('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','选择写作备份');body.append(field('恢复备份','').wrap);body.lastElementChild!.replaceChildren(node('span','恢复备份（会替换当前写作工作区）'),file);
  file.onchange=async()=>{try{if(isWritingBusy())throw Error('请先停止当前AI任务再恢复备份');const f=file.files?.[0];if(!f)return;if(f.size>workspaceBackupLimit)throw Error('文件超过100MB');const data=parseWorkspaceBackup(await f.text());if(!confirm(`将恢复 ${data.docs.length} 份文档和 ${data.entities.length} 项资料，替换当前写作数据。导入前的数据会保留一个恢复点。继续？`))return;await flushWorkspace();await restoreWorkspace(data);localStorage.removeItem(projectStorageKey('dsh:selectedScript'));location.reload();}catch(e){alert(String(e));file.value='';}};
  if(await previousWorkspace())body.append(action('恢复上次导入前的数据',async()=>{if(isWritingBusy())throw Error('请先停止AI任务');if(!confirm('恢复到上次导入备份之前的写作数据？'))return;await flushWorkspace();const data=await previousWorkspace();if(data){await restoreWorkspace(data);location.reload();}}));
  const cleaned=await templateCleanupBackup();if(cleaned&&!cleaned.restoredAt)body.append(action('恢复示例清理前的分镜',async()=>{if(isWritingBusy())throw Error('请先停止AI任务');await flushWorkspace();await restoreTemplateShots();location.reload();}));
}
export async function mountWorkspaceTools(root:HTMLElement,episodeId:string){
  const panel=root.querySelector<HTMLElement>('.bg-panel');if(!panel)return;const anchor=panel.firstChild;
  const meta=await loadDoc<{name:string}>('project:meta');if(!panel.isConnected||panel.firstChild!==anchor)return;
  const toolbar=panel.querySelector<HTMLElement>('[data-project-actions]');
  if(!toolbar)return;
  toolbar.append(action('项目 / 备份',projectDialog),action('管理剧集',showEpisodeManager),action('项目资料设置',()=>openProjectWriting(episodeId)));
  if(root.dataset.screen==='01-script'){
    if (writingWorkspace) {
      mountFocusMode(root, toolbar);
    }
    const home=root.querySelector('.lumHeaderHome');
    const entry=action('剧本设定器',()=>openScriptSetup(episodeId));
    entry.classList.add('ssHeaderEntry');
    if(home)home.after(entry);else toolbar.append(entry);
  }
  const title=panel.querySelector<HTMLElement>('h3.truncate')??node('button','','localButton');if(!title.isConnected)toolbar.append(title);const projectName=meta?.name||'我的写作项目';title.dataset.projectName='true';title.textContent=projectName;title.title=projectName;title.tabIndex=0;title.setAttribute('role','button');title.setAttribute('aria-label','修改项目名称');title.onclick=()=>void projectDialog().catch(e=>alert(String(e)));title.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();title.click();}};document.title=`${projectName} · Lum`;
  await mountWritingSidebar(root,episodeId);
  panel.querySelectorAll<HTMLButtonElement>('button[aria-label="项目菜单"]').forEach(button=>{button.onclick=e=>{e.preventDefault();e.stopPropagation();openProjectMenu(button,episodeId);};});
  panel.querySelectorAll<HTMLButtonElement>('button[aria-label="添加剧集"]').forEach(button=>{button.onclick=async e=>{e.preventDefault();e.stopPropagation();if(button.disabled)return;button.disabled=true;try{await addBlankEpisode();}catch(error){alert(String(error));}finally{button.disabled=false;}};});
}
