import {readWorldview} from '../worldview/worldviewModel';
import {readStoryBible,bibleFields} from '../novel/storyBible';
import { db, loadDoc, type EntityRow } from '../data/db';
import type { EpisodeEntry, EpisodeIndex } from '../episode/episodeManager';
import { screenplayCss, screenplayStyleId, screenplayWordStyles } from './screenplayStyles';
import type { ProjectKind } from '../projects/projectStore';
import type { ScriptBlock } from '../script/editor';
import { storyScenes, sceneShots, shotNumber, shotFields, type Shot, type ShotField } from '../storyboard/shotModel';
import { UNASSIGNED_SCENE } from '../script/sceneIdentity';
import { selectedShotImage } from '../storyboard/storyboardViews';
import { node, action, modal, downloadText } from '../ui/localUi';
import { flushWorkspace } from '../ui/workspaceTools';
import './writingExport.css';
import { validateBeats } from '../beats/beatModel';

export const exportContents = [['script','剧本'],['outline','大纲'],['beats','节拍'],['scenes','场次'],['storyboard','分镜板'],['character','选角表'],['location','勘景簿'],['prop','道具表'],['worldview','世界观'],['bible','小说设定']] as const;
type Content = typeof exportContents[number][0];
export interface ExportOptions { episodes:string[]; contents:Content[]; fields:ShotField[]; watermark:string }
type Section = { title:string; paragraphs?:string[]; screenplayBlocks?:ScriptBlock[]; columns?:string[]; rows?:Array<{ cells:string[]; image?:string }> };
export interface WritingExport { title:string; sections:Section[]; watermark:string; warnings:string[] }
const plain = (html:string) => { const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());doc.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));doc.querySelectorAll('p,div,h1,h2,h3,li,blockquote').forEach(n=>n.append('\n'));return doc.body.textContent?.trim()??''; };
const safeName=(name:string)=>name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'写作项目';
const downloadBlob=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};

async function readExportBlocks(chapter:EpisodeEntry):Promise<ScriptBlock[]> {
  const blocks = await loadDoc<ScriptBlock[]>(`script:${chapter.episodeId}`) ?? [];
  const legacyText = chapter.content;
  if (!legacyText?.trim() || blocks.some(block => block.text.trim())) return blocks;

  // Match migrateChapterText without opening the chapter or writing a migration marker.
  // A migrated chapter may have been cleared deliberately while its old backup remains.
  if (await loadDoc(`chapter:migrated:${chapter.id}`)) return blocks;
  return legacyText.split(/\r?\n/).map((text, index) => ({
    id: `export:${chapter.id}:${index}`, type: 'action', text,
  }));
}

/** Collect one consistent database snapshot before any media loading or formatting. */
export async function collectWritingExport(options:ExportOptions):Promise<WritingExport> {
  const snapshot=await db.transaction('r',db.docs,db.entities,async()=>{
    const index=await loadDoc<EpisodeIndex>('episode:ep_001');
    const chapters=index?.chapters.filter(c=>options.episodes.includes(c.episodeId))??[];
    if(!chapters.length)throw Error('请至少选择一个现有章节');
    if(!options.contents.length)throw Error('请至少选择一种导出内容');
    const project=await loadDoc<{name:string;kind?:ProjectKind}>('project:meta');
    return {project,world:options.contents.includes('worldview')?await readWorldview():undefined,bible:options.contents.includes('bible')?(await readStoryBible()).bible:undefined,entities:await db.entities.orderBy('order').toArray(),chapters:await Promise.all(chapters.map(async chapter=>({...chapter,blocks:await readExportBlocks(chapter),beats:validateBeats(await loadDoc(`beats:${chapter.episodeId}`)??[]),shots:await loadDoc<Shot[]>(`storyboard:${chapter.episodeId}`)??[],outline:await loadDoc<{docs:Array<{title:string;html:string}>}>(`outline:${chapter.episodeId}`),descs:await loadDoc<Record<string,string>>(`scene:desc:${chapter.episodeId}`)??{}})))};
  });
  const result:WritingExport={title:snapshot.project?.name??'写作项目',sections:[],watermark:options.watermark,warnings:[]};
  if(snapshot.world){result.sections.push({title:'世界观 · 项目共用设定',paragraphs:[snapshot.world.overview,...snapshot.world.entries.map(e=>['【'+(e.status==='canon'?'已确认':'待定')+'】'+e.category+' · '+e.key,e.dateLabel,e.value].filter(Boolean).join('\n'))]});}
  if(snapshot.bible){const bible=snapshot.bible;result.sections.push({title:'小说设定 · Story Bible',paragraphs:[...bibleFields.map(([k,title])=>title+'\n'+bible[k]),'叙事视角：'+({'first':'第一人称','second':'第二人称','third_limited':'第三人称有限视角','third_omniscient':'第三人称全知视角'}[bible.narration.pov]),'时态：'+(bible.narration.tense==='past'?'过去时':'现在时')]});}
  for(const chapter of snapshot.chapters){
    const scenes=storyScenes(chapter.blocks),prefix=chapter.title+' · ';
    if(options.contents.includes('script')){
      result.sections.push({
        title:prefix+'剧本',
        paragraphs:chapter.blocks.map(b=>b.text),
        screenplayBlocks:snapshot.project?.kind==='novel'?undefined:chapter.blocks,
      });
    }
    if(options.contents.includes('outline'))for(const doc of chapter.outline?.docs??[])result.sections.push({title:prefix+'大纲 · '+doc.title,paragraphs:plain(doc.html).split('\n')});
    if(options.contents.includes('beats'))result.sections.push({title:prefix+'节拍',columns:['序号','名称','开始（分钟）','结束（分钟）','描述'],rows:chapter.beats.map((beat,i)=>({cells:[String(i+1),beat.name,String(beat.startTime),String(beat.endTime),beat.description]}))});
    if(options.contents.includes('scenes'))result.sections.push({title:prefix+'场次',columns:['场次','场次梗概'],rows:scenes.map(scene=>({cells:[scene.title,chapter.descs[scene.blockId]??chapter.descs[scene.id]??chapter.descs[scene.title]??'']}))});
    if(options.contents.includes('storyboard')){
      const groups=[...scenes.map(s=>({id:s.id,title:s.title})),{id:UNASSIGNED_SCENE,title:'未关联镜头'}];
      const fields=shotFields.filter(([key])=>options.fields.includes(key));
      for(const group of groups){
        const shots=sceneShots(chapter.shots,group.id,scenes);if(!shots.length)continue;
        const rows:NonNullable<Section['rows']>=[];
        for(const shot of shots){
          let image='';try{image=await selectedShotImage(shot);}catch{result.warnings.push(`${chapter.title} ${shot.no} 图片未能读取`);}
          rows.push({image,cells:fields.map(([key])=>key==='no'?shotNumber(shot,chapter.shots,scenes):key==='duration'?(shot.duration?`${shot.duration} 秒`:''):String(shot[key]??''))});
        }
        result.sections.push({title:prefix+group.title+' · 分镜板',columns:['分镜图',...fields.map(([,label])=>label)],rows});
      }
      if(!chapter.shots.length)result.sections.push({title:prefix+'分镜板',paragraphs:['暂无镜头']});
    }
  }
  for(const kind of ['character','location','prop'] as EntityRow['kind'][]){
    if(!options.contents.includes(kind))continue;
    const label=exportContents.find(([id])=>id===kind)![1];
    result.sections.push({title:label+' · 项目共用资产',columns:['名称','资料','描述'],rows:snapshot.entities.filter(e=>e.kind===kind).map(e=>({cells:[e.name,e.meta,e.desc]}))});
  }
  if(!result.sections.length)result.sections.push({title:'所选内容',paragraphs:['暂无内容']});
  return result;
}
export function writingExportText(data:WritingExport) {
  return [data.title,data.watermark?`稿件标记：${data.watermark}`:'',...data.sections.map(s=>[s.title,...s.paragraphs??[],...(s.rows??[]).map(row=>row.cells.map((cell,i)=>`${s.columns?.[i+(row.image!==undefined?1:0)]??''}：${cell}`).join('\n'))].join('\n\n'))].filter(Boolean).join('\n\n');
}
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const columnWeights=(columns:string[])=>columns.map(label=>label==='分镜图'?2.6:label==='镜头描述'||label==='描述'||label==='场次梗概'?3:1);
function allowedImage(url:string){return /^(data:image\/(?:png|jpeg|webp|gif);base64,|blob:|https?:\/\/)/i.test(url)?url:'';}
function isScreenplayManuscript(data:WritingExport) {
  return data.sections.length > 0 && data.sections.every(section => section.screenplayBlocks !== undefined && !section.columns);
}
function htmlParagraphs(section:Section) {
  if(section.screenplayBlocks) return section.screenplayBlocks.map(block =>
    `<p class="${screenplayStyleId(block.type)}">${escape(block.text)}</p>`
  ).join('');
  return (section.paragraphs??[]).map(p=>`<p>${escape(p)}</p>`).join('');
}
export function writingExportHtml(data:WritingExport) {
  const manuscript = isScreenplayManuscript(data);
  const sections=data.sections.map(s=>{const weights=columnWeights(s.columns??[]),sum=weights.reduce((a,b)=>a+b,0);return `<section><h2>${escape(s.title)}</h2>${htmlParagraphs(s)}${s.columns?`<table><colgroup>${weights.map(w=>`<col style="width:${100*w/sum}%">`).join('')}</colgroup><thead><tr>${s.columns.map(c=>`<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${(s.rows??[]).map(r=>`<tr>${r.image!==undefined?`<td class="image">${allowedImage(r.image)?`<img src="${escape(r.image)}" alt="分镜图">`:'暂无分镜图'}</td>`:''}${r.cells.map(c=>`<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:''}</section>`;}).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(data.title)}</title><style>@page{size:A4 ${manuscript?'portrait':'landscape'};margin:${manuscript?'22mm 24mm':'16mm'}}*{box-sizing:border-box}body{font:12px/1.7 "Microsoft YaHei",sans-serif;color:#263b2e;margin:0}h1{font-size:23px}h2{font-size:16px;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}section+section{break-before:page}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:10px}th,td{border:1px solid #ccd8d0;padding:7px;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top}th{background:#f1f5f2}thead{display:table-header-group}tr{break-inside:avoid}td.image{width:22%}img{max-width:100%;max-height:115px;object-fit:contain}.watermark{position:fixed;top:45%;left:10%;width:80%;text-align:center;transform:rotate(-30deg);color:#55685c22;font-size:50px;pointer-events:none;z-index:10}.printTools{margin-bottom:15px}.printTools button{padding:8px 18px}${screenplayCss}
.manuscript {color:#1c1c1c}
.manuscript h1,.manuscript h2 {break-after:avoid;overflow-wrap:anywhere}
.manuscript h1 {font-size:22pt}
.manuscript h2 {font-size:15pt}
@media screen{.manuscript{max-width:210mm;margin:auto;padding:1rem clamp(1rem,5vw,24mm)}}
@media print{.printTools{display:none}}</style></head><body${manuscript?' class="manuscript"':''}><div class="printTools"><button onclick="window.print()">打印 / 另存为 PDF</button><p>在打印窗口选择“另存为 PDF”。图片无法加载时会显示占位说明。</p></div>${data.watermark?`<div class="watermark">${escape(data.watermark)}</div>`:''}<h1>${escape(data.title)}</h1>${sections}</body></html>`;
}
async function imagePng(url:string):Promise<{data:Uint8Array;width:number;height:number}> {
  if(!allowedImage(url))throw Error('图片地址无效');
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('图片无法读取');
  const blob=await response.blob();if(blob.size>20*1024*1024)throw Error('图片过大');
  const bitmap=await createImageBitmap(blob);
  try{const scale=Math.min(1,800/bitmap.width,450/bitmap.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);const png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('图片转换失败')),'image/png'));return {data:new Uint8Array(await png.arrayBuffer()),width:canvas.width,height:canvas.height};}finally{bitmap.close();}
}
export async function writingExportDocx(data:WritingExport):Promise<Blob> {
  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,ImageRun,WidthType,HeadingLevel,Header,PageOrientation,TableLayoutType}=await import('docx');
  const {TextWatermark}=await import('docx/watermarks');
  const manuscript = isScreenplayManuscript(data);
  const children:Array<InstanceType<typeof Paragraph>|InstanceType<typeof Table>>=[new Paragraph({text:data.title,heading:HeadingLevel.TITLE})];
  const lines = (text:string) => text.split(/\r\n?|\n/).map((line,i)=>new TextRun({text:line,break:i?1:0}));
  const para=(text:string)=>new Paragraph({children:lines(text),spacing:{after:100}});
  for(const [at,s] of data.sections.entries()){
    children.push(new Paragraph({text:s.title,heading:HeadingLevel.HEADING_1,pageBreakBefore:at>0,keepNext:true}));
    if(s.screenplayBlocks){
      for(const block of s.screenplayBlocks){
        children.push(new Paragraph({style:screenplayStyleId(block.type),children:lines(block.text)}));
      }
    }else{
      children.push(...(s.paragraphs??[]).map(para));
    }
    if(!s.columns)continue;
    const weights=columnWeights(s.columns),sum=weights.reduce((a,b)=>a+b,0),widths=weights.map(weight=>Math.round(11250*weight/sum));
    const cell=(text:string,i:number,heading=false)=>new TableCell({width:{size:widths[i],type:WidthType.DXA},shading:heading?{fill:'EDF3EF'}:undefined,children:[para(text)]});
    const rows=[new TableRow({tableHeader:true,children:s.columns.map((c,i)=>cell(c,i,true))})];
    for(const r of s.rows??[]){
      const cells=r.cells.map((c,i)=>cell(c,i+(r.image!==undefined?1:0)));
      if(r.image!==undefined){let child=para('暂无分镜图');if(r.image)try{const png=await imagePng(r.image);const width=Math.min(145,widths[0]/15-16),height=width*png.height/png.width;child=new Paragraph({children:[new ImageRun({type:'png',data:png.data,transformation:{width,height}})]});}catch{data.warnings.push(`${s.title} 图片加载失败，导出中保留占位`);child=para('图片无法读取');}cells.unshift(new TableCell({width:{size:widths[0],type:WidthType.DXA},children:[child]}));}
      rows.push(new TableRow({cantSplit:true,children:cells}));
    }
    children.push(new Table({width:{size:11250,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,rows}));
  }
  const document=new Document({title:data.title,creator:'Lum',styles:{
    paragraphStyles:screenplayWordStyles,
    default:{
      document:{run:{font:'Microsoft YaHei',size:20},paragraph:{spacing:{line:280}}},
      ...(manuscript?{
        title:{run:{color:'1C1C1C',size:44,bold:true},paragraph:{keepNext:true}},
        heading1:{run:{color:'1C1C1C',size:30,bold:true}},
      }:{}),
    }
  },sections:[{properties:{page:{size:{orientation:manuscript?PageOrientation.PORTRAIT:PageOrientation.LANDSCAPE},margin:manuscript?{top:1247,right:1361,bottom:1247,left:1361}:{top:900,right:900,bottom:900,left:900}}},headers:data.watermark?{default:new Header({children:[new Paragraph({children:[new TextWatermark({text:data.watermark,font:'Microsoft YaHei',color:'D6DDD8',opacity:.35,layout:'diagonal'})]})]})}:undefined,children}]});
  return Packer.toBlob(document);
}
export async function openWritingExport(currentEpisode:string,defaultContent:Content='storyboard') {
  await flushWorkspace();const index=await loadDoc<EpisodeIndex>('episode:ep_001');if(!index?.chapters.length)throw Error('尚无章节');
  const {dialog,body}=modal('导出');dialog.classList.add('writingExport');
  const episodes=new Set(index.chapters.map(c=>c.episodeId));const contents=new Set<Content>([defaultContent]);const fields=new Set<ShotField>(shotFields.map(([id])=>id));
  const checks=<T extends string>(label:string,choices:readonly(readonly[T,string])[],selected:Set<T>)=>{const group=node('fieldset');group.append(node('legend',label));for(const [id,text] of choices){const wrap=node('label'),input=node('input');input.type='checkbox';input.checked=selected.has(id);input.onchange=()=>input.checked?selected.add(id):selected.delete(id);wrap.append(input,node('span',text));group.append(wrap);}return group;};
  const chapters=checks('导出章节',index.chapters.map(c=>[c.episodeId,c.title] as const),episodes);const all=action('全选',()=>{episodes.clear();index.chapters.forEach(c=>episodes.add(c.episodeId));chapters.querySelectorAll('input').forEach(c=>c.checked=true);});const current=action('仅当前章',()=>{episodes.clear();episodes.add(currentEpisode);chapters.querySelectorAll('input').forEach((c,i)=>c.checked=index.chapters[i].episodeId===currentEpisode);});chapters.append(all,current);
  const contentChoices=checks('导出内容',exportContents,contents);
  const shotChoices=checks('分镜表显示属性（分镜图始终保留）',shotFields,fields);
  const showShotChoices=()=>{shotChoices.style.display=contents.has('storyboard')?'':'none';};
  contentChoices.addEventListener('change',showShotChoices);
  showShotChoices();
  body.append(chapters,contentChoices);
  const formatLabel=node('label','格式'),format=node('select');format.setAttribute('aria-label','导出格式');for(const text of ['PDF','DOCX','TXT']){const option=node('option',text);format.append(option);}formatLabel.append(format);body.append(formatLabel,shotChoices);
  const watermarkLabel=node('label'),watermark=node('input'),watermarkText=node('input');watermark.type='checkbox';watermark.setAttribute('aria-label','水印');watermarkText.placeholder='水印文字';watermarkText.setAttribute('aria-label','水印文字');watermarkText.maxLength=100;watermarkText.disabled=true;watermarkText.value=(await loadDoc<{name:string}>('project:meta'))?.name??'内部稿件';watermark.onchange=()=>watermarkText.disabled=!watermark.checked;watermarkLabel.append(watermark,node('span','水印'),watermarkText);body.append(watermarkLabel,node('p','PDF / DOCX 每页斜排浅灰水印；TXT 保留稿件标记。资产表使用项目共用资料。','localMuted'));
  const status=node('p','','exportStatus');status.setAttribute('role','status');
  body.append(status,action('导出文件',async()=>{
    if(!episodes.size||!contents.size)throw Error('请至少选择一个章节和一种内容');
    if(watermark.checked&&!watermarkText.value.trim())throw Error('请输入水印文字');
    let printWindow:Window|null=null;
    const desktopPdf=format.value==='PDF' && !!window.lumDesktop?.saveWritingPdf;
    if(format.value==='PDF' && !desktopPdf){printWindow=window.open('','_blank');if(!printWindow)throw Error('请允许打开打印预览窗口');printWindow.document.title='正在准备导出';printWindow.document.body.textContent='正在读取项目内容…';}
    try{
      status.textContent='正在准备导出…';await flushWorkspace();const data=await collectWritingExport({episodes:[...episodes],contents:[...contents],fields:[...fields],watermark:watermark.checked?watermarkText.value.trim():''});const name=safeName(data.title);
      if(format.value==='TXT')downloadText(`${name}.txt`,writingExportText(data));
      else if(format.value==='DOCX')downloadBlob(await writingExportDocx(data),`${name}.docx`);
      else if(desktopPdf){
        const {saveDesktopWritingPdf}=await import('./desktopWritingPdf');
        if(!await saveDesktopWritingPdf(data,name)){
          status.textContent='已取消导出。';
          return;
        }
      }else if(printWindow){printWindow.document.open();printWindow.document.write(writingExportHtml(data));printWindow.document.close();printWindow.opener=null;await Promise.all([...printWindow.document.images].map(img=>img.complete?Promise.resolve():Promise.race([new Promise<void>(resolve=>{img.onload=()=>resolve();img.onerror=()=>{img.replaceWith(printWindow!.document.createTextNode('图片无法读取'));resolve();};}),new Promise<void>(resolve=>setTimeout(resolve,15000))])));if(!printWindow.closed){await printWindow.document.fonts.ready;printWindow.focus();printWindow.print();}}
      const success=desktopPdf?'PDF 已保存。':format.value==='PDF'?'已打开打印预览，请选择另存为 PDF。':'文件已生成。';
      status.textContent=data.warnings.length?`${success}${data.warnings.length} 张图片未能读取，已保留文字。`:success;
    }catch(error){if(printWindow&&!printWindow.closed)printWindow.close();status.textContent='导出失败，请重试。';throw error;}
  }));
}
export function mountWritingExport(root:HTMLElement,episodeId:string,screen:string) {
  for(const button of root.querySelectorAll<HTMLButtonElement>('button[data-writing-export],button[aria-label="导出"],button[title="导出"]')){
    button.onclick=e=>{e.preventDefault();e.stopPropagation();void openWritingExport(episodeId,screen==='04-storyboard'?'storyboard':screen==='03-outline'?'outline':'script').catch(error=>alert(String(error)));};
  }
}
