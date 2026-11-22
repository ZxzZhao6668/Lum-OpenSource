import {readWritingBoard} from '../novel/writingBoard';
import {readStoryBible} from '../novel/storyBible';
import { listEntities, loadDoc } from "../data/db";
import {coverTextContext} from '../data/coverDocument';
import {readWorldview} from '../worldview/worldviewModel';

const labels: Record<string, string> = { '14-bible':'小说设定','15-whiteboard':'写作白板','13-beats':'节拍', '01-script': '剧本', '02-cover': '封面', '03-outline': '大纲', '04-storyboard': '分镜', '05-scenes': '场次', '06-characters': '人物', '07-locations': '地点', '08-props': '道具', '09-worldview': '世界观', '11-consultant': '技能', canvas: '画布' };
export function writingPage() {
  if(document.getElementById('dsh-chapter-view'))return {id:'chapter-draft',label:'章节正文',script:false};
  const host = document.querySelector<HTMLElement>('.laper-host');
  const id = host?.dataset.screen || '01-script';
  const overview = id === '03-outline' && host?.dataset.outlineView === 'board';
  return { id, label: overview ? '集纲看板' : labels[id] || '项目', script: id === '01-script', overview };
}
export async function writingPageContext(episodeId = "ep_001") {
  const page = writingPage();
  let content: unknown = null;
  if(page.id==='chapter-draft')content={title:document.querySelector('.dsh-chapter-title')?.textContent,text:(document.querySelector('.dsh-chapter-paper') as HTMLElement|null)?.innerText};
  if(page.id==='02-cover')content=coverTextContext(await loadDoc(`cover:${episodeId}`));
  if(page.id==='15-whiteboard')content=await readWritingBoard();
  if(page.id==='14-bible')content=await readStoryBible();
  if(page.id==='13-beats')content={episodeId,beats:await loadDoc(`beats:${episodeId}`)??[]};
  if(page.id==='05-scenes')content={scenes:(await loadDoc<{id:string;type:string;text:string}[]>(`script:${episodeId}`))?.filter(block=>block.type==='scene'),notes:await loadDoc(`scene:desc:${episodeId}`)};
  if (page.id === '09-worldview') {const world=await readWorldview();content={overview:world.overview,entries:world.entries.filter(e=>e.status==='canon'),note:'默认只带已确认设定；要检查待定想法，请用 readEntities worldview 分页读取。'};}
  if (page.id === '03-outline') content = await loadDoc(page.overview ? 'episode:ep_001' : `outline:${episodeId}`);
  if (page.id === '04-storyboard') {
    const shots = await loadDoc<Array<Record<string, unknown>>>(`storyboard:${episodeId}`);
    content = (shots || []).map(shot => Object.fromEntries(['id','no','sceneId','type','angle','movement','lens','desc','duration','entityIds','staging','notes'].filter(key => key in shot).map(key => [key, shot[key]])));
  }
  const kind = ({ '06-characters': 'character', '07-locations': 'location', '08-props': 'prop' } as const)[page.id as '06-characters'];
  if (kind) content = await listEntities(kind);
  const targets: Array<{ kind: 'outline' | 'storyboard' | 'entity'; id: string }> = [];
  if (page.id === '03-outline' && content && typeof content === 'object' && 'docs' in content && Array.isArray(content.docs)) {
    for (const doc of content.docs) if (doc && typeof doc.id === 'string' && doc.id !== 'world') targets.push({ kind: 'outline', id: doc.id });
  }
  if (page.id === '04-storyboard' && Array.isArray(content)) for (const shot of content) if (typeof shot.id === 'string') targets.push({ kind: 'storyboard', id: shot.id });
  if (kind && Array.isArray(content)) for (const entity of content) if (typeof entity.id === 'string') targets.push({ kind: 'entity', id: entity.id });
  const viewport=page.id==='04-storyboard'?document.querySelector<HTMLElement>('.sbViewport'):null;
  const contextual=viewport?{episodeId,viewMode:viewport.dataset.viewMode,activeSceneId:viewport.dataset.activeScene,activeSceneBlockId:viewport.dataset.activeScene?.replace(/^block:/,''),shots:content}:content;
  return { ...page, targets, context: contextual === null ? '' : JSON.stringify(contextual).slice(0, 18000) };
}
