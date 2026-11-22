import type { EntityRow } from '../data/db';
import type { Shot } from './shotModel';

/** UTF-16 offsets match textarea selectionStart/selectionEnd. The ID owns identity,
 * while label is the literal text at the time this occurrence was written. */
export interface ShotMention { entityId: string; start: number; end: number; label: string }
type MentionedText = Pick<Shot, 'desc' | 'descMentions' | 'entityIds'>;

export function validMentions(text: string, values: unknown): ShotMention[] {
  if (!Array.isArray(values)) return [];
  let end = 0;
  return values.filter((m): m is ShotMention => !!m && typeof m.entityId === 'string' &&
    typeof m.label === 'string' && Number.isInteger(m.start) && Number.isInteger(m.end))
    .sort((a,b)=>a.start-b.start).filter(m=>{
      if (m.start<end || m.start<0 || m.end<=m.start || m.end>text.length || text.slice(m.start,m.end)!=='@'+m.label) return false;
      end=m.end;return true;
    }).map(m=>({...m}));
}

/** Legacy migration is deliberately conservative: only already-linked, unambiguous
 * names with a word boundary qualify. Ordinary names are never turned into links. */
export function initializeMentions(shot: MentionedText, rows: readonly Pick<EntityRow,'id'|'name'>[]) {
  if (shot.descMentions !== undefined) { shot.descMentions=validMentions(shot.desc,shot.descMentions);return; }
  const linked=rows.filter(row=>shot.entityIds?.includes(row.id));
  const candidates=linked.filter(row=>linked.filter(other=>other.name===row.name).length===1).sort((a,b)=>b.name.length-a.name.length);
  const mentions:ShotMention[]=[];
  for(let at=0;at<shot.desc.length;at++){
    if(shot.desc[at]!=='@')continue;
    const row=candidates.find(row=>shot.desc.startsWith('@'+row.name,at) && (at+row.name.length+1===shot.desc.length || /[\s，。！？、；：,.!?;:()（）\[\]“”"'—]/u.test(shot.desc[at+row.name.length+1])));
    if(row){const end=at+row.name.length+1;mentions.push({entityId:row.id,start:at,end,label:row.name});at=end-1;}
  }
  shot.descMentions=mentions;
}

export function mapMentionEdit(before:string, after:string, mentions:ShotMention[]):ShotMention[] {
  if(before===after)return validMentions(after,mentions);
  let prefix=0,suffix=0;const shorter=Math.min(before.length,after.length);
  while(prefix<shorter&&before[prefix]===after[prefix])prefix++;
  while(suffix<shorter&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
  // Repeated text can admit several equally valid edit locations. Preserve only
  // references outside their union; unknown edits must never guess an asset ID.
  const ambiguous=prefix+suffix>shorter;
  const start=ambiguous?shorter-suffix:prefix;
  const end=ambiguous?prefix+Math.max(0,before.length-after.length):before.length-suffix;
  const shift=after.length-before.length;
  return validMentions(after,validMentions(before,mentions).flatMap(m=>m.end<=start?[m]:m.start>=end?[{...m,start:m.start+shift,end:m.end+shift}]:[]));
}

/** A real selection is authoritative even if the replacement has identical text. */
export function mapMentionReplacement(before:string,after:string,mentions:ShotMention[],start:number,end:number):ShotMention[]{
  const inserted=after.length-before.length+end-start;
  if(start<0||end<start||end>before.length||inserted<0||before.slice(0,start)+after.slice(start,start+inserted)+before.slice(end)!==after)return mapMentionEdit(before,after,mentions);
  const shift=after.length-before.length;
  return validMentions(after,validMentions(before,mentions).flatMap(m=>m.end<=start?[m]:m.start>=end?[{...m,start:m.start+shift,end:m.end+shift}]:[]));
}

export function setShotDescription(shot:MentionedText, text:string) {
  if(shot.desc===text)return;
  if(shot.descMentions!==undefined)shot.descMentions=mapMentionEdit(shot.desc,text,shot.descMentions);
  shot.desc=text;
}

export function renameShotMentions(shot:Shot, before:EntityRow, after:EntityRow, rows:EntityRow[]):Shot {
  if(before.name===after.name)return shot;
  const next=structuredClone(shot);initializeMentions(next,rows);
  const refs=next.descMentions!;
  if(!refs.some(m=>m.entityId===before.id))return shot;
  let text='',at=0;const renamed:ShotMention[]=[];
  for(const ref of refs){
    text+=next.desc.slice(at,ref.start);const label=ref.entityId===before.id?after.name:ref.label;
    const start=text.length;text+='@'+label;renamed.push({...ref,label,start,end:text.length});at=ref.end;
  }
  next.desc=text+next.desc.slice(at);next.descMentions=renamed;return next;
}
