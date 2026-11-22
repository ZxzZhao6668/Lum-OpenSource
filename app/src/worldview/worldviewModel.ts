import {db,loadDoc} from '../data/db';
export const WORLD_ENTRIES='project:worldview:entries';
export const worldCategories=['基本设定','世界规则','历史时间线','术语','组织与文化'];
export const worldTemplates=[
 {id:'short-drama',name:'短剧',description:'主题、钩子、人设与商业定位',fields:[['主题','故事探讨的核心问题是什么？'],['核心钩子','开场悬念、主角困境和持续观看动力是什么？'],['人物关系','主角的欲望、阻碍、反差及人物关系如何推动剧情？'],['受众与商业定位','目标受众、情绪回报与每集推进方式是什么？']]},
 {id:'film',name:'故事片',description:'一句话故事、三幕、人物弧与影像风格',fields:[['一句话故事','用主角、目标、阻碍与风险概括故事。'],['核心议题','故事最终希望观众思考什么？'],['三幕结构','建立困境、升级对抗、解决冲突分别发生什么？'],['人物弧','主角从何种信念出发，经历怎样的变化？'],['影像风格','时代、色彩、空间、声音和摄影共同形成怎样的风格？']]},
 {id:'world',name:'世界设定',description:'规则、历史、文化与术语',fields:[['世界边界','故事发生的空间、时代、自然条件和社会范围是什么？'],['核心规则','力量或技术的来源、限制、代价和不可突破的边界是什么？'],['历史转折','哪些历史事件塑造了当前局面？'],['组织与文化','组织目标、制度、风俗与价值冲突是什么？'],['关键术语','哪些专有名词需要统一定义和用法？']]},
] as const;
export interface WorldEntry {id:string;key:string;value:string;category:string;status:'draft'|'canon';tags:string[];entityIds:string[];dateLabel:string;timelineOrder:number;archived:boolean}
const fields=['id','key','value','category','status','tags','entityIds','dateLabel','timelineOrder','archived'];
export function validateWorldEntries(value:unknown):WorldEntry[]{
 if(!Array.isArray(value)||value.length>500)throw Error('世界观最多500条设定');const ids=new Set<string>(),names=new Set<string>();let size=0;
 for(const e of value){if(!e||typeof e!=='object'||Object.keys(e).some(k=>!fields.includes(k))||typeof e.id!=='string'||!/^[\w-]{1,100}$/.test(e.id)||ids.has(e.id)||typeof e.key!=='string'||!e.key.trim()||e.key.length>200||typeof e.value!=='string'||!e.value.trim()||e.value.length>20000||e.value.includes('\0')||typeof e.category!=='string'||!e.category.trim()||e.category.length>80||!['draft','canon'].includes(e.status)||!Array.isArray(e.tags)||e.tags.length>20||e.tags.some((t:unknown)=>typeof t!=='string'||!t.trim()||t.length>60)||!Array.isArray(e.entityIds)||e.entityIds.length>100||e.entityIds.some((id:unknown)=>typeof id!=='string'||!/^[\w-]{1,100}$/.test(id))||typeof e.dateLabel!=='string'||e.dateLabel.length>200||!Number.isFinite(e.timelineOrder)||Math.abs(e.timelineOrder)>1e12||typeof e.archived!=='boolean')throw Error('世界观条目格式无效');
  const name=`${e.category.trim()}\0${e.key.trim()}`;if(!e.archived&&names.has(name))throw Error('同分类已有同名设定，请编辑原条目');if(!e.archived)names.add(name);ids.add(e.id);size+=e.value.length;
 }if(size>1000000)throw Error('世界观正文总量超过100万字');return structuredClone(value);
}
export async function readWorldview(includeArchived=false){const entries=validateWorldEntries(await loadDoc(WORLD_ENTRIES)??[]);return {overview:await loadDoc<string>('project:worldview')??'',entries:entries.filter(e=>includeArchived||!e.archived)};}
export async function worldviewContext(){const world=await readWorldview();return [world.overview,...world.entries.filter(e=>e.status==='canon').map(e=>`[${e.id}] ${e.category} / ${e.key}：${e.value}`)].filter(Boolean).join('\n\n').slice(0,8000);}
export function addWorldTemplate(before:WorldEntry[],id:string){const template=worldTemplates.find(t=>t.id===id);if(!template)throw Error('模板不存在');const after=structuredClone(before);for(const [key,value]of template.fields){if(after.some(e=>!e.archived&&e.key===key))continue;after.push({id:crypto.randomUUID(),key,value,category:'基本设定',status:'draft',tags:[],entityIds:[],dateLabel:'',timelineOrder:after.length,archived:false});}return validateWorldEntries(after);}
export async function setWorldEntries(before:WorldEntry[],input:unknown){
 if(!Array.isArray(input)||!input.length||input.length>100)throw Error('一次提交1—100条设定');const after=structuredClone(before),changed:string[]=[];
 for(const raw of input){if(!raw||typeof raw!=='object'||Object.keys(raw).some(k=>!fields.includes(k)||k==='archived'))throw Error('世界观 set 不能删除或归档条目');
  const existing=raw.id?after.find(e=>e.id===raw.id):after.find(e=>!e.archived&&e.key===raw.key&&e.category===(raw.category??'基本设定'));if(raw.id&&!existing)throw Error('世界观条目 ID 不存在');if(existing?.archived)throw Error('请先恢复已归档设定');
  const entry={id:crypto.randomUUID(),key:'',value:'',category:'基本设定',status:'draft',tags:[],entityIds:[],dateLabel:'',timelineOrder:after.length,archived:false,...existing,...raw} as WorldEntry;
  if(changed.includes(entry.id))throw Error('同一条目不能重复修改');changed.push(entry.id);
  for(const id of entry.entityIds)if(!await db.entities.get(id))throw Error('关联资产不存在，请先读取真实 ID');
  if(existing)after[after.findIndex(e=>e.id===entry.id)]=entry;else after.push(entry);
 }return {entries:validateWorldEntries(after),changed};
}
