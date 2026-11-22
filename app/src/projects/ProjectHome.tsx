import { useEffect, useRef, useState } from 'react';
import { createProject, listProjects, openProject, renameProject, trashProject, type ProjectKind, type ProjectSummary } from './projectStore';
import './projectHome.css';

type Tab = 'recent' | 'script' | 'novel' | 'trash';
function Icon({ name }: { name: string }) {
  const paths: Record<string,string> = {
    plus:'M12 5v14M5 12h14',recent:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    script:'M7 3h7l4 4v14H6V3h1m7 0v5h4',novel:'M4 20c1-5 3-8 7-10m-7 6C2 6 14 2 21 3c0 9-7 15-14 13',
    trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
    search:'M17 17l4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.script}/></svg>;
}
const tabs: {id:Tab;label:string;icon:string}[] = [{id:'recent',label:'最近',icon:'recent'},{id:'script',label:'剧本',icon:'script'},{id:'novel',label:'小说',icon:'novel'},{id:'trash',label:'回收站',icon:'trash'}];
function editedAt(time: number) {
  const minutes = Math.max(0, Math.floor((Date.now()-time)/60000));
  if(minutes<1)return '刚刚'; if(minutes<60)return `${minutes} 分钟前`;
  if(minutes<1440)return `${Math.floor(minutes/60)} 小时前`;
  if(minutes<10080)return `${Math.floor(minutes/1440)} 天前`;
  return new Date(time).toLocaleDateString('zh-CN');
}
export function ProjectHome({ onSettings }: { onSettings: () => void }) {
  const [tab,setTab]=useState<Tab>('recent');const [projects,setProjects]=useState<ProjectSummary[]>([]);
  const [search,setSearch]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<ProjectSummary|null>(null);const [kind,setKind]=useState<ProjectKind>('script');const [name,setName]=useState('');const [dialogOpen,setDialogOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);const nameInput=useRef<HTMLInputElement>(null);
  const refresh=async()=>{try{setProjects(await listProjects());setError('');}catch(e){setError(String(e));}finally{setLoading(false);}};
  useEffect(()=>{void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
  useEffect(()=>{if(dialogOpen){dialog.current?.showModal();nameInput.current?.focus();}else dialog.current?.close();},[dialogOpen]);
  async function run(work:()=>Promise<void>) { if(busy)return;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);} }
  function newProject(value:ProjectKind) {setEditing(null);setKind(value);setName('');setError('');setDialogOpen(true);}
  const visible=projects.filter(p=>(tab==='trash'?!!p.trashedAt:!p.trashedAt)&&(tab==='recent'||tab==='trash'||p.kind===tab)&&`${p.name} ${p.summary}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="projectHome">
    <aside className="projectHomeSidebar">
      <a className="projectHomeBrand" href="/" aria-label="返回 Lum 主页"><img src="/brand/lumLogo.png" alt="Lum 影纪 Logo"/></a>
      <nav aria-label="项目导航"><button onClick={()=>newProject('script')}><Icon name="plus"/><span>新建</span></button>{tabs.map(item=><button key={item.id} className={tab===item.id?'isSelected':''} aria-current={tab===item.id?'page':undefined} onClick={()=>setTab(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id==='trash'&&projects.some(p=>p.trashedAt)&&<small>{projects.filter(p=>p.trashedAt).length}</small>}</button>)}</nav>
      <div className="projectHomeFooter"><button onClick={onSettings}><Icon name="settings"/>项目设置</button><p>本地创作 · API 接入</p></div>
    </aside>
    <main className="projectHomeMain"><header><h1>{tabs.find(t=>t.id===tab)?.label}</h1><label className="projectHomeSearch"><Icon name="search"/><input aria-label="搜索项目" placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)}/></label></header>
      {error&&!dialogOpen&&<div className="projectHomeError" role="alert">{error}<button onClick={()=>void refresh()}>重新读取</button></div>}
      {projects.some(project=>project.unavailable)&&<div className="projectHomeError" role="status">部分项目的本地数据暂不可用，异常记录已保留。其他可用项目仍可打开。<button onClick={()=>void refresh()}>重新读取</button></div>}
      <div className="projectHomeContent">
        <div className="projectHomeGrid">
          {!search&&tab!=='trash'&&<>
            {(tab==='recent'||tab==='script')&&<button className="projectCreateCard" onClick={()=>newProject('script')}><Icon name="plus"/><strong>新剧本</strong><span>撰写专业的结构化剧本</span></button>}
            {(tab==='recent'||tab==='novel')&&<button className="projectCreateCard" onClick={()=>newProject('novel')}><Icon name="plus"/><strong>新建小说</strong><span>按章节展开你的长篇故事</span></button>}
          </>}
          {visible.map(project=><article className="projectBook" key={project.id} data-project-id={project.id}>
            <button className="projectBookOpen" disabled={busy||!!project.trashedAt||project.unavailable} aria-label={`打开项目 ${project.name}${project.unavailable?'（数据暂不可用）':''}`} onClick={()=>void run(()=>openProject(project.id))}><h2>{project.name}</h2><p>{project.summary}</p><time dateTime={new Date(project.updatedAt).toISOString()}>{project.unavailable?'数据暂不可用':project.trashedAt?'移入回收站':'最近编辑'} {editedAt(project.trashedAt||project.updatedAt)}</time></button>
            <details className="projectBookMenu"><summary aria-label={`${project.name}的项目操作`}>···</summary><div>{project.trashedAt?<button disabled={busy} onClick={()=>void run(async()=>{await trashProject(project.id,false);await refresh();})}>恢复项目</button>:<><button disabled={busy||project.unavailable} onClick={()=>{setEditing(project);setName(project.name);setKind(project.kind);setError('');setDialogOpen(true);}}>重命名</button><button disabled={busy||project.unavailable} onClick={()=>void run(()=>openProject(project.id,'production'))}>打开制作工作区</button><button disabled={busy} onClick={()=>void run(async()=>{await trashProject(project.id,true);await refresh();})}>移入回收站</button></>}</div></details>
          </article>)}
        </div>
        {loading&&<p className="projectHomeEmpty" role="status">正在读取本地项目…</p>}
        {!loading&&!visible.length&&<p className="projectHomeEmpty">{search?'没有找到匹配的项目':tab==='trash'?'回收站是空的。移入的项目会保留内容，可随时恢复。':'从上方新建项目，开始你的创作。'}</p>}
      </div>
    </main>
    <dialog ref={dialog} className="projectHomeDialog" aria-label={editing?'重命名项目':'新建项目'} onCancel={e=>{if(busy)e.preventDefault();else setDialogOpen(false);}} onClose={()=>setDialogOpen(false)}>
      <form onSubmit={e=>{e.preventDefault();void run(async()=>{if(editing){await renameProject(editing.id,name);setDialogOpen(false);await refresh();}else{const project=await createProject(name,kind);await openProject(project.id);}});}}>
        <h2>{editing?'重命名项目':'新建项目'}</h2>{!editing&&<div className="projectKind"><button type="button" className={kind==='script'?'isSelected':''} onClick={()=>setKind('script')}>剧本</button><button type="button" className={kind==='novel'?'isSelected':''} onClick={()=>setKind('novel')}>小说</button></div>}
        <label>项目名称<input ref={nameInput} aria-label="项目名称" placeholder={kind==='novel'?'为你的小说取个名字':'为你的剧本取个名字'} maxLength={120} required value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
        {error&&<p role="alert" className="projectHomeError">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={()=>setDialogOpen(false)}>取消</button><button className="projectPrimary" type="submit" disabled={busy||!name.trim()}>{busy?'正在保存…':editing?'保存名称':'创建并打开'}</button></footer>
      </form>
    </dialog>
  </div>;
}
