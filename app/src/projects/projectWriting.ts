import {db,loadDoc} from '../data/db';
import {prepareWorkspaceChange} from '../writing/workspaceChanges';
import type {ToolDefinition,ToolScope} from '../writing/writingTools';
export const LOCATION_GROUPS='project:locationGroups';
export interface ProjectMeta {name:string;kind?:'script'|'novel';synopsis?:string;author?:string;[key:string]:unknown}
export interface LocationGroup {id:string;name:string;locationIds:string[]}
export function validateProjectMeta(value:unknown):ProjectMeta{if(!value||typeof value!=='object')throw Error('项目信息无效');const p=value as ProjectMeta;if(typeof p.name!=='string'||!p.name.trim()||p.name.length>120||p.synopsis!==undefined&&(typeof p.synopsis!=='string'||p.synopsis.length>50000)||p.author!==undefined&&(typeof p.author!=='string'||p.author.length>200)||p.kind!==undefined&&!['script','novel'].includes(p.kind))throw Error('项目信息字段无效');return p;}
export function validateLocationGroups(value:unknown):LocationGroup[]{if(!Array.isArray(value)||value.length>200)throw Error('地点分组最多200个');const ids=new Set<string>(),names=new Set<string>();return value.map(g=>{if(!g||typeof g.id!=='string'||!g.id||g.id.length>200||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.length>120||names.has(g.name.trim())||!Array.isArray(g.locationIds)||g.locationIds.length>1000||g.locationIds.some((id:unknown)=>typeof id!=='string'||!id||id.length>200)||new Set(g.locationIds).size!==g.locationIds.length)throw Error('地点分组记录无效或重名');ids.add(g.id);names.add(g.name.trim());return {id:g.id,name:g.name.trim(),locationIds:[...g.locationIds]};});}
export async function readProjectWriting(){return db.transaction('r',db.docs,db.entities,async()=>({meta:validateProjectMeta(await loadDoc('project:meta')),locationGroups:validateLocationGroups(await loadDoc(LOCATION_GROUPS)??[]),locations:(await db.entities.where('kind').equals('location').toArray()).map(e=>({id:e.id,name:e.name}))}));}
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export const projectWritingRead:ToolDefinition={name:'readProject',description:'读取当前项目真实名称、梗概、作者、地点分组及地点ID。分组引用共用地点资产。',parameters:object({})};
export const projectWritingTools:ToolDefinition[]=[
 {name:'editProject',description:'修改项目名称、项目梗概或作者。只更新patch提供的字段。所有页面标题与首页读取同一记录。',parameters:object({patch:object({name:{type:'string',maxLength:120},synopsis:{type:'string',maxLength:50000},author:{type:'string',maxLength:200}})},['patch'])},
 {name:'editLocationGroups',description:'编排共用地点分组。upsert省略id新建，已有分组必须用readProject返回的id；locationIds为完整成员列表，只接受真实地点ID。delete只删分组，保留地点。',parameters:object({op:{type:'string',enum:['upsert','delete']},id:{type:'string'},name:{type:'string',maxLength:120},locationIds:{type:'array',maxItems:1000,items:{type:'string'}}},['op'])}
];
export async function prepareProjectWriting(name:string,input:unknown,scope:ToolScope,expected?:unknown){
 if(scope.readOnly||!scope.allowAppend)throw Error('修改项目信息需要整集写入范围');if(!input||typeof input!=='object'||Array.isArray(input))throw Error('工具参数无效');const a=input as Record<string,unknown>;
 return prepareWorkspaceChange(name==='editProject'?'项目信息':'地点分组',scope.snapshot.episodeId,name==='editProject'?'01-script':'07-locations',async draft=>{
  if(name==='editProject'){
   if(Object.keys(a).some(k=>k!=='patch')||!a.patch||typeof a.patch!=='object'||Array.isArray(a.patch)||!Object.keys(a.patch).length||Object.keys(a.patch).some(k=>!['name','synopsis','author'].includes(k)))throw Error('项目信息补丁无效');
   const old=await draft.doc<ProjectMeta>('project:meta');if(expected!==undefined&&JSON.stringify(old)!==JSON.stringify(expected))throw Error('项目信息已变化，请重新打开');const meta=validateProjectMeta({...old,...a.patch});meta.name=meta.name.trim();await draft.setDoc('project:meta',meta);return {meta};
  }
  if(Object.keys(a).some(k=>!['op','id','name','locationIds'].includes(k)))throw Error('地点分组参数无效');const groups=validateLocationGroups(await draft.doc(LOCATION_GROUPS)??[]);if(expected!==undefined&&JSON.stringify(groups)!==JSON.stringify(expected))throw Error('地点分组已变化，请重新打开');
  const found=groups.find(g=>g.id===a.id);if(a.id!==undefined&&!found)throw Error('分组ID不存在，请先读取');if(a.op==='delete'){if(!found)throw Error('请选择现有分组');await draft.setDoc(LOCATION_GROUPS,groups.filter(g=>g!==found));return {deletedId:found.id};}
  if(a.op!=='upsert')throw Error('分组操作无效');const group={id:found?.id??crypto.randomUUID(),name:a.name,locationIds:a.locationIds};const all=validateLocationGroups([...groups.filter(g=>g!==found),group]);for(const id of all.find(g=>g.id===group.id)!.locationIds){const entity=await db.entities.get(id);if(entity?.kind!=='location')throw Error('分组成员必须是当前项目真实地点');}await draft.setDoc(LOCATION_GROUPS,all);return {group:all.find(g=>g.id===group.id)};
 });
}
export async function syncProjectTitle(){const meta=await loadDoc<ProjectMeta>('project:meta');if(!meta)return;document.querySelectorAll<HTMLElement>('[data-project-name]').forEach(el=>{el.textContent=meta.name;el.title=meta.name;});document.title=`${meta.name} · Lum`;window.dispatchEvent(new Event('dsh:project-renamed'));}
