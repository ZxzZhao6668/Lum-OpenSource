import { chooseShotSetup, confirmShotAppearanceLocks, shotStyleLabel } from '../scriptSetup/shotSetup';
import {db,loadDoc,saveDoc} from '../data/db';
import {listSkills} from '../skills/skillStore';
import {listTextModels,cancelWriting} from '../writing/writingClient';
import {node,modal,action,field} from '../ui/localUi';
import {showToast} from '../ui/toast';
import {lumRequest} from './lumClient';
import {readImageDefaults,fillImageDimension,fillImageModels} from './imageDefaults';
import {imageStyles,applyImageStyle,imageStyleId} from './imageStyles';
import {optimizeImagePrompt,type ImagePromptDraft} from './imagePromptOptimization';
import {initializeGeneration,prepareShotPrompt,startGeneration,hasActiveTask,getShotGeneration,subscribeGeneration,type GenerationConfig,type ImageModel} from './generationState';
import type {Shot} from './storyboard';
import {readDocument} from '../writing/documentStore';
import {storyScenes} from './shotModel';
import {shotSceneFilter} from './shotSceneFilter';
import '../entities/entityBatch.css';

/** Batch selection is a snapshot of one episode; each generated prompt and job
 * still belongs to its real shot and uses the ordinary generation lifecycle. */
export async function openShotBatch(episodeId:string,shots:Shot[],initialSceneId=''){
 const {dialog,body}=modal('分镜批量管理');dialog.classList.add('entityBatchDialog');
 const status=node('p','正在读取分镜和模型…','entityBatchStatus');status.setAttribute('role','status');body.append(status);
 let stopped=false,busy=false;const requests=new Set<string>();let unsubscribe=()=>{};
 dialog.addEventListener('close',()=>{stopped=true;unsubscribe();for(const id of requests)void cancelWriting(id).catch(()=>{});},{once:true});
 try{
  const currentShots=await loadDoc<Shot[]>(`storyboard:${episodeId}`)??[];
  if(shots.some(shot=>!currentShots.some(current=>current.id===shot.id)))throw Error('部分分镜已删除，请重新打开批量管理');
  const filter=shotSceneFilter(storyScenes((await readDocument(episodeId)).blocks),shots,initialSceneId);
  await initializeGeneration();const [skills,textModels,response,defaults]=await Promise.all([listSkills('storyboard-image'),listTextModels(),lumRequest<{models:ImageModel[]}>('models'),readImageDefaults()]);
  if(!dialog.isConnected)return;
  const imageModels=response.models.filter(m=>m.type==='image');
  const settings=node('section','','entityBatchSettings');
  const makeSelect=(label:string)=>{const wrap=node('label',label),select=node('select');select.setAttribute('aria-label',label);wrap.append(select);settings.append(wrap);return select;};
  const skill=makeSelect('统一 Skill');for(const item of skills){const o=node('option',item.name);o.value=item.id;skill.append(o);}
  const style=makeSelect('图片风格');for(const item of imageStyles){const o=node('option',item.id ? item.name : '使用镜头固定画风');o.value=item.id;style.append(o);}
  const textModel=makeSelect('提示词优化模型');for(const [i,m] of textModels.entries()){const o=node('option',`${m.providerLabel} · ${m.label||m.modelId}`);o.value=String(i);textModel.append(o);}if(!textModels.length){const o=node('option','请先配置文本模型');o.value='';textModel.append(o);}
  const preferred=localStorage.getItem('writing:preferredModel'),idx=textModels.findIndex(m=>JSON.stringify([m.providerId,m.modelId])===preferred);if(idx>=0)textModel.value=String(idx);
  const imageModel=makeSelect('生图模型'),ratio=makeSelect('画幅比例'),size=makeSelect('图片尺寸');fillImageModels(imageModel,imageModels,defaults);
  const dimensions=()=>{const m=imageModels[Number(imageModel.value)];fillImageDimension(ratio,m?.imageRatios,defaults.ratio);fillImageDimension(size,m?.imageSizes,defaults.size);};dimensions();imageModel.onchange=dimensions;
  const extra=field('统一补充要求','',true);extra.input.maxLength=12000;
  type Item={shot:Shot;card:HTMLElement;check:HTMLInputElement;output:HTMLTextAreaElement;status:HTMLElement;origin:HTMLElement;draft?:ImagePromptDraft;persisted?:ImagePromptDraft;generation?:string};
  const list=node('section','','entityBatchList'),items:Item[]=[];
  for(const shot of shots){const card=node('article','','entityBatchItem'),label=node('label'),check=node('input');check.type='checkbox';check.setAttribute('aria-label',`选择 ${shot.no}`);label.append(check,node('strong',shot.no));const text=node('p',shot.desc||'未填写画面描述','localMuted');const output=node('textarea');output.setAttribute('aria-label',`${shot.no} 的提示词`);const itemStatus=node('p','待选择','entityBatchItemStatus');itemStatus.dataset.shotBatchStatus=shot.id;const origin=node('p',shotStyleLabel(shot.setupSnapshot),'localMuted');card.append(label,text,origin,itemStatus,output);list.append(card);const item:Item={shot,card,check,output,origin,status:itemStatus};items.push(item);output.oninput=()=>{if(item.draft)item.draft.text=output.value;};}
  for(const item of items){const draft=await loadDoc<ImagePromptDraft>(`image:prompt:${item.shot.id}`);if(draft?.sourceHash&&draft.text){item.draft=structuredClone(draft);item.persisted=structuredClone(draft);item.output.value=draft.text;item.status.textContent='已恢复提示词，请检查';}}
  const first=items.find(item=>item.draft)?.draft;if(first){if([...skill.options].some(option=>option.value===first.skillId))skill.value=first.skillId;style.value=imageStyleId(first.requirements);extra.input.value=applyImageStyle(first.requirements,'');}
  const visible=()=>items.filter(i=>filter.matches(i.shot));
  const selected=()=>visible().filter(i=>i.check.checked);
  const count=node('p','','entityBatchHint'),empty=node('p','本场暂无分镜，可先在分镜板点击本场“自动分镜”。','shotSceneEmpty');list.append(empty);
  function updateSelection(){for(const item of items)item.card.hidden=!filter.matches(item.shot);const shown=visible();count.textContent=`当前显示 ${shown.length} 镜 · 已选 ${selected().length} 镜。全选、优化和生成仅处理当前显示的分镜。`;empty.hidden=shown.length>0;all.disabled=none.disabled=busy||!shown.length;optimize.disabled=generate.disabled=busy||!selected().length;}
  filter.select.onchange=updateSelection;for(const item of items)item.check.onchange=updateSelection;
  const update=()=>{if(!dialog.isConnected)return;for(const item of items){const task=item.generation?getShotGeneration(item.shot.id).history.find(h=>h.taskId===item.generation):undefined;if(task?.state==='succeeded')item.status.textContent='图片已完成，已更新分镜';else if(task&&['failed','interrupted','cancelled'].includes(task.state))item.status.textContent=`${task.state==='failed'?'生成失败':task.state==='interrupted'?'任务中断':'已取消'}：${task.message??''}`;}};
  unsubscribe=subscribeGeneration(update);
  const actions=node('div','','entityBatchActions');
  const all=action('全选分镜',()=>{for(const i of visible())i.check.checked=true;updateSelection();});const none=action('取消选择',()=>{for(const i of visible())i.check.checked=false;updateSelection();});
  const freeze = async (items: Item[]) => {
   await chooseShotSetup(episodeId,items.map(i=>i.shot.id),{alive:()=>!stopped&&dialog.open});
   const latest = await loadDoc<Shot[]>(`storyboard:${episodeId}`) ?? [];
   for (const item of items) {
    const shot = latest.find(shot=>shot.id===item.shot.id);
    if (!shot) throw Error('镜头已删除，请重新打开批量管理');
    item.shot=shot;item.origin.textContent=shotStyleLabel(shot.setupSnapshot);
   }
   await confirmShotAppearanceLocks(items.map(i=>i.shot));
  };
  const optimize=action('批量优化提示词',async()=>{
   const chosen=selected(),model=textModels[Number(textModel.value)];if(!chosen.length)throw Error('请先选择分镜');if(!model)throw Error('请选择文本模型');if(!skill.value)throw Error('请选择 Skill');
   stopped=false;busy=true;setBusy();let next=0;
   const worker=async()=>{while(!stopped&&dialog.isConnected){const item=chosen[next++];if(!item)return;let requestId='';try{
    item.status.textContent='正在优化…';const requirements=applyImageStyle(extra.input.value,style.value);const before=await loadDoc<ImagePromptDraft>(`image:prompt:${item.shot.id}`);
    const source=await prepareShotPrompt(item.shot,true,skill.value,requirements);if(stopped||!dialog.isConnected)return;
    requestId=crypto.randomUUID();requests.add(requestId);const value=await optimizeImagePrompt(source,model,requestId);if(stopped||!dialog.isConnected)return;
    const current=await prepareShotPrompt(item.shot,true,skill.value,requirements);if(current.sourceHash!==source.sourceHash)throw Error('分镜或资产已变化，请重新优化');
    const draft:ImagePromptDraft={skillId:source.skillId,requirements:source.requirements,sourceHash:source.sourceHash,text:value,textModel:JSON.stringify([model.providerId,model.modelId])};
    await db.transaction('rw',db.docs,async()=>{if(stopped||!dialog.isConnected)throw Error('操作已停止');if(JSON.stringify(await loadDoc(`image:prompt:${item.shot.id}`))!==JSON.stringify(before))throw Error('提示词已在其他窗口修改，请重新打开');await saveDoc(`image:prompt:${item.shot.id}`,draft);});
    item.draft=draft;item.persisted=structuredClone(draft);item.output.value=value;item.status.textContent='优化完成，可检查或编辑';
   }catch(e){if(dialog.isConnected)item.status.textContent=stopped?'已停止':`优化失败：${e instanceof Error?e.message:String(e)}`;}finally{if(requestId)requests.delete(requestId);}}};
   try{await freeze(chosen);await Promise.all(Array.from({length:Math.min(12,chosen.length)},()=>worker()));}finally{busy=false;setBusy();}
  });
  const generate=action('批量生成分镜图',async()=>{
   const chosen=selected(),m=imageModels[Number(imageModel.value)];if(!chosen.length)throw Error('请先选择分镜');if(!m)throw Error('请选择生图模型');
   const config:GenerationConfig={providerId:m.providerId,modelId:m.modelId,...ratio.value?{ratio:ratio.value}:{},...size.value?{size:size.value}:{}};
   stopped=false;busy=true;setBusy();
   try{await freeze(chosen);await Promise.all(chosen.map(async item=>{try{
    if(!item.draft||!item.output.value.trim())throw Error('请先批量优化并检查提示词');if(hasActiveTask(item.shot.id))throw Error('已有任务，请查看生成历史');
    const saved=item.draft;const requirements=applyImageStyle(extra.input.value,style.value);
    if(saved.skillId!==skill.value||saved.requirements!==requirements)throw Error('Skill 或风格已变化，请重新优化');
    const reviewed={...saved,text:item.output.value,includeContext:true};
    await db.transaction('rw',db.docs,async()=>{if(stopped||!dialog.isConnected)throw Error('操作已停止');if(JSON.stringify(await loadDoc(`image:prompt:${item.shot.id}`))!==JSON.stringify(item.persisted))throw Error('提示词已在其他窗口修改，请重新打开');await saveDoc(`image:prompt:${item.shot.id}`,{...saved,text:reviewed.text});});
    item.persisted={...saved,text:reviewed.text};item.status.textContent='正在提交…';await startGeneration(item.shot,config,'',reviewed,()=>!stopped&&dialog.isConnected);
    const task=getShotGeneration(item.shot.id).history[0];item.generation=task?.taskId;item.status.textContent=task?.state==='failed'?`生成失败：${task.message??''}`:'已提交，等待图片生成';
   }catch(e){if(dialog.isConnected)item.status.textContent=`未提交：${e instanceof Error?e.message:String(e)}`;}}));}finally{busy=false;setBusy();update();}
  });
  const stop=action('停止后续操作',async()=>{stopped=true;await Promise.allSettled([...requests].map(id=>cancelWriting(id)));status.textContent='已停止；已提交的图片任务继续保留。';});
  function setBusy(){for(const element of [all,none,optimize,generate,filter.select,skill,style,textModel,imageModel,ratio,size,extra.input,...items.map(i=>i.check),...items.map(i=>i.output)])element.disabled=busy;stop.disabled=!busy;updateSelection();}
  actions.append(all,none,optimize,generate,stop);body.replaceChildren(node('p',`本集共 ${shots.length} 个镜头。先选择场次，再勾选镜头和统一风格。`),filter.wrap,count,settings,extra.wrap,actions,status,list);status.textContent='图片任务提交后可在分镜卡片查看进度和历史。';setBusy();
 }catch(e){status.textContent=e instanceof Error?e.message:String(e);showToast(status.textContent);}
}
