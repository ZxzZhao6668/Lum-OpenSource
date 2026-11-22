import { db, loadDoc } from '../data/db';
import type { ScriptBlock } from '../script/editor';

export async function linkAsset(episodeId:string,blockId:string,entityId:string,remove=false) {
  await db.transaction('rw',db.docs,db.entities,async()=>{
    const blocks=await loadDoc<ScriptBlock[]>(`script:${episodeId}`)??[];if(!blocks.some(b=>b.id===blockId))throw Error('段落已不存在，请重新选择');
    if(!remove&&!await db.entities.get(entityId))throw Error('资产已不存在');
    const key=`entities:links:${episodeId}`,links=await loadDoc<Record<string,string[]>>(key)??{};
    links[blockId]=remove?(links[blockId]??[]).filter(id=>id!==entityId):[...new Set([...(links[blockId]??[]),entityId])];
    await db.docs.put({key,payload:links,updatedAt:Date.now()});
  });
  window.dispatchEvent(new CustomEvent('dsh:content-updated'));
}
