export interface Beat { id:string; name:string; description:string; startTime:number; endTime:number; color:string }
export const beatColors=['#d9e8d5','#d4e5ee','#e4d5e8','#f0ddce','#eee6bd','#d4e7e2'];
const fields=['id','name','description','startTime','endTime','color'];
function object(value:unknown,keys:string[]) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('节拍参数含无效字段');
  return value as Record<string,unknown>;
}
function text(value:unknown,max:number,empty=false) {if(typeof value!=='string'||value.length>max||value.includes('\0')||!empty&&!value.trim())throw Error('节拍文字无效');return value;}
function id(value:unknown){const s=text(value,200);if(!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s))throw Error('节拍ID无效');return s;}
function beat(value:unknown):Beat {
  const a=object(value,fields),start=a.startTime,end=a.endTime;
  if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>10000)throw Error('节拍起止分钟无效：结束必须大于开始，且不超过10000分钟');
  if(typeof a.color!=='string'||!/^#[\da-f]{6}$/i.test(a.color))throw Error('节拍颜色无效');
  // Validation must preserve stored text so reloading cannot change the CAS baseline.
  return {id:id(a.id),name:text(a.name,120),description:text(a.description,20000,true),startTime:start,endTime:end,color:a.color};
}
export function validateBeats(value:unknown):Beat[] {
  if(!Array.isArray(value)||value.length>500)throw Error('每章最多500条节拍');
  const result=value.map(beat);if(new Set(result.map(b=>b.id)).size!==result.length)throw Error('节拍ID不能重复');return result;
}
function list(value:unknown,max=500){if(!Array.isArray(value)||!value.length||value.length>max)throw Error('节拍操作列表为空或过长');return value;}
export function changeBeats(before:Beat[],input:unknown):Beat[] {
  const raw=object(input,['op','beats','beatIds','orderedIds']),op=raw.op;
  const a=object(input,op==='add'||op==='update'?['op','beats']:op==='delete'?['op','beatIds']:['op','orderedIds']);
  let next=structuredClone(before);validateBeats(next);
  if(op==='add'){
    for(const item of list(a.beats,100)){
      const b=object(item,fields.filter(key=>key!=='id')),start=b.startTime??Math.ceil(next.at(-1)?.endTime??0);
      next.push(beat({id:crypto.randomUUID(),name:b.name,description:b.description??'',startTime:start,endTime:b.endTime??Number(start)+10,color:b.color??beatColors[next.length%beatColors.length]}));
    }
  }else if(op==='update'){
    const seen=new Set<string>();for(const item of list(a.beats,100)){
      const patch=object(item,fields),key=id(patch.id),at=next.findIndex(b=>b.id===key);
      if(at<0||seen.has(key)||Object.keys(patch).length<2)throw Error('节拍不存在、重复修改或无修改字段');seen.add(key);next[at]=beat({...next[at],...patch});
    }
  }else if(op==='delete'||op==='reorder'){
    const ids=list(op==='delete'?a.beatIds:a.orderedIds).map(id);
    if(new Set(ids).size!==ids.length||ids.some(key=>!next.some(b=>b.id===key)))throw Error('节拍ID不存在或重复');
    if(op==='reorder'&&ids.length!==next.length)throw Error('排序必须包含当前章全部节拍');
    next=op==='delete'?next.filter(b=>!ids.includes(b.id)):ids.map(key=>next.find(b=>b.id===key)!);
  }else throw Error('节拍操作无效');
  return validateBeats(next);
}
