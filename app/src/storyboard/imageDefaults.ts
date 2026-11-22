import {db,loadDoc,saveDoc} from '../data/db';
import {node} from '../ui/localUi';
import {lumRequest} from './lumClient';
import type {ImageModel,GenerationConfig} from './generationState';
import './imageDefaults.css';

type ImageDefaults={ratio?:string;size?:string;providerId?:string;modelId?:string};
const key='image:defaults',changed='dsh:image-defaults-changed';
let writes=Promise.resolve();
export async function readImageDefaults():Promise<ImageDefaults>{await writes.catch(()=>{});return {ratio:'',size:'',...await loadDoc<ImageDefaults>(key)??{}};}
function saveImageDefault(patch:ImageDefaults){
  writes=writes.catch(()=>{}).then(async()=>{
    await db.transaction('rw',db.docs,async()=>{await saveDoc(key,{...await loadDoc<ImageDefaults>(key)??{},...patch});});
    window.dispatchEvent(new Event(changed));
  });return writes;
}
export function fillImageDimension(select:HTMLSelectElement,values:string[]|undefined,value?:string){
  const fallback=node('option','模型默认');fallback.value='';select.replaceChildren(fallback);
  for(const v of values??[]){const option=node('option',v);option.value=v;select.append(option);}
  if(value&&!values?.includes(value)){const option=node('option',`${value}（请核对模型支持）`);option.value=value;select.append(option);}
  select.value=value??'';
}
export function fillImageModels(select:HTMLSelectElement,models:ImageModel[],defaults:ImageDefaults,saved?:GenerationConfig){
  select.replaceChildren();
  models.forEach((m,i)=>{const option=node('option',`${m.providerLabel} · ${m.label}`);option.value=String(i);select.append(option);});
  const preferred=models.find(model=>model.isDefault)??(defaults.providerId&&defaults.modelId?defaults:saved);
  const index=preferred?models.findIndex(m=>m.providerId===preferred.providerId&&m.modelId===preferred.modelId):models.length?0:-1;
  if(index<0){const missing=node('option',models.length?'原选模型不可用，请重新选择':'请先配置图片模型');missing.value='-1';missing.disabled=true;select.prepend(missing);}
  select.value=String(index);
}
export function validateImageDimensions(model:ImageModel,config:GenerationConfig){
  if(config.ratio&&model.imageRatios?.length&&!model.imageRatios.includes(config.ratio))throw Error(`该模型不支持比例 ${config.ratio}，请调整比例或更换模型`);
  if(config.size&&model.imageSizes?.length&&!model.imageSizes.includes(config.size))throw Error(`该模型不支持分辨率 ${config.size}，请调整分辨率或更换模型`);
}
export function mountImageDefaults(host:HTMLElement){
  const bar=node('section','','imageDefaultsBar');bar.setAttribute('aria-label','统一生图设置');
  const model=node('select'),ratio=node('select'),size=node('select');model.setAttribute('aria-label','统一生图模型');ratio.setAttribute('aria-label','统一比例');size.setAttribute('aria-label','统一分辨率');
  for(const [label,select]of [['模型',model],['比例',ratio],['分辨率',size]] as const){const wrap=node('label',label);wrap.append(select);bar.append(wrap);select.disabled=true;}
  const status=node('span','读取图片模型…');status.setAttribute('role','status');
  const refresh=node('button','刷新选项');refresh.type='button';bar.prepend(node('strong','统一生图'));bar.append(refresh,status);host.append(bar);
  let models:ImageModel[]=[],disposed=false,revision=0;
  const render=async()=>{
    const token=++revision,defaults=await readImageDefaults();if(disposed||token!==revision)return;
    const fallback=node('option','单次选择');fallback.value='';model.replaceChildren(fallback);
    const modelKey=(m:{providerId?:string;modelId?:string})=>JSON.stringify([m.providerId,m.modelId]);
    models.forEach(m=>{const option=node('option',`${m.providerLabel} · ${m.label}`);option.value=modelKey(m);model.append(option);});
    const current=models.find(m=>m.providerId===defaults.providerId&&m.modelId===defaults.modelId);
    if(defaults.providerId&&defaults.modelId&&!current){const missing=node('option','已选模型不可用，请重新选择');missing.value=modelKey(defaults);missing.disabled=true;model.append(missing);}
    model.value=defaults.providerId&&defaults.modelId?modelKey(defaults):'';model.disabled=!models.length;
    const dimensions=current?[current]:models;
    fillImageDimension(ratio,[...new Set(dimensions.flatMap(m=>m.imageRatios??[]))],defaults.ratio);
    fillImageDimension(size,[...new Set(dimensions.flatMap(m=>m.imageSizes??[]))],defaults.size);
    ratio.disabled=!models.length;size.disabled=!models.length;
  };
  const reload=async()=>{refresh.disabled=true;try{const result=await lumRequest<{models:ImageModel[]}>('models');if(disposed)return;models=result.models.filter(m=>m.type==='image');await render();status.textContent=models.length?'人物、地点、道具、分镜共用；单次可调整':'请先在项目设置中配置图片模型';}catch(error){if(!disposed)status.textContent=String(error);}finally{refresh.disabled=false;}};
  refresh.onclick=()=>{void reload();};
  model.onchange=()=>{
    const chosen=models.find(m=>JSON.stringify([m.providerId,m.modelId])===model.value);
    const patch:ImageDefaults={providerId:chosen?.providerId??'',modelId:chosen?.modelId??''};
    if(chosen){if(ratio.value&&chosen.imageRatios?.length&&!chosen.imageRatios.includes(ratio.value))patch.ratio='';if(size.value&&chosen.imageSizes?.length&&!chosen.imageSizes.includes(size.value))patch.size='';}
    status.textContent='保存中…';void saveImageDefault(patch).then(()=>{if(!disposed)status.textContent='已保存 · 人物、地点、道具、分镜共用'+(patch.ratio===''||patch.size===''?'；不支持的尺寸已重置为模型默认':'');}).catch(error=>{if(!disposed)status.textContent=`保存失败：${String(error)}`;});
  };
  for(const [name,select]of [['ratio',ratio],['size',size]] as const)select.onchange=()=>{
    const value=select.value;status.textContent='保存中…';
    void saveImageDefault({[name]:value}).then(()=>{if(!disposed)status.textContent='已保存 · 四类生图共用';}).catch(error=>{if(!disposed)status.textContent=`保存失败：${String(error)}`;});
  };
  const update=()=>{void render().catch(error=>{if(!disposed)status.textContent=String(error);});};window.addEventListener(changed,update);
  const lifecycle=new MutationObserver(()=>{if(!bar.isConnected){disposed=true;window.removeEventListener(changed,update);lifecycle.disconnect();}});
  lifecycle.observe(document.body,{childList:true,subtree:true});void reload();
  return bar;
}
