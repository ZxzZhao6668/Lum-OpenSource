import { db } from '../data/db';
import { writingStyles } from './styles';
import {getSkill} from '../skills/skillStore';
import {extractProjectDocument} from './documentImport';

export const FILE_PREFIX='project:file:';
export const FILE_LIMITS={bytes:2*1024*1024,totalBytes:20*1024*1024,count:100};
export interface ProjectFile {id:string;name:string;text:string;bytes:number;encoding:string;hash:string;revision:number;createdAt:number;updatedAt:number;advisorId?:string;archivedAt?:number}
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function projectFileId(value:unknown):string{if(typeof value!=='string'||!idPattern.test(value))throw Error('资料ID无效，请先列出项目资料');return value;}
function fileName(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>200||/[\\/:<>|"*?\u0000-\u001f]/.test(value))throw Error('资料名称无效');return value.trim();}
function advisor(value:unknown):string|undefined{if(value===undefined||value==='')return undefined;if(typeof value!=='string'||!/^[\w-]{1,100}$/.test(value))throw Error('顾问标识无效');return value;}
async function existingAdvisor(value:unknown){const id=advisor(value);if(id&&!writingStyles.some(s=>s.id===id))await getSkill(id,'agent');return id;}
export function validateProjectFile(value:unknown,id?:string):ProjectFile{
  if(!value||typeof value!=='object')throw Error('资料记录损坏');const file=value as ProjectFile;projectFileId(file.id);
  if(id!==undefined&&id!==file.id)throw Error('资料记录ID不一致');fileName(file.name);advisor(file.advisorId);
  if(typeof file.text!=='string'||file.text.includes('\0')||file.text.length>FILE_LIMITS.bytes||typeof file.encoding!=='string'||file.encoding.length>30||typeof file.hash!=='string'||!/^[a-f0-9]{64}$/.test(file.hash)||!Number.isSafeInteger(file.revision)||file.revision<1||![file.createdAt,file.updatedAt,file.archivedAt??0,file.bytes].every(n=>Number.isFinite(n)&&n>=0)||file.bytes>FILE_LIMITS.bytes||new TextEncoder().encode(file.text).byteLength!==file.bytes)throw Error('资料内容或元数据无效');return file;
}
export async function listProjectFiles(includeArchived=false){
  return (await db.docs.where('key').startsWith(FILE_PREFIX).toArray()).map(row=>validateProjectFile(row.payload,row.key.slice(FILE_PREFIX.length))).filter(file=>includeArchived||!file.archivedAt).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
}
export async function getProjectFile(id:unknown,includeArchived=false){const key=projectFileId(id),row=await db.docs.get(FILE_PREFIX+key);if(!row)throw Error('当前项目中没有这份资料');const file=validateProjectFile(row.payload,key);if(file.archivedAt&&!includeArchived)throw Error('资料已归档，请先恢复');return file;}
export function projectFileMetadata(file:ProjectFile){return {id:file.id,name:file.name,bytes:file.bytes,encoding:file.encoding,revision:file.revision,createdAt:file.createdAt,updatedAt:file.updatedAt,advisorId:file.advisorId,archivedAt:file.archivedAt,totalChars:file.text.length,totalLines:file.text.split(/\r?\n/).length};}
export async function importProjectFile(input:File,advisorId?:string){
  const name=fileName(input.name),owner=await existingAdvisor(advisorId);
  if(!/\.(txt|md|markdown|csv|json|pdf|docx)$/i.test(name))throw Error('支持 TXT、Markdown、CSV、JSON、PDF、DOCX 资料');
  let encoding='UTF-8',text:string;
  if(/\.(pdf|docx)$/i.test(name)){({text,encoding}=await extractProjectDocument(input));}
  else{
  if(!input.size||input.size>FILE_LIMITS.bytes)throw Error('单份文本资料须为1字节至2MiB');
  const bytes=new Uint8Array(await input.arrayBuffer());
  if(bytes[0]===255&&bytes[1]===254){encoding='UTF-16LE';text=new TextDecoder('utf-16le',{fatal:true}).decode(bytes);}
  else if(bytes[0]===254&&bytes[1]===255){encoding='UTF-16BE';text=new TextDecoder('utf-16be',{fatal:true}).decode(bytes);}
  else{try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{encoding='GB18030';text=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}}
  }
  if(text.includes('\0'))throw Error('资料包含二进制内容，未导入');
  const encoded=new TextEncoder().encode(text);if(encoded.byteLength>FILE_LIMITS.bytes)throw Error('转为文本后超过2MiB，未导入');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))).map(x=>x.toString(16).padStart(2,'0')).join('');
  return db.transaction('rw',db.docs,async()=>{
    const all=await listProjectFiles(true),same=all.find(f=>f.hash===hash&&f.text===text&&f.name===name&&f.advisorId===owner&&!f.archivedAt);if(same)return same;
    if(all.length>=FILE_LIMITS.count||all.reduce((sum,f)=>sum+f.bytes,0)+encoded.byteLength>FILE_LIMITS.totalBytes)throw Error('项目资料上限为100份、20MiB（含归档资料）');
    const now=Date.now(),file:ProjectFile={id:crypto.randomUUID(),name,text,bytes:encoded.byteLength,encoding,hash,revision:1,createdAt:now,updatedAt:now,...(owner?{advisorId:owner}:{})};
    await db.docs.add({key:FILE_PREFIX+file.id,payload:file,updatedAt:now});return file;
  });
}
export async function updateProjectFile(id:string,revision:number,patch:{name?:string;advisorId?:string;archived?:boolean}){
  return db.transaction('rw',db.docs,async()=>{
    const file=await getProjectFile(id,true);if(file.revision!==revision)throw Error('资料已在其他窗口修改，请重新打开后操作');
    if(patch.name!==undefined)file.name=fileName(patch.name);
    if('advisorId' in patch && advisor(patch.advisorId) !== file.advisorId)
      file.advisorId=await existingAdvisor(patch.advisorId);
    if(patch.archived!==undefined)file.archivedAt=patch.archived?Date.now():undefined;
    file.revision++;file.updatedAt=Date.now();await db.docs.put({key:FILE_PREFIX+id,payload:file,updatedAt:file.updatedAt});return file;
  });
}
