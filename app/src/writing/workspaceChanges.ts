import {assertInspirationCapacity} from '../inspiration/inspirationStore';
import {syncProjectTitle} from '../projects/projectWriting';
import { db, type EntityRow, syncEntityShotNames } from '../data/db';
import { equalDocumentValue as same } from '../data/equalDocumentValue';
import { createEpisodeDocument, readDocument, saveDocument, validateBlocks, type DocumentSnapshot, type ScriptBlock, type WriteAuthorization } from './documentStore';

interface ValueChange { key: string; before: unknown; after: unknown }
interface ScriptChange { episodeId: string; before: DocumentSnapshot | null; after: ScriptBlock[]; applied?: DocumentSnapshot; undone?: DocumentSnapshot }
export interface WorkspaceChange {
  id: string; label: string; episodeId: string; screen: string; createdAt: number;
  status: 'pending' | 'applied' | 'undone' | 'rejected';
  docs: ValueChange[]; entities: ValueChange[]; scripts: ScriptChange[];
  result: Record<string, unknown>;
  scriptSetupTaskId?: string;
}
const key = (id: string) => `writing:workspaceChange:${id}`;
const conflict = () => { throw Error('内容已在本次操作后发生变化，请重新读取后再处理；现有内容没有被覆盖。'); };

/** A project operation is prepared and committed as one IndexedDB transaction.
 * The journal contains only touched records; undo never restores an entire database. */
export async function prepareWorkspaceChange(label: string, episodeId: string, screen: string, build: (draft: WorkspaceDraft) => Promise<Record<string, unknown>>) {
  return db.transaction('rw', db.docs, db.entities, async () => {
    const change: WorkspaceChange = { id: crypto.randomUUID(), label, episodeId, screen, createdAt: Date.now(), status: 'pending', docs: [], entities: [], scripts: [], result: {} };
    const draft = new WorkspaceDraft(change);
    change.result = await build(draft);
    if(change.docs.some(d=>d.key.startsWith('inspiration:')))await assertInspirationCapacity(change.docs.map(d=>({key:d.key,after:d.after})),change);
    await db.docs.add({ key: key(change.id), payload: change, updatedAt: Date.now() });
    return change;
  });
}
export class WorkspaceDraft {
  readonly change: WorkspaceChange;
  constructor(change: WorkspaceChange) { this.change=change; }
  async doc<T>(docKey: string): Promise<T | undefined> {
    const staged = this.change.docs.find(item => item.key === docKey);
    return structuredClone(staged ? staged.after : (await db.docs.get(docKey))?.payload) as T | undefined;
  }
  async setDoc(docKey: string, after: unknown) {
    const found = this.change.docs.find(item => item.key === docKey);
    if (found) { found.after = structuredClone(after); return; }
    const before = (await db.docs.get(docKey))?.payload;
    if (!same(before, after)) this.change.docs.push({ key: docKey, before, after: structuredClone(after) });
  }
  async setEntity(id: string, after: EntityRow | undefined) {
    if (this.change.entities.some(item => item.key === id)) throw Error('同一资产不能重复修改');
    const before = await db.entities.get(id);
    if (!same(before, after)) this.change.entities.push({ key: id, before, after });
  }
  async script(episodeId: string, after: ScriptBlock[], before: DocumentSnapshot | null) {
    if (this.change.scripts.some(item => item.episodeId === episodeId)) throw Error('同一剧集不能重复修改');
    this.change.scripts.push({ episodeId, before, after: validateBlocks(after) });
  }
}
export async function getWorkspaceChange(id: string): Promise<WorkspaceChange> {
  const change = (await db.docs.get(key(id)))?.payload as WorkspaceChange | undefined;
  if (!change || change.id !== id) throw Error('操作记录不存在');
  return change;
}
export async function listWorkspaceChanges() {
  const summaries: Pick<WorkspaceChange, 'id' | 'label' | 'screen' | 'createdAt' | 'status'>[] = [];
  // Consume one journal at a time. Before/after snapshots may contain full images.
  await db.docs.where('key').startsWith(key('')).each(row => {
    const {id, label, screen, createdAt, status} = row.payload as WorkspaceChange;
    summaries.push({id, label, screen, createdAt, status});
  });
  return summaries.sort((a, b) => b.createdAt - a.createdAt);
}
async function checkValues(changes: ValueChange[], entity: boolean, side: 'before' | 'after') {
  for (const value of changes) {
    const current = entity ? await db.entities.get(value.key) : (await db.docs.get(value.key))?.payload;
    if (!same(current, value[side])) conflict();
  }
}
async function putValues(changes: ValueChange[], entity: boolean, side: 'before' | 'after') {
  for (const value of changes) {
    const payload = value[side];
    if (entity) {
      if (payload === undefined) await db.entities.delete(value.key);
      else await db.entities.put(payload as EntityRow);
    } else {
      if (payload === undefined) await db.docs.delete(value.key);
      else await db.docs.put({ key: value.key, payload, updatedAt: Date.now() });
    }
  }
}
export async function applyWorkspaceChange(id: string, authorization: WriteAuthorization, checkTask?: (taskId: string) => Promise<void>) {
  if (!authorization || !('approvedByUser' in authorization && authorization.approvedByUser === true || 'agentWriteEnabled' in authorization && authorization.agentWriteEnabled === true)) throw Error('写入模式未开启');
  return db.transaction('rw', db.docs, db.entities, async () => {
    const change = await getWorkspaceChange(id);
    if (change.status === 'applied' || change.status === 'undone') return change;
    if (change.status !== 'pending') throw Error('操作已拒绝');
    if (change.scriptSetupTaskId) {
      if (!checkTask) throw Error('请在候选记录中校验来源并批准。');
      await checkTask(change.scriptSetupTaskId);
    }
    if(change.docs.some(d=>d.key.startsWith('inspiration:')))await assertInspirationCapacity(change.docs.map(d=>({key:d.key,after:d.after})),change);
    await checkValues(change.docs, false, 'before'); await checkValues(change.entities, true, 'before');
    for (const script of change.scripts) {
      if (script.before) {
        const current = await readDocument(script.episodeId);
        if (current.revision !== script.before.revision || !same(current.blocks, script.before.blocks)) conflict();
      } else if (await db.docs.get(`script:${script.episodeId}`)) conflict();
    }
    for (const script of change.scripts) {
      const current = script.before ?? await createEpisodeDocument(script.episodeId);
      script.applied = await saveDocument(script.episodeId, script.after, current.revision);
    }
    await putValues(change.docs, false, 'after');
    for(const entity of change.entities){
      if(!entity.before||!entity.after)continue;
      for(const linked of await syncEntityShotNames(entity.before as EntityRow,entity.after as EntityRow)){
        const existing=change.docs.find(doc=>doc.key===linked.key);
        if(existing)existing.after=linked.after;else change.docs.push(linked);
      }
    }
    await putValues(change.entities, true, 'after');
    change.status = 'applied';if(change.docs.some(d=>d.key==='project:meta'))queueMicrotask(()=>void syncProjectTitle());
    await db.docs.put({ key: key(id), payload: change, updatedAt: Date.now() });
    return change;
  });
}
export async function undoWorkspaceChange(id: string) {
  return db.transaction('rw', db.docs, db.entities, async () => {
    const change = await getWorkspaceChange(id);
    if (change.status === 'undone') return change;
    if (change.status !== 'applied') throw Error('只能撤销已写入的操作');
    if(change.docs.some(d=>d.key.startsWith('inspiration:')))await assertInspirationCapacity(change.docs.map(d=>({key:d.key,after:d.before})),change);
    await checkValues(change.docs, false, 'after'); await checkValues(change.entities, true, 'after');
    for (const script of change.scripts) {
      const current = await readDocument(script.episodeId);
      if (current.revision !== script.applied?.revision || !same(current.blocks, script.after)) conflict();
    }
    for (const script of change.scripts) script.undone = await saveDocument(script.episodeId, script.before?.blocks ?? [], script.applied!.revision);
    await putValues(change.docs, false, 'before'); await putValues(change.entities, true, 'before');
    change.status = 'undone';if(change.docs.some(d=>d.key==='project:meta'))queueMicrotask(()=>void syncProjectTitle());
    await db.docs.put({ key: key(id), payload: change, updatedAt: Date.now() });
    return change;
  });
}
export async function rejectWorkspaceChange(id: string) {
  return db.transaction('rw', db.docs, async () => {
    const change = await getWorkspaceChange(id);
    if (change.status !== 'pending') throw Error('只能拒绝尚未写入的操作');
    change.status = 'rejected'; await db.docs.put({ key: key(id), payload: change, updatedAt: Date.now() });
  });
}
