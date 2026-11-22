import { shotStyleMedia, validateShotSetup } from '../scriptSetup/shotSetup';
import { SCRIPT_SETUP_WORKSPACE_EPOCH, validateScriptSetupBackup } from '../scriptSetup/scriptSetupStore';
import { SCRIPT_SETUP_CANON_KEY, validateCanonResolution, validateScriptSetupSnapshot } from '../scriptSetup/scriptSetupContext';
import { validateScriptSetupTaskBackup } from '../scriptSetup/scriptSetupTasks';
import { validateCharacterProfileBackup } from '../scriptSetup/characterProfiles';
import { validateShotMediaPin } from '../storyboard/shotMedia';
import {validateInspirationDoc} from '../inspiration/inspirationStore';
import {BOARD_KEY,validateWritingBoard} from '../novel/writingBoard';
import {BIBLE_KEY,validateStoryBible} from '../novel/storyBible';
import {LOCATION_GROUPS,validateProjectMeta,validateLocationGroups} from '../projects/projectWriting';
import { db, type DocRow, type EntityRow } from '../data/db';
import { validateBlocks } from '../writing/documentStore';
import { validateSelectionRunBackup } from '../writing/selectionRun';
import { validateWritingRequestSource } from '../writing/writingRequestSource';
import { FILE_PREFIX,FILE_LIMITS,validateProjectFile } from '../writing/projectFiles';
import { validateBeats } from '../beats/beatModel';
import { SKILL_PREFIX,validateSkill,validateSkillRecords } from '../skills/skillStore';
import {WORLD_ENTRIES,validateWorldEntries} from '../worldview/worldviewModel';
import { blobDataUrl } from '../entities/entityImageUpload';
import { assetMediaLimits, imageDataUrlBlob, imageDataUrlBytes, readAssetMedia, type AssetMedia } from '../assetLibrary/assetMedia';
import { isProjectAssetMediaId, validateProjectAssetSnapshot } from '../assetLibrary/assetSnapshot';
interface BackupAssetMedia { id: string; dataUrl: string }
export interface WorkspaceBackup {
  format: 'local-writing-workspace'; version: 1; createdAt: string; docs: DocRow[]; entities: EntityRow[];
  assetMedia?: BackupAssetMedia[];
}
type WorkspaceRows = Pick<WorkspaceBackup, 'docs' | 'entities'>;
const recoveryKey = 'workspace:beforeRestore';
export const workspaceBackupLimit = 100 * 1024 * 1024;

function referencedMedia({docs, entities}: WorkspaceRows) {
  const ids = new Set<string>();
  const entity = (row: unknown) => {
    const pin = (row as { assetSnapshot?: unknown } | undefined)?.assetSnapshot;
    if (pin !== undefined) ids.add(validateProjectAssetSnapshot(pin).view.mediaId);
  };
  const shotSetup = (value: unknown, shotId?: string) => {const media = shotStyleMedia(validateShotSetup(value, shotId));if (media) ids.add(media);};
  const shotRows = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const shot of value) {
      if (shot?.setupSnapshot !== undefined) shotSetup(shot.setupSnapshot, shot.id);
      if (shot?.mediaPin !== undefined) ids.add(validateShotMediaPin(shot.mediaPin).mediaId);
      if (shot?.mediaHistory !== undefined) {
        if (!Array.isArray(shot.mediaHistory)) throw Error('分镜原图历史损坏');
        for (const previous of shot.mediaHistory) if (previous?.pin !== undefined) ids.add(validateShotMediaPin(previous.pin).mediaId);
      }
    }
  };
  validateScriptSetupBackup(docs).forEach(id => ids.add(id));
  validateScriptSetupTaskBackup(docs).forEach(id => ids.add(id));
  validateSelectionRunBackup(docs).forEach(id => ids.add(id));
  entities.forEach(entity);
  for (const doc of docs) {
    if (doc.key === SCRIPT_SETUP_CANON_KEY) validateCanonResolution(doc.payload);
    if (/^writing:(session:|sessionArchive:|episodeArchive:)/.test(doc.key)) {
      const messages = (doc.payload as { messages?: { role?: unknown; scriptSetup?: unknown; writingSource?: unknown }[] })?.messages;
      if (Array.isArray(messages)) for (const message of messages) {
        if (message?.writingSource !== undefined) {
          if (message.role !== 'user') throw Error('写作请求来源只能关联用户请求。');
          validateWritingRequestSource(message.writingSource);
        }
        if (message?.scriptSetup === undefined || message.scriptSetup === null) continue;
        const mediaId = validateScriptSetupSnapshot(message.scriptSetup).visual.style.referenceMediaId;
        if (mediaId) ids.add(mediaId);
      }
    }
    if (/^storyboard:[^:]+$/.test(doc.key)) shotRows(doc.payload);
    if (doc.key === 'production:clips') for (const clip of (doc.payload as {clips?: {shotIds?: string[];setupSnapshots?: unknown[]}[]})?.clips ?? []) {
      if (clip.setupSnapshots === undefined) continue;
      if (!Array.isArray(clip.setupSnapshots) || clip.setupSnapshots.length > 1000) throw Error('胶卷镜头画风快照无效');
      const seen = new Set<string>();
      for (const value of clip.setupSnapshots) {const snapshot=validateShotSetup(value);if (!clip.shotIds?.includes(snapshot.shotId) || seen.has(snapshot.shotId)) throw Error('胶卷镜头画风来源不匹配');seen.add(snapshot.shotId);shotSetup(snapshot);}
    }
    if (doc.key === 'storyboard:ep_001:generation') for (const [shotId, row] of Object.entries((doc.payload as {shots?: Record<string, {history?: {setupSnapshot?:unknown;styleOverride?:unknown}[]}>})?.shots ?? {}))
      for (const task of row.history ?? []) {
        if (task.setupSnapshot !== undefined) shotSetup(task.setupSnapshot, shotId);
        if (task.styleOverride !== undefined && (typeof task.styleOverride !== 'string' || task.styleOverride.length > 2000 || task.styleOverride.includes('\0'))) throw Error('历史任务画风覆盖无效');
      }
    if (doc.key.startsWith('writing:workspaceChange:')) {
      const documents = (doc.payload as { docs?: { key?: string; before?: unknown; after?: unknown }[] })?.docs;
      for (const change of documents ?? []) if (/^storyboard:[^:]+$/.test(change.key ?? '')) { shotRows(change.before); shotRows(change.after); }
    }
    if (doc.key.startsWith('entity:deleted:')) entity(doc.payload);
    if (doc.key.startsWith('writing:workspaceChange:')) {
      const changes = (doc.payload as { entities?: { before?: unknown; after?: unknown }[] } | undefined)?.entities;
      if (Array.isArray(changes)) for (const change of changes) {
        entity(change?.before);
        entity(change?.after);
      }
    }
  }
  return ids;
}

async function readWorkspaceRows(): Promise<WorkspaceRows> {
  return { docs: (await db.docs.toArray()).filter(row => row.key !== recoveryKey), entities: await db.entities.toArray() };
}

async function readMedia(rows: WorkspaceRows): Promise<AssetMedia[]> {
  const media: AssetMedia[] = [];
  let bytes = 0;
  for (const id of referencedMedia(rows)) {
    const item = await db.assetMedia.get(id);
    if (!item) throw Error('项目快照所需的原图缺失，无法创建完整备份');
    bytes += 4 * Math.ceil(item.bytes / 3) + 24;
    if (bytes > workspaceBackupLimit) throw Error('项目固定原图合计超过写作备份的 100MB 限制');
    media.push(item);
  }
  return media;
}

async function encodeBackup(rows: WorkspaceRows, media: AssetMedia[], createdAt = new Date().toISOString()): Promise<WorkspaceBackup> {
  const assetMedia: BackupAssetMedia[] = [];
  for (const item of media) {
    assetMedia.push({ id: item.id, dataUrl: await blobDataUrl(item.original) });
  }
  return { format: 'local-writing-workspace', version: 1, createdAt, ...rows, ...(assetMedia.length ? { assetMedia } : {}) };
}

export async function exportWorkspace(rows?: WorkspaceRows, createdAt?: string): Promise<WorkspaceBackup> {
  const snapshot = await db.transaction('r', [db.docs, db.entities, db.assetMedia], async () => {
    const data = rows ?? await readWorkspaceRows();
    return { data, media: await readMedia(data) };
  });
  return encodeBackup(snapshot.data, snapshot.media, createdAt);
}

export function parseWorkspaceBackup(text:string):WorkspaceBackup {
  if(text.length>workspaceBackupLimit)throw Error('备份超过100MB，请拆分外部图片后重试');
  const data=JSON.parse(text) as WorkspaceBackup;
  if(!data||data.format!=='local-writing-workspace'||data.version!==1||!Array.isArray(data.docs)||!Array.isArray(data.entities)||data.docs.length>50000||data.entities.length>10000)throw Error('不是有效的写作工作区备份');
  const keys=new Set<string>();for(const row of data.docs){if(!row||typeof row.key!=='string'||!row.key||row.key.length>1000||keys.has(row.key)||row.key===recoveryKey||!Number.isFinite(row.updatedAt)||!('payload'in row))throw Error('备份文档记录损坏或重复');keys.add(row.key);if(row.key.startsWith('script:'))validateBlocks(row.payload);
    if(row.key.startsWith(FILE_PREFIX))validateProjectFile(row.payload,row.key.slice(FILE_PREFIX.length));
    if(row.key.startsWith('beats:'))validateBeats(row.payload);
    if(row.key.startsWith('inspiration:'))validateInspirationDoc(row.key,row.payload);
    if(row.key==='project:meta')validateProjectMeta(row.payload);if(row.key===LOCATION_GROUPS)validateLocationGroups(row.payload);
    if(row.key===BIBLE_KEY)validateStoryBible(row.payload);
    if(row.key===BOARD_KEY)validateWritingBoard(row.payload);
    if(row.key===WORLD_ENTRIES)validateWorldEntries(row.payload);
    if(row.key.startsWith(SKILL_PREFIX)){const skill=validateSkill(row.payload);if(row.key!==SKILL_PREFIX+skill.id)throw Error('Skill 备份 ID 不匹配');}
    if(row.key.startsWith('outline:')){const p=row.payload as {docs?:{html:string}[]};if(!Array.isArray(p?.docs))throw Error('大纲结构无效');for(const d of p.docs){if(typeof d.html!=='string')throw Error('大纲内容无效');const html=new DOMParser().parseFromString(d.html,'text/html');if(html.querySelector('script,iframe,object,embed,link,style')||[...html.querySelectorAll('*')].some(el=>[...el.attributes].some(a=>/^on/i.test(a.name)||/javascript\s*:/i.test(a.value))))throw Error('备份包含不支持的可执行HTML');}}
  }
  validateSkillRecords(data.docs);
  validateCharacterProfileBackup(data.docs);
  const files=data.docs.filter(row=>row.key.startsWith(FILE_PREFIX));if(files.length>FILE_LIMITS.count||files.reduce((sum,row)=>sum+validateProjectFile(row.payload).bytes,0)>FILE_LIMITS.totalBytes)throw Error('备份中的项目资料超过容量限制');
  const ids=new Set<string>();for(const row of data.entities){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||!['character','location','prop'].includes(row.kind)||![row.name,row.meta,row.desc].every(v=>typeof v==='string')||!Number.isFinite(row.order))throw Error('资产记录损坏或重复');ids.add(row.id);}
  const index=data.docs.find(r=>r.key==='episode:ep_001')?.payload as {chapters?:{id:string;episodeId?:string;title:string;draft?:boolean}[]}|undefined;
  if(!index||!Array.isArray(index.chapters)||!index.chapters.length||index.chapters.some(c=>!c||typeof c.id!=='string'||typeof c.title!=='string'))throw Error('备份缺少有效剧集列表');
  if(index.chapters.some(c=>c.draft!==undefined&&typeof c.draft!=='boolean'))throw Error('备份章节草稿标记无效');
  const media = data.assetMedia === undefined ? [] : data.assetMedia;
  const referenced = referencedMedia(data), mediaIds = new Set<string>();
  if (!Array.isArray(media) || media.length > 10000) throw Error('项目原图备份列表损坏');
  for (const row of media) {
    if (!row || !isProjectAssetMediaId(row.id) || mediaIds.has(row.id) || !referenced.has(row.id)) {
      throw Error('项目原图备份记录损坏或重复');
    }
    imageDataUrlBytes(row.dataUrl, assetMediaLimits.bytes);
    mediaIds.add(row.id);
  }
  if (referenced.size !== mediaIds.size) throw Error('备份缺少已固定的项目原图');

  return data;
}
export async function restoreWorkspace(data: WorkspaceBackup): Promise<void> {
  const validated = parseWorkspaceBackup(JSON.stringify(data));
  const media: AssetMedia[] = [];
  for (const row of validated.assetMedia ?? []) {
    const original = await readAssetMedia(await imageDataUrlBlob(row.dataUrl, assetMediaLimits.bytes));
    if (original.id !== row.id) throw Error('项目原图校验失败，无法恢复备份');
    media.push(original);
  }
  await replaceWorkspaceRows(validated, media);
}

/** Local history references the same immutable project originals. */
export async function restoreLocalWorkspaceVersion(version: WorkspaceRows & { createdAt: number }): Promise<void> {
  const backup = await exportWorkspace(version, new Date(version.createdAt).toISOString());
  await restoreWorkspace(backup);
}

async function replaceWorkspaceRows(data: WorkspaceRows, media: AssetMedia[]) {
  await db.transaction('rw', [db.docs, db.entities, db.assetMedia], async () => {
    const before = await readWorkspaceRows();
    // The existing recovery point and local history can still reference these immutable rows.
    for (const id of referencedMedia(before)) {
      if (!await db.assetMedia.where('id').equals(id).count()) throw Error('当前项目原图缺失，无法创建恢复点');
    }
    for (const item of media) {
      if (!await db.assetMedia.where('id').equals(item.id).count()) await db.assetMedia.add(item);
    }
    await db.docs.clear();
    await db.entities.clear();
    await db.docs.bulkAdd(data.docs);
    // Invalidate editors in other windows even when the restored version IDs match.
    await db.docs.put({key: SCRIPT_SETUP_WORKSPACE_EPOCH, payload: crypto.randomUUID(), updatedAt: Date.now()});
    await db.entities.bulkAdd(data.entities);
    await db.docs.put({ key: recoveryKey, payload: {
      format: 'local-writing-workspace', version: 1, createdAt: new Date().toISOString(), ...before,
    }, updatedAt: Date.now() });
  });
}

export async function previousWorkspace() {
  const previous = (await db.docs.get(recoveryKey))?.payload as WorkspaceBackup | undefined;
  if (!previous || previous.assetMedia) return previous;
  return exportWorkspace({ docs: previous.docs, entities: previous.entities }, previous.createdAt);
}
