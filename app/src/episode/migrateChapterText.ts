import { db, loadDoc, saveDoc } from '../data/db';
import type { EpisodeIndex } from './episodeManager';
import { readDocument, createEpisodeDocument, saveDocument } from '../writing/documentStore';

/** Legacy sidebar drafts become a real document once; never overwrite an existing script. */
export async function migrateChapterText(episodeId:string) {
  await db.transaction('rw',db.docs,async()=>{
    const index=await loadDoc<EpisodeIndex>('episode:ep_001');const chapter=index?.chapters.find(c=>c.episodeId===episodeId);if(!chapter)return;
    if(!await db.docs.get(`script:${episodeId}`)&&episodeId!=='ep_001')await createEpisodeDocument(episodeId);
    const marker=`chapter:migrated:${chapter.id}`;if(await loadDoc(marker))return;
    const document=await readDocument(episodeId);
    if(chapter.content?.trim()&&!document.blocks.some(block=>block.text.trim())){
      await saveDocument(episodeId,chapter.content.split(/\r?\n/).map(text=>({id:crypto.randomUUID(),type:'action',text})),document.revision);
      await saveDoc(marker,{source:chapter.content,migratedAt:Date.now()});
    }else await saveDoc(marker,{migratedAt:Date.now(),...(chapter.content?.trim()?{preservedLegacyText:chapter.content}:{} )});
  });
}
