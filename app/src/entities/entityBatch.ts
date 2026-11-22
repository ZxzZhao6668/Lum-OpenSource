import { db, loadDoc, type EntityKind, type EntityRow } from '../data/db';
import { preferredSkill, rememberSkill, type SkillUse } from '../skills/skillStore';
import { cancelWriting, type TextModel } from '../writing/writingClient';
import { optimizeImagePrompt, type ImagePromptDraft } from '../storyboard/imagePromptOptimization';
import { initializeGeneration, prepareEntityPrompt, startEntityGeneration, getShotGeneration, hasActiveTask, subscribeGeneration, adoptEntityImage, type GenerationConfig } from '../storyboard/generationState';

export interface EntityBatchItem {
  entity: EntityRow;
  draft: ImagePromptDraft;
  saved: ImagePromptDraft | null;
  useReference: boolean;
  savedReference: { useReference: boolean } | null;
  version: number;
  message: string;
  error: boolean;
  generationFailed?: boolean;
  taskId?: string;
}
const key = (id: string) => `image:prompt:entity:${id}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A batch owns its selected IDs. Closing stops unsubmitted work; existing image jobs remain in generationState. */
export class EntityBatch {
  readonly items: EntityBatchItem[] = [];
  busy = false;
  stopped = false;
  private disposed = false;
  private activeRequests = new Set<string>();
  private listeners = new Set<() => void>();
  private writes = Promise.resolve();
  private unsubscribe = () => {};

  static async open(ids: string[], kind: EntityKind) {
    const unique = [...new Set(ids)];
    if (!unique.length) throw Error('请先选择资产');
    await initializeGeneration();
    const batch = new EntityBatch();
    const skill = await preferredSkill(`${kind}-image` as SkillUse);
    for (const id of unique) {
      const entity = await db.entities.get(id);
      if (!entity || entity.kind !== kind) throw Error('选中的资产已删除或类别变化，请重新选择');
      const saved = await loadDoc<ImagePromptDraft>(key(id));
      const savedReference = await loadDoc<{useReference:boolean}>(`image:options:entity:${id}`);
      const useReference = !!savedReference?.useReference && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(entity.image ?? '');
      const draft = saved ? structuredClone(saved) : { skillId: skill?.id ?? '', requirements: '', text: '', sourceHash: '' };
      if (draft.sourceHash) {
        try { if ((await prepareEntityPrompt(id, draft.skillId, draft.requirements, useReference)).sourceHash !== draft.sourceHash) draft.sourceHash = ''; }
        catch { draft.sourceHash = ''; }
      }
      batch.items.push({ entity, draft, saved, useReference, savedReference, version: 0, message: draft.sourceHash ? '提示词已就绪' : '待优化提示词', error: false, taskId: getShotGeneration(`entity:${id}`).history[0]?.taskId });
    }
    batch.unsubscribe = subscribeGeneration(() => batch.emit());
    return batch;
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach(listener => listener()); }
  task(item: EntityBatchItem) { return getShotGeneration(`entity:${item.entity.id}`).history.find(task => task.taskId === item.taskId); }

  private persist(item: EntityBatchItem) {
    const value = structuredClone(item.draft);
    const reference = { useReference: item.useReference };
    const write = this.writes.then(() => db.transaction('rw', db.docs, async () => {
      const current = await loadDoc<ImagePromptDraft>(key(item.entity.id));
      if (JSON.stringify(current) !== JSON.stringify(item.saved)) throw Error('提示词已在其他窗口修改，请重新打开批量面板');
      const optionKey = `image:options:entity:${item.entity.id}`;
      if (JSON.stringify(await loadDoc(optionKey)) !== JSON.stringify(item.savedReference)) throw Error('参考图设置已在其他窗口修改，请重新打开批量面板');
      await db.docs.put({ key: key(item.entity.id), payload: value, updatedAt: Date.now() });
      await db.docs.put({ key: optionKey, payload: reference, updatedAt: Date.now() });
      item.saved = structuredClone(value);
      item.savedReference = reference;
    }));
    this.writes = write.catch(() => {});
    return write;
  }

  async edit(item: EntityBatchItem, patch: Partial<Pick<ImagePromptDraft, 'skillId' | 'requirements' | 'text'>> & { useReference?: boolean }) {
    if (this.busy || this.disposed) throw Error('请先停止当前批量操作');
    item.version++;
    const invalidates = patch.skillId !== undefined && patch.skillId !== item.draft.skillId || patch.requirements !== undefined && patch.requirements !== item.draft.requirements || patch.useReference !== undefined && patch.useReference !== item.useReference;
    const { useReference, ...draftPatch } = patch;
    if (useReference && !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(item.entity.image ?? '')) throw Error('该资产没有可用的参考图');
    if (useReference !== undefined) item.useReference = useReference;
    Object.assign(item.draft, draftPatch);
    if (invalidates) item.draft.sourceHash = '';
    item.error = false;
    item.generationFailed = false;
    item.message = item.draft.sourceHash ? '提示词已就绪' : '要求或 Skill 已变化，请优化提示词';
    try { await this.persist(item); }
    catch (error) { item.error = true; item.draft.sourceHash = ''; item.message = errorText(error); throw error; }
    finally { this.emit(); }
  }

  private async begin() {
    if (this.busy || this.disposed) throw Error('批量操作正在进行或面板已关闭');
    this.busy = true; this.stopped = false; this.emit();
    await this.writes;
  }
  private finish() { this.busy = false; this.emit(); }
  async stop() {
    this.stopped = true; this.emit();
    const requests=[...this.activeRequests];
    await Promise.allSettled(requests.map(id=>cancelWriting(id)));
  }
  dispose() { this.disposed = true; void this.stop().catch(() => {}); this.unsubscribe(); this.listeners.clear(); }

  async optimize(model: TextModel) {
    await this.begin();
    try {
      let next=0;
      const worker=async()=>{while(!this.stopped&&!this.disposed){
        const item=this.items[next++];if(!item)return;
        item.message = '正在优化提示词…'; item.error = false; this.emit();
        const version = item.version;
        let requestId:string|undefined;
        try {
          if (hasActiveTask(`entity:${item.entity.id}`)) throw Error('该资产仍在生成，请待任务结束后优化');
          const source = await prepareEntityPrompt(item.entity.id, item.draft.skillId, item.draft.requirements, item.useReference);
          if (this.stopped || this.disposed) return;
          await rememberSkill(`${item.entity.kind}-image` as SkillUse, source.skillId);
          if (this.stopped || this.disposed) return;
          requestId = crypto.randomUUID(); this.activeRequests.add(requestId);
          const text = await optimizeImagePrompt(source, model, requestId);
          if (this.stopped || this.disposed) { item.message = '已停止，保留原提示词'; return; }
          const current = await prepareEntityPrompt(item.entity.id, item.draft.skillId, item.draft.requirements, item.useReference);
          if (this.stopped || this.disposed) { item.message = '已停止，保留原提示词'; return; }
          if (version !== item.version || source.sourceHash !== current.sourceHash) throw Error('资产或 Skill 已变化，请重新优化');
          item.draft = { skillId: source.skillId, requirements: source.requirements, sourceHash: source.sourceHash, text, textModel: JSON.stringify([model.providerId, model.modelId]) };
          await this.persist(item); item.message = '优化完成，可检查或编辑提示词';
        } catch (error) { if(this.stopped||this.disposed){item.message='已停止，保留原提示词';}else{item.error = true; item.draft.sourceHash = ''; item.message = errorText(error);} }
        finally { if(requestId)this.activeRequests.delete(requestId); this.emit(); }
      }};
      await Promise.all(Array.from({length:Math.min(12,this.items.length)},()=>worker()));
    } finally { this.finish(); }
  }

  async generate(config: GenerationConfig, failedOnly = false) {
    await this.begin();
    try {
      await Promise.all(this.items.map(async item => {
        if (this.stopped || this.disposed) return;
        const previous = this.task(item);
        if (failedOnly && previous?.state !== 'failed' && !item.generationFailed) return;
        if (hasActiveTask(`entity:${item.entity.id}`)) { item.message = '已有任务，请查看生成记录；未重复提交'; return; }
        if (!failedOnly && previous?.state === 'succeeded' && previous.sourceHash === item.draft.sourceHash && previous.prompt === item.draft.text && JSON.stringify(previous.config) === JSON.stringify(config)) { item.message = '相同提示词已生成，可采用成功图片'; return; }
        if (!item.draft.sourceHash || !item.draft.text.trim()) { item.message = '请先优化并检查提示词'; item.error = true; return; }
        item.message = '正在提交…'; item.error = false; item.generationFailed = false; this.emit();
        const before = new Set(getShotGeneration(`entity:${item.entity.id}`).history.map(task => task.taskId));
        try {
          const current = await db.entities.get(item.entity.id); if (!current) throw Error('资产已删除');
          if (this.stopped || this.disposed) return;
          item.entity = current;
          await startEntityGeneration(item.entity.id, config, item.draft.skillId, item.draft.requirements, item.useReference, { ...item.draft }, () => !this.stopped && !this.disposed);
          item.message = this.stopped || this.disposed ? '后续操作已停止，请查看当前任务状态' : '已提交，等待图片生成';
        } catch (error) {
          const code = (error as { code?: string })?.code;
          item.error = code !== 'LOCAL_CANCELLED'; item.generationFailed = code !== 'LOCAL_CANCELLED'; item.message = errorText(error);
          if (code === 'STALE_IMAGE_PROMPT') item.draft.sourceHash = '';
        }
        finally {
          const submitted = getShotGeneration(`entity:${item.entity.id}`).history.find(task => !before.has(task.taskId));
          if (submitted) { item.taskId = submitted.taskId; item.generationFailed = false; }
          this.emit();
        }
      }));
    } finally { this.finish(); }
  }

  async adopt(replaceExisting: boolean) {
    await this.begin();
    try {
      for (const item of this.items) {
        if (this.stopped || this.disposed) break;
        const task = this.task(item);
        if (task?.state !== 'succeeded' || !task.outputs.length) continue;
        item.error = false;
        try {
          const current = await db.entities.get(item.entity.id);
          if (!current) throw Error('资产已删除');
          if (current.image && !replaceExisting) { item.message = '保留已有资产图'; continue; }
          const source = await prepareEntityPrompt(item.entity.id, item.draft.skillId, item.draft.requirements, item.useReference);
          if (this.stopped || this.disposed) break;
          if (source.sourceHash !== item.draft.sourceHash || task.sourceHash !== item.draft.sourceHash || task.prompt !== item.draft.text) throw Error('资产或提示词已变化，请在单项生图中检查后采用');
          item.entity = await adoptEntityImage(item.entity.id, task.outputs[0], item.entity, () => !this.stopped && !this.disposed);
          item.message = '已采用第一张成功图片';
        } catch (error) { item.error = (error as {code?:string})?.code !== 'LOCAL_CANCELLED'; item.message = errorText(error); }
        finally { this.emit(); }
      }
    } finally { this.finish(); }
  }
}
