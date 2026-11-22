import {db,type DocRow} from '../data/db';
export interface Inspiration {id:string;text:string;time:number;images?:string[]}
const MiB=1024*1024;
export function validateInspirationImages(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>6)throw Error('灵感图片须为最多6张图片的列表');
 for(const image of value){if(typeof image!=='string'||image.length>Math.ceil(4*MiB*4/3)+128)throw Error('灵感单张图片最多4MiB');const match=/^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/.exec(image);if(!match||!match[1]||match[1].length%4!==0)throw Error('灵感图片记录无效');}
 return [...value];
}
export function validateInspirations(value:unknown):Inspiration[]{
 if(!Array.isArray(value)||value.length>5000)throw Error('灵感列表记录无效');const ids=new Set<string>();
 for(const item of value){if(!item||typeof item.id!=='string'||!item.id||item.id.length>200||ids.has(item.id)||typeof item.text!=='string'||item.text.length>50000||!Number.isFinite(item.time)||item.time<0)throw Error('灵感内容记录无效');if(item.images!==undefined)validateInspirationImages(item.images);ids.add(item.id);}return value;
}
export function validateInspirationDoc(key:string,value:unknown){
 if(key.startsWith('inspiration:draftImages:'))validateInspirationImages(value);
 else if(key.startsWith('inspiration:draft:')){if(typeof value!=='string'||value.length>50000)throw Error('灵感草稿无效');}
 else if(key.startsWith('inspiration:'))validateInspirations(value);
}
/** Account for both the next live value and its undo journal before committing.
 * The restore format has a100MiB character ceiling; retain10MiB headroom.
 * No old image/history is silently pruned to make room for a new write. */
export async function assertInspirationCapacity(updates:{key:string;after:unknown}[],journal?:{id:string}){
 const [current,entities]=await Promise.all([db.docs.toArray(),db.entities.toArray()]);const docs=new Map(current.filter(row=>row.key!=='workspace:beforeRestore').map(row=>[row.key,row]));
 for(const u of updates){if(u.after===undefined)docs.delete(u.key);else docs.set(u.key,{key:u.key,payload:u.after,updatedAt:Date.now()});}
 if(journal)docs.set(`writing:workspaceChange:${journal.id}`,{key:`writing:workspaceChange:${journal.id}`,payload:journal,updatedAt:Date.now()});
 let imageBytes=0;for(const row of docs.values()){if(!row.key.startsWith('inspiration:'))continue;validateInspirationDoc(row.key,row.payload);const images=row.key.startsWith('inspiration:draftImages:')?row.payload as string[]:row.key.startsWith('inspiration:draft:')?[]:(row.payload as Inspiration[]).flatMap(n=>n.images??[]);for(const image of images){const data=image.slice(image.indexOf(',')+1);imageBytes+=data.length*3/4-(data.endsWith('==')?2:data.endsWith('=')?1:0);}}
 if(imageBytes>9*MiB)throw Error('项目灵感图片累计最多9MiB（包含草稿），请移除部分图片后再保存');
 const total=JSON.stringify({format:'local-writing-workspace',version:1,createdAt:new Date().toISOString(),docs:[...docs.values()] as DocRow[],entities}).length;
 if(total>90*MiB)throw Error('本次修改及撤销记录会超过备份容量保护线，未写入。请先导出当前备份，再整理项目或在新项目中继续。');
}
