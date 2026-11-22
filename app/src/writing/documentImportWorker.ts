import mammoth from 'mammoth';
import {unzipSync} from 'fflate';

self.onmessage=async(event:MessageEvent<ArrayBuffer>)=>{
 try{
  let total=0,count=0,hasDocument=false;
  unzipSync(new Uint8Array(event.data),{filter:file=>{total+=file.originalSize;count++;if(file.name==='word/document.xml')hasDocument=true;if(total>32*1024*1024||file.originalSize>16*1024*1024||count>4000)throw Error('Word 解压内容超过容量限制');return false;}});
  if(!hasDocument)throw Error('不是有效的 DOCX 文档');
  const result=await mammoth.extractRawText({arrayBuffer:event.data});
  self.postMessage({text:result.value.trim()});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:'Word 文档解析失败'});}
};
