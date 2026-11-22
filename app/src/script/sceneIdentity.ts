export const parseScene = (text: string, fallbackIndex?: number) => {
  const t = text.replace(/\u200B/g, "").trim();
  const m = /^(\d+)\s*[.、]?\s*(内外|内|外)\s*(.+?)\s*[-–—]\s*(\S{1,6})\s*$/.exec(t);
  if (m) return { index: Number(m[1]), intExt: m[2], location: m[3].trim(), timeOfDay: m[4] };
  const m2 = /^(\d+)\s*[.、]\s*(内外|内|外)\s*(.+)$/.exec(t);
  if (m2) {
    const rest = m2[3].trim();
    // 没有破折号时，末尾的「日 / 夜 / 清晨」当成时间
    const mt = /^(.*?)\s*(清晨|傍晚|深夜|白天|黄昏|黎明|夜|日|晨|暮)$/.exec(rest);
    if (mt && mt[1].trim()) {
      return { index: Number(m2[1]), intExt: m2[2], location: mt[1].trim(), timeOfDay: mt[2] };
    }
    return { index: Number(m2[1]), intExt: m2[2], location: rest, timeOfDay: "" };
  }
  const plainNumber=/^(\d+)\s*[.、]\s*(.+)$/.exec(t);
  if(plainNumber){const end=/^(.*?)\s*[-—–]\s*(.{1,20})$/.exec(plainNumber[2]);return {index:Number(plainNumber[1]),intExt:'',location:end?end[1].trim():plainNumber[2],timeOfDay:end?end[2].trim():''};}
  const heading=/^(?:(?:第[零一二三四五六七八九十百\d]+场|场景[零一二三四五六七八九十百\d]+)\s*[:：.、-]?\s*)?(?:(INT\.?\s*\/\s*EXT\.?|INT\.?|EXT\.?|内外景|内外|内景|外景|内|外)\s*[.：:]?\s*)(.+)$/i.exec(t);
  if(heading){const place=heading[2];const end=/^(.*?)\s*[-—–]\s*(.{1,20})$/.exec(place);const intExt=/INT.*EXT|内外/i.test(heading[1])?'内外':/INT|内/i.test(heading[1])?'内':'外';return {index:fallbackIndex??1,intExt,location:end?end[1].trim():place.trim(),timeOfDay:end?end[2].trim():''};}
  // A scene-typed block must remain visible even when its author uses a free-form heading.
  if(fallbackIndex!==undefined)return {index:fallbackIndex,intExt:'',location:t||'未命名场次',timeOfDay:''};
  return null;
};


// Navigation follows the current chapter order; keep parseScene's source number
// unchanged so legacy title-based references can still migrate safely.
export const sceneAtOrder = (text: string, index: number) => ({
  ...parseScene(text, index)!,
  index,
});

export const sceneRef = (blockId: string) => `block:${blockId}`;
export const UNASSIGNED_SCENE = "unassigned";
