import { executeWritingTool, type ToolScope } from './writingTools';

export const MAX_WRITING_ROUNDS=24;
export const MAX_WRITING_TOOLS=96;
export const WRITING_TOOL_BATCH_SIZE=8;
type Call={id:string;name:string;arguments:unknown};
type Result=Awaited<ReturnType<typeof executeWritingTool>>;

function canonical(value:unknown,depth=0):string {
  if(depth>50)throw Error('工具参数嵌套过深');
  if(Array.isArray(value))return '['+value.map(item=>canonical(item,depth+1)).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key],depth+1)).join(',')+'}';
  return JSON.stringify(value)??'null';
}

/** One user request owns the cache. Replayed receipts never execute a write again.
 * Only consecutive identical writes are coalesced; A→B→A remains a real edit. */
export class WritingToolRun {
  private completed=new Map<string,{signature:string;result:Result}>();
  private lastWrite?:{signature:string;result:Result};
  async execute(call:Call,scope:ToolScope):Promise<{result:Result;replayed:boolean}> {
    if(typeof call.id!=='string'||!call.id||typeof call.name!=='string')throw Error('工具调用ID或名称无效');
    if(scope.cancelled?.())throw Error('已停止，未执行工具');
    const signature=call.name+':'+canonical(call.arguments);
    const known=this.completed.get(call.id);
    if(known){if(known.signature!==signature)throw Error('同一工具调用ID不能使用不同参数');return {result:known.result,replayed:true};}
    if(this.lastWrite?.signature===signature){this.completed.set(call.id,this.lastWrite);return {result:this.lastWrite.result,replayed:true};}
    const result=await executeWritingTool(call.name,call.arguments,scope);
    const record={signature,result};this.completed.set(call.id,record);
    if(result.proposalId||result.contentProposalId||result.workspaceChangeId)this.lastWrite=record;
    return {result,replayed:false};
  }
}

/** A stopped provider message may have unexecuted calls. Pair them with explicit
 * interruption results before any later user turn; never automatically replay. */
export function closeInterruptedCalls(messages:unknown[]) {
  const repaired:unknown[]=[];
  for(let i=0;i<messages.length;i++){
    const message=messages[i] as {role?:string;content?:unknown};repaired.push(message);
    if(message.role!=='assistant'||!Array.isArray(message.content))continue;
    const calls=message.content.filter((part):part is Call=>part?.type==='toolCall');
    const results=[];
    while((messages[i+1] as {role?:string}|undefined)?.role==='toolResult')results.push(messages[++i] as {toolCallId?:string});
    repaired.push(...results);
    for(const call of calls)if(!results.some(result=>result.toolCallId===call.id))repaired.push({role:'toolResult',toolCallId:call.id,toolName:call.name,content:[{type:'text',text:'上次执行中断，结果未确认。请先读取当前文档和已有记录，不能假定失败后重复新增。'}],isError:true,timestamp:Date.now()});
  }
  return repaired;
}
