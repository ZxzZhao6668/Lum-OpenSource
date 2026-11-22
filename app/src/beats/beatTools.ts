import { type ToolDefinition,type ToolScope } from '../writing/writingTools';
import { scopedDocument,toolObject } from '../writing/structuredTools';
import { prepareWorkspaceChange } from '../writing/workspaceChanges';
import { changeBeats,validateBeats } from './beatModel';
const string={type:'string'},object=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export const beatTool:ToolDefinition={name:'editBeats',description:'按真实章节ID编辑独立节拍表。add新增name/description/startTime/endTime/color，时间单位分钟，默认接上一节末尾并延续10分钟；update必须先readEntities beats读取真实id，仅改所给字段；delete提供beatIds；reorder提供该章完整orderedIds。大纲中的Story Beats文字不等于节拍记录。节拍不会自动写入正文或分镜。',parameters:object({episodeId:string,op:{type:'string',enum:['add','update','delete','reorder']},beats:{type:'array',minItems:1,maxItems:100,items:object({id:string,name:{type:'string',maxLength:120},description:{type:'string',maxLength:20000},startTime:{type:'number',minimum:0},endTime:{type:'number',exclusiveMinimum:0,maximum:10000},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}})},beatIds:{type:'array',items:string},orderedIds:{type:'array',items:string}},['episodeId','op'])};
export async function prepareBeatTool(input:unknown,scope:ToolScope) {
  if(scope.readOnly||!scope.allowAppend)throw Error('修改节拍需要整章范围并开启写入模式');
  const a=toolObject(input,['episodeId','op','beats','beatIds','orderedIds']);const snapshot=await scopedDocument(a.episodeId,scope);
  const {episodeId,...edit}=a;
  return prepareWorkspaceChange('节拍编排',snapshot.episodeId,'13-beats',async draft=>{
    const key=`beats:${episodeId}`,before=validateBeats(await draft.doc(key)??[]),after=changeBeats(before,edit);await draft.setDoc(key,after);
    return {episodeId,beats:after,total:after.length};
  });
}
