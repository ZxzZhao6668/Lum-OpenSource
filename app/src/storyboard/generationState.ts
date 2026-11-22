import { shotAppearanceText, shotStyleMedia, shotStyleText, type ShotSetupSnapshot } from '../scriptSetup/shotSetup';
import { imageStyleId, imageStyles } from './imageStyles';
import { db,loadDoc, saveDoc } from "../data/db";
import { listEntitySummaries, type EntitySummary } from '../data/entityCatalog';
import {getSkill,rememberSkill,type SkillUse} from '../skills/skillStore';
import type { EntityRow } from "../data/db";
import type { Shot } from "./storyboard";
import { lumRequest } from "./lumClient";
import {validateImageDimensions} from './imageDefaults';
import {getProjectAssetMedia} from '../assetLibrary/projectAssets';
import {blobDataUrl} from '../entities/entityImageUpload';

export type ReferenceImage = { path: string; mimeType: string };
export type Asset = { id: string; entityId?: string; name: string; kind: string; desc: string; images: ReferenceImage[] };
export type AssetLink = { assetId: string; useImage: boolean; imagePath?: string };
export type GenerationConfig = { providerId: string; modelId: string; ratio?: string; size?: string; other?: Record<string, unknown> };
export type ImageModel = GenerationConfig & { label: string; providerLabel: string; type: string; imageSizes?: string[]; imageRatios?: string[]; rules?: unknown[]; mode?: unknown; isDefault?:boolean };
export type Generation = {
  taskId: string; shotNo?: string; createdAt: number; state: string; message?: string; resumable?: boolean;
  prompt: string; sourceHash?: string; setupSnapshot?: ShotSetupSnapshot; styleOverride?: string; config: GenerationConfig; references: { name: string; desc: string; image?: ReferenceImage }[];
  outputs: ReferenceImage[];
};
export type ShotGeneration = { links: AssetLink[]; config?: GenerationConfig; includeContext?:boolean; history: Generation[]; selected?: ReferenceImage; selectedAt?: number; useOriginal?: boolean };
export type ReviewedImagePrompt = { text: string; sourceHash: string; skillId: string; requirements: string; includeContext?: boolean };
export type ImagePromptSource = { targetId: string; label: string; basePrompt: string; sourceHash: string; skillId: string; skillName: string; skillInstruction: string; requirements: string; references: Generation['references']; referenceLegend: string; includeContext?: boolean; setupSnapshot?: ShotSetupSnapshot; styleOverride?: string; effectiveStyle?: string };
type Store = { assets: Asset[]; shots: Record<string, ShotGeneration>; defaults?:{config:GenerationConfig;includeContext:boolean}; imageCache?:Record<string,ReferenceImage> };
let store: Store = { assets: [], shots: {} };
let initialized: Promise<void> | undefined;
let entities: readonly EntitySummary[] = [];
let saveQueue = Promise.resolve();
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const taskOperations = new Map<string, number>();
let syncError = "";
let saveError = "";
let retrySave: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach(fn => fn()); };
export function subscribeGeneration(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function generationError() { return saveError || syncError; }
export function persistGeneration() {
  const data = structuredClone(store);
  saveQueue = saveQueue.catch(() => {}).then(() => saveDoc("storyboard:ep_001:generation", data));
  return saveQueue.then(() => { saveError = ""; if (retrySave) clearTimeout(retrySave); retrySave = undefined; }).catch(error => {
    saveError = "生成记录保存失败，请勿关闭页面，正在重试"; emit();
    if (!retrySave) retrySave = setTimeout(() => { retrySave = undefined; void persistGeneration().then(emit).catch(() => {}); }, 3000);
    throw error;
  });
}
export async function initializeGeneration() {
  if (!initialized) initialized = (async () => {
    store = await loadDoc<Store>("storyboard:ep_001:generation") ?? { assets: [], shots: {} };
    let recovered=false;
    for(const shot of Object.values(store.shots))for(const task of shot.history)if(['cancelling','resuming'].includes(task.state)){
      task.state='unknown';task.message='页面已恢复，正在核对原任务状态；未重新提交';recovered=true;
    }
    if(recovered)await persistGeneration();
    entities = await listEntitySummaries();
    schedulePoll(true);
  })().catch(error => { initialized = undefined; throw error; });
  return initialized;
}
export async function refreshAssets() { entities = await listEntitySummaries(); return getAssets(); }
window.addEventListener('dsh:content-updated', event => {
  if ((event as CustomEvent).detail?.kind === 'entity' && initialized) void refreshAssets().then(emit).catch(() => { syncError = '资产资料刷新失败，请重新进入分镜页'; emit(); });
});
function entityAsset(e: EntitySummary): Asset {
  return {id:e.id,entityId:e.id,name:e.name,kind:e.kind,desc:[e.meta,e.desc].filter(Boolean).join('\n'),images:[...(e.imageMimeType?[{path:`lum-entity:${encodeURIComponent(e.id)}`,mimeType:e.imageMimeType}]:[]),...store.assets.find(a=>a.entityId===e.id)?.images??[]]};
}
function historyAsset(history: Generation, image: ReferenceImage, index: number): Asset {
  return {id:`${history.taskId}:${index}`,name:`${history.shotNo||'镜头'} · 生成图 ${index+1} · ${new Date(history.createdAt).toLocaleString()}`,kind:'image',desc:history.prompt,images:[image]};
}
/** Card labels need their own references, not a rebuilt catalogue of every past image. */
export function getAsset(id: string): Asset | undefined {
  const entity=entities.find(row=>row.id===id);
  if(entity)return entityAsset(entity);
  const saved=store.assets.find(asset=>asset.id===id);
  if(saved)return saved.entityId?undefined:saved;
  for(const shot of Object.values(store.shots))for(const history of shot.history){
    const index=history.outputs.findIndex((_image,i)=>`${history.taskId}:${i}`===id);
    if(index>=0)return historyAsset(history,history.outputs[index],index);
  }
}
export function getAssets(): Asset[] {
  return [...entities.map(entityAsset),...store.assets.filter(a=>!a.entityId),...Object.values(store.shots).flatMap(s=>s.history.flatMap(h=>h.outputs.map((image,i)=>historyAsset(h,image,i)))).filter(a=>!store.assets.some(saved=>saved.id===a.id))];
}
function entityImage(entity:EntityRow):ReferenceImage[]{const mime=/^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(entity.image??'');return mime?[{path:entity.image!,mimeType:mime[1]}]:[];}
// Internal catalogue handles are resolved only for a visible preview or an actual
// reference. Never persist/send these handles as provider input or fingerprint them.
async function resolveAssetImage(image:ReferenceImage, preview=false):Promise<ReferenceImage>{
  if(image.path.startsWith('lum-media:')) { const blob=await getProjectAssetMedia(image.path.slice('lum-media:'.length)); return {path:await blobDataUrl(blob),mimeType:blob.type}; }
  if(!image.path.startsWith('lum-entity:'))return image;
  const id=decodeURIComponent(image.path.slice('lum-entity:'.length).split('?')[0]);
  const row=await db.entities.get(id);
  if(row?.assetSnapshot&&!preview){
    const blob=await getProjectAssetMedia(row.assetSnapshot.view.mediaId);
    return {path:await blobDataUrl(blob),mimeType:blob.type};
  }
  const original=row&&entityImage(row)[0];
  if(!original)throw Error('引用资产的图片已移除，请重新选择参考图');
  return original;
}
const imageUploads=new Map<string,Promise<ReferenceImage>>();
export async function workspaceImage(image:ReferenceImage):Promise<ReferenceImage>{
  image=await resolveAssetImage(image);
  if(!image.path.startsWith('data:'))return image;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(image.path)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(store.imageCache?.[hash])return store.imageCache[hash];
  let pending=imageUploads.get(hash);
  if(!pending){
    const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[image.mimeType];
    if(!extension)throw Error('资产图片格式不支持');
    const fileName=`entity-${hash.slice(0,20)}.${extension}`;
    pending=lumRequest<ReferenceImage>('upload',{fileName,dataUrl:image.path}).catch(async(error:unknown)=>{
      if((error as {status?:number})?.status!==409)throw error;
      const existing={path:`assets/storyboard/${fileName}`,mimeType:image.mimeType};const saved=await lumRequest<{dataUrl:string}>('preview',{path:existing.path});
      if(saved.dataUrl!==image.path)throw Error('已有同名图片内容不一致，未覆盖文件');return existing;
    }).then(result=>{(store.imageCache??={})[hash]=result;return result;}).finally(()=>imageUploads.delete(hash));imageUploads.set(hash,pending);
  }
  return pending;
}
export function getShotGeneration(id: string): ShotGeneration { return store.shots[id] ??= { links: [], history: [] }; }
export function getGenerationDefaults(){return store.defaults;}
export async function saveGenerationConfig(shotId:string,config:GenerationConfig,includeContext:boolean){const meta=getShotGeneration(shotId);meta.config=structuredClone(config);meta.includeContext=includeContext;store.defaults={config:structuredClone(config),includeContext};await persistGeneration();emit();}
export function effectiveShotLinks(shot:Shot):AssetLink[] {
  const links=getShotGeneration(shot.id).links;
  const retained=shot.entityIds===undefined?links:links.filter(link=>getAsset(link.assetId)?.kind==='image'||shot.entityIds!.includes(link.assetId));
  const resolved=[...retained,...(shot.entityIds??[]).filter(id=>!retained.some(link=>link.assetId===id)).map(assetId=>({assetId,useImage:false}))];
  return resolved.map(link=>{const asset=getAsset(link.assetId);return asset?.entityId&&asset.images.length?{...link,useImage:true}:link;});
}
export async function setLinks(id: string, links: AssetLink[]) { getShotGeneration(id).links = links; await persistGeneration(); emit(); }
export async function uploadAsset(file: File, asset?: Asset): Promise<Asset> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw new Error("请选择 PNG、JPEG、WebP 或 GIF 图片，最大 10MB");
  // An explicit attachment keeps its own snapshot even if the primary image is
  // later replaced/removed. Passive catalogue handles must not enter that snapshot.
  const snapshotImages: ReferenceImage[] = [];
  const owner = asset?.entityId ? await db.entities.get(asset.entityId) : undefined;
  for (const image of asset?.images ?? []) {
    snapshotImages.push(owner?.assetSnapshot ? await workspaceImage(image) : await resolveAssetImage(image));
  }
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("读取图片失败")); reader.readAsDataURL(file); });
  const extension = ({ "image/png":"png", "image/jpeg":"jpg", "image/webp":"webp", "image/gif":"gif" } as Record<string,string>)[file.type];
  const image = await lumRequest<ReferenceImage>("upload", { fileName: `reference-${crypto.randomUUID()}.${extension}`, dataUrl });
  let target = asset && store.assets.find(a => a.id === asset.id);
  if (!target) { target = asset ? { ...asset, images: snapshotImages } : { id: crypto.randomUUID(), name: file.name, kind: "image", desc: "", images: [] }; store.assets.push(target); }
  target.images.push({ path: image.path, mimeType: image.mimeType }); await persistGeneration(); emit(); return target;
}
const previews = new Map<string, Promise<string>>();
const previewBytes = new Map<string,number>();
function trimPreviews(){
  let bytes=[...previewBytes.values()].reduce((sum,size)=>sum+size,0);
  while(previews.size>8||bytes>24*1024*1024){
    const key=previews.keys().next().value;if(key===undefined)break;
    bytes-=previewBytes.get(key)??0;previews.delete(key);previewBytes.delete(key);
  }
}
export function previewImage(image: ReferenceImage, cache = true) {
  if(image.path.startsWith('lum-entity:')||image.path.startsWith('lum-media:'))return resolveAssetImage(image,true).then(original=>original.path);
  if(/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(image.path))return Promise.resolve(image.path);
  if(!cache)return lumRequest<{dataUrl:string}>('preview',{path:image.path}).then(result=>result.dataUrl);
  let promise = previews.get(image.path);
  if (!promise) { promise = lumRequest<{ dataUrl: string }>("preview", { path: image.path }).then(r => {if(previews.get(image.path)===promise){previewBytes.set(image.path,r.dataUrl.length*2);trimPreviews();}return r.dataUrl;}).catch(error => { if(previews.get(image.path)===promise){previews.delete(image.path);previewBytes.delete(image.path);} throw error; }); }
  // 预览是可重新读取的缓存，避免长时间浏览把全部大图保留在内存。
  previews.delete(image.path); previews.set(image.path,promise);
  trimPreviews();
  return promise;
}
export async function selectOutput(shotId: string, image?: ReferenceImage) {
  const meta = getShotGeneration(shotId); meta.selectedAt = Date.now(); meta.selected = image; meta.useOriginal = !image; await persistGeneration(); emit();
}
export function hasActiveTask(id: string) { return getShotGeneration(id).history.some(h => ["submitting", "running", "unknown", "interrupted", "resuming", "cancelling"].includes(h.state)); }
export async function sceneContext(shot: Shot, episodeId?:string) {
  const index=await loadDoc<{chapters:{episodeId:string}[]}>('episode:ep_001');
  for(const id of episodeId?[episodeId]:(index?.chapters??[]).map(c=>c.episodeId)){
    const shots=await loadDoc<Shot[]>(`storyboard:${id}`)??[];if(!shots.some(s=>s.id===shot.id))continue;
    const blocks=await loadDoc<{id:string;type:string;text:string}[]>(`script:${id}`)??[];
    const start=blocks.findIndex(b=>b.type==='scene'&&`block:${b.id}`===shot.sceneId);if(start<0)return '';
    const end=blocks.findIndex((b,i)=>i>start&&b.type==='scene');return blocks.slice(start,end<0?blocks.length:end).map(b=>b.text).join('\n');
  }
  return '';
}
async function shotReferences(shot: Shot): Promise<Generation['references']> {
  return Promise.all(effectiveShotLinks(shot).map(async link => {
    const asset = getAsset(link.assetId); if (!asset) throw new Error("引用资产已不存在，请重新选择");
    const image = link.useImage ? asset.images.find(i => i.path === link.imagePath) ?? asset.images[0] : undefined;
    if (link.useImage && !image) throw new Error(`${asset.name} 没有参考图，请先在资产页面生成或上传图片`);
    const appearance = shot.setupSnapshot?.characters?.find(c=>c.entityId===asset.entityId);
    const desc = appearance ? [asset.desc, appearance.identity && `身份：${appearance.identity}`, appearance.appearance && `外貌：${appearance.appearance}`].filter(Boolean).join('；') : asset.desc;
    return { name: asset.name, desc, ...(image ? { image: await resolveAssetImage(image) } : {}) };
  }));
}
function referenceLegend(references: Generation['references']) {
  let number = 0;
  return references.map(reference => `${reference.image ? `参考图 ${++number}` : '资产资料（无图片）'}：${reference.name}。${reference.desc || ''}${reference.image ? ' 保持该资产的外观辨识特征。' : ''}`).join('\n');
}
function shotBasePrompt(shot: Shot, context: string, references: Generation['references'], style: string)  {
  return ['请生成一张影视分镜画面，只描绘本镜可见主体；背景资料、画外音或相邻镜头中的人物不因此入画。', style ? `画面风格：${style}` : '', `镜头：${shot.no}；景别：${shot.type}；角度：${shot.angle}；运镜意图：${shot.movement}；焦段：${shot.lens}。`, `画面描述：\n${shot.desc}`, shot.staging ? `调度：${shot.staging}` : '', shot.notes ? `备注：${shot.notes}` : '', context ? `本场剧本背景（只描绘当前镜头，不拼贴整场）：\n${context}` : '', shotAppearanceText(shot) ? `仅对本镜已引用且可见的人物应用造型：\n${shotAppearanceText(shot)}` : '', referenceLegend(references)].filter(Boolean).join('\n\n');
}
async function promptSource(targetId: string, label: string, basePrompt: string, references: Generation['references'], skillId: string, use: SkillUse, requirements: string, includeContext?: boolean, visual?: Pick<ImagePromptSource, 'setupSnapshot' | 'styleOverride' | 'effectiveStyle'>): Promise<ImagePromptSource> {
  if (requirements.length > 12000) throw Error('补充要求最多 12000 字');
  const skill = await getSkill(skillId, use);
  if (requirements.trim()) basePrompt += `\n\n用户补充要求：\n${requirements}`;
  const fingerprint = JSON.stringify({targetId, basePrompt, references, skill, includeContext, visual});
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)));
  return {...visual, targetId, label, basePrompt, references, skillId, skillName:skill.name, skillInstruction:skill.instruction, requirements, includeContext, referenceLegend:referenceLegend(references), sourceHash:Array.from(digest, byte=>byte.toString(16).padStart(2,'0')).join('')};
}
async function readStoredShot(shotId: string) {
  const ids = (await loadDoc<{chapters:{episodeId:string}[]}>('episode:ep_001'))?.chapters ?? [];
  for (const {episodeId} of ids) {
    const shot = (await loadDoc<Shot[]>(`storyboard:${episodeId}`))?.find(item => item.id === shotId);
    if (shot) return {shot, episodeId};
  }
  throw Error('镜头已删除或尚未保存，请重新打开分镜');
}
async function shotVisual(shot: Shot, requirements = '') {
  const setupSnapshot = shot.setupSnapshot;
  const styleOverride = imageStyles.find(style => style.id === imageStyleId(requirements))?.instruction || undefined;
  if (styleOverride && setupSnapshot?.locked) throw Error('镜头的项目画风已锁定，请取消本次覆盖或先在剧本设定器核对锁定字段');
  const references = await shotReferences(shot);
  const mediaId = styleOverride ? undefined : shotStyleMedia(setupSnapshot);
  if (mediaId) references.push({name:'项目画风参考',desc:'仅参考色彩、光线、材质与构图风格；不得带入参考图中的人物、物件或场景。', image:await resolveAssetImage({path:`lum-media:${mediaId}`,mimeType:'image/png'})});
  return {references, setupSnapshot, styleOverride, effectiveStyle: styleOverride ?? shotStyleText(setupSnapshot)};
}
export async function prepareShotPrompt(shot: Shot, includeContext: boolean, skillId: string, requirements: string): Promise<ImagePromptSource> {
  await initializeGeneration(); await refreshAssets();
  const {shot: current, episodeId} = await readStoredShot(shot.id);
  if (!current.desc.trim()) throw Error('请先填写镜头画面描述');
  const {references, ...visual} = await shotVisual(current, requirements);
  const context = includeContext ? await sceneContext(current, episodeId) : '';
  return promptSource(current.id, current.no, shotBasePrompt(current, context, references, visual.effectiveStyle), references, skillId, 'storyboard-image', requirements, includeContext, visual);
}
export async function prepareEntityPrompt(entityId: string, skillId: string, requirements: string, useReference: boolean): Promise<ImagePromptSource> {
  await initializeGeneration();
  const row = await db.entities.get(entityId); if (!row) throw Error('资产已不存在');
  const references: Generation['references'] = [];
  if (useReference) {
    const preview=entityImage(row)[0];
    if (!preview) throw Error('当前资产没有参考图');
    const image=row.assetSnapshot
      ? await resolveAssetImage({path:'lum-entity:'+encodeURIComponent(row.id),mimeType:preview.mimeType})
      : preview;
    references.push({name:row.name,desc:[row.meta,row.desc].join('\n'),image});
  }
  const prompt = [`为${({character:'人物',location:'地点',prop:'道具'})[row.kind]}「${row.name}」生成一张设定图。`, `资产资料：\n${row.meta}\n${row.desc}`, referenceLegend(references)].filter(Boolean).join('\n\n');
  return promptSource(`entity:${entityId}`, row.name, prompt, references, skillId, `${row.kind}-image`, requirements);
}
function reviewedText(reviewed: ReviewedImagePrompt, source: ImagePromptSource) {
  if (reviewed.sourceHash !== source.sourceHash) throw Object.assign(new Error('来源已变化，请重新 AI 优化提示词后再生成'), { code: 'STALE_IMAGE_PROMPT' });
  if (typeof reviewed.text !== 'string' || !reviewed.text.trim() || reviewed.text.length > 100000 || reviewed.text.includes('\0')) throw Error('最终生图提示词为空或过长');
  return reviewed.text;
}
function validateReferenceModel(model: ImageModel, count: number) {
  const modes = Array.isArray(model.mode) ? model.mode as string[] : [];
  if (count && modes.length && !modes.includes('singleImage') && !modes.includes('multiReference')) throw Error('该模型不支持图片参考，请换用支持参考图的图片模型');
  if (count > 1 && modes.length && !modes.includes('multiReference')) throw Error('该模型不支持多张参考图，请换用多图模型；未删减参考图或提交任务');
}
export async function startGeneration(shot: Shot, config: GenerationConfig, context = "", reviewed?: ReviewedImagePrompt, isActive:()=>boolean=()=>true) {
  await initializeGeneration(); if (hasActiveTask(shot.id)) throw new Error("此镜头已有进行中的任务，请等待完成或取消");
  const {shot: current} = await readStoredShot(shot.id);
  if (!current.desc.trim()) throw new Error("请先填写镜头画面描述");
  if (!config.providerId || !config.modelId) throw new Error("请选择图片模型");
  await refreshAssets();
  const source = reviewed ? await prepareShotPrompt(shot, reviewed.includeContext ?? true, reviewed.skillId, reviewed.requirements) : undefined;
  const visual = source ?? await shotVisual(current);
  const {references, effectiveStyle} = visual;
  const styleLine = effectiveStyle ? `画面风格（本次生效）：${effectiveStyle}` : '';
  const appearance = shotAppearanceText(current);
  const prompt = reviewed ? [reviewedText(reviewed,source!), appearance && `仅对本镜已引用且可见的人物应用造型：\n${appearance}`, styleLine].filter(Boolean).join('\n\n') : shotBasePrompt(current,context,references,effectiveStyle ?? '');
  if (prompt.length > 100000) throw Error('最终生图提示词过长，请精简后重试');
  const { models } = await lumRequest<{models: ImageModel[]}>("models");
  const model = models.find(m => m.type === "image" && m.providerId === config.providerId && m.modelId === config.modelId);
  if (!model) throw new Error("所选图片模型已不可用，请重新选择");
  validateReferenceModel(model,references.filter(r => r.image).length);
  validateImageDimensions(model,config);
  for(const reference of references)if(reference.image)reference.image=await workspaceImage(reference.image);
  // Model lookup and local reference uploads can take time; recheck the canonical source
  // immediately before recording/submitting a paid task, not only when the dialog was read.
  if(reviewed)reviewedText(reviewed,await prepareShotPrompt(shot,reviewed.includeContext??true,reviewed.skillId,reviewed.requirements));
  if (JSON.stringify((await readStoredShot(shot.id)).shot.setupSnapshot) !== JSON.stringify(visual.setupSnapshot)) throw Error('镜头画风已变化，请重新预览');
  return submitGeneration(shot.id,source?.label??shot.no,prompt,config,references,source?.sourceHash,isActive,visual.setupSnapshot,visual.styleOverride);
}
async function submitGeneration(id:string,label:string,prompt:string,config:GenerationConfig,references:Generation['references'],sourceHash?:string,isActive:()=>boolean=()=>true,setupSnapshot?:ShotSetupSnapshot,styleOverride?:string){
  if (!isActive()) throw Object.assign(new Error('操作已停止，未提交生成'), { code: 'LOCAL_CANCELLED' });
  if (hasActiveTask(id)) throw new Error("已有任务正在提交，请勿重复生成");
  const meta=getShotGeneration(id);
  const generation: Generation = { taskId: crypto.randomUUID(), shotNo: label, createdAt: Date.now(), state: "submitting", prompt, sourceHash, ...(setupSnapshot ? {setupSnapshot} : {}), ...(styleOverride ? {styleOverride} : {}), config: structuredClone(config), references, outputs: [] };
  meta.config = structuredClone(config); meta.history.unshift(generation);
  // 先落盘任务ID，再提交，刷新或响应丢失时查询同一个任务，避免重复扣费。
  try { await persistGeneration(); } catch (error) { meta.history = meta.history.filter(h => h !== generation); emit(); throw error; }
  emit();
  try {
    await lumRequest("generate", { ...config, taskId: generation.taskId, prompt, images: references.flatMap(r => r.image ? [{path:r.image.path,mimeType:r.image.mimeType}] : []) }, () => isActive() && generation.state === 'submitting');
    if(generation.state==='submitting'){generation.state = "running"; generation.message = "任务已提交";}
  } catch (error) {
    const status = (error as {status?:number})?.status;
    const rejected = (error as {code?:string})?.code === "INVALID_PARAMS" || (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 409);
    if(generation.state==='submitting'){
      const localCancelled = (error as {code?:string})?.code === 'LOCAL_CANCELLED';
      generation.state = localCancelled ? 'cancelled' : rejected ? "failed" : "unknown";
      generation.message = `${error instanceof Error ? error.message : error}${rejected || localCancelled ? "" : "；正在核对任务状态"}`;
    }
  }
  try { await persistGeneration(); } finally { emit(); schedulePoll(); }
}
export async function startEntityGeneration(entityId:string,config:GenerationConfig,skillId:string,extra='',useReference=false,reviewed?:ReviewedImagePrompt,isActive:()=>boolean=()=>true){
 await initializeGeneration();const row=await db.entities.get(entityId);if(!row)throw Error('资产已不存在');
 if(!config.providerId||!config.modelId)throw Error('请选择图片模型');if(extra.length>12000)throw Error('补充要求最多12000字');
 const key=`entity:${entityId}`;if(hasActiveTask(key))throw Error('此资产已有生成任务，请等待或取消');
 const use=`${row.kind}-image` as SkillUse,source=await prepareEntityPrompt(entityId,skillId,extra,useReference);
 const prompt=reviewed?reviewedText(reviewed,source):`${source.basePrompt}\n\n创作 Skill「${source.skillName}」：\n${source.skillInstruction}`;
 const {models}=await lumRequest<{models:ImageModel[]}>('models');const model=models.find(m=>m.type==='image'&&m.providerId===config.providerId&&m.modelId===config.modelId);if(!model)throw Error('图片模型不可用，请刷新模型');
 const references=source.references;validateReferenceModel(model,references.filter(r=>r.image).length);validateImageDimensions(model,config);
 for(const reference of references)if(reference.image)reference.image=await workspaceImage(reference.image);
 await rememberSkill(use,source.skillId);
 if(reviewed)reviewedText(reviewed,await prepareEntityPrompt(entityId,skillId,extra,useReference));
 await submitGeneration(key,row.name,prompt,config,references,source.sourceHash,isActive);
}
export async function adoptEntityImage(entityId:string,image:ReferenceImage,expected:EntityRow,isActive:()=>boolean=()=>true){
 await initializeGeneration();const history=getShotGeneration(`entity:${entityId}`).history;
 if(!history.some(h=>h.state==='succeeded'&&h.outputs.some(o=>o.path===image.path&&o.mimeType===image.mimeType)))throw Error('图片不是此资产已完成的生成结果');
 const dataUrl=await previewImage(image);if(!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(dataUrl)||dataUrl.length>30*1024*1024)throw Error('图片格式或大小不支持采用');
 await db.transaction('rw',db.entities,async()=>{
   const current=await db.entities.get(entityId);
   if(!isActive())throw Object.assign(new Error('操作已停止，未采用图片'),{code:'LOCAL_CANCELLED'});
   if(!current||JSON.stringify(current)!==JSON.stringify(expected))throw Error('资产已修改或删除，请重新打开后选用图片');
   // Only the image changes; submit the write immediately after the lifecycle check.
   const next={...current,image:dataUrl};
   if(dataUrl!==current.image)delete next.assetSnapshot;
   await db.entities.put(next);
 });
 await refreshAssets();emit();window.dispatchEvent(new CustomEvent('dsh:content-updated',{detail:{kind:'entity',id:entityId}}));
 return (await db.entities.get(entityId))!;
}
/** Cover tasks share the durable lifecycle; only explicit adoption updates the document. */
export type CoverDocument = Record<string,string>;
export async function prepareCoverPrompt(episodeId:string,skillId:string,requirements:string,config:GenerationConfig):Promise<ImagePromptSource>{
 await initializeGeneration();
 const cover=await loadDoc<CoverDocument>(`cover:${episodeId}`);
 if(!cover)throw Error('封面已删除或尚未保存，请重新打开封面');
 if(!cover.title?.trim()&&!cover.synopsis?.trim())throw Error('请先填写作品名称或作品简介');
 const prompt=[
  '为当前作品设计一张完整封面图片。',
  `作品名称（需要标题时逐字使用）：${cover.title||'未提供，使用无字封面'}`,
  cover.author?`作者（仅用户要求署名时使用）：${cover.author}`:'',
  cover.synopsis?`作品简介：\n${cover.synopsis}`:'',
  `画幅比例：${config.ratio||'模型默认'}；图片分辨率：${config.size||'模型默认'}。按这一画幅安排视觉重心与标题安全区。`,
  '只画一张封面，不生成封面样机、书籍实物展示、多格拼图或分镜表。没有明确要求时不加文字，留出后期排版空间。不显示联系方式，不添加虚构奖项、出版社、二维码或水印。',
 ].filter(Boolean).join('\n\n');
 return promptSource(`cover:${episodeId}`,cover.title||'作品封面',prompt,[],skillId,'cover-image',requirements);
}
export async function startCoverGeneration(episodeId:string,config:GenerationConfig,reviewed:ReviewedImagePrompt,isActive:()=>boolean=()=>true){
 await initializeGeneration();
 const key=`cover:${episodeId}`;
 if(hasActiveTask(key))throw Error('封面已有生成任务，请等待完成或取消');
 if(!config.providerId||!config.modelId)throw Error('请选择图片模型');
 const source=await prepareCoverPrompt(episodeId,reviewed.skillId,reviewed.requirements,config);
 const prompt=reviewedText(reviewed,source);
 const {models}=await lumRequest<{models:ImageModel[]}>('models');
 const model=models.find(m=>m.type==='image'&&m.providerId===config.providerId&&m.modelId===config.modelId);
 if(!model)throw Error('图片模型已不可用，请重新选择');
 validateImageDimensions(model,config);
 await rememberSkill('cover-image',source.skillId);
 reviewedText(reviewed,await prepareCoverPrompt(episodeId,reviewed.skillId,reviewed.requirements,config));
 await submitGeneration(key,`${source.label} · 封面`,prompt,config,[],source.sourceHash,isActive);
}
export async function adoptCoverImage(episodeId:string,image:ReferenceImage,expected:CoverDocument,isActive:()=>boolean=()=>true):Promise<CoverDocument>{
 await initializeGeneration();
 const history=getShotGeneration(`cover:${episodeId}`).history;
 if(!history.some(h=>h.state==='succeeded'&&h.outputs.some(o=>o.path===image.path&&o.mimeType===image.mimeType)))throw Error('图片不是本作品封面已完成的生成结果');
 const dataUrl=await previewImage(image);
 if(!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(dataUrl)||dataUrl.length>30*1024*1024)throw Error('图片格式或大小不支持采用');
 return db.transaction('rw',db.docs,async()=>{
  const key=`cover:${episodeId}`,current=await loadDoc<CoverDocument>(key);
  if(!isActive())throw Error('封面页面已关闭，未采用图片');
  if(!current||JSON.stringify(current)!==JSON.stringify(expected))throw Error('封面已修改或删除，请重新打开后采用图片');
  const next={...current,image:dataUrl,imageSource:image.path};
  await saveDoc(key,next);return next;
 });
}

type Task = { taskId: string; state: string; resumable?: boolean; result?: { code: number; message: string; data?: (ReferenceImage & { mediaType?: string })[] | null } };
function schedulePoll(reconcileInterrupted = false) { if (!pollTimer && !polling) pollTimer = setTimeout(() => { pollTimer = undefined; void pollTasks(reconcileInterrupted); }, 1800); }
export async function pollTasks(reconcileInterrupted = false) {
  const states = ["submitting", "running", "unknown", ...(reconcileInterrupted ? ["interrupted"] : [])];
  if (polling) return; const active = Object.values(store.shots).flatMap(s => s.history).filter(h => states.includes(h.state)); if (!active.length) return;
  polling = true;
  try {
    const requested = active.slice(0,100);
    const operations = new Map(requested.map(h => [h.taskId, taskOperations.get(h.taskId) ?? 0]));
    const { tasks } = await lumRequest<{ tasks: Task[] }>("status", { taskIds: requested.map(h => h.taskId) }); syncError = "";
    let changed = false;
    for (const task of tasks) {
      const owner = Object.values(store.shots).find(s => s.history.some(h => h.taskId === task.taskId));
      const generation = owner?.history.find(h => h.taskId === task.taskId); if (!owner || !generation) continue;
      if (operations.get(task.taskId) !== (taskOperations.get(task.taskId) ?? 0)) continue;
      // A status response was captured before a local cancellation or a newer terminal state.
      if(!states.includes(generation.state))continue;
      // 超时提交可能仍在后端建立任务；短时间404不触发重提。
      if (task.result?.code === 404 && Date.now() - generation.createdAt < 90000) continue;
      const message = task.result?.message || (task.state === "running" ? "生成中" : task.state);
      if (generation.state === task.state && generation.message === message && generation.resumable === task.resumable) continue;
      generation.resumable = task.resumable;
      generation.state = task.state; generation.message = message; changed = true;
      if (task.state === "succeeded") {
        generation.outputs = (task.result?.data ?? []).filter(r => r.mimeType.startsWith("image/")).map(r => ({ path: r.path, mimeType: r.mimeType }));
        if (generation.outputs[0]) { owner.selected = generation.outputs[0]; owner.useOriginal = false; }
        else { generation.state = "failed"; generation.message = "任务未返回可用图片，原图已保留"; }
      }
    }
    if (changed) { await persistGeneration(); emit(); }
  } catch (error) { syncError = `状态同步暂不可用：${error instanceof Error ? error.message : error}`; emit(); }
  finally { polling = false; if (Object.values(store.shots).some(s => s.history.some(h => ["submitting", "running", "unknown"].includes(h.state)))) schedulePoll(); }
}
export async function resumeGeneration(id: string, taskId?: string) {
  await initializeGeneration();
  const history = getShotGeneration(id).history;
  if (history.some(h => ['submitting','running','unknown','resuming','cancelling'].includes(h.state))) throw Error('此镜头已有任务正在处理，请等待状态同步');
  const active = history.filter(h => h.state === 'interrupted' && h.resumable !== false && (!taskId || h.taskId === taskId));
  if (!active.length) throw Error('此任务没有可恢复的结果，请先核对生成历史');
  active.forEach(h => { taskOperations.set(h.taskId, (taskOperations.get(h.taskId) ?? 0) + 1); h.state = 'resuming'; h.message = '正在恢复原任务，不会重新提交生成'; }); emit();
  try {
    await persistGeneration();
    await lumRequest('resume', { taskIds: active.map(h => h.taskId) });
    active.forEach(h => { if (h.state === 'resuming') { h.state = 'unknown'; h.message = '已请求恢复，正在同步原任务结果'; } });
  } catch (error) {
    active.forEach(h => { if (h.state === 'resuming') { h.state = 'unknown'; h.message = `恢复响应未确认，正在核对原任务结果：${error instanceof Error ? error.message : error}`; } });
    throw error;
  } finally { await persistGeneration(); emit(); schedulePoll(); }
}
export async function cancelGeneration(id: string) {
  const active = getShotGeneration(id).history.filter(h => ["submitting", "running", "unknown", "interrupted", "resuming"].includes(h.state));
  if(!active.length)return;
  active.forEach(h=>{taskOperations.set(h.taskId,(taskOperations.get(h.taskId)??0)+1);h.state='cancelling';h.message='正在取消任务';});emit();
  try{
    await persistGeneration();await lumRequest("cancel", { taskIds: active.map(h => h.taskId) });
    active.forEach(h => { h.state = "cancelled"; h.message = "本地任务已取消；供应商是否停止或退款需另行确认"; });
    await persistGeneration();
  }catch(error){active.forEach(h=>{h.state='unknown';h.message='取消结果未确认，正在核对原任务；未重新提交';});await persistGeneration();schedulePoll();throw error;}
  finally{emit();}
}
