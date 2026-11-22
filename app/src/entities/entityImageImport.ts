import {action,modal,node} from '../ui/localUi';
import {prepareEntityImage} from './entityImageUpload';

/** Sequential decoding keeps a multi-file import from holding all originals in memory. */
export function attachImageImport(host:HTMLElement,options:{title:()=>string;begin?:()=>void;save:(name:string,image:string)=>Promise<void>;complete?:(count:number)=>void|Promise<void>}) {
  const input=node('input');input.type='file';input.multiple=true;input.hidden=true;
  input.accept='image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';input.setAttribute('aria-label','上传资产图片');
  const button=action('上传图片',()=>input.click());host.append(button,input);
  input.onchange=async()=>{
    const files=[...input.files??[]];input.value='';if(!files.length)return;options.begin?.();button.disabled=true;
    const {dialog,body}=modal(options.title());let cancelled=false,success=0,failed=0;
    const cancel=()=>{cancelled=true;};
    // Close/Escape start an exit animation before the dialog emits `close`.
    dialog.querySelector('header button')?.addEventListener('click',cancel,{capture:true,once:true});
    dialog.addEventListener('cancel',cancel,{capture:true,once:true});
    dialog.addEventListener('close',cancel,{once:true});
    const status=node('p','','localStatus');status.setAttribute('role','status');
    const list=node('ul','','assetImportResults'),items=files.map(file=>node('li',`${file.name} · 等待导入`));list.append(...items);
    const stop=action('停止导入',()=>{cancelled=true;stop.hidden=true;status.textContent='正在停止，已导入的图片会保留。';});
    body.append(node('p','支持 PNG、JPG、WebP，单张最大 32MB。按文件名创建资产；大图自动压缩。停止或关闭只会取消尚未保存的图片。','localMuted'),status,list,stop);
    try{
      for(const [index,file] of files.entries()){
        if(cancelled)break;
        status.textContent=`正在处理 ${index+1}/${files.length} · 已导入 ${success} 张`;
        items[index].textContent=`${file.name} · 正在处理…`;
        try{
          const result=await prepareEntityImage(file);if(cancelled)break;
          const name=file.name.replace(/\.[^.]*$/,'').trim().slice(0,200)||'未命名资产';
          await options.save(name,result.dataUrl);success++;
          items[index].textContent=`${file.name} · 已导入${result.adjusted?'（已自动压缩）':''}`;
        }catch(error){failed++;items[index].textContent=`${file.name} · 失败：${error instanceof Error?error.message:String(error)}`;}
      }
      const pending=files.length-success-failed;
      if(pending)for(const item of items)if(/ · (等待导入|正在处理…)$/.test(item.textContent??''))item.textContent=item.textContent!.replace(/ · .+$/,' · 未导入');
      status.textContent=`${cancelled?'已停止':'导入完成'}：已导入 ${success} 张，失败 ${failed} 张${pending?`，未导入 ${pending} 张`:''}。`;
      stop.hidden=true;
      if(success)await options.complete?.(success);
    }catch(error){status.textContent+=` 刷新列表失败：${error instanceof Error?error.message:String(error)}`;}
    finally{button.disabled=false;}
  };
  return button;
}
