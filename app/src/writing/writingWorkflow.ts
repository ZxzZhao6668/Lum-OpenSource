import { writingWorkspace } from '../projects/projectIdentity';
import { loadDoc } from '../data/db';
import type { EpisodeIndex } from '../episode/episodeManager';
import { readDocument, type ScriptBlock } from './documentStore';
import {getWorkspaceChange} from './workspaceChanges';

export type WorkflowKind = 'draft' | 'scenes' | 'assets' | 'storyboard' | 'adapt';
export interface WorkflowRequest { kind: WorkflowKind; range: 'project' | 'episode'; rootEpisodeId?:string; resumeId?:string; sceneBlockId?:string }
export interface WritingWorkflow extends WorkflowRequest {
  id:string; completedChapters:Record<string,number>; pendingPlans:string[];
  reads:Record<string,{revision:number;totalLines:number;lines:number[]}>;
  shotReads:Record<string,string>;
  rootEpisodeId: string; targetEpisodeIds: string[]; protectedEpisodeIds: string[]; verifiedEpisodeIds: string[];
}
export const workflowLabels: Record<WorkflowKind,string> = {draft:'生成大纲并分章写作',scenes:'一键分场次',assets:'一键提取资产',storyboard:'一键分镜',adapt:'根据正文自动整理'};
const hasOutline = async (id:string) => {const docs=(await loadDoc<{docs:{id:string;title:string;html:string}[]}>(`outline:${id}`))?.docs??[];const doc=docs.find(d=>d.title==='本章大纲')??docs.find(d=>d.id!=='world');return !!doc&&!!new DOMParser().parseFromString(doc.html,'text/html').body.textContent?.trim();};

export function storyboardSceneRange(blocks: ScriptBlock[], sceneBlockId: string) {
  const start = blocks.findIndex(block => block.id === sceneBlockId && block.type === 'scene');
  if (start < 0) return undefined;
  const next = blocks.findIndex((block, index) => index > start && block.type === 'scene');
  const end = next < 0 ? blocks.length : next;
  return {title: blocks[start].text, startLine: start + 1, endLine: end, blocks: blocks.slice(start, end)};
}

function sceneRead(task: WritingWorkflow, id: string, revision: number, total: number, range: ReturnType<typeof storyboardSceneRange>) {
  const read = task.reads[id];
  if (!range || !read || read.revision !== revision || read.totalLines !== total) return false;
  const lines = new Set(read.lines);
  return range.blocks.every((_, index) => lines.has(range.startLine + index));
}

export async function createWritingWorkflow(request: WorkflowRequest, rootEpisodeId: string, previous?:WritingWorkflow): Promise<WritingWorkflow> {
  if(writingWorkspace && request.kind==='storyboard')throw Error('请在项目的制作工作区编排分镜');
  if(!Object.hasOwn(workflowLabels,request.kind)||!['project','episode'].includes(request.range))throw Error('创作任务类型或范围无效');
  if(request.sceneBlockId!==undefined){
    if(request.kind!=='storyboard'||request.range!=='episode'||!request.sceneBlockId)throw Error('指定场次仅用于当前章节的一键分镜');
    if(!storyboardSceneRange((await readDocument(rootEpisodeId)).blocks,request.sceneBlockId))throw Error('所选场次已不存在，请重新选择');
  }
  if(request.resumeId){
    if(!previous||previous.id!==request.resumeId||previous.kind!==request.kind||previous.range!==request.range||previous.rootEpisodeId!==rootEpisodeId||previous.sceneBlockId!==request.sceneBlockId)throw Error('原任务记录不匹配，请重新选择任务');
    const restored=structuredClone(previous);
    for(const id of restored.pendingPlans){const receipt=await getWorkspaceChange(id);if(receipt.status==='pending')throw Error('请先处理原任务的待审批提案');if(receipt.status==='applied'){const chapters=receipt.result.chapters as {episodeId:string}[]|undefined;for(const chapter of chapters??[])if(!restored.targetEpisodeIds.includes(chapter.episodeId))restored.targetEpisodeIds.push(chapter.episodeId);}}
    restored.pendingPlans=[];return restored;
  }
  const index=await loadDoc<EpisodeIndex>('episode:ep_001');
  if(!index?.chapters.some(c=>c.episodeId===rootEpisodeId))throw Error('当前章节已不存在，请重新打开');
  const chapters=await Promise.all(index.chapters.map(async c=>({...c,written:(await readDocument(c.episodeId)).blocks.some(b=>b.text.trim())})));
  const targets=request.kind==='draft'?chapters.filter(c=>!c.draft):chapters.filter(c=>c.written&&(request.range==='project'||c.episodeId===rootEpisodeId));
  if(request.kind!=='draft'&&!targets.length)throw Error('所选范围还没有正文，请先写作或生成剧本');
  return {...request,id:crypto.randomUUID(),rootEpisodeId,targetEpisodeIds:targets.map(c=>c.episodeId),protectedEpisodeIds:chapters.filter(c=>c.written).map(c=>c.episodeId),verifiedEpisodeIds:[],completedChapters:{},reads:{},shotReads:{},pendingPlans:[]};
}

const fullRead=(task:WritingWorkflow,id:string,revision:number,total:number)=>{const read=task.reads[id];return !!read&&read.revision===revision&&read.totalLines===total&&total>0&&read.lines.length===total;};
const shotFields=['id','no','sceneId','desc','type','angle','movement','lens','duration','entityIds','staging','notes'];
const shotSignature=(shots:Record<string,unknown>[])=>JSON.stringify(shots.map(shot=>Object.fromEntries(shotFields.filter(key=>key in shot).map(key=>[key,shot[key]]))));

export async function finishWorkflowChapter(task:WritingWorkflow,id:string){
  const document=await readDocument(id);
  if(!fullRead(task,id,document.revision,document.blocks.length)||!document.blocks.some(b=>b.text.trim()))throw Error('请先分页读回整章正文，核对本章完整后再标记完成');
  task.completedChapters[id]=document.revision;
  return {result:{episodeId:id,revision:document.revision,chapterComplete:true,message:'本章已标记完成；正文修改后需要重新核对'}};
}

export async function inspectWritingWorkflow(task: WritingWorkflow) {
  const index=await loadDoc<EpisodeIndex>('episode:ep_001');
  const targets=await Promise.all(task.targetEpisodeIds.map(async id=>{
    const chapter=index?.chapters.find(c=>c.episodeId===id);
    const document=await readDocument(id),body=document.blocks.filter(b=>b.text.trim());
    const range=task.sceneBlockId?storyboardSceneRange(document.blocks,task.sceneBlockId):undefined;
    const scenes=body.filter(b=>b.type==='scene'&&(!task.sceneBlockId||b.id===task.sceneBlockId));
    const reasons:string[]=[];
    if(!chapter)reasons.push('章节已不存在');
    if(task.kind==='draft'){
      if(chapter?.draft)reasons.push('尚未建立正式章节');
      if(!body.length)reasons.push('正文为空');
      if(!task.protectedEpisodeIds.includes(id)&&task.completedChapters[id]!==document.revision)reasons.push('正文尚未标记完成');
    }
    else {
      if(!body.length)reasons.push('正文为空');
      if(task.sceneBlockId){
        if(!range)reasons.push('所选场次已不存在');
        if(!sceneRead(task,id,document.revision,document.blocks.length,range))reasons.push('尚未完整读回所选场次正文');
      }else if(!fullRead(task,id,document.revision,document.blocks.length))reasons.push('尚未完整读回当前版本正文');
      if(task.kind==='adapt'){
        if(chapter?.draft)reasons.push('尚未建立正式章节');
        if(!await hasOutline(id))reasons.push('尚未保存本章大纲');
      }
      if(task.kind==='assets'){
        const extraction=await loadDoc<{sourceRevision:number}>(`entities:extraction:${id}`);
        if(extraction?.sourceRevision!==document.revision)reasons.push('当前版本正文尚未完成资产提取');
      }else{
        if(!scenes.length)reasons.push('尚未保存场次');
        else if(!task.sceneBlockId&&task.kind!=='adapt'&&body[0]?.type!=='scene')reasons.push('正文开头尚未归入场次');
        if(task.kind==='storyboard'||(task.kind==='adapt'&&!writingWorkspace)){
          const shots=(await loadDoc<{sceneId:string;desc:string}[]>(`storyboard:${id}`)??[]).filter(shot=>!task.sceneBlockId||shot.sceneId===`block:${task.sceneBlockId}`);
          if(task.shotReads[id]!==shotSignature(shots))reasons.push('尚未读回当前分镜');
          if(scenes.some(scene=>!shots.some(shot=>shot.sceneId===`block:${scene.id}`&&shot.desc?.trim())))reasons.push('部分场次尚无分镜');
        }
      }
    }
    return {episodeId:id,title:range?.title??chapter?.title??'已移除的章节',complete:reasons.length===0,reasons,sceneCount:scenes.length,...range?{sceneBlockId:task.sceneBlockId,startLine:range.startLine,endLine:range.endLine}:{}};
  }));
  const outline=task.kind!=='draft'||await hasOutline(task.rootEpisodeId);
  const completed=targets.filter(t=>t.complete).length;
  const complete=outline&&targets.length>0&&completed===targets.length;
  const phase=task.kind==='draft'?!outline?'outline':!targets.length?'chapters':complete?'complete':'writing':complete?'complete':task.kind;
  return {kind:task.kind,range:task.range,rootEpisodeId:task.rootEpisodeId,state:structuredClone(task),label:workflowLabels[task.kind],phase,complete,completed,total:targets.length,targets,
    summary:!outline?'需要保存大纲':!targets.length?'需要建立真实章节':`${completed}/${targets.length} ${task.sceneBlockId?'场':'章'}已核验`,
    remaining:targets.filter(t=>!t.complete).map(t=>`${t.title}（${t.reasons.join('、')}）`)};
}
export type WorkflowProgress = Awaited<ReturnType<typeof inspectWritingWorkflow>>;

export async function assertWorkflowTool(task: WritingWorkflow, name: string, input: unknown) {
  const a=input as Record<string,unknown>;
  const ids=[task.rootEpisodeId,...task.targetEpisodeIds];
  if(a?.episodeId!==undefined&&!ids.includes(String(a.episodeId)))throw Error('目标章节不在本次一键任务范围');
  if(task.sceneBlockId){
    if(!storyboardSceneRange((await readDocument(task.rootEpisodeId)).blocks,task.sceneBlockId))throw Error('所选场次已不存在，请重新选择');
    if(name==='organizeScenes')throw Error('本次仅为所选场次生成分镜，不修改正文场次');
    if(name==='editStoryboard'&&(!Array.isArray(a.shots)||a.shots.some((shot:{sceneBlockId?:string})=>shot.sceneBlockId!==task.sceneBlockId)))throw Error('镜头必须归入本次选定的场次，不能写入其他场次');
  }
  const read=['readScript','findNode','readEntities','readScriptSetup','listEpisodes','grepManuscript','listFiles','readFile','grepWorkspace','fileStat','skillRead','readProject','readStoryBible','askUser','switchEpisode'];
  if(read.includes(name))return;
  if(task.kind==='draft'){
    const progress=await inspectWritingWorkflow(task);
    if(name==='writeOutline'&&a?.episodeId===task.rootEpisodeId)return;
    if(progress.phase==='outline')throw Error('请先用writeOutline保存大纲，再规划章节和写作');
    if(name==='editEpisodes'&&a?.op==='plan'&&progress.phase==='chapters')return;
    if(name==='editEpisodes'&&a?.op==='finish'&&task.targetEpisodeIds.includes(String(a.episodeId)))return;
    if(['editScript','proposeScriptAppend'].includes(name)&&task.targetEpisodeIds.includes(String(a?.episodeId))){
      if(task.protectedEpisodeIds.includes(String(a.episodeId)))throw Error('自动成稿保留已有正文；请用普通聊天明确提出修改要求');
      if(progress.targets.find(t=>t.episodeId===a.episodeId)?.complete)throw Error('本章已标记完成，不重复追加；其他修改请在普通聊天提出');
      if(name==='editScript'&&a.op!=='insert')throw Error('自动成稿只能向规划章节追加正文，不覆盖原文');
      return;
    }
  }else if(task.targetEpisodeIds.includes(String(a?.episodeId))){
    if(task.kind==='adapt'){
      if(name==='editEpisodes'&&['split','rename'].includes(String(a.op))){
        const document=await readDocument(String(a.episodeId));
        if(!fullRead(task,String(a.episodeId),document.revision,document.blocks.length))throw Error('请先分页读取完整正文，再整理章节');
        return;
      }
      if(name==='organizeScenes'){
        const document=await readDocument(String(a.episodeId));
        if(Array.isArray(a.scenes)&&a.scenes.some((scene:{startBlockId?:string;title?:string;useExistingHeading?:boolean})=>scene.useExistingHeading&&document.blocks.find(b=>b.id===scene.startBlockId)?.text!==scene.title))throw Error('整理已有正文时不能改写原有段落，请保留标题原文或插入新场次标题');
        return;
      }
      if(name==='writeOutline'){const document=await readDocument(String(a.episodeId));if(!fullRead(task,String(a.episodeId),document.revision,document.blocks.length))throw Error('请先分页读取完整正文，再生成大纲');if(await hasOutline(String(a.episodeId)))throw Error('已有大纲，自动整理会保留原内容；如需修改请单独提出');return;}
      if(!writingWorkspace&&name==='editStoryboard'&&a.op==='add')return;
    }
    if(task.kind==='scenes'&&name==='organizeScenes'||task.kind==='assets'&&name==='extractEntities')return;
    if(task.kind==='storyboard'&&name==='organizeScenes')return;
    if(task.kind==='storyboard'&&name==='editStoryboard'&&a.op==='add')return;
  }
  throw Error('该工具或操作不属于本次一键任务；现有内容未修改');
}

export function recordWorkflowTool(task: WritingWorkflow, name:string, input:unknown, result:{applied?:boolean;workspaceChangeId?:string;result:unknown}) {
  const a=input as Record<string,unknown>;
  if((task.kind==='draft'&&a.op==='plan'||task.kind==='adapt'&&a.op==='split')&&name==='editEpisodes'&&!result.applied&&result.workspaceChangeId&&!task.pendingPlans.includes(result.workspaceChangeId))task.pendingPlans.push(result.workspaceChangeId);
  if((task.kind==='draft'||task.kind==='adapt')&&name==='editEpisodes'&&result.applied){
    const chapters=(result.result as {chapters?:{episodeId:string}[]}).chapters??[];
    task.targetEpisodeIds=[...new Set([...task.targetEpisodeIds,...chapters.map(c=>c.episodeId)])];
  }
  if(name==='readScript'){
    const read=result.result as {episodeId:string;revision:number;totalLines:number;blocks:{line:number}[]};
    if(task.targetEpisodeIds.includes(read.episodeId)){
      const prior=task.reads[read.episodeId];
      const lines=prior?.revision===read.revision?prior.lines:[];
      task.reads[read.episodeId]={revision:read.revision,totalLines:read.totalLines,lines:[...new Set([...lines,...read.blocks.map(b=>b.line)])].filter(line=>Number.isInteger(line)&&line>0&&line<=read.totalLines)};
    }
  }
  if(name==='readEntities'&&a.kind==='storyboard'&&!a.query&&typeof a.episodeId==='string'&&task.targetEpisodeIds.includes(a.episodeId))task.shotReads[a.episodeId]=shotSignature((result.result as Record<string,unknown>[]).filter(shot=>!task.sceneBlockId||shot.sceneId===`block:${task.sceneBlockId}`));
}

export async function workflowInstruction(task: WritingWorkflow) {
  const progress=await inspectWritingWorkflow(task);
  const {state:_,...displayProgress}=progress;
  if(task.sceneBlockId){
    const range=storyboardSceneRange((await readDocument(task.rootEpisodeId)).blocks,task.sceneBlockId);
    if(!range)throw Error('所选场次已不存在，请重新选择');
    return `[workflow:storyboard]\n本次仅根据一个场次正文生成分镜：${range.title}。episodeId=${task.rootEpisodeId}，sceneBlockId=${task.sceneBlockId}。\n本地核验：${JSON.stringify(displayProgress)}\n`+
      `先readScript分页读取第${range.startLine}—${range.endLine}行，每次最多120行；只根据这一场正文编排，不混入其他场次。readEntities kind=storyboard核对已有镜头，kind=scenes核对场次，读取已有资产供必要引用。\n`+
      '使用editStoryboard op=add实际保存镜头，每镜sceneBlockId必须为上述ID，包含desc/type/angle/movement/lens/duration和必要的真实entityIds。保留已有镜头、图片与布局，仅补充缺少的镜头。不得修改正文、重分场或写入其他场次。\n'+
      '完成后readScript分页读回所选场次全部正文，再readEntities kind=storyboard核验分镜。只核验这一场，无需整章或其他场次完成。不能用聊天预览代替保存；缺项继续使用工具，失败如实说明，不重复写入。';
  }
  return `[workflow:${task.kind}]\n本次任务：${workflowLabels[task.kind]}；起始文档=${task.rootEpisodeId}；范围=${task.range}。\n本地核验：${JSON.stringify(displayProgress)}\n`+
    (task.kind==='draft'?'严格顺序：1. readEntities outline读取现有大纲，writeOutline保存整体大纲；2. 没有正式章节时用editEpisodes op=plan一次提交全部章节title与summary，空草稿将转成第一章，回执提供真实ID；3. 按规划逐章editScript insert或proposeScriptAppend写完整正文。先读已有正文，保留已有内容；不要用目录、梗概或聊天回复代替章节正文。按用户指定章数规划，未指定时自行合理分章。小说用action；剧本用scene/action/character/dialogue等类型。每章完整后再结束，不以一段示意文字当成稿。':
    task.kind==='adapt'?'根据现有正文整理，不写新正文、不删除或改写任何原文。先listEpisodes并逐章分页readScript全文；未分章的长正文若有清晰分集边界，用editEpisodes split按原文块ID分集，单集则用rename转为正式集；保留已有正式章节，勿重复拆分。逐集readEntities outline，保留已有大纲，空白时用writeOutline的replace更新看板所显示的真实大纲文档（title=本章大纲）；无大纲文档才create，集纲看板会展示各集大纲。逐集organizeScenes分场，保留已有场次与正文，useExistingHeading=true时标题必须和该段原文完全相同；'+(writingWorkspace?'整理后逐集重新全文readScript，核对已有正文、场次和大纲。':'逐场用editStoryboard add补充缺少的镜头，保留已有镜头与图片。最后逐集重新全文readScript及readEntities storyboard核验，不能仅在聊天回复。'):
    task.kind==='scenes'?'逐章readScript阅读全文后organizeScenes保存场次；保留全部正文与已有场次ID，第一段正文也要归属场次。已有分场正确时读取并核对，不重复插入。':
    task.kind==='assets'?'逐章readScript阅读全文，readEntities查同名共用人物/地点/道具，再extractEntities关联真实blockIds。三类均需检查，不编造未出现资产；没有可提取项时entities=[]记录已检查。已有同类同名复用ID，不覆盖已有图片与设定。':
    '逐章readScript、readEntities scenes/storyboard。缺少场次先organizeScenes；再为尚无镜头的场次editStoryboard add保存镜头，包含desc/type/angle/movement/lens/duration及已有资产entityIds。保留已有镜头、图片和布局；每个场次都要有镜头。')+
    '\n所有任务都要用readScript每次最多120行分页读回整章，不能只读开头或越界空页；修改正文后需重新读回新版本。'+
    (task.kind==='draft'?'成稿每章完整后调用editEpisodes op=finish并提供episodeId，不能把部分开头当成完成。':'本任务不需要标记成稿，按本地核验列出的缺项逐项处理。')+
    ((task.kind==='storyboard'||(task.kind==='adapt'&&!writingWorkspace))?'逐章使用readEntities kind=storyboard读回当前镜头。':'')+
    '只处理本任务目标。尚有未完成章节就继续使用工具。工具失败要修正或如实说明，禁止仅回答“已完成”。问卷/审批/停止时暂停，不自行继续。';
}
