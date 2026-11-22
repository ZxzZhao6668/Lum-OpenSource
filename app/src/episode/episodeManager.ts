import { db, loadDoc, saveDoc } from '../data/db';
import { createEpisodeDocument } from '../writing/documentStore';
import type { ScriptBlock } from '../script/editor';
import { action, modal, node, field } from '../ui/localUi';
import { closeChapterDraft } from './chapterView';
import { getActiveWritingEditor } from '../script/editor';
import { getActiveContentEditor } from '../writing/contentEditor';
import {isWritingBusy} from '../writing/writingSession';
import {synchronizeScriptChapters} from './scriptChapterSync';
export interface EpisodeEntry { id: string; episodeId: string; title: string; content?: string; draft?: boolean }
export interface EpisodeIndex { collapsed: boolean; chapters: EpisodeEntry[]; archived?: EpisodeEntry[] }
const key='episode:ep_001';
export async function changeEpisodes(change: (index: EpisodeIndex) => void | Promise<void>) {
  return db.transaction('rw',db.docs,async()=>{const index=await loadDoc<EpisodeIndex>(key);if(!index)throw Error('剧集尚未加载');await change(index);await saveDoc(key,index);return index;});
}
export async function showEpisodeManager() {
  await closeChapterDraft();await getActiveWritingEditor()?.flush();await getActiveContentEditor()?.flush();
  const {dialog,body}=modal('管理剧集'); let selected: EpisodeEntry | undefined;
  dialog.addEventListener('close',()=>{
    if(selected)window.dispatchEvent(new CustomEvent('dsh:open-script',{detail:{episodeId:selected.episodeId,title:selected.title}}));
    else window.dispatchEvent(new Event('dsh:episodes-changed'));
  });
  const render=async()=>{
    const index=await loadDoc<EpisodeIndex>(key);if(!index||!dialog.isConnected)return;
    body.replaceChildren();const row=node('div','','localRow');const title=field('新剧集名称',`第${index.chapters.filter(c=>!c.draft).length+1}集`);title.wrap.style.flex='1';
    row.append(title.wrap,action('新增剧集',async()=>{
      const name=title.input.value.trim();if(!name||name.length>120)throw Error('剧集名称需为1—120字');
      await changeEpisodes(async current=>{const draft=current.chapters.find(c=>c.draft);const blocks=draft?await loadDoc<ScriptBlock[]>(`script:${draft.episodeId}`):undefined;if(draft&&!draft.content?.trim()&&!blocks?.some(b=>b.text.trim())){draft.title=name;delete draft.draft;}else{const id=`ep_${crypto.randomUUID()}`;await createEpisodeDocument(id);current.chapters.push({id,episodeId:id,title:name,content:''});}current.collapsed=false;});await render();
    }));body.append(row);
    body.append(action('从第一章重新编号',async()=>{
      if(isWritingBusy())throw Error('请先完成或停止当前写作任务');
      await closeChapterDraft();await getActiveWritingEditor()?.flush();await getActiveContentEditor()?.flush();
      await synchronizeScriptChapters({approvedByUser:true},{renumberOnly:true});
      await getActiveWritingEditor()?.reload();await getActiveContentEditor()?.reload();await render();
    }));
    for(const [i,chapter] of index.chapters.entries()){
      const blocks=await loadDoc<ScriptBlock[]>(`script:${chapter.episodeId}`)??[];
      const card=node('section','','localCard');card.style.marginBottom='10px';const name=field('剧集名称',chapter.title);card.append(name.wrap,node('p',`${blocks.reduce((n,b)=>n+b.text.replace(/\s/g,'').length,0)} 字 · ${blocks.filter(b=>b.type==='scene').length} 场`,'localMuted'));
      const actions=node('div','','localRow');actions.append(action('打开剧本',()=>{selected=chapter;dialog.close();}),action('保存名称',async()=>{const next=name.input.value.trim();if(!next||next.length>120)throw Error('名称需为1—120字');await changeEpisodes(s=>{const c=s.chapters.find(c=>c.id===chapter.id);if(!c)throw Error('剧集已变化');if(c.draft&&c.title!==next)delete c.draft;c.title=next;});await render();}),action('上移',async()=>{await changeEpisodes(s=>{const at=s.chapters.findIndex(c=>c.id===chapter.id);if(at>0)[s.chapters[at-1],s.chapters[at]]=[s.chapters[at],s.chapters[at-1]];});await render();}),action('下移',async()=>{await changeEpisodes(s=>{const at=s.chapters.findIndex(c=>c.id===chapter.id);if(at>=0&&at<s.chapters.length-1)[s.chapters[at+1],s.chapters[at]]=[s.chapters[at],s.chapters[at+1]];});await render();}),action('归档',async()=>{await changeEpisodes(s=>{if(s.chapters.length<=1)throw Error('请至少保留一集');const c=s.chapters.find(c=>c.id===chapter.id);if(c){(s.archived??=[]).push(c);s.chapters=s.chapters.filter(c=>c.id!==chapter.id);}});await render();}));
      actions.children[2].toggleAttribute('disabled',i===0);actions.children[3].toggleAttribute('disabled',i===index.chapters.length-1);card.append(actions);body.append(card);
      if(chapter.content?.trim())card.append(action('查看旧章节文本',()=>{const {body}=modal('旧章节文本备份');body.append(node('p','这是统一正文前保留的旧文本备份，当前写作和 Agent 均使用本章正文。','localMuted'),node('pre',chapter.content!));}));
    }
    if(index.archived?.length){body.append(node('h3','已归档（正文和分镜仍保留）'));for(const c of index.archived){const row=node('div','','localRow');row.append(node('span',c.title),action('恢复剧集',async()=>{await changeEpisodes(s=>{const found=s.archived?.find(x=>x.id===c.id);if(found){s.chapters.push(found);s.archived=s.archived!.filter(x=>x.id!==c.id);}});await render();}));body.append(row);}}
  };await render();
}
