import {shotAppearanceText, type ShotSetupSnapshot} from '../scriptSetup/shotSetup';
import {effectiveShotGenerationImage} from '../storyboard/shotMedia';
import {db, type EntityRow} from '../data/db';
import {storyScenes,type Shot} from '../storyboard/shotModel';
import type {ScriptBlock} from '../script/editor';
import type {ReferenceImage} from '../storyboard/generationState';
export interface ProductionMaterial {key:string;kind:'entity'|'scene'|'shot'|'clip';title:string;text:string;episodeId?:string;episodeTitle?:string;entityKind?:string;dependencies:string[];setupSnapshot?:ShotSetupSnapshot;image?:ReferenceImage;imageKey?:string;imageSource?:{assetId:string;appearanceId:string;revision:number;viewId:string;mediaId:string}}
export interface ProductionSnapshot {docs: Map<string, unknown>; entities: EntityRow[]; episodeId?: string}
/** Read only production inputs, once. Chat histories and saved batch signatures may contain large media. */
export async function readProductionSnapshot(episodeId?: string): Promise<ProductionSnapshot> {
 const initial = await db.docs.bulkGet(['episode:ep_001', 'production:clips', 'storyboard:ep_001:generation']);
 const docs = new Map(initial.flatMap(row => row ? [[row.key, row.payload] as const] : []));
 const index = docs.get('episode:ep_001') as {chapters?: {episodeId: string}[]} | undefined;
 const stored = docs.get('production:clips') as {clips?: {episodeId: string}[]} | undefined;
 const ids = episodeId ? [episodeId] : [...new Set([...(index?.chapters ?? []).map(c => c.episodeId), ...(stored?.clips ?? []).map(c => c.episodeId)])];
 const rows = await db.docs.bulkGet(ids.flatMap(id => [`script:${id}`, `storyboard:${id}`, `entities:links:${id}`]));
 for (const row of rows) if (row) docs.set(row.key, row.payload);
 const shots = (docs.get(`storyboard:${episodeId}`) ?? []) as Shot[];
 const links = (docs.get(`entities:links:${episodeId}`) ?? {}) as Record<string, string[]>;
 const refs = [...new Set([...shots.flatMap(s => s.entityIds ?? []), ...Object.values(links).flat()])];
 // Explicit clip asset selections are also production inputs.
 for (const clip of (docs.get('production:clips') as {clips?: {episodeId: string; assetIds?: string[]}[]})?.clips ?? []) {
  if (clip.episodeId === episodeId) refs.push(...clip.assetIds ?? []);
 }
 const entities = episodeId ? (await db.entities.bulkGet([...new Set(refs)].sort())).filter((row): row is EntityRow => Boolean(row)) : await db.entities.toArray();
 return {docs, entities, episodeId};
}
export async function collectProductionMaterials(snapshot?:ProductionSnapshot):Promise<ProductionMaterial[]>{
 return db.transaction('r',db.docs,db.entities,async()=>{
  const {docs, entities, episodeId} = snapshot ?? await readProductionSnapshot();const entityMap=new Map(entities.map(e=>[e.id,e]));
  const index=docs.get('episode:ep_001') as {chapters?:{episodeId:string;title:string}[]}|undefined;
  const generation=docs.get('storyboard:ep_001:generation') as {shots?:Record<string,{selected?:ReferenceImage;selectedAt?:number;useOriginal?:boolean}>}|undefined;
  const image=(value?:string):ReferenceImage|undefined=>{const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(value??'');return match?{path:value!,mimeType:match[1]}:undefined;};
  const result:ProductionMaterial[]=entities.map(e=>({key:`entity:${e.id}`,kind:'entity',entityKind:e.kind,title:e.name,text:`${({character:'人物',location:'地点',prop:'道具'})[e.kind]}：${e.name}\n${e.meta}\n${e.desc}`,dependencies:[],image:e.assetSnapshot?{path:`lum-media:${e.assetSnapshot.view.mediaId}`,mimeType:'image/png'}:image(e.image),imageSource:e.assetSnapshot?{assetId:e.assetSnapshot.assetId,appearanceId:e.assetSnapshot.appearanceId,revision:e.assetSnapshot.appearanceVersion,viewId:e.assetSnapshot.view.id,mediaId:e.assetSnapshot.view.mediaId}:undefined,imageKey:e.assetSnapshot?`assetView:${e.assetSnapshot.assetId}:${e.assetSnapshot.appearanceId}:${e.assetSnapshot.appearanceVersion}:${e.assetSnapshot.view.id}`:undefined}));
  for(const chapter of index?.chapters??[]){
   if(episodeId && chapter.episodeId!==episodeId)continue;
   const blocks=docs.get(`script:${chapter.episodeId}`) as ScriptBlock[]??[],shots=docs.get(`storyboard:${chapter.episodeId}`) as Shot[]??[];
   const links=docs.get(`entities:links:${chapter.episodeId}`) as Record<string,string[]>??{};
   for(const scene of storyScenes(blocks)){const sceneKey=`scene:${chapter.episodeId}:${scene.blockId}`;const related=shots.filter(s=>s.sceneId===scene.id);result.push({key:sceneKey,kind:'scene',title:scene.title,episodeId:chapter.episodeId,episodeTitle:chapter.title,text:`${chapter.title} · ${scene.title}\n\n${scene.blocks.slice(1).map(b=>b.text).join('\n')}`,dependencies:[...new Set([...scene.blocks.flatMap(b=>links[b.id]??[]).filter(id=>entityMap.has(id)).map(id=>`entity:${id}`),...related.map(s=>`shot:${chapter.episodeId}:${s.id}`)])]});}
   for(const shot of shots){const refs=(shot.entityIds??[]).filter(id=>entityMap.has(id));const meta=generation?.shots?.[shot.id];const selected=effectiveShotGenerationImage(shot.mediaPin,meta);result.push({key:`shot:${chapter.episodeId}:${shot.id}`,kind:'shot',title:`${shot.no} · ${shot.desc.slice(0,40)}`,episodeId:chapter.episodeId,episodeTitle:chapter.title,text:[`${chapter.title} · 镜头 ${shot.no}`,`景别 ${shot.type}；角度 ${shot.angle}；运镜 ${shot.movement}；焦段 ${shot.lens}；时长 ${shot.duration??'未定'} 秒`,shot.desc,shot.staging?`调度：${shot.staging}`:'',shot.notes?`备注：${shot.notes}`:'',shotAppearanceText(shot)?`本镜可见人物造型：\n${shotAppearanceText(shot)}`:'',refs.length?`共用资产：${refs.map(id=>entityMap.get(id)!.name).join('、')}`:''].filter(Boolean).join('\n'),dependencies:refs.map(id=>`entity:${id}`),setupSnapshot:shot.setupSnapshot,image:selected??(shot.mediaPin?{path:`lum-media:${shot.mediaPin.mediaId}`,mimeType:'image/png'}:image(shot.image))});}
  }
  return result;
 });
}
export function expandMaterialSelection(catalog:ProductionMaterial[],keys:string[]){const all=new Map(catalog.map(m=>[m.key,m])),selected=new Set<string>();const visit=(key:string)=>{if(selected.has(key))return;const item=all.get(key);if(!item)throw Error('素材已删除或归档，请刷新列表');selected.add(key);item.dependencies.forEach(visit);};keys.forEach(visit);return catalog.filter(m=>selected.has(m.key));}
