import {useEffect,useRef,useState} from 'react';
import {collectProductionMaterials,expandMaterialSelection,type ProductionMaterial} from './productionMaterials';
import {sendProductionMaterials} from './productionBridge';
import {previewImage,subscribeGeneration} from '../storyboard/generationState';
import {openImageViewer} from '../ui/imageViewer';
import {loadDoc} from '../data/db';
import './productionMaterialsPanel.css';

const materialGroups=[['character','人物'],['location','地点'],['prop','道具'],['scene','场次'],['shot','分镜']] as const;
function MaterialThumbnail({item}:{item:ProductionMaterial}) {
  const [preview,setPreview]=useState({path:'',source:''});
  const path=item.image?.path,mimeType=item.image?.mimeType;
  useEffect(()=>{let active=true;if(path&&mimeType)void previewImage({path,mimeType}).then(source=>{if(active)setPreview({path,source});}).catch(()=>{});return()=>{active=false;};},[path,mimeType]);
  const source=preview.path===path?preview.source:'';
  return source?<button className="materialThumbnail" aria-label={`放大查看${item.title}`} onClick={()=>openImageViewer(source,item.title)}><img src={source} alt={item.title} loading="lazy"/></button>:<span className="materialThumbnail materialPlaceholder" aria-hidden="true">{item.kind==='scene'?'场':item.kind==='shot'?'镜':item.title.slice(0,1)}</span>;
}
export function StageMaterialsPanel({close}:{close:()=>void}) {
  const destination='当前片场';
  const [items,setItems]=useState<ProductionMaterial[]>([]),[selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState(''),[status,setStatus]=useState('正在读取项目素材…'),[busy,setBusy]=useState(false),[projectName,setProjectName]=useState('当前项目');
  const [expanded,setExpanded]=useState<string[]>(['character','location']);
  const lifecycle=useRef({active:false,revision:0,busy:false});
  const refresh=async()=>{
    const revision=++lifecycle.current.revision;
    try{const [all,meta]=await Promise.all([collectProductionMaterials(),loadDoc<{name:string}>('project:meta')]);if(!lifecycle.current.active||revision!==lifecycle.current.revision)return;setItems(all);setProjectName(meta?.name||'当前项目');setSelected(s=>s.filter(key=>all.some(m=>m.key===key)));setStatus(`共 ${all.length} 条素材`);}
    catch(error){if(lifecycle.current.active&&revision===lifecycle.current.revision)setStatus(String(error));}
  };
  useEffect(()=>{
    const lifetime=lifecycle.current;lifetime.active=true;void refresh();let timer:ReturnType<typeof setTimeout>|undefined;
    const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),180);};
    window.addEventListener('dsh:content-updated',changed);window.addEventListener('dsh:project-renamed',changed);const unsubscribe=subscribeGeneration(changed);
    return()=>{lifetime.active=false;lifetime.revision++;clearTimeout(timer);unsubscribe();window.removeEventListener('dsh:content-updated',changed);window.removeEventListener('dsh:project-renamed',changed);};
  },[]);
  const visible=items.filter(item=>`${item.title} ${item.text} ${item.episodeTitle??''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const submit=async(keys:string[])=>{
    if(lifecycle.current.busy)return;lifecycle.current.busy=true;setBusy(true);setStatus(`正在加入${destination}…`);
    try{const chosen=expandMaterialSelection(await collectProductionMaterials(),keys);
      if(!lifecycle.current.active)return;
      const result=await sendProductionMaterials(chosen,undefined,'virtualStage');if(lifecycle.current.active)setStatus(`已加入${destination}：新增 ${result.created}，更新 ${result.updated}，未变 ${result.unchanged}。${result.conflicts.length?'已保留手工修改：'+result.conflicts.join('、'):''}${result.warnings?.join('；')??''}`);}
    catch(error){if(lifecycle.current.active)setStatus(error instanceof Error?error.message:String(error));}
    finally{lifecycle.current.busy=false;if(lifecycle.current.active)setBusy(false);}
  };
  const toggle=(key:string,checked:boolean)=>setSelected(current=>checked?[...new Set([...current,key])]:current.filter(id=>id!==key));
  return <aside className="productionMaterials" aria-label={`${destination}项目素材`}>
    <header><div><small>{projectName}</small><strong>项目素材</strong></div><button className="materialClose" aria-label="收起项目素材" onClick={close}>×</button></header>
    <p className="materialIntro">引用同一份资产，让每个镜头保持一致。</p>
    <input className="materialSearch" aria-label="搜索项目素材" placeholder="搜索名称、章节或内容" value={query} onChange={event=>setQuery(event.target.value)}/>
    <div className="productionActions"><button disabled={busy} onClick={()=>setSelected(current=>[...new Set([...current,...visible.map(item=>item.key)])])}>选择当前列表</button><button disabled={busy||!selected.length} onClick={()=>setSelected([])}>清空选择</button><button disabled={busy} onClick={()=>void refresh()}>刷新</button></div>
    <div className="productionList">
      {materialGroups.map(([kind,label])=>{
        const all=items.filter(item=>item.kind===kind||item.entityKind===kind),group=visible.filter(item=>item.kind===kind||item.entityKind===kind),open=expanded.includes(kind)||!!query.trim();
        return <section className="materialGroup" key={kind}><button className="materialGroupHeading" aria-expanded={open} onClick={()=>setExpanded(current=>current.includes(kind)?current.filter(value=>value!==kind):[...current,kind])}><strong>{label} <span>{all.length}</span></strong><span aria-hidden="true">{open?'⌃':'⌄'}</span></button>
          {open&&<div className="materialGroupItems">{group.map(item=>{
            const uses=items.filter(other=>other.kind==='shot'&&other.dependencies.includes(item.key)).length;
            const subtitle=item.kind==='entity'?`已关联 ${uses} 个镜头`:item.kind==='scene'?`${item.episodeTitle??''} · ${item.dependencies.filter(key=>key.startsWith('shot:')).length} 个镜头`:item.episodeTitle??'分镜';
            return <article className="materialItem" key={item.key}><input type="checkbox" aria-label={`选择${item.title}`} checked={selected.includes(item.key)} disabled={busy} onChange={event=>toggle(item.key,event.target.checked)}/><MaterialThumbnail item={item}/><details className="materialItemCopy"><summary title={item.title}>{item.title}</summary><p>{item.text}</p></details><small className="materialItemSubtitle">{subtitle}</small><button className="materialAdd" title={`加入${destination}`} aria-label={`将${item.title}加入${destination}`} disabled={busy} onClick={()=>void submit([item.key])}>＋</button></article>;
          })}{!group.length&&<p className="materialEmpty">{query?'没有匹配的素材':'暂无'+label}</p>}</div>}
        </section>;
      })}
    </div>
    <footer><p role="status">{status}</p>{!!selected.length&&<button disabled={busy} onClick={()=>void submit(selected)}>{busy?'正在加入…':`加入${destination} · ${selected.length} 项`}</button>}<small>场次会携带关联分镜和资产；重复加入保留节点位置与手工修改。</small></footer>
  </aside>;
}
