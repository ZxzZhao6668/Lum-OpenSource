import { db } from "../data/db";
import type { ScriptBlock } from "../script/editor";
import { parseScene, sceneRef, UNASSIGNED_SCENE } from "../script/sceneIdentity";
import type { Shot } from './shotModel';

/** Upgrade title-based associations before a script title can change. Never guess
 * by position: unmatched/ambiguous legacy associations stay recoverable. */
export async function migrateSceneReferences(episodeId: string, blocks: readonly ScriptBlock[]): Promise<Shot[] | null> {
  return db.transaction("rw", db.docs, async () => {
    const sceneLabels=new Map<string,string[]>();
    for(const b of blocks){if(b.type!=='scene')continue;const s=parseScene(b.text,1);if(!s)continue;const label=(s.timeOfDay?`${s.intExt} ${s.location} - ${s.timeOfDay}`:`${s.intExt} ${s.location}`).replace(/\s+/g,' ').trim();sceneLabels.set(label,[...(sceneLabels.get(label)??[]),sceneRef(b.id)]);}
    for(const dataKey of [`scene:desc:${episodeId}`,`scenes:canvas:${episodeId}`]){
      const dataRow=await db.docs.get(dataKey);if(!dataRow||!dataRow.payload||typeof dataRow.payload!=='object'||Array.isArray(dataRow.payload))continue;
      const value=dataRow.payload as Record<string,unknown>;
      const map=dataKey.startsWith('scene:desc:')?value:value.nodes as Record<string,unknown>;
      if(!map||typeof map!=='object'||Array.isArray(map))continue;let changed=false;
      for(const [label,ids] of sceneLabels){if(ids.length===1&&Object.hasOwn(map,label)&&!Object.hasOwn(map,ids[0])){map[ids[0]]=map[label];changed=true;}}
      if(changed)await db.docs.update(dataKey,{payload:value,updatedAt:Date.now()});
    }
    const key = `storyboard:${episodeId}`;
    const row = await db.docs.get(key);
    if (!row || !Array.isArray(row.payload)) return null;
    const labels = new Map<string, Set<string>>();
    const compact = (text: string) => text.replace(/[\s\u200B]/g, "");
    const scenes = blocks.filter(b => b.type === "scene" && parseScene(b.text,1));
    for (const block of scenes) {
      const scene = parseScene(block.text,scenes.indexOf(block)+1)!;
      const label = compact(`${scene.index}. ${scene.intExt} ${scene.location} ${scene.timeOfDay}`);
      const matches = labels.get(label) ?? new Set<string>();
      matches.add(sceneRef(block.id)); labels.set(label, matches);
    }
    const resolve = (old: unknown): string | undefined => {
      if (old === undefined) return scenes[0] ? sceneRef(scenes[0].id) : UNASSIGNED_SCENE;
      if (typeof old !== "string" || old.startsWith("block:") || old === UNASSIGNED_SCENE) return undefined;
      if (old === "scene-1") return UNASSIGNED_SCENE;
      const matches = labels.get(compact(old));
      return matches?.size === 1 ? [...matches][0] : undefined;
    };
    let changed = false;
    const shots = row.payload.map(shot => {
      if (!shot || typeof shot !== "object" || Array.isArray(shot)) return shot;
      const next = resolve(shot.sceneId);
      if (!next || next === shot.sceneId) return shot;
      changed = true;
      return { ...shot, sceneId: next };
    });
    const viewRow = await db.docs.get(`${key}:views`);
    let viewsChanged = false;
    const views = viewRow?.payload;
    const nextViews = views && typeof views === "object" && !Array.isArray(views) ? { ...views } as Record<string, unknown> : null;
    if (nextViews) for (const [old, view] of Object.entries(nextViews)) {
      const next = resolve(old);
      if (next && !Object.hasOwn(nextViews, next)) { nextViews[next] = view; viewsChanged = true; }
    }
    if (!changed && !viewsChanged) return row.payload as Shot[];
    const backupKey = `${key}:beforeStableScenes`;
    if (!(await db.docs.get(backupKey))) await db.docs.add({ key: backupKey, updatedAt: Date.now(), payload: { shots: row.payload, views: viewRow?.payload ?? null } });
    if (changed) await db.docs.update(key, { payload: shots, updatedAt: Date.now() });
    if (viewsChanged) await db.docs.update(`${key}:views`, { payload: nextViews, updatedAt: Date.now() });
    return (changed ? shots : row.payload) as Shot[];
  });
}
