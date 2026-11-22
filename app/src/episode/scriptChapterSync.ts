import { db, loadDoc } from '../data/db';
import type { EpisodeEntry, EpisodeIndex } from './episodeManager';
import { readDocument, type DocumentSnapshot, type ScriptBlock, type WriteAuthorization } from '../writing/documentStore';
import { moveSceneAssets } from '../writing/structuredTools';
import { applyWorkspaceChange, prepareWorkspaceChange, type WorkspaceChange } from '../writing/workspaceChanges';

export interface ScriptChapterSyncOptions { episodeIds?: string[]; cancelled?: () => boolean; renumberOnly?:boolean }
export interface ScriptChapterSyncResult { changed: boolean; changeId?: string; episodeIds: string[]; skipped: string[] }
interface Heading { title: string; number: number; unit: string; caption: string }
interface Part { heading: Heading; start: number }
interface TitleSource {heading:string; sourceHeadings?:string[]}
const indexKey = 'episode:ep_001';
const titlesKey = 'episode:scriptChapterTitles';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const numberedPrefix = /^第([0-9零〇一二三四五六七八九十百千万两]+)(章|集)(?=$|[\s：:、.．—-])/;
function chineseOrdinal(value:number,inner=false):string {
  const digits='零一二三四五六七八九';
  if(value<10)return digits[value];
  if(value>=10000)return String(value);
  const [unit,label]=value>=1000?[1000,'千'] as const:value>=100?[100,'百'] as const:[10,'十'] as const;
  const head=Math.floor(value/unit),tail=value%unit;
  return (unit===10&&head===1&&!inner?'':digits[head])+label+(tail?(tail<unit/10?'零':'')+chineseOrdinal(tail,true):'');
}
function numberedTitle(title:string,position:number){
  return title.replace(numberedPrefix,(_,value:string,unit:string)=>`第${/^\d+$/.test(value)?position:chineseOrdinal(position)}${unit}`);
}

function numberOf(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  let total = 0, section = 0, digit = 0;
  for (const c of value.replaceAll('〇', '零').replaceAll('两', '二')) {
    const n = digits.indexOf(c);
    if (n >= 0) digit = n;
    else if (c === '万') { total += (section + digit || 1) * 10000; section = 0; digit = 0; }
    else { section += (digit || 1) * ({十:10,百:100,千:1000}[c] ?? 0); digit = 0; }
  }
  return total + section + digit;
}

/** Deliberately narrow: standalone numbered chapter/episode headings, never scenes or speech. */
function heading(text: string): Heading | undefined {
  const title = text.trim().replace(/^#{1,6}[^\S\r\n]+/, '').replace(/[^\S\r\n]+#+$/, '').trim();
  if (title.length > 120 || /[\r\n，。！？；“”「」]/.test(title)) return;
  const match = /^第([0-9零〇一二三四五六七八九十百千万两]+)(章|集)(?:(?:[^\S\r\n]+|[：:、.．—-][^\S\r\n]*)(.+))?$/.exec(title);
  if (!match) return;
  const number = numberOf(match[1]);
  if (!Number.isSafeInteger(number) || number < 1) return;
  return { title, number, unit: match[2], caption: (match[3] ?? '').trim() };
}

function chaptersIn(source: ScriptBlock[]): {blocks:ScriptBlock[];headings:Part[]} {
  // Imported/pasted prose can contain many lines in one block. Slice only at
  // explicit heading lines, retaining the original ID on its first fragment and
  // every character (including line endings); scene and speech blocks stay whole.
  const blocks = source.flatMap(block=>{
    if (!['action','subtitle','comment'].includes(block.type)) return [block];
    const offsets = [0];
    for (const line of block.text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
      if (line.index > 0 && heading(line[0].trim())) offsets.push(line.index);
    }
    return offsets.map((start,i)=>({...block,id:i?crypto.randomUUID():block.id,text:block.text.slice(start,offsets[i+1])}));
  });
  const headings = blocks.flatMap((block, start) => {
    if (!['action', 'subtitle', 'comment'].includes(block.type)) return [];
    const found = heading(block.text.split(/[\r\n]/,1)[0]);
    return found ? [{heading:found,start}] : [];
  });
  return {blocks,headings};
}

function matches(entry: EpisodeEntry, target: Heading) {
  const found = heading(entry.title);
  return found ? found.number === target.number && found.unit === target.unit
    : entry.title.trim() === target.title || !!target.caption && entry.title.trim() === target.caption;
}

async function hasSceneData(id: string) {
  const shots = await loadDoc<unknown[]>(`storyboard:${id}`);
  if (shots?.length) return true;
  for (const key of [`entities:links:${id}`, `scene:desc:${id}`, `storyboard:${id}:views`]) {
    if (Object.keys(await loadDoc<Record<string,unknown>>(key) ?? {}).length) return true;
  }
  const canvas = await loadDoc<{nodes?:Record<string,unknown>}>(`scenes:canvas:${id}`);
  return !!Object.keys(canvas?.nodes ?? {}).length;
}

/** Prepare a reversible structural edit. Callers flush editors before scanning; application
 * checks the directory, every touched document revision, and scene records again atomically. */
export async function prepareScriptChapterSync(options: ScriptChapterSyncOptions = {}): Promise<{change:WorkspaceChange|null;skipped:string[]}> {
  return db.transaction('rw',db.docs,db.entities,()=>prepareSync(options));
}

async function prepareSync(options: ScriptChapterSyncOptions): Promise<{change:WorkspaceChange|null;skipped:string[]}> {
  if (options.cancelled?.()) throw Error('已停止，未同步章节');
  const index = await loadDoc<EpisodeIndex>(indexKey);
  if (!index?.chapters.length) return {change:null,skipped:[]};
  const titles = await loadDoc<Record<string,TitleSource>>(titlesKey) ?? {};
  const originalTitles = structuredClone(titles);
  const original = structuredClone(index), skipped: string[] = [], reserved = new Set<string>();
  const plans: {source:EpisodeEntry;snapshot:DocumentSnapshot;entries:EpisodeEntry[];parts:{episodeId:string;blocks:ScriptBlock[];before:DocumentSnapshot|null}[]}[] = [];
  for (const source of options.renumberOnly?[]:original.chapters) {
    if (options.cancelled?.()) throw Error('已停止，未同步章节');
    if (reserved.has(source.episodeId) || options.episodeIds && !options.episodeIds.includes(source.episodeId)) continue;
    if (!await db.docs.get(`script:${source.episodeId}`)) {
      if(!source.draft||source.content?.trim())skipped.push(`${source.title}：尚无独立正文，保留旧章节内容`);
      continue;
    }
    const snapshot = await readDocument(source.episodeId), {blocks,headings} = chaptersIn(snapshot.blocks);
    if (!headings.length) continue;
    if (headings.length > 50 || headings.some((h,i) => i > 0 && (h.heading.unit !== headings[0].heading.unit || h.heading.number <= headings[i-1].heading.number))) {
      skipped.push(`${source.title}：章节标题顺序重复或不明确，保留原文`); continue;
    }
    // Once derived, an unchanged heading must not overwrite a user's later card
    // rename. Register even matching existing titles on the first scan.
    if (headings.length === 1 && titles[source.episodeId]?.heading === headings[0].heading.title && !source.draft) continue;
    const entries: EpisodeEntry[] = [], parts: typeof plans[number]['parts'] = [];
    let blocked = false;
    for (const [i, h] of headings.entries()) {
      const candidates = index.chapters.filter(c => c.episodeId !== source.episodeId && (matches(c,h.heading)
        || titles[c.episodeId] && (matches({...c,title:titles[c.episodeId].heading},h.heading)||titles[c.episodeId].sourceHeadings?.includes(h.heading.title))));
      // The first part keeps the source ID (and preamble); never merge it into another document.
      if (candidates.length > 1 || candidates.some(c=>reserved.has(c.episodeId)) || i === 0 && candidates.length) { blocked = true; break; }
      const reuse = candidates[0];
      if(reuse&&!await db.docs.get(`script:${reuse.episodeId}`)){blocked=true;break;}
      const before = i === 0 ? snapshot : reuse ? await readDocument(reuse.episodeId) : null;
      if (reuse && (reuse.content?.trim() || before?.blocks.some(b=>b.text.trim()) || await hasSceneData(reuse.episodeId))) { blocked = true; break; }
      const id = i === 0 ? source.episodeId : reuse?.episodeId ?? `ep_${crypto.randomUUID()}`;
      const base = i === 0 ? source : reuse;
      const entry: EpisodeEntry = {...(base ?? {id,episodeId:id,content:''}), title:base&&titles[id]?.heading===h.heading.title?base.title:h.heading.title};
      delete entry.draft;
      entries.push(entry);
      parts.push({episodeId:id,before,blocks:[...(i && before ? before.blocks : []),...blocks.slice(i === 0 ? 0 : h.start,headings[i+1]?.start)]});
    }
    if (blocked) { skipped.push(`${source.title}：同名或同序号章节已有内容，保留原文`); continue; }
    const used = new Set(entries.map(e=>e.episodeId));
    for(const [i,entry] of entries.entries())titles[entry.episodeId]={...titles[entry.episodeId],heading:headings[i].heading.title};
    for (const id of used) reserved.add(id);
    index.chapters = index.chapters.filter(c=>c.episodeId===source.episodeId||!used.has(c.episodeId));
    const at = index.chapters.findIndex(c=>c.episodeId===source.episodeId);
    index.chapters.splice(at,1,...entries);
    plans.push({source,snapshot,entries,parts});
  }
  // The project's directory order owns numbering. Imported/source chapter numbers
  // must not make a new project begin at chapter 10 or create gaps after a split.
  const allowedIds=options.episodeIds?new Set([...options.episodeIds,...plans.flatMap(p=>p.entries.map(e=>e.episodeId))]):undefined;
  const renumbers=index.chapters.filter(c=>!c.draft).map((entry,i)=>({entry,position:i+1,before:entry.title,after:numberedTitle(entry.title,i+1)})).filter(r=>r.before!==r.after&&(!allowedIds||allowedIds.has(r.entry.episodeId)));
  if (!plans.length&&!renumbers.length) return {change:null,skipped};
  const change = await prepareWorkspaceChange('按剧本章节同步目录',plans[0]?.source.episodeId??renumbers[0].entry.episodeId,'01-script',async draft=>{
    if (!same(await draft.doc(indexKey),original)) throw Error('章节目录已变化，请重新同步');
    if (!same(await draft.doc(titlesKey) ?? {},originalTitles)) throw Error('章节标题来源已变化，请重新同步');
    if (options.cancelled?.()) throw Error('已停止，未同步章节');
    for (const plan of plans) {
      const current = await readDocument(plan.source.episodeId);
      if (current.revision !== plan.snapshot.revision || !same(current.blocks,plan.snapshot.blocks)) throw Error('正文已变化，请重新同步');
      if (plan.parts.length === 1) {
        // Rename/promote without changing the document revision; unchanged records act as
        // read guards so a prepared rename cannot be applied after a concurrent body edit.
        for (const key of [`script:${plan.source.episodeId}`,`writing:document:${plan.source.episodeId}:metadata`]) {
          const value = await draft.doc(key);
          draft.change.docs.push({key,before:value,after:structuredClone(value)});
        }
      } else {
        await moveSceneAssets(draft,plan.source.episodeId,plan.parts);
        for (const part of plan.parts) {
          await draft.script(part.episodeId,part.blocks,part.before);
          if (part.episodeId !== plan.source.episodeId && !await draft.doc(`outline:${part.episodeId}`)) {
            await draft.setDoc(`outline:${part.episodeId}`,{active:0,docs:[{id:'outline',title:'大纲',html:'<p></p>'}]});
          }
        }
      }
    }
    for(const renumber of renumbers){
      const id=renumber.entry.episodeId,knownHeading=titles[id]?.heading;
      const staged=draft.change.scripts.find(script=>script.episodeId===id);
      const snapshot=!staged&&await db.docs.get(`script:${id}`)?await readDocument(id):null;
      const blocks=staged?.after??snapshot?.blocks;
      let updatedHeading:string|undefined;
      const after=blocks?.map(block=>{
        if(!['action','subtitle','comment'].includes(block.type))return block;
        const text=block.text.replace(/[^\r\n]+/g,line=>{
          const parsed=heading(line);if(!parsed||![renumber.before,knownHeading].includes(parsed.title))return line;
          const rewritten=line.replace(/^([^\S\r\n]*(?:#{1,6}[^\S\r\n]+)?)(第[^\r\n]*)$/,(_,prefix:string,rest:string)=>prefix+numberedTitle(rest,renumber.position));
          if(rewritten!==line)updatedHeading=numberedTitle(parsed.title,renumber.position);
          return rewritten;
        });
        return text===block.text?block:{...block,text};
      });
      if(after&&blocks&&!same(after,blocks)){
        if(staged)staged.after=after;else await draft.script(id,after,snapshot);
        // A title-only sync may have staged no-op read guards. Do not let them
        // overwrite the newly numbered script or its updated revision on commit.
        draft.change.docs=draft.change.docs.filter(d=>!([`script:${id}`,`writing:document:${id}:metadata`].includes(d.key)&&same(d.before,d.after)));
      }
      if(updatedHeading)titles[id]={heading:updatedHeading,sourceHeadings:[...new Set([...(titles[id]?.sourceHeadings??[]),knownHeading??renumber.before])].slice(-50)};
      renumber.entry.title=renumber.after;
    }
    index.collapsed = false;
    await draft.setDoc(indexKey,index);
    await draft.setDoc(titlesKey,titles);
    const changedEntries=[...plans.flatMap(p=>p.entries),...renumbers.map(r=>r.entry)];
    return {chapters:[...new Map(changedEntries.map(c=>[c.episodeId,{episodeId:c.episodeId,title:c.title}])).values()],skipped};
  });
  return {change,skipped};
}

/** Explicit UI authorization or a completed direct-write run is required. No model calls. */
export async function synchronizeScriptChapters(authorization: WriteAuthorization, options: ScriptChapterSyncOptions = {}): Promise<ScriptChapterSyncResult> {
  if (!authorization || !('approvedByUser' in authorization && authorization.approvedByUser === true || 'agentWriteEnabled' in authorization && authorization.agentWriteEnabled === true)) throw Error('写入模式未开启，未同步章节');
  return db.transaction('rw',db.docs,db.entities,async()=>{
    const {change,skipped} = await prepareScriptChapterSync(options);
    if (!change) return {changed:false,episodeIds:[],skipped};
    if (options.cancelled?.()) throw Error('已停止，未同步章节');
    const applied = await applyWorkspaceChange(change.id,authorization);
    return {changed:true,changeId:applied.id,episodeIds:(applied.result.chapters as {episodeId:string}[]).map(c=>c.episodeId),skipped};
  });
}
