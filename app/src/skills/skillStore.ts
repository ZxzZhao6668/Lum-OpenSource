import { writingWorkspace } from '../projects/projectIdentity';
import { db,loadDoc,saveDoc } from '../data/db';
import corpus from './lum-writing-prompts.json';
import {advisorSkills} from './advisorSkills';
import characterAssetSkills from './characterAssetSkills.json';
import {creativeSkills} from './creativeSkills';
import {assetExtractionSkill} from './assetExtractionSkill';
import {previsSkills} from './previsSkills';
import {coverSkills,creativeGapSkills} from './coverSkills';
export const skillUses={rewrite:'改写',expand:'扩写',describe:'描写','cover-image':'封面生图','character-image':'人物生图','location-image':'地点生图','prop-image':'道具生图','storyboard-image':'分镜生图','video-prompt':'视频提示词','video-style':'视频风格','video-continuity':'视频一致性','storyboard-plan':'文字分镜','previs-action':'预演动作','previs-camera':'预演镜头',agent:'写作 Agent'} as const;
export type SkillUse=keyof typeof skillUses;
export interface WritingSkill {id:string;name:string;description:string;instruction:string;uses:SkillUse[];source:'laper-public'|'local'|'imported';collection?:string;advisor?:boolean;sources?:{title:string;url:string}[]}
export const SKILL_PREFIX='writing:skill:';
const writing:SkillUse[]=['rewrite','expand','describe','agent'];
const styleSkillIds = new Set(['local-original', ...Object.keys(corpus.stylePresets).map(id => 'laper-' + id)]);
const builtins:WritingSkill[]=[
 ...advisorSkills,
 {id:'local-original',name:'保持原文风格',description:'延续现有语气与事实',instruction:'延续原文人称、时态、事实与人物口吻，遵守本次操作要求。',uses:writing,source:'local'},
 ...Object.entries(corpus.stylePresets).map(([id,s])=>({id:`laper-${id}`,name:s.name,description:'Lum 写作文风预设',instruction:s.prompt,uses:writing,source:'local' as const})),
 ...(['character','location','prop'] as const).map(kind=>({id:`local-${kind}`,name:({character:'人物设定图',location:'场景空间图',prop:'道具设计图'})[kind],description:'本地生图 Skill',instruction:({character:'根据人物设定制作清晰人物设定图，明确五官、年龄、发型、衣着与辨识特征，单个人物主体，不添加文字水印。',location:'根据地点设定制作场景空间图，明确建筑、地形、时代、光线和空间层次，不擅自加入主角，不添加文字水印。',prop:'根据道具设定制作道具设计图，明确材质、比例、结构、使用痕迹与辨识特征，简洁背景，不添加文字水印。'})[kind],uses:[`${kind}-image` as SkillUse],source:'local' as const})),
 {id:'local-storyboard',name:'单镜头电影分镜',description:'参考共用资产图，保持人物、地点和道具一致',instruction:'将当前镜头转化为一张电影感单帧画面。严格对应参考图中的人物五官、服饰、地点结构和道具外观，按镜头描述安排景别、机位、构图、动作和光线。只描绘当前镜头，不生成多格漫画、拼贴分镜板、镜头表、字幕或文字水印；不把整场剧情塞进一张图。',uses:['storyboard-image'],source:'local'},
 ...characterAssetSkills as WritingSkill[],
 ...creativeSkills,
 assetExtractionSkill,
 ...previsSkills,
 ...coverSkills,
 ...creativeGapSkills,
];
export function validateSkill(value:unknown):WritingSkill {
 const s=value as WritingSkill;
 if(!s||typeof s.id!=='string'||!/^[\w-]{1,100}$/.test(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>120||typeof s.description!=='string'||s.description.length>2000||typeof s.instruction!=='string'||!s.instruction.trim()||s.instruction.length>60000||s.instruction.includes('\0')||!Array.isArray(s.uses)||!s.uses.length||s.uses.some(u=>!Object.hasOwn(skillUses,u))||new Set(s.uses).size!==s.uses.length||!['laper-public','local','imported'].includes(s.source))throw Error('Skill 格式无效：检查名称、正文与功能分配');
 if(s.advisor!==undefined&&typeof s.advisor!=='boolean'||s.sources!==undefined&&(!Array.isArray(s.sources)||s.sources.length>20||s.sources.some(r=>!r||typeof r.title!=='string'||r.title.length>200||typeof r.url!=='string'||r.url.length>2000||!/^https:\/\//.test(r.url))))throw Error('Skill 来源信息无效');
 if(s.collection!==undefined&&(typeof s.collection!=='string'||!s.collection.trim()||s.collection.length>80))throw Error('Skill 技能包名称无效');
 return structuredClone(s);
}
/** Historical Agent methods are self-contained and may outlive the current Skill catalog. */
export function validateAgentSkillSnapshot(value: unknown): WritingSkill {
  const fields = ['id', 'name', 'description', 'instruction', 'uses', 'source', 'collection', 'advisor', 'sources'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw Error('写作 Skill 快照格式无效。');
  const skill = validateSkill(value);
  if (!skill.uses.includes('agent') || skill.sources?.some(source => Object.keys(source).some(key => key !== 'title' && key !== 'url')))
    throw Error('写作 Skill 快照用途或资料来源无效。');
  return skill;
}
/** Catalog sources can include extra metadata. New snapshots use the declared fields. */
export function captureAgentSkillSnapshot(skill: WritingSkill): WritingSkill {
  const { id, name, description, instruction, uses, source, collection, advisor, sources } = skill;
  return validateAgentSkillSnapshot({
    id, name, description, instruction, uses, source,
    ...(collection !== undefined ? { collection } : {}),
    ...(advisor !== undefined ? { advisor } : {}),
    ...(sources !== undefined ? { sources: sources.map(({ title, url }) => ({ title, url })) } : {}),
  });
}
export function validateSkillRecords(rows:{key:string;payload:unknown}[]){
 const imported=rows.filter(r=>r.key.startsWith(SKILL_PREFIX));const ids=new Set(builtins.map(s=>s.id));for(const row of imported){const skill=validateSkill(row.payload);if(row.key!==SKILL_PREFIX+skill.id||ids.has(skill.id)||skill.source!=='imported')throw Error('Skill 记录冲突或来源无效');ids.add(skill.id);}if(imported.length>200)throw Error('项目最多200个导入 Skill，内置技能不占额度');
 const assignments=rows.find(r=>r.key==='writing:skillAssignments')?.payload??{};if(!assignments||typeof assignments!=='object'||Array.isArray(assignments))throw Error('Skill 功能分配无效');
 for(const [id,uses]of Object.entries(assignments)){if(!ids.has(id)||!Array.isArray(uses)||!uses.length||uses.some(use=>typeof use!=='string'||!Object.hasOwn(skillUses,use))||new Set(uses).size!==uses.length)throw Error('Skill 功能分配包含无效用途或不存在的 Skill');}
 for(const row of rows.filter(r=>r.key.startsWith('writing:skillDefault:'))){const use=row.key.slice('writing:skillDefault:'.length);if(!Object.hasOwn(skillUses,use)||typeof row.payload!=='string'||!ids.has(row.payload))throw Error('Skill 默认选择无效');}
}
export const isWritingUse = (use: SkillUse) => writing.includes(use);
export async function listSkills(use?:SkillUse, textOnly = writingWorkspace && !!use && isWritingUse(use)) {
 const imported=(await db.docs.where('key').startsWith(SKILL_PREFIX).toArray()).map(r=>{const s=validateSkill(r.payload);if(r.key!==SKILL_PREFIX+s.id)throw Error('Skill ID 不匹配');return s;});
 const assignments=await loadDoc<Record<string,SkillUse[]>>('writing:skillAssignments')??{};
 return [...builtins,...imported]
   .filter(s => !textOnly || (s.id !== 'advisor-storyboard' && s.uses.every(isWritingUse)))
   .map(s => {
     // Agent has a separate style control. Keep explicit project assignments and the production catalog.
     const uses = assignments[s.id] ?? (textOnly && styleSkillIds.has(s.id) ? s.uses.filter(use => use !== 'agent') : s.uses);
     return validateSkill({...s, uses});
   })
   .filter(s => (!textOnly || s.uses.some(isWritingUse)) && (!use || s.uses.includes(use)));

}
export async function getSkill(id:string,use:SkillUse){const skill=(await listSkills(use)).find(s=>s.id===id);if(!skill)throw Error('此 Skill 不适用于当前功能，请重新选择');return skill;}
function classify(text:string):SkillUse[]{
 const result:SkillUse[]=[];
 const heading=text.split('\n').slice(0,2).join(' ');
 if(/封面|cover[- ]?image|book[- ]?cover/i.test(heading))return ['cover-image'];
 if(/预演|白模|白膜|previs/i.test(heading))return /镜头|机位|运镜|camera/i.test(heading)?['previs-camera']:['previs-action'];
 if(/文字分镜|镜头表|分镜编排|shot list/i.test(heading))return ['storyboard-plan','agent'];
 if(/视频|video|seedance|minimax|hailuo/i.test(heading)&&!/分镜图|生图|图像|image prompt/i.test(heading))return [/一致性|continuity|consistency/i.test(heading)?'video-continuity':/风格库|style library/i.test(heading)?'video-style':'video-prompt','agent'];
 if(/生图|图像|image|portrait|illustrat|render|设计图|设定图|分镜|storyboard/i.test(text)){
  if(/分镜|storyboard/i.test(text))result.push('storyboard-image');
  if(/人物|角色|character|portrait/i.test(text))result.push('character-image');
  if(/地点|场景|环境|location|environment|landscape/i.test(text))result.push('location-image');
  if(/道具|物品|prop|object/i.test(text))result.push('prop-image');
  if(!result.length)result.push('character-image','location-image','prop-image','storyboard-image');
 }else{if(/改写|rewrite/i.test(text))result.push('rewrite');if(/扩写|expand/i.test(text))result.push('expand');if(/描写|describe/i.test(text))result.push('describe');if(!result.length)result.push(...writing);}
 return result;
}
export async function importSkills(filename:string,text:string):Promise<WritingSkill[]> {
 if(text.length>600000)throw Error('Skill 文件过大，最多600000字符');
 let values:unknown[];
 if(/\.json$/i.test(filename)){const v=JSON.parse(text);values=Array.isArray(v)?v:[v];}
 else if(/\.(md|markdown|txt)$/i.test(filename)){
  const front=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);const metadata:Record<string,string>={};
  for(const line of front?.[1].split(/\r?\n/)??[]){const m=/^(name|description|uses|collection):\s*(.+)$/.exec(line);if(m)metadata[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
  const instruction=front?text.slice(front[0].length):text;values=[{name:metadata.name??filename.replace(/\.[^.]+$/,''),description:metadata.description??'',instruction,...(metadata.collection?{collection:metadata.collection}:{}),...(metadata.uses?{uses:metadata.uses.replace(/^\[|\]$/g,'').split(',').map(x=>x.trim().replace(/^['"]|['"]$/g,''))}:{})}];
 }else throw Error('请选择 Markdown、TXT 或 JSON Skill 文件');
 if(!values.length||values.length>100)throw Error('单次导入1—100个 Skill');
 const parsed=values.map(v=>{const s=v as Partial<WritingSkill>;return validateSkill({id:crypto.randomUUID(),name:s?.name,description:s?.description??'',instruction:s?.instruction,uses:s?.uses??classify(`${s?.name}\n${s?.description}\n${s?.instruction}`),source:'imported',...(s?.collection!==undefined?{collection:s.collection}:{}),...(s?.advisor!==undefined?{advisor:s.advisor}:{}),...(s?.sources!==undefined?{sources:s.sources}:{})});});
 const result:WritingSkill[]=[];
 await db.transaction('rw',db.docs,async()=>{const existing=await listSkills();for(const skill of parsed){const duplicate=existing.find(s=>s.name===skill.name&&s.instruction===skill.instruction&&JSON.stringify(s.uses)===JSON.stringify(skill.uses));if(duplicate){result.push(duplicate);continue;}if(existing.filter(s=>s.source==='imported').length>=200)throw Error('项目最多200个导入 Skill，内置技能不占额度');await saveDoc(SKILL_PREFIX+skill.id,skill);existing.push(skill);result.push(skill);}});
 window.dispatchEvent(new Event('dsh:skills-changed'));return result;
}
export async function assignSkill(id:string,uses:SkillUse[]){
 await db.transaction('rw',db.docs,async()=>{const s=(await listSkills()).find(s=>s.id===id);if(!s)throw Error('Skill 已不存在');validateSkill({...s,uses});const assignments=await loadDoc<Record<string,SkillUse[]>>('writing:skillAssignments')??{};assignments[id]=uses;await saveDoc('writing:skillAssignments',assignments);});window.dispatchEvent(new Event('dsh:skills-changed'));
}
export async function removeSkill(id:string){if(builtins.some(s=>s.id===id))throw Error('内置 Skill 不能删除，可调整用途');await db.transaction('rw',db.docs,async()=>{await db.docs.delete(SKILL_PREFIX+id);const assignments=await loadDoc<Record<string,SkillUse[]>>('writing:skillAssignments')??{};delete assignments[id];await saveDoc('writing:skillAssignments',assignments);for(const use of Object.keys(skillUses))if(await loadDoc(`writing:skillDefault:${use}`)===id)await db.docs.delete(`writing:skillDefault:${use}`);});window.dispatchEvent(new Event('dsh:skills-changed'));}
export async function preferredSkill(use:SkillUse, skills?: WritingSkill[]){
 const id = await loadDoc<string>(`writing:skillDefault:${use}`);
 const available = skills ?? await listSkills(use);
 const preferred = available.find(s => s.id === id);
 if (writingWorkspace && use === 'agent') return preferred;
 return preferred ?? available.find(s => s.id === 'local-original') ?? available[0];
}
export async function rememberSkill(use:SkillUse,id:string){
 const key = `writing:skillDefault:${use}`;
 await db.transaction('rw', db.docs, async () => {
   if (writingWorkspace && use === 'agent' && !id) { await db.docs.delete(key); return; }
   await getSkill(id,use);
   await saveDoc(key,id);
 });
}
