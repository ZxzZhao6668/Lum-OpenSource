import {db,loadDoc,saveDoc} from '../data/db';
import {bindImagePreview} from '../ui/imageViewer';
import {node,action,modal} from '../ui/localUi';
import type {SkillUse} from '../skills/skillStore';
import {createImagePromptEditor} from '../storyboard/imagePromptEditor';
import {initializeGeneration,getShotGeneration,startEntityGeneration,prepareEntityPrompt,adoptEntityImage,previewImage,cancelGeneration,resumeGeneration,subscribeGeneration,hasActiveTask,generationError,type ImageModel} from '../storyboard/generationState';
import {lumRequest} from '../storyboard/lumClient';
import {readImageDefaults,fillImageDimension,fillImageModels} from '../storyboard/imageDefaults';

export async function openEntityImage(entityId:string){
  let row=await db.entities.get(entityId);if(!row)throw Error('资产已删除');
  const {dialog,body}=modal(`${({character:'人物',location:'地点',prop:'道具'})[row.kind]}生图`);dialog.dataset.entityImage=entityId;
  const status=node('p','正在加载 Skill 与图片模型…');status.setAttribute('role','status');body.append(status);
  try{
    await initializeGeneration();
    const {models}=await lumRequest<{models:ImageModel[]}>('models');if(!dialog.isConnected)return;
    const choices=models.filter(m=>m.type==='image');
    const model=node('select');model.setAttribute('aria-label','生图模型');
    const key=`entity:${entityId}`,saved=getShotGeneration(key).config;
    const defaults=await readImageDefaults();const preferences=await loadDoc<{useReference:boolean}>(`image:options:${key}`);if(!dialog.isConnected)return;
    fillImageModels(model,choices,defaults,saved);
    const ratio=node('select'),size=node('select');ratio.setAttribute('aria-label','画幅比例');size.setAttribute('aria-label','图片尺寸');
    const params=()=>{
      const m=choices[Number(model.value)];
      for(const [select,values,value]of [[ratio,m?.imageRatios,defaults.ratio??saved?.ratio],[size,m?.imageSizes,defaults.size??saved?.size]] as const)fillImageDimension(select,values,value);
    };model.onchange=()=>{params();updateGenerate();};params();
    const reference=node('label'),check=node('input');check.type='checkbox';
    const hasReference=/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(row.image??'');check.disabled=!hasReference;
    check.checked=hasReference&&(preferences?.useReference??false);
    check.setAttribute('aria-label','使用当前资产图片作参考');reference.append(check,node('span','使用当前资产图片作参考'));
    const list=node('section'),generate=node('button','生成图片','localButton');generate.type='button';
    const cancel=action('取消生成',async()=>{await cancelGeneration(key);render();});
    let rendering=0,submitting=false,promptEditor:Awaited<ReturnType<typeof createImagePromptEditor>>|undefined;
    const updateGenerate=()=>{generate.disabled=submitting||hasActiveTask(key)||!promptEditor?.ready||!choices[Number(model.value)];};
    const render=()=>{
      const version=++rendering;list.replaceChildren();updateGenerate();cancel.disabled=!hasActiveTask(key);
      const interrupted=getShotGeneration(key).history.some(h=>h.state==='interrupted');
      status.textContent=generationError()||(!choices.length?'请先在项目设置中配置图片模型。':interrupted?'任务已中断，请查看生成记录；可恢复的任务可继续取回原图，不重新生成。':hasActiveTask(key)?'生成中，可关闭窗口；再次打开会继续查询同一个任务。':'生成图采用后会更新当前资产，关联分镜共用这份图片。');
      for(const h of getShotGeneration(key).history){
        const item=node('article','','localCard');
        item.append(node('p',`${new Date(h.createdAt).toLocaleString()} · ${({submitting:'提交中',running:'生成中',succeeded:'已完成',failed:'失败',unknown:'核对中',interrupted:'任务中断',resuming:'恢复中',cancelled:'已取消',cancelling:'取消中'} as Record<string,string>)[h.state]??h.state}`),node('p',h.message??''));
        if(h.state==='interrupted'&&h.resumable!==false)item.append(action('恢复原任务',async()=>{try{await resumeGeneration(key,h.taskId);}catch(error){status.textContent=error instanceof Error?error.message:String(error);}}));
        const details=node('details');details.append(node('summary','查看本次提示词'),node('pre',h.prompt));details.style.whiteSpace='pre-wrap';item.append(details);
        for(const image of h.outputs){
          const img=node('img');img.alt=row!.name;bindImagePreview(img,()=>previewImage(image));
          img.style.cssText='display:block;max-width:100%;max-height:300px;object-fit:contain';
          void previewImage(image).then(src=>{if(dialog.isConnected&&version===rendering)img.src=src;}).catch(e=>{if(dialog.isConnected&&version===rendering)status.textContent=String(e);});
          item.append(img,action('采用此图',async()=>{row=await adoptEntityImage(entityId,image,row!);status.textContent='已采用，人物/地点/道具与分镜引用已同步';check.disabled=false;promptEditor?.invalidate();}));
        }
        list.append(item);
      }
    };
    generate.onclick=()=>{void(async()=>{
      if(submitting)return;submitting=true;updateGenerate();
      try{
        const m=choices[Number(model.value)];if(!m)throw Error('请先在项目设置中配置图片模型');
        const reviewed=await promptEditor!.getReviewed();if(!dialog.isConnected)return;
        await startEntityGeneration(entityId,{providerId:m.providerId,modelId:m.modelId,...(ratio.value?{ratio:ratio.value}:{}),...(size.value?{size:size.value}:{})},reviewed.skillId,reviewed.requirements,check.checked,reviewed);
        render();
      }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
      finally{submitting=false;updateGenerate();}
    })();};
    const settings=node('div','','imageModelFields');
    for(const [label,select]of [['生图模型',model],['画幅比例',ratio],['图片尺寸',size]] as const){const wrap=node('label',label);wrap.append(select);settings.append(wrap);}
    const settingsRow=node('div','','localRow');settingsRow.append(action('模型设置',()=>{dialog.close();window.dispatchEvent(new Event('dsh:settings'));}),reference);
    const generationActions=node('div','','localRow');generationActions.append(generate,cancel);
    body.replaceChildren(node('p',`当前资产：${row.name}。先按 Skill 优化提示词，检查后再生成图片。`),settings,settingsRow,generationActions,status,list);
    updateGenerate();
    promptEditor=await createImagePromptEditor({key,use:`${row.kind}-image` as SkillUse,isAlive:()=>dialog.isConnected&&dialog.open,readSource:(skill,requirements)=>prepareEntityPrompt(entityId,skill,requirements,check.checked),onReadyChange:updateGenerate});
    if(!dialog.isConnected){promptEditor.dispose();return;}
    generationActions.before(promptEditor.element);check.onchange=()=>{promptEditor?.invalidate();void saveDoc(`image:options:${key}`,{useReference:check.checked}).catch(error=>{status.textContent=String(error);});};
    const unsubscribe=subscribeGeneration(()=>{if(dialog.isConnected)render();});
    dialog.addEventListener('close',()=>{unsubscribe();promptEditor?.dispose();},{once:true});render();
  }catch(e){status.textContent=String(e);}
}
