import {loadDoc,saveDoc} from '../data/db';
import {node,action} from '../ui/localUi';
import {bindImagePreview} from '../ui/imageViewer';
import {createImagePromptEditor} from '../storyboard/imagePromptEditor';
import {readImageDefaults,fillImageDimension,fillImageModels} from '../storyboard/imageDefaults';
import {lumRequest} from '../storyboard/lumClient';
import {initializeGeneration,getShotGeneration,prepareCoverPrompt,startCoverGeneration,subscribeGeneration,hasActiveTask,generationError,previewImage,cancelGeneration,resumeGeneration,pollTasks,type ImageModel,type GenerationConfig,type ReferenceImage} from '../storyboard/generationState';

export async function mountCoverImagePanel(host:HTMLElement,options:{episodeId:string;isAlive:()=>boolean;flush:()=>Promise<void>;adopt:(image:ReferenceImage)=>Promise<void>}){
 const root=node('section','','coverImagePanel');root.dataset.coverImage=options.episodeId;
 const status=node('p','正在读取封面生成记录…','coverHint');status.setAttribute('role','status');
 const list=node('section','','coverHistory');list.setAttribute('aria-label','封面生成历史');
 const model=node('select'),ratio=node('select'),size=node('select');
 const generate=node('button','生成封面图片','localButton');generate.type='button';generate.disabled=true;
 const key=`cover:${options.episodeId}`,optionsKey=`image:options:${key}`;
 let models:ImageModel[]=[],submitting=false,disposed=false,rendering=0,refreshing=false;
 let taskFeedback=false;
 let editor:Awaited<ReturnType<typeof createImagePromptEditor>>|undefined,unsubscribe=()=>{};
 let defaults:Awaited<ReturnType<typeof readImageDefaults>>={},saved:GenerationConfig|undefined,settingsWrites=Promise.resolve();
 const alive=()=>!disposed&&options.isAlive();
 const config=():GenerationConfig=>{const m=models[Number(model.value)];if(!m)throw Error('请先配置并选择图片模型');return {providerId:m.providerId,modelId:m.modelId,...(ratio.value?{ratio:ratio.value}:{}),...(size.value?{size:size.value}:{})};};
 const update=()=>{generate.disabled=!alive()||submitting||refreshing||hasActiveTask(key)||!editor?.ready||!models[Number(model.value)];cancel.disabled=!hasActiveTask(key);};
 const report=(error:unknown)=>{taskFeedback=false;if(alive())status.textContent=error instanceof Error?error.message:String(error);};
 const cancel=action('取消生成',async()=>{await cancelGeneration(key);render();});
 const settings=node('div','','imageModelFields');
 for(const [label,select]of [['图片模型',model],['画幅比例',ratio],['分辨率',size]] as const){select.setAttribute('aria-label',`封面${label}`);const wrap=node('label',label);wrap.append(select);settings.append(wrap);}
 const persistSettings=()=>{
  try{const next={...config(),ratio:ratio.value,size:size.value};saved=next;settingsWrites=settingsWrites.catch(()=>{}).then(()=>saveDoc(optionsKey,next));void settingsWrites.catch(report);}catch(error){report(error);}
 };
 const dimensions=(chosen?:GenerationConfig)=>{const m=models[Number(model.value)];fillImageDimension(ratio,m?.imageRatios,chosen?.ratio??defaults.ratio);fillImageDimension(size,m?.imageSizes,chosen?.size??defaults.size);};
 const reload=async()=>{
  if(refreshing)return;refreshing=true;refresh.disabled=true;update();
  try{
   const result=await lumRequest<{models:ImageModel[]}>('models');if(!alive())return;
   models=result.models.filter(m=>m.type==='image');fillImageModels(model,models,saved??defaults,saved);dimensions(saved);editor?.invalidate();
   status.textContent=models.length?'先优化并检查提示词，再生成封面；完成后选择「采用此图」。':'请在项目设置中配置图片模型。';
  }catch(error){report(error);}finally{refreshing=false;refresh.disabled=false;update();}
 };
 const refresh=action('刷新图片模型',reload);
 model.onchange=()=>{dimensions();editor?.invalidate();persistSettings();update();};
 for(const select of [ratio,size])select.onchange=()=>{editor?.invalidate();persistSettings();};
 const controls=node('div','','localRow');controls.append(refresh,action('模型设置',()=>{window.dispatchEvent(new Event('dsh:settings'));}));
 const actions=node('div','','localRow');actions.append(generate,cancel,action('核对任务状态',async()=>{await pollTasks(true);render();}));
 root.append(node('h3','AI 封面创作'),node('p','作品信息 → Skill 优化提示词 → 检查并生成 → 预览采用','coverHint'),settings,controls,actions,status,node('h3','生成历史'),list);host.append(root);
 const render=()=>{
  if(!alive())return;
  const version=++rendering;list.replaceChildren();update();
  const history=getShotGeneration(key).history;
  if(generationError()){taskFeedback=true;status.textContent=generationError();}
  else if(hasActiveTask(key)){taskFeedback=true;status.textContent='正在生成或核对任务。可以离开页面，返回后继续查询原任务。';}
  else if(taskFeedback){taskFeedback=false;const latest=history[0];status.textContent=latest?.state==='succeeded'?'封面生成完成，请预览并选择「采用此图」。':latest?.state==='failed'?`生成失败：${latest.message||'请检查模型配置后重试'}`:latest?.state==='cancelled'?'生成已取消，已有结果仍保留。':'任务状态已更新，请查看生成历史。';}
  if(!history.length)list.append(node('p','尚无生成记录。生成结果会保存在这里，采用后才更新当前封面。','coverHint'));
  for(const task of history){
   const item=node('article','','localCard coverResult');
   const states:Record<string,string>={submitting:'提交中',running:'生成中',succeeded:'已完成',failed:'失败',unknown:'核对中',interrupted:'已中断',resuming:'恢复中',cancelled:'已取消',cancelling:'取消中'};
   item.append(node('strong',`${new Date(task.createdAt).toLocaleString()} · ${states[task.state]??task.state}`),node('p',`${task.config.modelId} · ${task.config.ratio||'默认比例'} · ${task.config.size||'默认分辨率'}`),node('p',task.message??''));
   const details=node('details');details.append(node('summary','本次最终提示词'),node('pre',task.prompt));item.append(details);
   if(task.state==='interrupted'&&task.resumable!==false)item.append(action('恢复原任务',async()=>{await resumeGeneration(key,task.taskId);render();}));
   for(const image of task.outputs){
    const figure=node('figure'),img=node('img');img.alt='生成的封面候选图';bindImagePreview(img,()=>previewImage(image));
    const imageStatus=node('figcaption','读取预览…');figure.append(img,imageStatus);
    void previewImage(image).then(src=>{if(alive()&&version===rendering){img.src=src;imageStatus.textContent='点击图片查看大图';}}).catch(error=>{if(alive()&&version===rendering)imageStatus.textContent=`预览读取失败：${String(error)}`;});
    figure.append(action('采用此图',async()=>{await options.adopt(image);if(alive())status.textContent='已采用此图，当前封面已更新。';}));item.append(figure);
   }
   list.append(item);
  }
 };
 generate.onclick=()=>{void(async()=>{
  if(submitting)return;submitting=true;update();
  try{
   await options.flush();await settingsWrites;
   const selected=config(),reviewed=await editor!.getReviewed();if(!alive())return;
   // Read again after async review, so changing the dimensions cannot submit an old prompt.
   if(JSON.stringify(selected)!==JSON.stringify(config()))throw Error('图片设置已变化，请重新优化提示词');
   await startCoverGeneration(options.episodeId,selected,reviewed,alive);render();
  }catch(error){report(error);}finally{submitting=false;update();}
 })();};
 const dispose=()=>{if(disposed)return;disposed=true;unsubscribe();editor?.dispose();lifecycle.disconnect();};
 const lifecycle=new MutationObserver(()=>{if(!root.isConnected||!options.isAlive())dispose();});lifecycle.observe(document.body,{childList:true,subtree:true});
 try{
  await initializeGeneration();if(!alive())return {invalidate:()=>{}};
  defaults=await readImageDefaults();saved=await loadDoc<GenerationConfig>(optionsKey)??getShotGeneration(key).config;if(!alive())return {invalidate:()=>{}};
  unsubscribe=subscribeGeneration(render);render();await reload();if(!alive())return {invalidate:()=>{}};
  editor=await createImagePromptEditor({key,use:'cover-image',isAlive:alive,readSource:async(skill,requirements)=>{await options.flush();return prepareCoverPrompt(options.episodeId,skill,requirements,config());},onReadyChange:update});
  if(!alive()){editor.dispose();return {invalidate:()=>{}};}
  actions.before(editor.element);update();
 }catch(error){report(error);}
 return {invalidate:()=>editor?.invalidate()};
}
