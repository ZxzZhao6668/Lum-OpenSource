import {boardWrite,prepareWritingBoard} from '../novel/writingBoard';
import {bibleWrite,prepareStoryBible} from '../novel/storyBible';
import {projectWritingTools,prepareProjectWriting} from '../projects/projectWriting';
import { db, loadDoc, type EntityRow } from '../data/db';
import type { EpisodeIndex, EpisodeEntry } from '../episode/episodeManager';
import { readDocument, validateBlocks, type DocumentSnapshot, type ScriptBlock } from './documentStore';
import { migrateSceneReferences } from '../storyboard/sceneReferences';
import { prepareWorkspaceChange, type WorkspaceDraft, type WorkspaceChange } from './workspaceChanges';
import type { ToolDefinition, ToolScope } from './writingTools';
import { bindShotSetup } from '../scriptSetup/shotSetup';
import { readScriptSetupWorkspaceEpoch } from '../scriptSetup/scriptSetupStore';
import { type Shot, validDuration } from '../storyboard/shotModel';
import { setShotDescription, initializeMentions } from '../storyboard/mentionModel';
import { beatTool,prepareBeatTool } from '../beats/beatTools';
import {WORLD_ENTRIES,validateWorldEntries,setWorldEntries} from '../worldview/worldviewModel';
import {canWriteWorldview} from './worldviewPermission';
import type { ProductionClip } from '../canvas/productionClips';

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' }, text = { type: 'string', maxLength: 100000 };
const strings = { type: 'array', maxItems: 1000, items: string };
const blockType = { type: 'string', enum: ['scene','action','character','parenthetical','dialogue','transition','comment','subtitle'] };
const blocks = { type: 'array', maxItems: 300, items: object({ type: blockType, text }, ['type','text']) };
export const structuredToolDefinitions: ToolDefinition[] = [
  beatTool,...projectWritingTools,bibleWrite,boardWrite,
  { name: 'editEpisodes', description: '管理真实章节/剧集。finish只在自动成稿任务中标记已全文读回且写完的章节，需episodeId，不改变正文；plan在尚无正式章节时一次规划chapters(title,summary)，返回真实ID再逐章写正文；create新增一集并写入blocks；split按已有正文块ID划分章节，必须从第一块开始、按正文顺序提供每章startBlockId，不丢正文、不重复复制。相关场次/分镜/资产关联跟随移动。rename改名，reorder排序，archive归档，restore恢复。返回真实episodeId。', parameters: object({ op: { type:'string',enum:['plan','finish','create','split','rename','reorder','archive','restore'] }, episodeId: string, title: string, blocks, chapters: {type:'array',minItems:1,maxItems:50,items:object({title:string,startBlockId:string,summary:text},['title'])}, orderedIds: strings }, ['op']) },
  { name: 'editScript', description: '结构化编辑指定剧集正文。insert在beforeBlockId前插入（省略为末尾）；patch更新真实块的文字或类型；replace/delete以startBlockId至endBlockId为闭区间；move把blockIds移到beforeBlockId前。保留未修改块ID。先readScript获取真实ID。', parameters: object({ episodeId:string,op:{type:'string',enum:['insert','patch','replace','delete','move']},beforeBlockId:string,startBlockId:string,endBlockId:string,blockIds:strings,blocks,updates:{type:'array',maxItems:300,items:object({id:string,text,type:blockType},['id'])}},['episodeId','op']) },
  { name: 'organizeScenes', description: '把现有剧本实际分场，写入场次功能界面。每场提供起始块startBlockId和场景标题title（如1. 内 书房 - 日）。已有标题用useExistingHeading=true把该块改为scene；正文段落则插入新scene标题，不吞掉原文。description为场次梗概。所有现有场次边界必须包含；先readScript。', parameters: object({episodeId:string,scenes:{type:'array',minItems:1,maxItems:100,items:object({startBlockId:string,title:string,useExistingHeading:{type:'boolean'},description:text},['startBlockId','title','useExistingHeading'])}},['episodeId','scenes']) },
  { name: 'writeOutline', description: '新增或更新真实大纲文档。op=create或replace/append；更新必须提供readEntities读到的documentId。text是纯文本，保留段落。空白大纲也可写入；只生成大纲不能代替剧本正文。', parameters: object({episodeId:string,op:{type:'string',enum:['create','replace','append']},documentId:string,title:string,text},['episodeId','op','text']) },
  { name: 'extractEntities', description: '检查三类资产；确实无资产时entities=[]记录已核对。提取/建立共用人物、地点（场景资产）、道具库并关联真实正文块。entities提供kind,name,meta,desc,blockIds；已有实体优先使用id，省略id按同类同名匹配；有重名冲突返回错误。已有设定默认保留，明确更新才updateExisting=true。blockIds必须是真实正文/场次块ID，链接可点击编辑及反查引用。', parameters: object({episodeId:string,entities:{type:'array',minItems:0,maxItems:100,items:object({id:string,kind:{type:'string',enum:['character','location','prop']},name:string,meta:text,desc:text,blockIds:strings,updateExisting:{type:'boolean'}},['kind','name','blockIds'])}},['episodeId','entities']) },
  { name: 'editStoryboard', description: '实际编排写作分镜，三个视图自动共享同一批镜头。生成分镜必须调用本工具，不能只在聊天输出。add提供shots，每镜sceneBlockId和desc必填，建议duration秒数、景别type、angle、movement、lens；entityIds关联现有人物/地点/道具。update只改提供的字段，必须有真实id，不覆盖图片和位置。delete提供shotIds。reorder提供sceneBlockId和该场完整orderedIds。先读取真实场次/镜头；无场次先organizeScenes。不是制片胶卷工具。', parameters: object({episodeId:string,op:{type:'string',enum:['add','update','delete','reorder']},sceneBlockId:string,shotIds:strings,orderedIds:strings,shots:{type:'array',minItems:1,maxItems:100,items:object({id:string,sceneBlockId:string,no:string,type:string,angle:string,movement:string,lens:string,desc:text,staging:text,notes:text,duration:{type:'number',exclusiveMinimum:0,maximum:3600},entityIds:strings})}},['episodeId','op']) },
  { name: 'editWorldview', description: '仅本轮用户明确要求新增/保存/修改世界观时写入。userRequestQuote须逐字引用本轮授权。set批量写入结构化设定key/value/category/status/tags/entityIds/dateLabel/timelineOrder；已有条目用真实id，未确认想法status=draft。不能删除、归档或自动把推断写成事实。append/replace只修改旧版概览。', parameters: object({op:{type:'string',enum:['append','replace','set']},text,userRequestQuote:string,entries:{type:'array',minItems:1,maxItems:100,items:object({id:string,key:string,value:text,category:string,status:{type:'string',enum:['draft','canon']},tags:strings,entityIds:strings,dateLabel:string,timelineOrder:{type:'number'}},['key','value'])}},['op','userRequestQuote']) },
];
export function toolObject(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('工具参数无效或包含未知字段');
  return value as Record<string, unknown>;
}
export function toolText(value: unknown, max = 100000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0')) throw Error('文本参数无效');
  return value;
}
function array(value: unknown, max = 300) { if (!Array.isArray(value) || !value.length || value.length > max) throw Error('列表数量无效'); return value; }
function newBlocks(value: unknown): ScriptBlock[] { return validateBlocks(array(value).map(item => ({...toolObject(item,['type','text']),id:crypto.randomUUID()}))); }
function html(value: string) { return value.split('\n').map(line => `<p>${line.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') || '<br>'}</p>`).join(''); }
export async function episodeIndex() {
  const index = await loadDoc<EpisodeIndex>('episode:ep_001');
  if (!index?.chapters.length) throw Error('项目章节尚未加载');
  return index;
}
export async function scopedDocument(id: unknown, scope: ToolScope) {
  const episodeId = toolText(id,200);
  if (!(await episodeIndex()).chapters.some(chapter => chapter.episodeId === episodeId)) throw Error('目标章节不存在，请先listEpisodes');
  if (episodeId !== scope.snapshot.episodeId && !scope.allowAppend) throw Error('选区模式只能处理当前章节');
  if (episodeId === scope.snapshot.episodeId) return scope.snapshot;
  scope.documents ??= new Map();
  if (!scope.documents.has(episodeId)) scope.documents.set(episodeId,await readDocument(episodeId));
  return scope.documents.get(episodeId)!;
}
function allowed(snapshot: DocumentSnapshot, scope: ToolScope, ids: string[]) {
  if (ids.some(id => !snapshot.blocks.some(block => block.id === id) || snapshot.episodeId === scope.snapshot.episodeId && !scope.editableIds.includes(id))) throw Error('块ID不在本轮可修改范围');
}
async function freshSnapshot(id: unknown, scope: ToolScope) {
  const snapshot = await scopedDocument(id,scope), current = await readDocument(snapshot.episodeId);
  if (snapshot.revision !== current.revision || JSON.stringify(snapshot.blocks) !== JSON.stringify(current.blocks)) throw Error('正文已变化，请重新读取再修改');
  return snapshot;
}
export async function moveSceneAssets(draft: WorkspaceDraft, source: string, parts: {episodeId:string;blocks:ScriptBlock[]}[]) {
  const sourceBlocks = parts.flatMap(part=>part.blocks);
  await migrateSceneReferences(source,sourceBlocks);
  const shots = await draft.doc<Array<Record<string,unknown>>>(`storyboard:${source}`) ?? [];
  const keys = [`scene:desc:${source}`,`storyboard:${source}:views`,`entities:links:${source}`];
  for (const docKey of keys) {
    const values = await draft.doc<Record<string,unknown>>(docKey) ?? {};
    for (const part of parts) {
      const ids = new Set(part.blocks.map(b=>docKey.startsWith('entities:')?b.id:`block:${b.id}`));
      const all = new Set(sourceBlocks.map(b=>docKey.startsWith('entities:')?b.id:`block:${b.id}`));
      const selected = Object.fromEntries(Object.entries(values).filter(([id])=>ids.has(id) || part.episodeId === source && !all.has(id)));
      await draft.setDoc(docKey.replace(source,part.episodeId),selected);
    }
  }
  const canvas = await draft.doc<{view:unknown;nodes:Record<string,unknown>}>(`scenes:canvas:${source}`);
  const production = await draft.doc<{clips:ProductionClip[]}>('production:clips');
  if (production) {
    const scenes = new Map<string,string>(parts.flatMap(part=>part.blocks.filter(block=>block.type==='scene').map(block=>[`block:${block.id}`,part.episodeId] as const)));
    const clips = production.clips.map(clip=>{
      const episodeId = clip.episodeId===source ? scenes.get(clip.sceneId) : undefined;
      return episodeId && episodeId!==source ? {...clip,episodeId,updatedAt:Date.now()} : clip;
    });
    await draft.setDoc('production:clips',{...production,clips});
  }
  for (const part of parts) {
    const ids = new Set(part.blocks.filter(b=>b.type==='scene').map(b=>`block:${b.id}`));
    const all = new Set(sourceBlocks.filter(b=>b.type==='scene').map(b=>`block:${b.id}`));
    await draft.setDoc(`storyboard:${part.episodeId}`,shots.filter(shot=>ids.has(String(shot.sceneId)) || part.episodeId===source && !all.has(String(shot.sceneId))));
    if (canvas) await draft.setDoc(`scenes:canvas:${part.episodeId}`,{...canvas,nodes:Object.fromEntries(Object.entries(canvas.nodes??{}).filter(([id])=>ids.has(id) || part.episodeId===source && !all.has(id)))});
  }
}
export async function prepareStructuredTool(name: string, input: unknown, scope: ToolScope, candidate?: { taskId: string; appendEpisodePlan: boolean }): Promise<WorkspaceChange> {
  if (scope.readOnly) throw Error('只读模式不能写入');
  if(name==='editWritingBoard')return prepareWritingBoard(input,scope);
  if(name==='editStoryBible')return prepareStoryBible(input,scope);
  if(projectWritingTools.some(t=>t.name===name))return prepareProjectWriting(name,input,scope);
  if(name==='editBeats')return prepareBeatTool(input,scope);
  if (name === 'editEpisodes') {
    if (!scope.allowAppend) throw Error('管理章节需要整集范围');
    const a=toolObject(input,['op','episodeId','title','blocks','chapters','orderedIds']);
    const index=await episodeIndex();
    const source=a.episodeId===undefined?undefined:toolText(a.episodeId,200);
    const target=index.chapters.find(chapter=>chapter.episodeId===source);
    const snapshot=a.op==='split'?await freshSnapshot(source,scope):null;
    return prepareWorkspaceChange('章节编排',source??scope.snapshot.episodeId,'01-script',async draft=>{
      if (candidate) draft.change.scriptSetupTaskId = candidate.taskId;
      if(JSON.stringify(await draft.doc('episode:ep_001'))!==JSON.stringify(index))throw Error('章节目录已变化，请重试');
      let output:EpisodeEntry[]=[];
      if(a.op==='plan'){
        if(!candidate?.appendEpisodePlan&&index.chapters.some(c=>!c.draft))throw Error('已有正式章节，请读取目录后继续写作，不重复规划');
        const names=new Set<string>(candidate?.appendEpisodePlan ? index.chapters.filter(c=>!c.draft).map(c=>c.title.trim()) : []);
        const planned=array(a.chapters,50).map(value=>{const chapter=toolObject(value,['title','summary']);const title=toolText(chapter.title,120).trim();if(names.has(title))throw Error('章节名称不能重复');names.add(title);return {title,summary:chapter.summary===undefined?'':toolText(chapter.summary,100000,true)};});
        const placeholder=candidate?.appendEpisodePlan && index.chapters.some(c=>!c.draft) ? undefined : index.chapters.find(c=>c.draft&&!c.content?.trim());
        const before=placeholder?await readDocument(placeholder.episodeId):null;
        for(const [position,chapter] of planned.entries()){
          const reuse=position===0&&!!placeholder&&!!before&&!before.blocks.some(b=>b.text.trim());
          const id=reuse?placeholder.episodeId:`ep_${crypto.randomUUID()}`;
          const entry={id:reuse?placeholder.id:id,episodeId:id,title:chapter.title,content:''};
          if(reuse)index.chapters.splice(index.chapters.indexOf(placeholder),1,entry);else index.chapters.push(entry);
          await draft.script(id,[],reuse?before:null);
          if(reuse&&chapter.summary){const outline=await draft.doc<{active:number;docs:{id:string;title:string;html:string}[]}>(`outline:${id}`)??{active:0,docs:[]};outline.docs.push({id:crypto.randomUUID(),title:'本章大纲',html:html(chapter.summary)});await draft.setDoc(`outline:${id}`,outline);}
          if(!reuse){await draft.setDoc(`outline:${id}`,{active:0,docs:[{id:'outline',title:'本章大纲',html:html(chapter.summary)}]});await draft.setDoc(`storyboard:${id}`,[]);}
          output.push(entry);
        }
      }else if(a.op==='create'){
        const placeholder=index.chapters.find(c=>c.draft&&!c.content?.trim());
        const before=placeholder?await readDocument(placeholder.episodeId):null;
        const reuse=!!placeholder&&!!before&&!before.blocks.some(b=>b.text.trim());
        const id=reuse?placeholder.episodeId:`ep_${crypto.randomUUID()}`;const entry={id:reuse?placeholder.id:id,episodeId:id,title:toolText(a.title,120),content:''};
        if(reuse)index.chapters.splice(index.chapters.indexOf(placeholder),1,entry);else index.chapters.push(entry);
        await draft.script(id,a.blocks===undefined?[]:newBlocks(a.blocks),reuse?before:null);output=[entry];
        if(!reuse){await draft.setDoc(`outline:${id}`,{active:0,docs:[{id:'outline',title:'大纲',html:'<p></p>'}]});await draft.setDoc(`storyboard:${id}`,[]);}
      }else if(a.op==='split'){
        if(!target||!snapshot?.blocks.length)throw Error('需要有正文的真实章节');
        const chapters=array(a.chapters,50).map(item=>{const c=toolObject(item,['title','startBlockId']);return {title:toolText(c.title,120),start:snapshot.blocks.findIndex(b=>b.id===c.startBlockId)};});
        if(chapters.length<2||chapters[0].start!==0||chapters.some((c,i)=>c.start<0||i>0&&c.start<=chapters[i-1].start))throw Error('分章必须从第一块开始，按正文顺序提供不重复的起始块ID');
        const parts=chapters.map((chapter,i)=>{const id=i?`ep_${crypto.randomUUID()}`:target.episodeId;const entry=i?{id,episodeId:id,title:chapter.title,content:''}:{...target,title:chapter.title};delete (entry as EpisodeEntry).draft;output.push(entry);return {episodeId:id,blocks:snapshot.blocks.slice(chapter.start,chapters[i+1]?.start)};});
        await moveSceneAssets(draft,target.episodeId,parts);
        for(const [i,part] of parts.entries()){
          await draft.script(part.episodeId,part.blocks,i?null:snapshot);
          if(i)await draft.setDoc(`outline:${part.episodeId}`,{active:0,docs:[{id:'outline',title:'大纲',html:'<p></p>'}]});
        }
        index.chapters.splice(index.chapters.indexOf(target),1,...output);
      }else if(a.op==='rename'){
        if(!target)throw Error('章节不存在');target.title=toolText(a.title,120);delete target.draft;output=[target];
      }else if(a.op==='reorder'){
        const ids=array(a.orderedIds,1000).map(id=>toolText(id,200));
        if(new Set(ids).size!==index.chapters.length||ids.length!==index.chapters.length||ids.some(id=>!index.chapters.some(c=>c.episodeId===id)))throw Error('排序必须完整列出每一章且不重复');
        index.chapters=ids.map(id=>index.chapters.find(c=>c.episodeId===id)!);output=index.chapters;
      }else if(a.op==='archive'){
        if(!target||index.chapters.length<=1)throw Error('至少保留一章');(index.archived??=[]).push(target);index.chapters=index.chapters.filter(c=>c!==target);output=[index.chapters[0]];
      }else if(a.op==='restore'){
        const entry=index.archived?.find(c=>c.episodeId===source);if(!entry)throw Error('未找到已归档章节');index.chapters.push(entry);index.archived=index.archived!.filter(c=>c!==entry);output=[entry];
      }else throw Error('章节操作不受支持');
      index.collapsed=false;await draft.setDoc('episode:ep_001',index);
      draft.change.episodeId=output[0]?.episodeId??scope.snapshot.episodeId;
      return {chapters:output.map(c=>({episodeId:c.episodeId,title:c.title})),message:'章节对应真实正文；点击左栏章节即可打开。'};
    });
  }
  if(name==='editWorldview'){
    const a=toolObject(input,['op','text','userRequestQuote','entries']);const quote=toolText(a.userRequestQuote,12000);
    if(!canWriteWorldview(scope.userPrompt)||!scope.userPrompt?.includes(quote)||!/(世界观|设定)/.test(quote)||!/(写|存|改|添加|新增|更新|补充|完善|建立|创建|记录)/.test(quote))throw Error('本轮用户没有明确授权修改世界观；只分析或禁止写入的要求优先');
    if(a.op==='set')return prepareWorkspaceChange('世界观设定写入',scope.snapshot.episodeId,'09-worldview',async draft=>{const before=validateWorldEntries(await draft.doc(WORLD_ENTRIES)??[]),result=await setWorldEntries(before,a.entries);await draft.setDoc(WORLD_ENTRIES,result.entries);return {target:'世界观',entryIds:result.changed,total:result.entries.length};});
    if(!['append','replace'].includes(String(a.op)))throw Error('世界观操作无效');
    return prepareWorkspaceChange('世界观写入',scope.snapshot.episodeId,'09-worldview',async draft=>{const before=await draft.doc<string>('project:worldview')??'';await draft.setDoc('project:worldview',a.op==='append'?before+'\n'+toolText(a.text):toolText(a.text));return {target:'世界观'};});
  }
  const a=toolObject(input,name==='editScript'?['episodeId','op','beforeBlockId','startBlockId','endBlockId','blockIds','blocks','updates']:name==='organizeScenes'?['episodeId','scenes']:name==='writeOutline'?['episodeId','op','documentId','title','text']:name==='extractEntities'?['episodeId','entities']:['episodeId','op','shots','shotIds','orderedIds','sceneBlockId']);
  const snapshot=await freshSnapshot(a.episodeId,scope), episodeId=snapshot.episodeId;
  if(name==='editScript'){
    let after=structuredClone(snapshot.blocks);
    const at=(id:unknown)=>{const position=after.findIndex(b=>b.id===id);if(position<0)throw Error('目标块不存在');return position;};
    if(a.op==='patch'){
      const patches=array(a.updates).map(item=>toolObject(item,['id','text','type']));const ids=patches.map(p=>toolText(p.id,200));allowed(snapshot,scope,ids);
      if(new Set(ids).size!==ids.length)throw Error('重复的修改块');
      for(const patch of patches){const position=at(patch.id);if(patch.text===undefined&&patch.type===undefined)throw Error('补丁没有修改字段');after[position]={...after[position],...(patch.text===undefined?{}:{text:toolText(patch.text,100000,true)}),...(patch.type===undefined?{}:{type:patch.type as ScriptBlock['type']})};}
    }else if(a.op==='insert'){
      if(!scope.allowAppend)throw Error('插入段落需要整集范围');after.splice(a.beforeBlockId===undefined?after.length:at(a.beforeBlockId),0,...newBlocks(a.blocks));
    }else if(a.op==='replace'||a.op==='delete'){
      const start=at(a.startBlockId),end=at(a.endBlockId??a.startBlockId);if(end<start)throw Error('结束块必须在起始块之后');allowed(snapshot,scope,after.slice(start,end+1).map(b=>b.id));after.splice(start,end-start+1,...(a.op==='delete'?[]:newBlocks(a.blocks)));
    }else if(a.op==='move'){
      const ids=array(a.blockIds).map(id=>toolText(id,200));allowed(snapshot,scope,ids);if(new Set(ids).size!==ids.length||ids.includes(String(a.beforeBlockId)))throw Error('移动参数重复或目标落在自身范围');
      const moved=ids.map(id=>after[at(id)]);after=after.filter(b=>!ids.includes(b.id));after.splice(a.beforeBlockId===undefined?after.length:at(a.beforeBlockId),0,...moved);
    }else throw Error('正文操作不受支持');
    return prepareWorkspaceChange('剧本结构编辑',episodeId,'01-script',async draft=>{await draft.script(episodeId,after,snapshot);return {episodeId,blockIds:after.filter(b=>!snapshot.blocks.some(old=>JSON.stringify(old)===JSON.stringify(b))).map(b=>b.id)};});
  }
  if(name==='organizeScenes'){
    if(!scope.allowAppend)throw Error('分场需要整集范围');
    const scenes=array(a.scenes,100).map(item=>toolObject(item,['startBlockId','title','useExistingHeading','description']));
    const positions=scenes.map(s=>snapshot.blocks.findIndex(b=>b.id===s.startBlockId));
    if(positions.some((p,i)=>p<0||i>0&&p<=positions[i-1]))throw Error('场次起始块必须存在且按正文顺序排列');
    if(snapshot.blocks.some(b=>b.type==='scene'&&!scenes.some(s=>s.startBlockId===b.id&&s.useExistingHeading===true)))throw Error('请包含所有已有场次边界，避免重复分场或删除原场次关联');
    return prepareWorkspaceChange('分场与场次卡',episodeId,'05-scenes',async draft=>{
      const after=structuredClone(snapshot.blocks),notes=await draft.doc<Record<string,string>>(`scene:desc:${episodeId}`)??{};
      const ids:string[]=[];
      for(let i=scenes.length-1;i>=0;i--){const scene=scenes[i];if(typeof scene.useExistingHeading!=='boolean')throw Error('useExistingHeading必须是布尔值');const title=toolText(scene.title,1000);const id=scene.useExistingHeading?after[positions[i]].id:crypto.randomUUID();const heading:ScriptBlock={id,type:'scene',text:title};after.splice(positions[i],scene.useExistingHeading?1:0,heading);if(scene.description!==undefined)notes[`block:${id}`]=toolText(scene.description,100000,true);ids.unshift(id);}
      await draft.script(episodeId,after,snapshot);await draft.setDoc(`scene:desc:${episodeId}`,notes);return {episodeId,sceneBlockIds:ids,sceneCount:ids.length};
    });
  }
  if(name==='writeOutline')return prepareWorkspaceChange('大纲写入',episodeId,'03-outline',async draft=>{
    if (candidate) draft.change.scriptSetupTaskId = candidate.taskId;
    const outline=await draft.doc<{active:number;docs:{id:string;title:string;html:string}[]}>(`outline:${episodeId}`)??{active:0,docs:[]};const content=html(toolText(a.text));let target=outline.docs.find(d=>d.id===a.documentId);
    if(a.op==='create'){target={id:crypto.randomUUID(),title:toolText(a.title??'大纲',120),html:content};outline.docs.push(target);}
    else{if(!target||target.id==='world')throw Error('大纲ID不存在，请先读取大纲');if(a.op==='replace')target.html=content;else if(a.op==='append')target.html+=content;else throw Error('大纲操作无效');if(a.title!==undefined)target.title=toolText(a.title,120);}
    outline.active=outline.docs.indexOf(target);await draft.setDoc(`outline:${episodeId}`,outline);return {episodeId,documentId:target.id,title:target.title};
  });
  if(name==='extractEntities')return prepareWorkspaceChange('资产提取与正文关联',episodeId,'01-script',async draft=>{
    const rows=await db.entities.toArray(), links=await draft.doc<Record<string,string[]>>(`entities:links:${episodeId}`)??{};
    const output: {id:string;name:string;kind:string;blockIds:string[];created:boolean}[]=[];const staged=new Set<string>();
    if(!Array.isArray(a.entities)||a.entities.length>100)throw Error('资产列表最多100项');
    for(const value of a.entities){
      const e=toolObject(value,['id','kind','name','meta','desc','blockIds','updateExisting']);if(!['character','location','prop'].includes(String(e.kind)))throw Error('资产类型无效');
      const name=toolText(e.name,200).trim(),kind=e.kind as EntityRow['kind'];if(!Array.isArray(e.blockIds)||e.blockIds.length>1000)throw Error('blockIds必须是最多1000项的列表');const ids=e.blockIds.map(id=>toolText(id,200));allowed(snapshot,scope,ids);
      if(e.updateExisting!==undefined&&typeof e.updateExisting!=='boolean')throw Error('updateExisting必须是布尔值');
      const matches=e.id===undefined?rows.filter(row=>row.kind===kind&&row.name.normalize('NFKC').trim()===name.normalize('NFKC')):rows.filter(row=>row.id===e.id&&row.kind===kind);
      if(matches.length>1)throw Error(`存在多个同名${name}，请读取资产后指定真实id`);if(e.id!==undefined&&!matches.length)throw Error('资产ID不存在或类型不匹配');
      const existing=matches[0];const row:EntityRow=existing?{...existing}:{id:crypto.randomUUID(),kind,name,meta:'',desc:'',order:rows.length};
      if(staged.has(row.id))throw Error('同一资产请合并blockIds后一次提交');staged.add(row.id);
      if(!existing||e.updateExisting===true){row.name=name;if(e.meta!==undefined)row.meta=toolText(e.meta,100000,true);if(e.desc!==undefined)row.desc=toolText(e.desc,100000,true);await draft.setEntity(row.id,row);}
      if(!existing)rows.push(row);
      for(const id of ids)links[id]=[...new Set([...(links[id]??[]),row.id])];
      output.push({id:row.id,name:row.name,kind,blockIds:ids,created:!existing});
    }
    await draft.setDoc(`entities:links:${episodeId}`,links);
    await draft.setDoc(`entities:extraction:${episodeId}`,{sourceRevision:snapshot.revision,checkedKinds:['character','location','prop'],count:output.length});
    return {episodeId,entities:output};
  });
  if(name==='editStoryboard')return prepareWorkspaceChange('文字分镜写入',episodeId,'04-storyboard',async draft=>{
    let shots=await draft.doc<Shot[]>(`storyboard:${episodeId}`)??[];const ids:string[]=[];
    const authorizeScene=(id:unknown)=>{const scene=snapshot.blocks.find(b=>b.id===id&&b.type==='scene');if(!scene)throw Error('分镜必须关联真实场次块，请先分场');allowed(snapshot,scope,[scene.id]);return `block:${scene.id}`;};
    if(a.op==='delete'){
      const selected=array(a.shotIds,100).map(id=>toolText(id,200));if(new Set(selected).size!==selected.length)throw Error('重复的镜头ID');
      for(const id of selected){const shot=shots.find(s=>s.id===id);if(!shot)throw Error('镜头不存在，请先读取分镜');if(!scope.allowAppend)authorizeScene(shot.sceneId?.slice(6));ids.push(id);}
      shots=shots.filter(s=>!selected.includes(s.id));
    }else if(a.op==='reorder'){
      const sceneId=authorizeScene(a.sceneBlockId),ordered=array(a.orderedIds,1000).map(id=>toolText(id,200));
      const list=shots.filter(s=>s.sceneId===sceneId);
      if(ordered.length!==list.length||new Set(ordered).size!==list.length||ordered.some(id=>!list.some(s=>s.id===id)))throw Error('排序必须完整包含本场镜头且不重复');
      let i=0;shots=shots.map(s=>{if(s.sceneId!==sceneId)return s;const id=ordered[i++];return list.find(item=>item.id===id)!;});ids.push(...ordered);
    }else if(a.op==='add'||a.op==='update'){
      const epoch = scope.scriptSetup?.workspaceEpoch ?? await readScriptSetupWorkspaceEpoch();
      for(const value of array(a.shots,100)){
        const shot=toolObject(value,['id','sceneBlockId','no','type','angle','movement','lens','desc','staging','notes','duration','entityIds']);
        let target:Shot;
        if(a.op==='add'){
          const sceneId=authorizeScene(shot.sceneBlockId),count=shots.filter(s=>s.sceneId===sceneId).length;
          target={id:crypto.randomUUID(),no:`SHOT ${String(count+1).padStart(2,'0')}`,type:'中景',angle:'平视',movement:'固定',lens:'35mm',desc:toolText(shot.desc),sceneId,x:80+count*408,y:120};shots.push(target);
        }else{
          const found=shots.find(s=>s.id===shot.id);if(!found)throw Error('镜头不存在，请先读取分镜');if(ids.includes(found.id))throw Error('同一镜头不能重复更新');
          if(!scope.allowAppend)authorizeScene(found.sceneId?.slice(6));target=found;
          if(shot.sceneBlockId!==undefined)target.sceneId=authorizeScene(shot.sceneBlockId);
        }
        for(const field of ['no','type','angle','movement','lens','desc','staging','notes'] as const)if(shot[field]!==undefined){const value=toolText(shot[field],['desc','staging','notes'].includes(field)?100000:200,true);if(field==='desc')setShotDescription(target,value);else target[field]=value;}
        if(shot.duration!==undefined)target.duration=validDuration(shot.duration);
        if(shot.entityIds!==undefined){
          if(!Array.isArray(shot.entityIds)||shot.entityIds.length>100)throw Error('资产引用列表无效');
          const entityIds=[...new Set(shot.entityIds.map(id=>toolText(id,200)))];
          for(const id of entityIds)if(!await db.entities.get(id))throw Error('资产ID不存在，请读取人地物后引用');
          target.entityIds=entityIds;
          if(target.descMentions)target.descMentions=target.descMentions.filter(m=>entityIds.includes(m.entityId));
        }
        initializeMentions(target,await db.entities.toArray());
        target.setupSnapshot = bindShotSetup(target, episodeId, scope.scriptSetup ?? null, epoch);
        ids.push(target.id);
      }
    }else throw Error('分镜操作无效');
    await draft.setDoc(`storyboard:${episodeId}`,shots);
    return {episodeId,op:a.op,shotIds:ids,shotCount:shots.length,sceneCounts:Object.fromEntries([...new Set(shots.map(s=>s.sceneId))].map(id=>[String(id),shots.filter(s=>s.sceneId===id).length])),message:'同一镜头记录已供分镜板、画布、镜头表使用。无需另生成三份。'};
  });
  throw Error('不支持此结构化工具');
}
