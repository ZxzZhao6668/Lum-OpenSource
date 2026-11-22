import { writingWorkspace } from '../projects/projectIdentity';
import {boardRead,readWritingBoard} from '../novel/writingBoard';
import {bibleRead,readStoryBible} from '../novel/storyBible';
import {projectWritingRead,readProjectWriting} from '../projects/projectWriting';
import { listEntities, loadDoc } from "../data/db";
import { createProposal, readDocument, type DocumentSnapshot, type ScriptBlock } from "./documentStore";
import { structuredToolDefinitions, prepareStructuredTool, episodeIndex, scopedDocument } from './structuredTools';
import { commitWorkspaceChange, refreshWorkspaceView } from './workspaceFeedback';
import { createContentProposal, type CreateContentProposalInput } from "./contentProposals";
import { commitWritingChange } from './writeFeedback';
import { projectFileTools,executeProjectFileTool } from './projectFileTools';
import { validateBeats } from '../beats/beatModel';
import {selectionText,type TextSelection} from './selectionWriting';
import { readScriptSetupPage, type ScriptSetupSnapshot } from '../scriptSetup/scriptSetupContext';
import {readWorldview} from '../worldview/worldviewModel';
import {validateQuestions,type WritingQuestion} from './questions';
import {assertWorkflowTool,recordWorkflowTool,finishWorkflowChapter,storyboardSceneRange,type WritingWorkflow} from './writingWorkflow';

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolScope { scriptSetup?: ScriptSetupSnapshot | null; snapshot: DocumentSnapshot; workflow?:WritingWorkflow; selection?:TextSelection; documents?: Map<string,DocumentSnapshot>; userPrompt?: string; cursorId?:string; advisorId?:string; fileIds?:string[]; editableIds: string[]; readOnly: boolean; autoWrite?: boolean; cancelled?: () => boolean; allowAppend?: boolean; contentTargets?: Array<{ kind: 'outline' | 'storyboard' | 'entity'; id: string }> }
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const episodeScreens = ['01-script','03-outline','05-scenes','13-beats'];
if (!writingWorkspace) episodeScreens.push('04-storyboard');
const selectionTools = new Set(['listFiles','readFile','grepWorkspace','fileStat','skillRead','listEpisodes','readScript','findNode','grepManuscript','readEntities','readScriptSetup','askUser','proposeScriptEdit']);
export function writingTools(readOnly: boolean, episodeId: string, autoWrite = false, selection = false): ToolDefinition[] {
  const episode = { type: "string", description: `真实剧集ID，当前为${episodeId}；其他ID须先listEpisodes或create获取` };
  const tools: ToolDefinition[] = [
    ...projectFileTools,projectWritingRead,bibleRead,boardRead,
    { name: 'readScriptSetup', description: '按字符分页读取本轮固定的已确认剧本设定，包括选中人物、正史和裁剪结果。nextOffset 非空时可继续。仅为创作资料。', parameters: object({ offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 12000 } }) },
    { name: "listEpisodes", description: "列出本项目真实章节与已归档章节的ID、名称。不要猜测ID。", parameters: object({}) },
    { name: "readScript", description: "读取本轮开始时的剧本文档快照。行号从1开始，每次最多120行。", parameters: object({ episodeId: episode, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } }, ["episodeId", "startLine", "endLine"]) },
    { name: "findNode", description: "定位真实正文节点ID。query按原文查找，或selector按cursor（本轮光标）、line（1起行号）、scene_number（1起场次顺序）、character_name（角色名）、type（段落类型）。二者选一；最多返回100项，offset可翻页。", parameters: object({ episodeId: episode, query: { type: "string", minLength: 1, maxLength: 200 }, selector:object({by:{type:'string',enum:['cursor','line','scene_number','character_name','type']},value:{type:['string','integer']}},['by']),offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100} }, ["episodeId"]) },
    { name:'grepManuscript',description:'按原文搜索本项目正文，返回章节ID、标题、真实块ID和行号。省略episodeId搜索全部当前章节；选区模式只查当前章。分页limit最大100，hasMore时用nextOffset继续。不执行正则表达式。',parameters:object({query:{type:'string',minLength:1,maxLength:200},episodeId:episode,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['query']) },
    { name: "readEntities", description: "查询共用人物/地点/道具库，以及章节大纲、场次、分镜、资产关联和世界观。episodeId省略时读取本轮当前集。只返回真实记录。", parameters: object({ episodeId: episode, kind: { type: "string", enum: ["character", "location", "prop", "outline", "storyboard", "scenes", "links", "worldview", "beats"] }, query: { type: "string", maxLength: 200 }, offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:100} }, ["kind"]) },
    { name: 'switchEpisode', description: '切换到指定章节的可用页面。写工具仍须显式提供 episodeId。', parameters: object({episodeId:episode,screen:{type:'string',enum:episodeScreens}},['episodeId']) },
    { name: "askUser", description: "需要用户提供方向时暂停本轮。提供questions（1—3题，每题2—4个选项，可multiple多选），或旧版question文本。选择本身不算用户授权，等下一轮用户发送回复。", parameters: object({ question: { type: "string", minLength: 1, maxLength: 2000 }, questions:{type:'array',minItems:1,maxItems:3,items:object({question:{type:'string',maxLength:200},options:{type:'array',minItems:2,maxItems:4,items:{type:'string',maxLength:80}},multiple:{type:'boolean'}},['question','options'])} }) },
  ];
  if (!readOnly) tools.push({ name: "proposeScriptEdit", description: "对本轮允许修改的块提出文本修改建议，不直接写入正文。保留块ID及类型，每块只能更新一次。用户确认后才应用。", parameters: object({ episodeId: episode, updates: { type: "array", minItems: 1, maxItems: 120, items: object({ id: { type: "string" }, text: { type: "string", maxLength: 100000 } }, ["id", "text"]) } }, ["episodeId", "updates"]) });
  if (!readOnly) tools.push({ name: "proposeContentEdit", description: "对授权的当前页面已有大纲、镜头或资产提出修改，必须先读取真实ID和原文。仅生成待审批提案，不直接写入。大纲用find/replace唯一文本匹配，禁止HTML或整篇重建；镜头只改文字，不改图片位置。", parameters: object({ target: object({ kind: { type: "string", enum: ["outline", "storyboard", "entity"] }, id: { type: "string", minLength: 1 } }, ["kind", "id"]), patch: object(Object.fromEntries(["title", "find", "replace", "desc", "type", "angle", "movement", "lens", "name", "meta"].map(key => [key, { type: "string", maxLength: 100000 }]))) }, ["target", "patch"]) });
  if(!readOnly)tools.push({name:'proposeScriptAppend',description:'为获准的空白剧本起稿或在整集末尾续写。只创建待审批提案，不直接写入；不替换现有正文。',parameters:object({episodeId:episode,blocks:{type:'array',minItems:1,maxItems:120,items:object({type:{type:'string',enum:['scene','action','character','parenthetical','dialogue','transition','comment','subtitle']},text:{type:'string',maxLength:100000}},['type','text'])}},['episodeId','blocks'])});
  if (autoWrite) for (const tool of tools) {
    if (tool.name === 'proposeScriptAppend') tool.description = '把生成的剧本段落直接写入指定集正文末尾（空白集即起稿），不限当前页面。返回 applied 才表示保存成功，可撤销。不覆盖已有正文。用户要求生成、起稿或续写剧本时必须调用，不要只在聊天回复中展示。';
    if (tool.name === 'proposeScriptEdit') tool.description = '直接修改本轮授权的剧本块文字，按真实块 ID 更新，保留类型。不限当前页面，返回 applied 才算成功，可撤销。先读取正文再修改。';
    if (tool.name === 'proposeContentEdit') tool.description = '直接修改当前页面授权的大纲、镜头或资产，可撤销。必须使用真实目标 ID；大纲用 find/replace 唯一文本匹配，镜头只改文字，不改图片和位置。生成剧本正文请用 proposeScriptAppend，不能写到大纲里。';
  }
  if (!readOnly) tools.push(...structuredToolDefinitions.map(tool => ({...tool,description:tool.description+(autoWrite?' 已启用直接写入：实际保存后返回applied。':' 当前审批模式：只生成待审批记录，不直接保存。')})));
  return tools.filter(tool => (!selection || selectionTools.has(tool.name)) && (!writingWorkspace || tool.name !== 'editStoryboard'));
}
function args(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工具参数必须是对象");
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("工具包含未知参数");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, allowEmpty = false) { if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) throw new Error("工具文本参数无效"); return value; }
function checkEpisode(value: unknown, scope: ToolScope) { if (value !== scope.snapshot.episodeId) throw new Error("目标集不在本轮授权范围"); }
function queryPage(a:Record<string,unknown>){const offset=a.offset??0,limit=a.limit??30;if(!Number.isInteger(offset)||Number(offset)<0||Number(offset)>1_000_000||!Number.isInteger(limit)||Number(limit)<1||Number(limit)>100)throw Error('查询分页参数无效');return {offset:Number(offset),limit:Number(limit)};}
export async function executeWritingTool(name: string, input: unknown, scope: ToolScope): Promise<{ result: unknown; proposalId?: string; contentProposalId?: string; workspaceChangeId?: string; episodeId?: string; question?: string; questionnaire?:WritingQuestion[]; applied?: boolean; blockIds?: string[]; warning?: string }> {
  if(scope.cancelled?.())throw Error('已停止，未执行工具');
  if (writingWorkspace && name === 'editStoryboard') throw Error('请在项目的制作工作区编辑分镜');
  if(scope.workflow)await assertWorkflowTool(scope.workflow,name,input);
  if(name==='editEpisodes'&&(input as {op?:string})?.op==='finish'){
    const a=args(input,['op','episodeId']);if(scope.cancelled?.()||scope.readOnly||!scope.workflow||scope.workflow.kind!=='draft')throw Error('当前没有可完成的成稿任务');
    return finishWorkflowChapter(scope.workflow,text(a.episodeId,200));
  }
  const result=await executeWritingToolInternal(name,input,scope);
  if(scope.workflow)recordWorkflowTool(scope.workflow,name,input,result);
  return result;
}
async function executeWritingToolInternal(name: string, input: unknown, scope: ToolScope): Promise<{ result: unknown; proposalId?: string; contentProposalId?: string; workspaceChangeId?: string; episodeId?: string; question?: string; questionnaire?:WritingQuestion[]; applied?: boolean; blockIds?: string[]; warning?: string }> {
  if (scope.cancelled?.()) throw Error('已停止，未执行工具');
  if(scope.selection&&!selectionTools.has(name))throw Error('选区模式仅可修改拉选的文字，不能操作其他内容');
  if(name==='readScriptSetup') {
    const a=args(input,['offset','limit']), offset=a.offset??0, limit=a.limit??8000;
    if(!Number.isSafeInteger(offset)||Number(offset)<0||!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>12000)throw Error('剧本设定分页参数无效');
    return {result:readScriptSetupPage(scope.scriptSetup,Number(offset),Number(limit))};
  }
  if(name==='readWritingBoard'){args(input,[]);return {result:await readWritingBoard()};}
  if(name==='readStoryBible'){args(input,[]);return {result:await readStoryBible()};}
  if(name==='readProject'){args(input,[]);return {result:await readProjectWriting()};}
  if(projectFileTools.some(tool=>tool.name===name))return {result:await executeProjectFileTool(name,input,scope)};
  if(['proposeScriptAppend','proposeScriptEdit'].includes(name)){
    const id=(input as Record<string,unknown>)?.episodeId;
    if(id!==scope.snapshot.episodeId){
      const snapshot=await scopedDocument(id,scope),nested={...scope,snapshot,editableIds:snapshot.blocks.map(b=>b.id)};
      const result=await executeWritingTool(name,input,nested);(scope.documents??=new Map()).set(snapshot.episodeId,nested.snapshot);return {...result,episodeId:snapshot.episodeId};
    }
  }
  if (structuredToolDefinitions.some(tool=>tool.name===name)) {
    const change=await prepareStructuredTool(name,input,scope);
    if (!scope.autoWrite) return {workspaceChangeId:change.id,episodeId:change.episodeId,result:{status:'pending',operationId:change.id,message:'待用户审批，尚未写入'}};
    const applied=await commitWorkspaceChange(change.id,{agentWriteEnabled:true},scope.cancelled);
    const index=await episodeIndex();
    const current=await readDocument(index.chapters.some(c=>c.episodeId===scope.snapshot.episodeId)?scope.snapshot.episodeId:change.episodeId);
    scope.snapshot=current;scope.editableIds=scope.allowAppend?current.blocks.map(b=>b.id):scope.editableIds;
    for(const script of applied.scripts)if(script.episodeId!==scope.snapshot.episodeId)(scope.documents??=new Map()).set(script.episodeId,await readDocument(script.episodeId));
    return {workspaceChangeId:change.id,episodeId:change.episodeId,applied:true,result:{status:'applied',operationId:change.id,operation:change.label,...change.result}};
  }
  if(name==='switchEpisode'){
    const a=args(input,['episodeId','screen']);const target=await scopedDocument(a.episodeId,scope);const screen=a.screen??'01-script';if(!episodeScreens.includes(String(screen)))throw Error('页面无效');
    await refreshWorkspaceView(target.episodeId,String(screen));return {result:{episodeId:target.episodeId,screen,status:'opened'}};
  }
  if(name==='grepManuscript'){
    const a=args(input,['query','episodeId','offset','limit']),query=text(a.query,200),{offset,limit}=queryPage(a);
    if(a.episodeId!==undefined)await scopedDocument(a.episodeId,scope);
    const chapters=(await episodeIndex()).chapters.filter(c=>a.episodeId!==undefined?c.episodeId===a.episodeId:scope.allowAppend||c.episodeId===scope.snapshot.episodeId);
    const matches:Array<{episodeId:string;title:string;id:string;line:number;type:string;text:string}>=[];let skipped=0;
    outer:for(const chapter of chapters){
      if(scope.cancelled?.())throw Error('已停止');
      const document=await readDocument(chapter.episodeId);
      for(let i=0;i<document.blocks.length;i++){const block=document.blocks[i];if(!block.text.includes(query))continue;if(skipped++<offset)continue;
        const at=block.text.indexOf(query),start=Math.max(0,at-200);matches.push({episodeId:chapter.episodeId,title:chapter.title,id:block.id,line:i+1,type:block.type,text:block.text.slice(start,start+3000)});
        if(matches.length>limit)break outer;
      }
    }
    const hasMore=matches.length>limit;return {result:{matches:matches.slice(0,limit),hasMore,nextOffset:hasMore?offset+limit:null}};
  }
  if(['readScript','findNode'].includes(name)){
    const value=input as Record<string,unknown>;let snapshot=await scopedDocument(value?.episodeId,scope);
    if(name==='readScript'){
      const a=args(input,['episodeId','startLine','endLine']);let start=a.startLine as number,end=a.endLine as number;
      if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end-start>=120)throw Error('每次读取1—120行');
      snapshot=await readDocument(snapshot.episodeId);
      if(scope.workflow?.sceneBlockId){
        const range=storyboardSceneRange(snapshot.blocks,scope.workflow.sceneBlockId);
        if(!range)throw Error('所选场次已不存在，请重新选择');
        start=Math.max(start,range.startLine);end=Math.min(end,range.endLine);
        if(start>end)throw Error(`请读取所选场次第${range.startLine}—${range.endLine}行，每次最多120行`);
      }
      if(snapshot.episodeId===scope.snapshot.episodeId){scope.snapshot=snapshot;if(scope.allowAppend)scope.editableIds=snapshot.blocks.map(b=>b.id);}
      else(scope.documents??=new Map()).set(snapshot.episodeId,snapshot);
      return {result:{episodeId:snapshot.episodeId,revision:snapshot.revision,totalLines:snapshot.blocks.length,blocks:snapshot.blocks.slice(start-1,end).map((b,i)=>({...b,line:start+i}))}};
    }
    const a=args(input,['episodeId','query','selector','offset','limit']),{offset,limit}=queryPage(a);
    if((a.query===undefined)===(a.selector===undefined))throw Error('query与selector必须且只能提供一个');
    let match:(block:ScriptBlock,index:number)=>boolean;
    if(a.query!==undefined){const query=text(a.query,200);match=b=>b.text.includes(query);}
    else {
      const selector=args(a.selector,['by','value']);
      if(selector.by==='cursor'){
        if(selector.value!==undefined)throw Error('cursor无需value');if(snapshot.episodeId!==scope.snapshot.episodeId)throw Error('光标仅在本轮当前章节内有效');match=b=>b.id===scope.cursorId;
      }else if(selector.by==='line'||selector.by==='scene_number'){
        if(!Number.isInteger(selector.value)||Number(selector.value)<1)throw Error('行号和场次顺序必须为正整数');
        const target=Number(selector.value),scene=selector.by==='scene_number'?snapshot.blocks.filter(b=>b.type==='scene')[target-1]:undefined;
        match=(b,i)=>selector.by==='line'?i+1===target:b===scene;
      }else if(selector.by==='character_name'){
        const name=text(selector.value,200).trim();match=b=>b.type==='character'&&b.text.replace(/[（(].*?[）)]/g,'').trim()===name;
      }else if(selector.by==='type'){
        const type=text(selector.value,30);if(!['scene','action','character','parenthetical','dialogue','transition','comment','subtitle'].includes(type))throw Error('段落类型无效');match=b=>b.type===type;
      }else throw Error('不支持的定位方式');
    }
    return {result:snapshot.blocks.flatMap((b,i)=>match(b,i)?[{...b,line:i+1}]:[]).slice(offset,offset+limit)};
  }
  const blocks = scope.snapshot.blocks;
  async function finishWrite(kind: 'script' | 'content', id: string) {
    const identity = kind === 'script' ? { proposalId: id } : { contentProposalId: id };
    if (!scope.autoWrite) return { ...identity, result: { proposalId: id, status: 'pending', message: '修改待用户审批，尚未写入' } };
    const written = await commitWritingChange(kind, id, scope.snapshot.episodeId, { agentWriteEnabled: true }, scope.cancelled);
    if (written.snapshot) {
      scope.snapshot = written.snapshot;
      scope.editableIds = [...new Set([...scope.editableIds, ...written.blockIds])];
    }
    return { ...identity, episodeId:scope.snapshot.episodeId, applied: true, blockIds: written.blockIds, warning: written.warning, result: { proposalId: id, status: 'applied', episodeId: scope.snapshot.episodeId, target: kind === 'script' ? '剧本正文' : '当前页面内容', blockIds: written.blockIds, warning: written.warning, message: '已保存，可在写入记录撤销。不要重复提交相同内容。' } };
  }
  if(name==='proposeScriptAppend'){
    if(scope.readOnly||!scope.allowAppend)throw Error('当前范围不允许起稿或续写，请选择整集并启用写入模式');
    const a=args(input,['episodeId','blocks']);checkEpisode(a.episodeId,scope);if(!Array.isArray(a.blocks)||!a.blocks.length||a.blocks.length>120)throw Error('新增段落数量无效');
    const added=a.blocks.map(value=>{const b=args(value,['type','text']);if(!['scene','action','character','parenthetical','dialogue','transition','comment','subtitle'].includes(String(b.type)))throw Error('段落类型无效');return {id:crypto.randomUUID(),type:b.type as ScriptBlock['type'],text:text(b.text,100000,true)};});
    const proposal=await createProposal({episodeId:scope.snapshot.episodeId,baseRevision:scope.snapshot.revision,before:blocks,after:[...blocks,...added]});return finishWrite('script', proposal.id);
  }
  if (name === "listEpisodes") { args(input, []); const index=await episodeIndex();return {result:{currentEpisodeId:scope.snapshot.episodeId,chapters:index.chapters.map(c=>({id:c.episodeId,episodeId:c.episodeId,title:c.title,...(c.draft?{draft:true}:{})})),archived:(index.archived??[]).map(c=>({id:c.episodeId,title:c.title}))}}; }
  if (name === "readEntities") {
    const a = args(input, ["kind", "query", "episodeId", "offset", "limit"]); const query = a.query === undefined ? "" : text(a.query, 200, true);const {offset,limit}=queryPage(a);
    const episodeId=(await scopedDocument(a.episodeId??scope.snapshot.episodeId,scope)).episodeId;
    if(a.kind==='worldview'){const world=scope.scriptSetup?{overview:scope.scriptSetup.overview,entries:scope.scriptSetup.canon}:await readWorldview(),matches=world.entries.filter(e=>!query||e.id===query||`${e.key}\n${e.value}\n${e.tags.join(' ')}`.includes(query));const entries=[];let size=0;for(const entry of matches.slice(offset,offset+limit)){if(entries.length&&size+entry.value.length>40000)break;entries.push(entry);size+=entry.value.length;}const hasMore=offset+entries.length<matches.length;return {result:{overview:world.overview.slice(0,8000),overviewTruncated:world.overview.length>8000,entries,total:matches.length,hasMore,nextOffset:hasMore?offset+entries.length:null}};}
    if(a.kind==='beats')return {result:{episodeId,episodeTitle:(await episodeIndex()).chapters.find(c=>c.episodeId===episodeId)?.title,beats:validateBeats(await loadDoc(`beats:${episodeId}`)??[]).filter(b=>!query||b.id===query||`${b.name}\n${b.description}`.includes(query))}};
    if(a.kind==='links')return {result:await loadDoc(`entities:links:${episodeId}`)??{}};
    if(a.kind==='scenes')return {result:{episodeId,scenes:(await scopedDocument(episodeId,scope)).blocks.filter(b=>b.type==='scene'),notes:await loadDoc(`scene:desc:${episodeId}`)}};
    if (a.kind === "outline") return { result: { episodeId, outline: await loadDoc(`outline:${episodeId}`) } };
    if (a.kind === "storyboard") {
      const shots = (await loadDoc<Array<Record<string, unknown>>>(`storyboard:${episodeId}`) ?? []).filter(shot=>!scope.workflow?.sceneBlockId||shot.sceneId===`block:${scope.workflow.sceneBlockId}`);
      return { result: shots.filter(shot => !query || String(shot.desc).includes(query) || shot.id === query || shot.sceneId === query).map(shot => Object.fromEntries(['id','no','sceneId','desc','type','angle','movement','lens','duration','entityIds','staging','notes'].filter(key=>key in shot).map(key => [key, shot[key]]))) };
    }
    if (!["character", "location", "prop"].includes(String(a.kind))) throw new Error("不支持的资产类型");
    const entities = await listEntities(a.kind as "character" | "location" | "prop");
    return { result: entities.filter(e => !query || `${e.name}\n${e.desc}`.includes(query)).slice(0, 30).map(e => ({ id: e.id, name: e.name, kind: e.kind, meta: e.meta, desc: e.desc.slice(0, 8000) })) };
  }
  if (name === "askUser") { const a = args(input, ["question","questions"]);if(a.questions!==undefined){if(a.question!==undefined)throw Error('question与questions只提供一种');const questionnaire=validateQuestions(a.questions),question=questionnaire.map(q=>q.question).join('\n');return {result:{waitingForUser:true,questions:questionnaire},question,questionnaire};}const question = text(a.question, 2000); return { result: { waitingForUser: true, question }, question }; }
  if (name === "proposeContentEdit") {
    if (scope.readOnly) throw new Error("只读模式禁止内容修改提案");
    const a = args(input, ["target", "patch"]); const target = args(a.target, ["kind", "id"]);
    if (!scope.contentTargets?.some(item => item.kind === target.kind && item.id === target.id)) throw new Error("目标不在当前页面授权内容范围");
    const proposal = await createContentProposal(a as unknown as CreateContentProposalInput, scope.snapshot.episodeId);
    return finishWrite('content', proposal.id);
  }
  if (name === "proposeScriptEdit") {
    if (scope.readOnly) throw new Error("只读模式禁止提出可执行修改");
    const a = args(input, ["episodeId", "updates"]); checkEpisode(a.episodeId, scope);
    if (!Array.isArray(a.updates) || !a.updates.length || a.updates.length > 120) throw new Error("修改块数量无效");
    const updates = new Map<string, string>();
    for (const entry of a.updates) { const patch = args(entry, ["id", "text"]); const id = text(patch.id, 200); if (!scope.editableIds.includes(id) || !blocks.some(b => b.id === id) || updates.has(id)) throw new Error("修改块不在授权范围、已不存在或重复"); updates.set(id, text(patch.text, 100000, true)); }
    const after: ScriptBlock[] = blocks.map(block => updates.has(block.id) ? { ...block, text: updates.get(block.id)! } : { ...block });
    if(scope.selection){
      const selected=scope.selection;selectionText(scope.snapshot,selected);
      const first=blocks.findIndex(b=>b.id===selected.start.id),last=blocks.findIndex(b=>b.id===selected.end.id);
      for(const [id,value]of updates){const i=blocks.findIndex(b=>b.id===id);if(i<first||i>last)throw Error('修改超出拉选范围');const before=blocks[i].text,prefix=i===first?before.slice(0,selected.start.offset):'',suffix=i===last?before.slice(selected.end.offset):'';if(!value.startsWith(prefix)||!value.endsWith(suffix)||value.length<prefix.length+suffix.length)throw Error('修改触及未选中的文字，已拒绝写入');}
    }
    const proposal = await createProposal({ episodeId: scope.snapshot.episodeId, baseRevision: scope.snapshot.revision, before: blocks, after });
    return finishWrite('script', proposal.id);
  }
  throw new Error("不允许执行该工具");
}
