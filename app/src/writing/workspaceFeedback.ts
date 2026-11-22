import { getActiveWritingEditor } from '../script/editor';
import { getActiveContentEditor } from './contentEditor';
import { closeChapterDraft } from '../episode/chapterView';
import { applyWorkspaceChange, type WorkspaceChange } from './workspaceChanges';
import type { WriteAuthorization } from './documentStore';
import { showToast } from '../ui/toast';
import { animateScriptWrite, highlightScriptWrite } from './writeFeedback';

export async function refreshWorkspaceView(episodeId: string, screen: string) {
  await new Promise<void>((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(Error('页面刷新超时，内容已保存在本地，请重新打开页面')),15000);
    window.dispatchEvent(new CustomEvent('dsh:refresh-writing',{detail:{episodeId,screen,resolve:()=>{clearTimeout(timer);resolve();},reject:(error:unknown)=>{clearTimeout(timer);reject(error);}}}));
  });
}
export async function flushWorkspaceEditors() {
  await closeChapterDraft();await getActiveWritingEditor()?.flush();await getActiveContentEditor()?.flush();
  if(document.querySelector('dialog[open]'))throw Error('请先保存或关闭编辑窗口，再执行写入');
}
export async function commitWorkspaceChange(id:string,authorization:WriteAuthorization,cancelled=()=>false):Promise<WorkspaceChange> {
  if(cancelled())throw Error('已停止，未写入');
  const host=document.querySelector<HTMLElement>('.laper-host'),inert=host?.inert??false;
  if(host)host.inert=true;
  let change:WorkspaceChange;
  try{
    await flushWorkspaceEditors();if(cancelled())throw Error('已停止，未写入');
    change=await applyWorkspaceChange(id,authorization);
    // The following navigation reconstructs all views. Old adapters were flushed
    // before the transaction and must not reload a structural change in place.
  }finally{if(host)host.inert=inert;}
  try{
    await refreshWorkspaceView(change.episodeId,change.screen);
    const script=change.scripts.find(s=>s.episodeId===change.episodeId);
    if(script&&change.screen==='01-script'){
      const ids=script.after.filter(b=>!script.before?.blocks.some(old=>old.id===b.id&&old.text===b.text)).map(b=>b.id);
      const current=document.querySelector<HTMLElement>('.laper-host'),wasInert=current?.inert??false;if(current)current.inert=true;
      try{await animateScriptWrite(ids,cancelled);highlightScriptWrite(ids,false);}finally{if(current)current.inert=wasInert;}
    }
  }catch(error){showToast(`内容已保存，页面请重新打开：${String(error)}`);}
  window.dispatchEvent(new CustomEvent('dsh:content-updated'));
  return change;
}
