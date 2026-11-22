const TEXT_LIMIT=2*1024*1024;
function checked(text:string){if(!text.trim())throw Error('文件中没有可提取的文字；扫描件请先转换为带文字的 PDF');if(text.includes('\0'))throw Error('文件包含无效文字');if(new TextEncoder().encode(text).byteLength>TEXT_LIMIT)throw Error('提取正文超过2MiB，请拆分后导入');return text;}
export async function extractProjectDocument(input:File):Promise<{text:string;encoding:string}>{
 if(!input.size||input.size>10*1024*1024)throw Error('PDF / Word 单份文件须为1字节至10MiB');
 const bytes=await input.arrayBuffer();
 if(/\.docx$/i.test(input.name)){
  const worker=new Worker(new URL('./documentImportWorker.ts',import.meta.url),{type:'module'});
  const text=await new Promise<string>((resolve,reject)=>{const end=(error?:string,value?:string)=>{clearTimeout(timer);worker.terminate();if(error)reject(Error(error));else resolve(value??'');};const timer=setTimeout(()=>end('Word 文档解析超时，请拆分或转为文本'),30000);worker.onerror=()=>end('Word 文档无法解析，请检查文件是否损坏');worker.onmessage=e=>end(e.data.error,e.data.text);worker.postMessage(bytes,[bytes]);});
  return {text:checked(text),encoding:'DOCX'};
 }
 const pdf=await import('pdfjs-dist');const workerUrl=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;pdf.GlobalWorkerOptions.workerSrc=workerUrl;
 const task=pdf.getDocument({data:bytes,useSystemFonts:true});const timer=setTimeout(()=>void task.destroy(),30000);
 try{const doc=await task.promise;if(doc.numPages>200)throw Error('PDF 超过200页，请拆分后导入');const pages:string[]=[];let size=0;for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);const content=await page.getTextContent();const text=content.items.map(item=>'str'in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim();size+=new TextEncoder().encode(text).byteLength;if(size>TEXT_LIMIT)throw Error('提取正文超过2MiB，请拆分后导入');pages.push(text);page.cleanup();}return {text:checked(pages.join('\n\n')),encoding:'PDF'};
 }catch(error){if(error instanceof Error&&error.name==='PasswordException')throw Error('PDF 已加密，请先另存为可读取的文件');throw error;}finally{clearTimeout(timer);await task.destroy();}
}
