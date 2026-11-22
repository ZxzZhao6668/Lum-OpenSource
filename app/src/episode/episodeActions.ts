import {loadDoc} from '../data/db';
import {changeEpisodes,type EpisodeIndex} from './episodeManager';
import {createEpisodeDocument} from '../writing/documentStore';
import {getActiveWritingEditor,type ScriptBlock} from '../script/editor';
import {getActiveContentEditor} from '../writing/contentEditor';
import {action,field,modal,node} from '../ui/localUi';
import {showToast} from '../ui/toast';

let adding: Promise<void>|undefined;
export function addBlankEpisode() {
  if(adding)return adding;
  adding=(async()=>{
    await getActiveWritingEditor()?.flush();await getActiveContentEditor()?.flush();
    await changeEpisodes(async index=>{
      const title=`Ep ${index.chapters.filter(c=>!c.draft).length+1}`;
      const draft=index.chapters.find(c=>c.draft);
      const blocks=draft?await loadDoc<ScriptBlock[]>(`script:${draft.episodeId}`):undefined;
      const outlines=draft?await loadDoc<{docs:{html:string}[]}>(`outline:${draft.episodeId}`):undefined;
      const shots=draft?await loadDoc<unknown[]>(`storyboard:${draft.episodeId}`):undefined;
      const empty=draft&&!draft.content?.trim()&&!blocks?.some(b=>b.text.trim())&&!outlines?.docs.some(d=>new DOMParser().parseFromString(d.html,'text/html').body.textContent?.trim())&&!shots?.length;
      if(empty){draft.title=title;delete draft.draft;}
      else {const id=`ep_${crypto.randomUUID()}`;await createEpisodeDocument(id);index.chapters.push({id,episodeId:id,title});}
      index.collapsed=false;
    });
    window.dispatchEvent(new Event('dsh:episodes-changed'));
  })().finally(()=>{adding=undefined;});
  return adding;
}

export async function renameEpisode(episodeId:string) {
  const index=await loadDoc<EpisodeIndex>('episode:ep_001');const entry=index?.chapters.find(c=>c.episodeId===episodeId);
  if(!entry)throw Error('该剧集已归档或不存在');
  const {dialog,body}=modal('重命名');dialog.classList.add('episodeRename');
  const name=field('剧集名称',entry.title);const footer=node('div','','localRow');
  footer.append(action('取消',()=>dialog.close()),action('保存',async()=>{
    const title=name.input.value.trim();if(!title||title.length>120)throw Error('名称需为1—120字');
    await changeEpisodes(current=>{const chapter=current.chapters.find(c=>c.episodeId===episodeId);if(!chapter)throw Error('剧集已归档或不存在');if(chapter.title!==entry.title)throw Error('名称已在其他位置修改，请重新打开');chapter.title=title;});
    dialog.close();window.dispatchEvent(new Event('dsh:episodes-changed'));
  }));body.append(node('p',entry.title,'localMuted'),name.wrap,footer);name.input.focus();name.input.select();
  name.input.addEventListener('keydown',e=>{if((e as KeyboardEvent).key==='Enter'){e.preventDefault();(footer.lastElementChild as HTMLButtonElement).click();}});
}

let closeMenu:(()=>void)|undefined;
export function openEpisodeMenu(anchor:HTMLElement,episodeId:string,event:MouseEvent|KeyboardEvent,onDelete?:()=>Promise<void>) {
  event.preventDefault();event.stopPropagation();closeMenu?.();
  const menu=node('div','','episodeContextMenu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','剧集菜单');
  const listeners=new AbortController();const close=()=>{listeners.abort();menu.remove();if(closeMenu===close)closeMenu=undefined;};closeMenu=close;
  const item=(label:string,run:()=>Promise<void>)=>{const button=node('button',label);button.type='button';button.setAttribute('role','menuitem');button.onclick=()=>{close();void run().catch(error=>showToast(String(error)));};menu.append(button);};
  item('重命名',()=>renameEpisode(episodeId));if(onDelete)item('删除',onDelete);
  document.body.append(menu);const rect=anchor.getBoundingClientRect();const point=event instanceof MouseEvent?{x:event.clientX,y:event.clientY}:{x:rect.left,y:rect.bottom};
  menu.style.left=`${Math.max(8,Math.min(point.x,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(point.y,innerHeight-menu.offsetHeight-8))}px`;
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target as Node))close();},{signal:listeners.signal,capture:true});
  window.addEventListener('dsh:nav',close,{signal:listeners.signal});window.addEventListener('dsh:episodes-changed',close,{signal:listeners.signal});
  menu.addEventListener('keydown',e=>{const buttons=[...menu.querySelectorAll('button')],at=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='Escape'){e.preventDefault();close();anchor.focus();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}else if(e.key==='Tab')close();});
  menu.querySelector('button')?.focus();
}
