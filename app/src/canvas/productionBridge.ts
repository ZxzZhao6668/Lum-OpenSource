import type { WritingManuscript } from './writingManuscripts';
import { shotStyleMedia, type ShotSetupSnapshot } from '../scriptSetup/shotSetup';
import { assertScriptSetupProject } from '../scriptSetup/scriptSetupStore';
import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
import {initializeGeneration,workspaceImage,persistGeneration} from '../storyboard/generationState';
import type {ProductionMaterial} from './productionMaterials';
import type {VideoContinuity} from './productionClips';
export interface ProductionNode {key:string;kind:'text'|'image';label:string;text?:string;image?:{path:string;mimeType:string};sourceKey:string;imageSource?:ProductionMaterial['imageSource'];episodeId?:string;entityKind?:string;setupSnapshot?:ShotSetupSnapshot;referenceKeys?:string[]}
export interface ProductionBinding {id:string;canvasId?:string;batchId?:string}
export interface ProductionOptions {clip:ProductionBinding;duration:number;mode?:'video'|'previs';continuity?:VideoContinuity;setupSnapshots?:readonly ShotSetupSnapshot[];styleOverride?:string;onBound?:(canvasId:string)=>Promise<void>}
export function requestProduction<T>(frame:HTMLIFrameElement,method:'target'|'import'|'panel'|'storyContext'|'storyImport'|'projectCheck',params:Record<string,unknown>={}){
 const target=frame.contentWindow,id=crypto.randomUUID();if(!target)return Promise.reject(Error('画布未连接'));
 return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(Error(method==='projectCheck'?'目标画布检查超时，请重试':'画布提交回执超时，请查看画布；再次送入会按来源去重'));},method==='projectCheck'?12000:120000);const receive=(event:MessageEvent)=>{if(event.origin!==canvasOrigin||event.source!==target||lumBridgeType(event.data?.type)!=='lum:productionResponse'||event.data.id!==id)return;clearTimeout(timer);window.removeEventListener('message',receive);if(event.data.error)reject(Error(event.data.error));else resolve(event.data.result);};window.addEventListener('message',receive);target.postMessage({type:'laper:productionRequest',id,method,...params},canvasOrigin);});
}
function productionFrame(){const frame=document.querySelector<HTMLIFrameElement>('iframe[data-production-frame]');if(!frame?.contentWindow)throw Error('画布未连接');return frame;}
export async function prepareWorkspaceNavigation(panel: 'canvas' | 'virtualStage' | 'leave', requireReady = false) {
 const frame=document.querySelector<HTMLIFrameElement>('iframe[data-production-frame]');
 if (!frame?.contentWindow || frame.closest('[data-connection]')?.getAttribute('data-connection') !== 'ready') {
   if (requireReady) throw Error('当前画布未连接，请重新连接后再切换项目');
   return;
 }
 await requestProduction(frame,'panel',{panel});
}
export async function checkProjectCanvas(id: string) {
 const frame = productionFrame();
 if (frame.closest('[data-connection]')?.getAttribute('data-connection') !== 'ready') throw Error('当前画布未连接，请重新连接后再切换项目');
 const projectId = id === 'legacy' ? 'localProject' : id;
 const result = await requestProduction<{ projectId: string }>(frame, 'projectCheck', { projectId });
 if (result?.projectId !== projectId) throw Error('目标画布校验未完成，请重试');
}
export async function sendProductionMaterials(materials:ProductionMaterial[],options?:ProductionOptions,targetMode:'canvas'|'virtualStage'='canvas'){
 if(!materials.length||materials.length>100)throw Error('一次选择1—100条素材，场次包含的镜头及引用资产计入数量');
 assertScriptSetupProject();
 const frame=productionFrame();
 const binding=await requestProduction<{target:string;canvasId:string;clipId?:string;batchId?:string}>(frame,'target',options?{clip:options.clip}:{virtualStage:targetMode==='virtualStage'});if(!binding||typeof binding.target!=='string'||!binding.target)throw Error('画布目标绑定失败，请更新或重新加载画布');
 if(options&&binding.clipId!==options.clip.id)throw Error('画布版本尚未更新，请刷新整个写作页面后重试');
 if(options?.clip.batchId&&binding.batchId!==options.clip.batchId)throw Error('画布尚不支持批量分镜，请更新并重新启动 Lum');
 await options?.onBound?.(binding.canvasId);
 await initializeGeneration();
 const nodes:ProductionNode[]=[];
 const imageKeys=new Set<string>();
 const byKey=new Map(materials.map(material=>[material.key,material]));
 for(const material of materials){
  if(material.text.length>100000)throw Error(`「${material.title}」文字超过单节点限制，请分场次送入`);
  nodes.push({key:material.key+':text',sourceKey:material.key,kind:'text',label:material.title,text:material.text,episodeId:material.episodeId,entityKind:material.entityKind,setupSnapshot:material.setupSnapshot,...(material.kind==='shot'?{referenceKeys:material.dependencies.flatMap(key=>{const ref=byKey.get(key);return ref?.image?[ref.imageKey??key]:[];})}:{})});
  const imageKey=material.imageKey??material.key;
  if(material.image&&!imageKeys.has(imageKey)){const image=await workspaceImage(material.image);imageKeys.add(imageKey);
   nodes.push({key:imageKey+':image',sourceKey:imageKey,kind:'image',label:material.title+' · 图片',image,imageSource:material.imageSource,episodeId:material.episodeId,entityKind:material.entityKind,setupSnapshot:material.setupSnapshot});}
 }
 const styleMedia = new Set((targetMode==='virtualStage'||options?.mode==='previs'||options?.styleOverride ? [] : options?.setupSnapshots ?? materials.flatMap(m=>m.setupSnapshot ? [m.setupSnapshot] : [])).flatMap(snapshot=>{
   const id = shotStyleMedia(snapshot); return id ? [id] : [];
 }));
 for (const mediaId of styleMedia) {
  const sourceKey = `styleRef:${mediaId}`;
  const image = await workspaceImage({path:`lum-media:${mediaId}`,mimeType:'image/png'});
  nodes.push({key:sourceKey+':image',sourceKey,kind:'image',label:'项目画风参考 · 仅用于光色与材质',image});
 }
 await persistGeneration();
 assertScriptSetupProject();
 if(!frame.isConnected)throw Error('画布已关闭，请重新选择目标');
 return requestProduction<{created:number;updated:number;unchanged:number;conflicts:string[];canvasId:string;warnings?:string[]}>(frame,'import',{target:binding.target,nodes,...(options?{production:{clipId:options.clip.id,batchId:options.clip.batchId,duration:options.duration,mode:options.mode??'video',continuity:options.continuity,setupSnapshots:options.setupSnapshots,styleOverride:options.styleOverride}}:{})});
}

interface ManuscriptReceipt {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: string[];
  canvasId: string;
}

const nodeTextLimit = 100_000;
const importTextLimit = 2_000_000;
const importNodeLimit = 200;

function *manuscriptParts(text: string) {
  let start = 0;
  while (text.length - start > nodeTextLimit) {
    let end = start + nodeTextLimit;
    const newline = text.lastIndexOf('\n', end - 1);
    if (newline >= start) end = newline + 1;
    else if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
    else if (text[end - 1] === '\r' && text[end] === '\n') end--;
    yield text.slice(start, end);
    start = end;
  }
  yield text.slice(start);
}

/** Send snapshots to the open workflow without changing the iframe's project or opening a clip. */
export async function sendWritingManuscripts(items: readonly WritingManuscript[], sourceProjectId: string): Promise<ManuscriptReceipt> {
  if (!sourceProjectId || !items.length) throw Error('请选择写作项目和要加入画布的文稿');
  if (items.length > importNodeLimit) throw Error('一次最多加入 200 个文本节点，请分批选择');
  const sourceKeys = new Set<string>();
  let textLength = 0;
  let nodeCount = 0;
  const selections = items.map(item => {
    if (!item.key || !item.title.trim() || !item.text.trim() || item.text.includes('\0')) throw Error('所选文稿的标识、名称或文字无效');
    if (sourceKeys.has(item.key)) throw Error('所选文稿重复，请重新选择');
    sourceKeys.add(item.key);
    textLength += item.text.length;
    if (textLength > importTextLimit) throw Error('文稿超过每批 200 万字的上限，请分批选择');
    const parts = [...manuscriptParts(item.text)];
    nodeCount += parts.length;
    if (nodeCount > importNodeLimit) throw Error('文稿分段后超过 200 个文本节点，请分批选择');
    return { item, parts };
  });
  const frame = productionFrame();
  const binding = await requestProduction<{ target: string; canvasId: string }>(frame, 'target');
  if (!binding?.target || !binding.canvasId || binding.canvasId.startsWith('virtualStages/')) throw Error('请先打开目标工作流画布');
  const nodes: ProductionNode[] = [];
  for (const { item, parts } of selections) {
    // The receiver accepts clip: keys. Its normal clip IDs cannot contain colons.
    const bytes = new TextEncoder().encode(JSON.stringify([sourceProjectId, item.key]));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    for (const [index, text] of parts.entries()) {
      const sourceKey = `clip:manuscript:${hash}:${index + 1}`;
      const suffix = parts.length > 1 ? ` · ${index + 1}/${parts.length}` : '';
      const label = item.title.slice(0, 500 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
      nodes.push({ kind: 'text', key: sourceKey + ':text', sourceKey, label, text });
    }
  }
  if (!frame.isConnected || frame !== productionFrame()) throw Error('画布已关闭，请重新打开目标画布');
  const receipt = await requestProduction<ManuscriptReceipt>(frame, 'import', { target: binding.target, nodes });
  if (receipt?.canvasId !== binding.canvasId || !Array.isArray(receipt.conflicts) ||
      ![receipt.created, receipt.updated, receipt.unchanged].every(n => Number.isSafeInteger(n) && n >= 0) ||
      receipt.created + receipt.updated + receipt.unchanged + receipt.conflicts.length !== nodes.length) {
    throw Error('画布返回的文稿回执不完整，请查看目标画布后重试');
  }
  return receipt;
}
