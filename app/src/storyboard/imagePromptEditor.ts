import { loadDoc, saveDoc } from '../data/db';
import { skillSelect, openSkillLibrary } from '../skills/skillPanel';
import { rememberSkill, type SkillUse } from '../skills/skillStore';
import { listTextModels, cancelWriting, type TextModel } from '../writing/writingClient';
import { node, field } from '../ui/localUi';
import type { ImagePromptSource, ReviewedImagePrompt } from './generationState';
import './imagePromptEditor.css';
import { optimizeImagePrompt, type ImagePromptDraft } from './imagePromptOptimization';
import {imageStyles,applyImageStyle,imageStyleId} from './imageStyles';

type PromptDraft = ImagePromptDraft;
export async function createImagePromptEditor(options: {
  key: string;
  use: SkillUse;
  isAlive: () => boolean;
  readSource: (skillId: string, requirements: string) => Promise<ImagePromptSource>;
  onReadyChange: (ready: boolean) => void;
}) {
  const root = node('section', '', 'imagePromptEditor'); root.dataset.imagePromptTarget = options.key;
  const skill = await skillSelect(options.use);
  const draft = await loadDoc<PromptDraft>(`image:prompt:${options.key}`);
  if (draft && [...skill.options].some(option => option.value === draft.skillId)) skill.value = draft.skillId;
  const requirements = field('补充生图要求', draft?.requirements ?? '', true);
  const entityStyle=/^(character|location|prop|storyboard)-image$/.test(options.use)?node('select'):undefined;
  if(entityStyle){entityStyle.setAttribute('aria-label','图片风格');for(const style of imageStyles){const option=node('option',!style.id && options.use==='storyboard-image' ? '使用镜头固定画风' : style.name);option.value=style.id;entityStyle.append(option);}entityStyle.value=imageStyleId(requirements.input.value);}
  const output = field('最终生图提示词', draft?.text ?? '', true);
  requirements.input.maxLength = 12000; output.input.maxLength = 100000;
  const model = node('select'); model.setAttribute('aria-label', '提示词优化模型');
  const status = node('p', '选择 Skill 并填写要求，先优化提示词，检查后再点击生成图片。', 'imagePromptStatus'); status.setAttribute('role','status');
  const controls = node('div', '', 'imagePromptControls');
  const optimize = node('button', 'AI 优化提示词'), stop = node('button', '停止优化'), manage = node('button', '管理 Skill'), reload = node('button', '刷新文本模型');
  for (const button of [optimize, stop, manage, reload]) button.type = 'button';
  const skillLabel = node('label', 'Skill'); skillLabel.append(skill);
  const modelLabel = node('label', '提示词优化模型'); modelLabel.append(model);
  controls.append(optimize, stop); root.append(skillLabel, manage);if(entityStyle){const styleLabel=node('label','图片风格');styleLabel.append(entityStyle);root.append(styleLabel);}root.append(requirements.wrap, modelLabel, reload, controls, status, output.wrap);
  let models: TextModel[] = [], sourceHash = '', includeContext: boolean | undefined;
  let epoch = 0, disposed = false, active: {id: string; version: number; started: boolean} | undefined;
  let saveQueue = Promise.resolve();
  const alive = () => !disposed && options.isAlive();
  const ready = () => alive() && !active && !!sourceHash && !!output.input.value.trim();
  const notify = () => {
    optimize.disabled = !!active || !skill.value || !models[Number(model.value)] || model.value === '';
    optimize.setAttribute('aria-busy', String(!!active));
    stop.disabled = !active; options.onReadyChange(ready());
  };
  const persist = () => {
    const value: PromptDraft = {skillId:skill.value,requirements:requirements.input.value,text:output.input.value,sourceHash,textModel:model.value === '' ? draft?.textModel : JSON.stringify([models[Number(model.value)]?.providerId,models[Number(model.value)]?.modelId])};
    saveQueue = saveQueue.catch(()=>{}).then(()=>saveDoc(`image:prompt:${options.key}`, value));
    void saveQueue.catch(error=>{ if(alive()) status.textContent=`提示词草稿保存失败：${String(error)}`; });
    return saveQueue;
  };
  const invalidate = (message = '要求或来源已变化，请重新 AI 优化提示词。') => {
    epoch++; sourceHash = ''; if(alive()) status.textContent=message; notify(); void persist();
  };
  skill.addEventListener('change', ()=>invalidate()); requirements.input.addEventListener('input', ()=>invalidate());
  entityStyle?.addEventListener('change',()=>{requirements.input.value=applyImageStyle(requirements.input.value,entityStyle.value);invalidate('图片风格已更改，请重新优化提示词。');});
  output.input.addEventListener('input', ()=>{ if(active) invalidate(); else { notify(); void persist(); } });
  model.addEventListener('change', ()=>{ void persist(); });
  manage.onclick = () => { void openSkillLibrary().catch(error=>{ status.textContent=String(error); }); };
  const refreshModels = async () => {
    reload.disabled = true;
    try {
      const next = await listTextModels(); if(!alive())return;
      const previous = models[Number(model.value)];
      const preferred = previous ? JSON.stringify([previous.providerId,previous.modelId]) : draft?.textModel || localStorage.getItem('writing:preferredModel');
      models = next; model.replaceChildren();
      const placeholder=node('option',next.length?'选择文本模型':'请在项目设置中配置文本模型');placeholder.value='';model.append(placeholder);
      models.forEach((item,index)=>{const option=node('option',`${item.providerLabel} · ${item.label || item.modelId}`);option.value=String(index);model.append(option);});
      const index=models.findIndex(item=>JSON.stringify([item.providerId,item.modelId])===preferred);
      model.value=index>=0?String(index):models.length===1?'0':'';
      if(!models.length)status.textContent='没有可用的文本模型，请在项目设置中配置后刷新。';
    } catch(error) { if(alive())status.textContent=`无法读取提示词优化模型：${String(error)}`; }
    finally { reload.disabled=false; if(alive())notify(); }
  };
  reload.onclick=()=>{void refreshModels();};
  optimize.onclick=()=>{void (async()=>{
    if(active)return;
    const chosen=models[Number(model.value)]; if(!chosen || model.value===''){status.textContent='请选择提示词优化模型';return;}
    const operation={id:crypto.randomUUID(),version:++epoch,started:false};active=operation;sourceHash='';notify();
    status.textContent='正在读取当前资料并优化提示词…';
    try {
      const source=await options.readSource(skill.value,requirements.input.value);
      if(!alive()||active!==operation)return;
      if(operation.version!==epoch){status.textContent='要求或来源已变化，本次结果不会采用，请重新优化。';return;}
      await rememberSkill(options.use,source.skillId);
      if(!alive()||active!==operation)return;
      if(operation.version!==epoch){status.textContent='要求或来源已变化，本次结果不会采用，请重新优化。';return;}
      localStorage.setItem('writing:preferredModel',JSON.stringify([chosen.providerId,chosen.modelId]));
      operation.started=true;
      const text=await optimizeImagePrompt(source,chosen,operation.id);
      if(!alive()||active!==operation)return;
      if(operation.version!==epoch){status.textContent='要求或来源已变化，本次结果不会采用，请重新优化。';return;}
      const current=await options.readSource(skill.value,requirements.input.value);
      if(!alive()||active!==operation)return;
      if(operation.version!==epoch || current.sourceHash!==source.sourceHash){invalidate('要求或来源已变化，本次结果不会采用，请重新优化。');return;}
      output.input.value=text;sourceHash=source.sourceHash;includeContext=source.includeContext;
      status.textContent='提示词已优化，可直接编辑下方文字；检查后再点击生成图片。';await persist();
    } catch(error) { if(alive()&&active===operation){sourceHash='';status.textContent=`提示词优化失败：${error instanceof Error?error.message:String(error)}`;} }
    finally { if(active===operation){active=undefined;if(alive())notify();} }
  })();};
  const cancel = () => {
    const operation=active;if(!operation)return;active=undefined;epoch++;sourceHash='';
    if(operation?.started)void cancelWriting(operation.id).catch(error=>{if(alive())status.textContent=String(error);});
    if(alive()){status.textContent='已停止优化，未生成图片。';notify();void persist();}
  };
  stop.onclick=cancel;
  const changed=()=>invalidate();
  window.addEventListener('dsh:skills-changed',changed);window.addEventListener('dsh:content-updated',changed);
  const dispose=()=>{if(disposed)return;cancel();disposed=true;window.removeEventListener('dsh:skills-changed',changed);window.removeEventListener('dsh:content-updated',changed);lifecycle.disconnect();};
  let connected=false;
  const lifecycle=new MutationObserver(()=>{if(root.isConnected)connected=true;else if(connected||!options.isAlive())dispose();});
  lifecycle.observe(document.body,{childList:true,subtree:true});
  const initialize = async () => {
    await refreshModels(); if(!alive())return;
    if(draft?.sourceHash && draft.skillId===skill.value){
      const version=epoch;
      try{const current=await options.readSource(skill.value,requirements.input.value);if(alive()&&version===epoch&&current.sourceHash===draft.sourceHash){sourceHash=draft.sourceHash;includeContext=current.includeContext;status.textContent='已恢复已确认的提示词，可以编辑后生成。';notify();}}
      catch(error){if(alive())status.textContent=String(error);}
    }
  };
  void initialize(); notify();
  return {
    element:root, get ready(){return ready();}, invalidate, dispose,
    async getReviewed(): Promise<ReviewedImagePrompt> {
      if(!ready())throw Error('请先 AI 优化提示词，检查后再生成图片');
      const version=epoch, expected=sourceHash;
      const source=await options.readSource(skill.value,requirements.input.value);
      if(!ready()||version!==epoch||source.sourceHash!==expected){invalidate('来源已变化，请重新 AI 优化提示词后再生成');throw Error('来源已变化，请重新 AI 优化提示词后再生成');}
      const text=output.input.value;if(!text.trim()||text.length>100000)throw Error('请填写有效的最终生图提示词');
      await persist();
      if(!ready()||version!==epoch||sourceHash!==expected||output.input.value!==text)throw Error('提示词已变化，请检查后重新点击生成');
      return {text,sourceHash:expected,skillId:source.skillId,requirements:source.requirements,includeContext};
    },
  };
}
