import corpus from './lum-writing-prompts.json';
import {loadDoc} from '../data/db';
import {modal,node,action} from '../ui/localUi';
export const publicAutoPrompt=corpus.autoPrompt;
export async function openPublicPrompts(fill:(text:string)=>void){const kind=(await loadDoc<{kind:string}>('project:meta'))?.kind??'script';
 const groups=Object.entries(kind==='novel'?corpus.starters.novel:corpus.starters.script);const {dialog,body}=modal('写作提示库');body.append(node('p','选择提示后可在写作对话中修改并发送。','localMuted'));const category=node('select');category.setAttribute('aria-label','提示分类');for(const [key,group]of groups){const o=node('option',group.label);o.value=key;category.append(o);}const list=node('div','','localGrid');const render=()=>{list.replaceChildren();for(const prompt of groups.find(([key])=>key===category.value)?.[1].prompts??[])list.append(action(prompt,()=>{fill(prompt);dialog.close();}));};category.onchange=render;body.append(category,list);render();}
