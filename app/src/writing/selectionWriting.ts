import { createProposal,type DocumentSnapshot,type ScriptBlock,type SelectionProposalSource } from './documentStore';
export interface TextSelection {start:{id:string;offset:number};end:{id:string;offset:number};blocks:ScriptBlock[]}
export function selectionText(snapshot:DocumentSnapshot,selected:TextSelection){
 if(JSON.stringify(snapshot.blocks)!==JSON.stringify(selected.blocks))throw Error('选区原文已变化，请重新拉选文字');
 const first=snapshot.blocks.findIndex(b=>b.id===selected.start.id),last=snapshot.blocks.findIndex(b=>b.id===selected.end.id);
 if(first<0||last<first||!Number.isInteger(selected.start.offset)||!Number.isInteger(selected.end.offset)||selected.start.offset<0||selected.end.offset<0||selected.start.offset>snapshot.blocks[first].text.length||selected.end.offset>snapshot.blocks[last].text.length||first===last&&selected.start.offset>=selected.end.offset)throw Error('请先拉选需要处理的文字，单独放置光标不能写入');
 const result=snapshot.blocks.slice(first,last+1).map((b,i)=>b.text.slice(i===0?selected.start.offset:0,first+i===last?selected.end.offset:undefined)).join('\n');
 if(!result.trim())throw Error('选区没有可处理文字');return result;
}
export async function prepareSelectionChange(snapshot:DocumentSnapshot,selected:TextSelection,replacement:string,selectionRun?:SelectionProposalSource){
 selectionText(snapshot,selected);if(typeof replacement!=='string'||!replacement.trim()||replacement.length>100000||replacement.includes('\0'))throw Error('生成内容为空或过长，未替换原文');
 const first=snapshot.blocks.findIndex(b=>b.id===selected.start.id),last=snapshot.blocks.findIndex(b=>b.id===selected.end.id);const left=snapshot.blocks[first],right=snapshot.blocks[last];
 const lines=replacement.replace(/\r\n?/g,'\n').split('\n');const pieces:ScriptBlock[]=lines.map((text,i)=>({id:i===0?left.id:i===lines.length-1&&first!==last?right.id:crypto.randomUUID(),type:i===lines.length-1&&first!==last?right.type:left.type,text}));
 pieces[0].text=left.text.slice(0,selected.start.offset)+pieces[0].text;
 // Keep the end paragraph's stable identity, including when the model returns one line.
 if(first!==last&&pieces.length===1)pieces.push({...right,text:right.text.slice(selected.end.offset)});else pieces[pieces.length-1].text+=right.text.slice(selected.end.offset);
 return createProposal({episodeId:snapshot.episodeId,baseRevision:snapshot.revision,before:snapshot.blocks,selectionRun,after:[...snapshot.blocks.slice(0,first),...pieces,...snapshot.blocks.slice(last+1)]});
}
