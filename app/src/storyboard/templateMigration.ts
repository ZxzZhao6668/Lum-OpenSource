import Dexie from 'dexie';
import { textFingerprint } from './shotVideoFingerprint';
import { db } from '../data/db';
import type { Shot } from './storyboard';
import { UNASSIGNED_SCENE } from '../script/sceneIdentity';

interface TemplateBackup { shots: Shot[]; removedIds: string[]; restoredAt?: number }
const backupKey = (episode: string) => `storyboard:${episode}:beforeTemplateCleanup`;
const markerKey = (episode: string) => `migration:templateShots:${episode}:v3`;
function imagePath(value: string | undefined) {
  try {
    const path = value ? new URL(value,location.origin).pathname : '';
    // The captured placeholder was renamed during Lum branding; persisted copies
    // still use the old path. Do not broaden this to arbitrary images or logos.
    return path === '/writing-mark.svg' ? '/brand/lumLogo.png' : path;
  } catch { return value; }
}
// Fingerprints of the three untouched records produced by older project initializers.
// They identify saved data independently of any UI, asset files or renderer.
const legacyFingerprints = new Set([
  '9907ea6f04a1b1b12b50688daee009601e2ce3b7e4a11c489be735180016993f',
  '0120fcffb38cf38ff1146b9cf97d1277e476749125e6fb711eb8a78c3f72f94e',
  'd24cb11f818a1cf7c63371f4cd1925f17c6fdc33030b1dcb53dfcd2d53d68283',
]);
async function isUneditedExample(shot: Shot) {
  if (!/^SHOT 0[123]$/.test(shot.no) || !shot.image || shot.image.length > 1024) return false;
  if (shot.duration !== undefined || shot.staging || shot.notes || shot.entityIds?.length ||
      shot.descMentions?.length || shot.setupSnapshot || shot.mediaPin || shot.mediaHistory?.length) return false;
  const fields = [shot.no, shot.type, shot.angle, shot.movement, shot.lens, shot.desc, shot.x, shot.y, imagePath(shot.image)];
  return legacyFingerprints.has(await textFingerprint(JSON.stringify(fields)));
}
/** Fix only unmodified template copies in projects created by the project home.
 * Preserve the full original row and provide a merge-based restore in project backups. */
export async function repairTemplateShots(episode: string, firstScene: string): Promise<Shot[] | undefined> {
  if (db.name === 'laper-data' || episode !== 'ep_001') return;
  return db.transaction('rw',db.docs,async()=>{
    if(await db.docs.get(markerKey(episode)))return;
    // v1 could miss hidden templates; v2 could miss the renamed brand placeholder.
    // Retry those projects, but never repeat cleanup after an earlier cleanup
    // or the user's restoration.
    if(await db.docs.get(backupKey(episode))){await db.docs.put({key:markerKey(episode),payload:{retainedPriorCleanup:true},updatedAt:Date.now()});return;}
    const meta=(await db.docs.get('project:meta'))?.payload as {emptyProjectVersion?:number}|undefined;
    if((meta?.emptyProjectVersion??0)>=2)return;
    const row=await db.docs.get(`storyboard:${episode}`);
    const shots=row?.payload as Shot[]|undefined;
    if(!Array.isArray(shots))return;
    const generation=(await db.docs.get('storyboard:ep_001:generation'))?.payload as {shots?:Record<string,{links?:unknown[];history?:unknown[];config?:unknown;selected?:unknown;useOriginal?:boolean}>}|undefined;
    const proposals=JSON.stringify(await db.docs.where('key').startsWith('writing:contentProposal:').toArray());
    const candidates = shots.filter(shot => {
      const used = generation?.shots?.[shot.id];
      if (used && (used.links?.length || used.history?.length || used.config || used.selected || used.useOriginal)) return false;
      return !proposals.includes(shot.id) && (shot.sceneId === firstScene || shot.sceneId === UNASSIGNED_SCENE);
    });
    const matches = await Dexie.waitFor(Promise.all(candidates.map(isUneditedExample)));
    const removed = candidates.filter((_, i) => matches[i]);
    let retained=shots;
    if(removed.length){
      const ids=removed.map(shot=>shot.id);
      retained=shots.filter(shot=>!ids.includes(shot.id));
      await db.docs.add({key:backupKey(episode),payload:{shots,removedIds:ids} satisfies TemplateBackup,updatedAt:Date.now()});
      await db.docs.put({key:`storyboard:${episode}`,payload:retained,updatedAt:Date.now()});
    }
    await db.docs.put({key:markerKey(episode),payload:{removed:removed.length},updatedAt:Date.now()});
    return retained;
  });
}
export async function templateCleanupBackup(episode='ep_001') {
  return (await db.docs.get(backupKey(episode)))?.payload as TemplateBackup|undefined;
}
export async function restoreTemplateShots(episode='ep_001') {
  await db.transaction('rw',db.docs,async()=>{
    const backup=await templateCleanupBackup(episode);if(!backup)return;
    const row=await db.docs.get(`storyboard:${episode}`);const current=(row?.payload??[]) as Shot[];
    const ids=new Set(current.map(shot=>shot.id));
    await db.docs.put({key:`storyboard:${episode}`,payload:[...current,...backup.shots.filter(shot=>backup.removedIds.includes(shot.id)&&!ids.has(shot.id))],updatedAt:Date.now()});
    await db.docs.put({key:backupKey(episode),payload:{...backup,restoredAt:Date.now()},updatedAt:Date.now()});
  });
}
