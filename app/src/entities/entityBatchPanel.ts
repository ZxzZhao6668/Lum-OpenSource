import { node, modal, field } from '../ui/localUi';
import { type EntityKind } from '../data/db';
import { listSkills, type SkillUse } from '../skills/skillStore';
import { listTextModels } from '../writing/writingClient';
import { lumRequest } from '../storyboard/lumClient';
import { previewImage, generationError, type ImageModel } from '../storyboard/generationState';
import { fillImageModels, fillImageDimension, readImageDefaults } from '../storyboard/imageDefaults';
import { openImageViewer } from '../ui/imageViewer';
import { mountLazyThumbnail } from '../ui/lazyThumbnail';
import { openEntityImage } from './entityImagePanel';
import { EntityBatch, type EntityBatchItem } from './entityBatch';
import './entityBatch.css';
import { showToast } from '../ui/toast';
import {imageStyles,applyImageStyle,imageStyleId} from '../storyboard/imageStyles';

const states: Record<string, string> = { submitting: '提交中', running: '生成中', succeeded: '已完成', failed: '生成失败', unknown: '正在核对任务', interrupted: '任务中断', cancelled: '已取消', cancelling: '取消中', resuming: '恢复中' };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function openEntityBatch(kind: EntityKind, ids: string[]) {
  const label = { character: '人物', location: '地点', prop: '道具' }[kind];
  const { dialog, body } = modal(`批量${label}生图`); dialog.classList.add('entityBatchDialog');
  const status = node('p', '正在读取资产、Skill 和模型…', 'entityBatchStatus'); status.setAttribute('role', 'status'); body.append(status);
  let batch: EntityBatch | undefined;
  let unsubscribe = () => {};
  const thumbnailDisposers:Array<()=>void>=[];
  dialog.addEventListener('close', () => { unsubscribe(); batch?.dispose(); thumbnailDisposers.splice(0).forEach(dispose=>dispose()); }, { once: true });
  try {
    batch = await EntityBatch.open(ids, kind);
    if (!dialog.isConnected) { batch.dispose(); return; }
    const current = batch;
    const [skills, textModels, images, defaults] = await Promise.all([
      listSkills(`${kind}-image` as SkillUse), listTextModels(), lumRequest<{ models: ImageModel[] }>('models'), readImageDefaults(),
    ]);
    if (!dialog.isConnected) return;
    const imageModels = images.models.filter(model => model.type === 'image');
    const settings = node('section', '', 'entityBatchSettings');
    const select = (title: string) => { const wrap = node('label', title), input = node('select'); input.setAttribute('aria-label', title); wrap.append(input); settings.append(wrap); return input; };
    const skill = select('统一 Skill');
    for (const item of skills) { const option = node('option', item.name); option.value = item.id; skill.append(option); }
    skill.value = current.items[0]?.draft.skillId ?? '';
    const style=select('图片风格');
    for(const item of imageStyles){const option=node('option',item.name);option.value=item.id;style.append(option);}
    style.value=imageStyleId(current.items[0]?.draft.requirements??'');
    const textModel = select('提示词优化模型');
    const empty = node('option', textModels.length ? '请选择文本模型' : '请先配置文本模型'); empty.value = ''; textModel.append(empty);
    for (const [index, model] of textModels.entries()) { const option = node('option', `${model.providerLabel} · ${model.label || model.modelId}`); option.value = String(index); textModel.append(option); }
    const preferred = current.items.find(item => item.draft.textModel)?.draft.textModel || localStorage.getItem('writing:preferredModel');
    const textIndex = textModels.findIndex(model => JSON.stringify([model.providerId, model.modelId]) === preferred);
    textModel.value = textIndex >= 0 ? String(textIndex) : textModels.length === 1 ? '0' : '';
    const imageModel = select('生图模型'), ratio = select('画幅比例'), size = select('清晰度 / 分辨率');
    fillImageModels(imageModel, imageModels, defaults);
    const dimensions = () => { const model = imageModels[Number(imageModel.value)]; fillImageDimension(ratio, model?.imageRatios, defaults.ratio); fillImageDimension(size, model?.imageSizes, defaults.size); };
    dimensions(); imageModel.onchange = () => { dimensions(); update(); };
    const requirements = field('统一补充要求', '', true); requirements.input.maxLength = 12000;
    const settingsActions = node('div', '', 'entityBatchActions');
    const button = (text: string, run: () => Promise<void>) => {
      const element = node('button', text, 'localButton'); element.type = 'button';
      element.onclick = () => { void run().catch(error => { showToast(message(error)); }).finally(update); };
      return element;
    };
    const applySkill = button('应用 Skill 到本批资产', async () => {
      if (!skill.value) throw Error('请选择适用 Skill');
      for (const item of current.items) await current.edit(item, { skillId: skill.value });
      syncEditors(); status.textContent = `已为 ${current.items.length} 项分配 Skill，请优化提示词。`;
    });
    const applyRequirements = button('应用补充要求', async () => {
      for (const item of current.items) await current.edit(item, { requirements: requirements.input.value });
      syncEditors(); status.textContent = '补充要求已应用，请重新优化提示词。';
    });
    const applyReference = button('使用已有资产图作参考', async () => {
      for (const item of current.items) await current.edit(item, { useReference: /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(item.entity.image ?? '') });
      syncEditors();
    });
    settingsActions.append(applySkill, applyRequirements, applyReference);
    const actions = node('div', '', 'entityBatchActions');
    const optimize = button('批量优化提示词', async () => {
      if (textModel.value === '' || !textModels[Number(textModel.value)]) throw Error('请选择提示词优化模型');
      for(const item of current.items){const updated=applyImageStyle(item.draft.requirements,style.value);if(updated!==item.draft.requirements)await current.edit(item,{requirements:updated});}
      await current.optimize(textModels[Number(textModel.value)]); syncEditors();
    });
    const generate = async (failedOnly: boolean) => {
      const model = imageModels[Number(imageModel.value)]; if (!model) throw Error('请选择可用图片模型');
      await current.generate({ providerId: model.providerId, modelId: model.modelId, ...(ratio.value ? { ratio: ratio.value } : {}), ...(size.value ? { size: size.value } : {}) }, failedOnly);
    };
    const start = button('批量生成资产图', () => generate(false));
    const retry = button('重试失败项', () => generate(true));
    const stop = button('停止后续操作', () => current.stop());
    actions.append(optimize, start, retry, stop);
    const results = node('div', '', 'entityBatchActions');
    const replace = node('input'); replace.type = 'checkbox'; replace.setAttribute('aria-label', '替换已有资产图');
    const replaceLabel = node('label'); replaceLabel.append(replace, node('span', '替换已有资产图'));
    const adopt = button('一键采用成功图片', () => current.adopt(replace.checked)); results.append(adopt, replaceLabel);
    const list = node('div', '', 'entityBatchList');
    const editors = new Map<EntityBatchItem, { skill: HTMLSelectElement; reference: HTMLInputElement; requirements: HTMLTextAreaElement | HTMLInputElement; text: HTMLTextAreaElement | HTMLInputElement; status: HTMLElement; image: HTMLElement; refreshImage:()=>void }>();
    for (const item of current.items) {
      const card = node('article', '', 'entityBatchItem'); card.dataset.entityId = item.entity.id;
      const head = node('header'); head.append(node('h3', item.entity.name));
      head.append(button('查看生成记录', async () => { await openEntityImage(item.entity.id); }));
      const perSkill = node('select'); perSkill.setAttribute('aria-label', `${item.entity.name} 的 Skill`);
      for (const s of skills) { const option = node('option', s.name); option.value = s.id; perSkill.append(option); }
      const skillLabel = node('label', '单项 Skill'); skillLabel.append(perSkill);
      const reference = node('input'); reference.type = 'checkbox'; reference.setAttribute('aria-label', `${item.entity.name} 使用当前图片作参考`);
      const referenceLabel = node('label', '', 'entityBatchReference'); referenceLabel.append(reference, node('span', '使用当前图片作参考'));
      const extra = field(`${item.entity.name} 的补充要求`, item.draft.requirements, true); extra.input.maxLength = 12000;
      const prompt = field(`${item.entity.name} 的最终提示词`, item.draft.text, true); prompt.input.maxLength = 100000;
      const details = node('details'); details.append(node('summary', '检查 / 编辑提示词'), extra.wrap, prompt.wrap);
      const itemStatus = node('p', '', 'entityBatchItemStatus'); itemStatus.setAttribute('role', 'status');
      const image = node('div','','entityBatchThumbnail'); image.hidden = true;image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label',`查看${item.entity.name}生成结果`);
      const viewImage=()=>{const output=current.task(item)?.outputs[0];if(output)openImageViewer(previewImage(output,false),item.entity.name);};
      image.onclick=viewImage;image.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();viewImage();}};
      const thumbnail=mountLazyThumbnail(image,`${item.entity.name} 生成结果`,()=>{const task=current.task(item),output=task?.state==='succeeded'?task.outputs[0]:undefined;return output?{key:output.path,load:()=>previewImage(output,false)}:undefined;});
      thumbnailDisposers.push(thumbnail.dispose);
      const change = (patch: Parameters<EntityBatch['edit']>[1]) => { void current.edit(item, patch).catch(error => { status.textContent = message(error); }); };
      perSkill.onchange = () => change({ skillId: perSkill.value });
      reference.onchange = () => change({ useReference: reference.checked });
      extra.input.oninput = () => change({ requirements: extra.input.value });
      prompt.input.oninput = () => change({ text: prompt.input.value });
      card.append(head, skillLabel, referenceLabel, itemStatus, image, details); list.append(card);
      editors.set(item, { skill: perSkill, reference, requirements: extra.input, text: prompt.input, status: itemStatus, image, refreshImage:thumbnail.refresh });
    }
    function syncEditors() {
      for (const [item, editor] of editors) { editor.skill.value = item.draft.skillId; editor.reference.checked = item.useReference; editor.requirements.value = item.draft.requirements; editor.text.value = item.draft.text; }
    }
    function update() {
      if (!dialog.isConnected) return;
      const ready = current.items.filter(item => !!item.draft.sourceHash && !!item.draft.text.trim()).length;
      const complete = current.items.filter(item => current.task(item)?.state === 'succeeded').length;
      const failed = current.items.filter(item => current.task(item)?.state === 'failed' || item.generationFailed).length;
      const active = current.items.filter(item => ['submitting', 'running', 'unknown', 'interrupted', 'cancelling', 'resuming'].includes(current.task(item)?.state ?? '')).length;
      status.textContent = generationError() || `${current.items.length} 项资产 · 提示词就绪 ${ready} · 图片完成 ${complete} · 进行中 ${active} · 失败 ${failed}${current.busy ? ' · 批量处理中' : current.stopped ? ' · 已停止后续操作' : ''}`;
      optimize.disabled = current.busy || textModel.value === '';
      start.disabled = current.busy || !ready || !imageModels[Number(imageModel.value)];
      retry.disabled = current.busy || !failed || !imageModels[Number(imageModel.value)];
      stop.disabled = !current.busy || current.stopped;
      adopt.disabled = current.busy || !complete;
      for (const control of [skill, style, textModel, imageModel, ratio, size, requirements.input, applySkill, applyRequirements, applyReference, replace]) control.disabled = current.busy;
      for (const [item, editor] of editors) {
        const task = current.task(item);
        editor.status.textContent = [item.message, task ? `图片：${states[task.state] ?? task.state}${task.message ? ` · ${task.message}` : ''}` : ''].filter(Boolean).join(' · ');
        editor.status.dataset.error = String(item.error || task?.state === 'failed');
        for (const control of [editor.skill, editor.requirements, editor.text]) control.disabled = current.busy;
        editor.reference.disabled = current.busy || !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(item.entity.image ?? '');
        if (document.activeElement !== editor.text && editor.text.value !== item.draft.text) editor.text.value = item.draft.text;
        const output = task?.state === 'succeeded' ? task.outputs[0] : undefined;
        editor.image.hidden = !output; editor.refreshImage();
      }
    }
    textModel.onchange = update;
    body.replaceChildren(node('p', `本批 ${current.items.length} 个${label}。分配 Skill → 批量优化 → 检查提示词 → 批量生成。`, 'localMuted'), settings, requirements.wrap, settingsActions, actions, status, results,
      node('p', '提示词优化最多同时处理 12 项，其余自动排队；图片任务同时提交，供应商可能限制并发。关闭面板会停止尚未提交的操作，已提交任务继续保留；一键采用使用每项第一张成功图片，默认保留已有图。', 'entityBatchHint'), list);
    syncEditors(); unsubscribe = current.subscribe(update); update();
  } catch (error) { status.textContent = message(error); batch?.dispose(); }
}
