import { equalDocumentValue } from '../data/equalDocumentValue';
import { db, loadDoc, saveDoc } from '../data/db';
import { action, modal, node } from '../ui/localUi';
import { getActiveContentEditor } from '../writing/contentEditor';
import { scriptSetupVisualStyleText, scriptSetupVisualText, validateScriptSetupVisualSnapshot, type ScriptSetupSnapshot, type ScriptSetupVisualSnapshot } from './scriptSetupContext';
import { prepareScriptSetupContext } from './scriptSetupReview';
import { assertScriptSetupProject, readScriptSetup, readScriptSetupWorkspaceEpoch, scriptSetupProjectId } from './scriptSetupStore';
import type { Shot } from '../storyboard/shotModel';

export type ShotSetupCharacter = Readonly<{entityId:string; name:string; identity:string; appearance:string; lockedFields: readonly ('identity'|'appearance')[]}>;
export type ShotSetupSnapshot = Readonly<{
  shotId: string; projectId: string; workspaceEpoch: string; episodeId: string; sceneId?: string;
  visual: ScriptSetupVisualSnapshot | null; locked: boolean; characters?: readonly ShotSetupCharacter[];
}>;

export function bindShotSetup(shot: Shot, episodeId: string, setup: ScriptSetupSnapshot | null, epoch: string): ShotSetupSnapshot {
  const sceneId = shot.sceneId && shot.sceneId !== 'unassigned' ? shot.sceneId : undefined;
  const visual = setup?.visual;
  const refs = new Set(shot.entityIds ?? []);
  const source = visual && Object.freeze({...visual, episodeId, sceneId, profileVersions: Object.freeze(visual.profileVersions.filter(v => refs.has(v.entityId)))});
  const characters = setup?.characters.flatMap(({entityId,name,profile,adoptedAppearance}) => entityId && refs.has(entityId) && profile
    ? [Object.freeze({entityId,name,identity:profile.identity,appearance:adoptedAppearance ? '' : profile.appearance,
      lockedFields:Object.freeze(profile.lockedFields.filter(field=>field==='identity'||field==='appearance'))})] : []);
  return Object.freeze({shotId: shot.id, projectId: setup?.projectId ?? scriptSetupProjectId, workspaceEpoch: setup?.workspaceEpoch ?? epoch,
    episodeId, sceneId, visual: source ?? null, ...(characters?.length ? {characters:Object.freeze(characters)} : {}), locked: !!setup && setup.payload.constraints.lockedFields.includes('visualStyle')});
}

export function validateShotSetup(value: unknown, shotId?: string): ShotSetupSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('镜头设定快照无效');
  const v = value as ShotSetupSnapshot;
  const key = (s: unknown, max = 200) => typeof s === 'string' && s.length > 0 && s.length <= max && !s.includes('\0');
  if (Object.keys(v).some(k => !['shotId','projectId','workspaceEpoch','episodeId','sceneId','visual','locked','characters'].includes(k)) ||
      !key(v.shotId) || shotId !== undefined && v.shotId !== shotId || !key(v.projectId) || !key(v.episodeId)
      || v.sceneId !== undefined && !key(v.sceneId, 210) || typeof v.locked !== 'boolean' ||
      typeof v.workspaceEpoch !== 'string' || v.workspaceEpoch !== '' && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v.workspaceEpoch))
    throw Error('镜头设定来源无效');
  if (v.characters !== undefined && (!Array.isArray(v.characters) || v.characters.length > 100 ||
      new Set(v.characters.map(c=>c?.entityId)).size !== v.characters.length || v.characters.some(c=>
        !c || !key(c.entityId) || !key(c.name,1000) || ![c.identity,c.appearance].every(text=>typeof text==='string' && text.length<=4000 && !text.includes('\0'))
        || Object.keys(c).some(k=>!['entityId','name','identity','appearance','lockedFields'].includes(k)) ||
        !Array.isArray(c.lockedFields) || new Set(c.lockedFields).size!==c.lockedFields.length ||
        c.lockedFields.some((field:unknown)=>field!=='identity'&&field!=='appearance')))) throw Error('镜头人物造型快照无效');
  if (v.visual !== null) {
    const visual = validateScriptSetupVisualSnapshot(v.visual);
    if (visual.projectId !== v.projectId || visual.workspaceEpoch !== v.workspaceEpoch || visual.episodeId !== v.episodeId || visual.sceneId !== v.sceneId)
      throw Error('镜头设定快照与来源不符');
    const characters = v.characters?.map(c=>Object.freeze({...c,lockedFields:Object.freeze([...c.lockedFields])}));
    if (characters?.some(c=>!visual.profileVersions.some(p=>p.entityId===c.entityId))) throw Error('镜头人物造型来源不符');
    return Object.freeze({...v, visual, ...(characters ? {characters:Object.freeze(characters)} : {})});
  }
  if (v.locked || v.characters?.length) throw Error('无设定镜头不能锁定画风');
  return Object.freeze({...v});
}

export function shotAppearanceText(shot: Shot) {
  const refs=new Set(shot.entityIds ?? []);
  return (shot.setupSnapshot?.characters ?? []).filter(c=>refs.has(c.entityId)).flatMap(c=>{
    const details = [c.identity && `身份：${c.identity}`, c.appearance && `外貌：${c.appearance}`].filter(Boolean);
    return details.length ? [`${c.name} · ${details.join('；')}`] : [];
  }).join('\n');
}
export function shotAppearanceLocks(shot: Shot) {
  return (shot.setupSnapshot?.characters ?? []).filter(c=>shot.entityIds?.includes(c.entityId) && c.lockedFields.length);
}
export async function confirmShotAppearanceLocks(shots: readonly Shot[]) {
  const locked = shots.flatMap(shot=>shotAppearanceLocks(shot).map(c=>({shot,c})));
  if (!locked.length) return;
  const {dialog,body} = modal('核对本次镜头的锁定人物特征');
  body.append(node('p','请将本次要求和现有提示词与以下已锁定事实核对。若冲突，返回修改提示词或核对已采用的人设与造型。'));
  for (const {shot,c} of locked) body.append(node('h3',`镜头 ${shot.no} · ${c.name} [${c.entityId}]`),
    node('pre', c.lockedFields.map(field=>field==='identity' ? `身份：${c.identity}` : `外貌：${c.appearance || '以已采用造型为准'}`).join('\n')));
  await new Promise<void>((resolve,reject)=>{
    body.append(action('遵守锁定特征并继续',()=>{resolve();dialog.close();}),action('返回修改',()=>dialog.close()));
    dialog.addEventListener('close',()=>reject(Error('已取消，未创建任务')),{once:true});
  });
}

export const shotStyleText = (snapshot?: ShotSetupSnapshot) => snapshot?.visual ? scriptSetupVisualText(snapshot.visual) : '';
export const shotStyleMedia = (snapshot?: ShotSetupSnapshot) => snapshot?.visual?.style.referenceMediaId;
export function shotStyleLabel(snapshot?: ShotSetupSnapshot) {
  if (!snapshot) return '旧镜头 · 尚未固定画风';
  if (!snapshot.visual) return '保持旧行为 · 不使用项目画风';
  return `固定项目设定 v${snapshot.visual.setupRevision} · ${snapshot.visual.style.preset?.label ?? (snapshot.visual.style.customText ? '自定义画风' : '未设置画风')}${shotStyleMedia(snapshot) ? ' · 含风格参考图' : ''}`;
}

export async function compileShotSetup(shot: Shot, episodeId: string, alive?: () => boolean, readOnly = false) {
  const epoch = await readScriptSetupWorkspaceEpoch();
  const {snapshot} = await prepareScriptSetupContext({purpose:'visual', episodeId, sceneId: shot.sceneId, entityIds: shot.entityIds ?? []},
    {cancelled: alive && (() => !alive()), readOnly});
  return bindShotSetup(shot, episodeId, snapshot, epoch);
}

/** The selection commits only after the user sees the effective version, and never replaces the source media. */
export async function chooseShotSetup(episodeId: string, shotIds: readonly string[], options: {adopt?: boolean; alive?: () => boolean} = {}) {
  const alive = options.alive ?? (() => true);
  if (!alive()) throw Error('操作已取消');
  assertScriptSetupProject();
  const key = `storyboard:${episodeId}`;
  const original = await loadDoc<Shot[]>(key) ?? [];
  const targets = shotIds.map(id => {
    const shot = original.find(item => item.id === id);
    if (!shot) throw Error('镜头不存在，请重新打开分镜');
    return shot;
  }).filter(shot => options.adopt || shot.setupSnapshot === undefined);
  if (!targets.length) return false;
  const epoch = await readScriptSetupWorkspaceEpoch();
  const confirmed = await readScriptSetup();
  if (!confirmed && !options.adopt) return false;
  const {dialog, body} = modal(options.adopt ? '采用最新项目设定' : '首次制作 · 固定镜头画风');
  dialog.classList.add('scriptSetupDialog');
  body.append(node('p', options.adopt ? '新任务将使用下列项目设定，已有图片、视频和任务保留。' : '请为下面的旧镜头固定当前项目画风，或继续使用原有行为。'));
  for (const shot of targets) {
    body.append(node('h3', `镜头 ${shot.no}`), node('p', `原：${shotStyleLabel(shot.setupSnapshot)}`));
    const text = shotStyleText(shot.setupSnapshot);
    if (text) body.append(node('pre', text));
  }
  const style = confirmed?.payload.visualStyle;
  const latest = style && scriptSetupVisualStyleText(style);
  body.append(node('p', `新：${confirmed ? `项目设定 v${confirmed.revision}` : '未设置'}${style?.referenceMediaId ? ' · 含风格参考图' : ''}`));
  if (latest) body.append(node('pre', latest));
  const choice = await new Promise<'current'|'legacy'|null>(resolve => {
    const select = (value:'current'|'legacy') => { resolve(value); dialog.close(); };
    body.append(action(options.adopt ? '确认采用最新项目设定' : '固定当前项目设定', () => select('current')));
    if (!options.adopt) body.append(action('保持旧行为（不使用项目画风）', () => select('legacy')));
    body.append(action('取消', () => dialog.close()));
    dialog.addEventListener('close', () => resolve(null), {once:true});
  });
  if (!choice || !alive()) throw Error('已取消，未创建任务');
  const snapshots = new Map<string, ShotSetupSnapshot>();
  for (const shot of targets) {
    const value = choice === 'current' ? await compileShotSetup(shot, episodeId, alive, true) : bindShotSetup(shot, episodeId, null, epoch);
    if (value.workspaceEpoch !== epoch || choice === 'current' && value.visual?.setupVersionId !== confirmed?.versionId)
      throw Error('项目设定或工作区已变化，请重新预览');
    snapshots.set(shot.id, value);
  }
  const editor = getActiveContentEditor();
  await editor?.flush();
  await db.transaction('rw', db.docs, async () => {
    assertScriptSetupProject();
    if (!alive() || await readScriptSetupWorkspaceEpoch() !== epoch || (await readScriptSetup())?.versionId !== confirmed?.versionId)
      throw Error('项目设定或工作区已变化，请重新预览');
    const current = await loadDoc<Shot[]>(key) ?? [];
    if (targets.some(shot => !equalDocumentValue(current.find(item => item.id === shot.id),shot)))
      throw Error('镜头已变化，请重新核对画风');
    await saveDoc(key, current.map(shot => snapshots.has(shot.id) ? {...shot, setupSnapshot:snapshots.get(shot.id)} : shot));
  });
  if (editor === getActiveContentEditor()) await editor?.reload();
  return true;
}
