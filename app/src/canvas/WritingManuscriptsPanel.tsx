import {useCallback, useEffect, useRef, useState} from 'react';
import {currentProjectId} from '../projects/projectIdentity';
import {getProject, listWritingProjectChoices, type Project} from '../projects/projectStore';
import {collectWritingManuscripts, type WritingManuscript} from './writingManuscripts';
import {sendWritingManuscripts} from './productionBridge';
import './productionMaterialsPanel.css';
import './writingManuscriptsPanel.css';

const categories = [
  ['script','剧本正文'], ['outline','大纲'], ['scene','场次'], ['shot','分镜'],
] as const;
const sourcePreference = 'lum:canvas:manuscript-source';

function ManuscriptEntry({item, selected, disabled, onSelect, onInsert}: {
  item: WritingManuscript; selected: boolean; disabled: boolean; onSelect: () => void; onInsert: () => void;
}) {
  const [open,setOpen] = useState(false);
  return <article className="manuscriptEntry">
    <input type="checkbox" checked={selected} onChange={onSelect} aria-label={'选择' + item.title}/>
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{item.title}</summary>
      {open && <pre>{item.text}</pre>}
    </details>
    {item.title !== item.episodeTitle && <small>{item.episodeTitle}</small>}
    <button type="button" className="materialAdd" title="放入画布" aria-label={'将' + item.title + '放入画布'} onClick={onInsert} disabled={disabled}>＋</button>
  </article>;
}

function ManuscriptList({sourceId, ready}: {sourceId: string; ready: boolean}) {
  const [items,setItems] = useState<WritingManuscript[]>([]);
  const [kind,setKind] = useState<WritingManuscript['kind']>('script');
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState<string[]>([]);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState('');
  const [notice,setNotice] = useState('');
  const [sending,setSending] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const submitting = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    try {
      const entries = await collectWritingManuscripts(sourceId);
      if (!mounted.current || request !== revision.current) return;
      setItems(entries);
      const keys = new Set(entries.map(item => item.key));
      setSelected(previous => previous.filter(key => keys.has(key)));
      setLoadError('');
    } catch (error) {
      if (mounted.current && request === revision.current) setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current && request === revision.current) setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onChange = () => { void refresh(); };
    window.addEventListener('focus',onChange);
    window.addEventListener('dsh:content-updated',onChange);
    return () => {
      mounted.current = false;
      revision.current++;
      window.removeEventListener('focus',onChange);
      window.removeEventListener('dsh:content-updated',onChange);
    };
  }, [refresh]);

  const insert = async (keys: string[]) => {
    if (!keys.length || submitting.current) return;
    submitting.current = true;
    setSending(true);
    setNotice('正在放入画布…');
    try {
      const latest = new Map((await collectWritingManuscripts(sourceId)).map(item => [item.key,item]));
      if (!mounted.current) return;
      const chosen = keys.map(key => {
        const item = latest.get(key);
        if (!item) throw Error('所选文稿已移除，请刷新后重选。');
        return item;
      });
      const result = await sendWritingManuscripts(chosen,sourceId);
      if (mounted.current) {
        setNotice('新增 ' + result.created + ' 个文本节点，更新 ' + result.updated + ' 个，已有 ' + result.unchanged +
          ' 个内容相同。' + (result.conflicts.length ? '已保留手动修改的节点：' + result.conflicts.join('、') : ''));
      }
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const term = query.trim().toLocaleLowerCase();
  const matches = items.filter(item => !term || [item.title,item.episodeTitle,item.text].some(s => s.toLocaleLowerCase().includes(term)));
  const visible = matches.filter(item => item.kind === kind);
  return <>
    <input type="search" className="materialSearch" aria-label="搜索写作文稿" placeholder="搜索章节、标题或正文" value={query} onChange={e => setQuery(e.target.value)}/>
    <div className="manuscriptKinds" role="group" aria-label="文稿类型">
      {categories.map(([key,label]) => <button key={key} type="button" aria-label={label} aria-pressed={kind===key} onClick={() => setKind(key)}>
        {label}<span aria-hidden="true">{matches.filter(item => item.kind === key).length}</span>
      </button>)}
    </div>
    <div className="productionActions">
      <button type="button" disabled={!visible.length} onClick={() => setSelected(s => [...new Set([...s,...visible.map(item => item.key)])])}>选择本类</button>
      <button type="button" disabled={!selected.length} onClick={() => setSelected([])}>清空选择</button>
      <button type="button" disabled={loading} onClick={() => {setNotice(''); void refresh();}}>刷新</button>
    </div>
    <div className="productionList manuscriptList" aria-busy={loading}>
      {loadError ? <p role="alert">{loadError}</p> : !visible.length ?
        <p className="materialEmpty">{loading ? '正在读取文稿…' : !items.length ? '这个项目还没有可用的写作文稿。' : term ? '本类没有匹配的文稿。' : '本类暂无文稿。'}</p> :
        visible.map(item => <ManuscriptEntry key={item.key} item={item} disabled={!ready || sending || !!loadError}
          selected={selected.includes(item.key)} onSelect={() => setSelected(s => s.includes(item.key) ? s.filter(k => k!==item.key) : [...s,item.key])}
          onInsert={() => void insert([item.key])}/>)}
    </div>
    <footer>
      <button type="button" className="manuscriptInsert" disabled={!ready || sending || !selected.length || !!loadError}
        onClick={() => void insert(selected)}>{'将所选 ' + selected.length + ' 条放入画布'}</button>
      <p role="status">{notice || (!ready ? '正在等待画布连接。' : '')}</p>
    </footer>
  </>;
}

export function WritingManuscriptsPanel({ready,close}: {ready:boolean;close:()=>void}) {
  const [sources,setSources] = useState<Project[]>([]);
  const [source,setSource] = useState('');
  const [status,setStatus] = useState('正在读取写作项目…');
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const projects = currentProjectId ? [await getProject(currentProjectId)].filter((p): p is Project => !!p && !p.trashedAt) : await listWritingProjectChoices();
        if (!active) return;
        let saved: string | null = null;
        try {saved=localStorage.getItem(sourcePreference);} catch { /* Storage may be unavailable. */ }
        setSources(projects);
        setSource((projects.find(p => p.id === saved) ?? projects[0])?.id ?? '');
        setStatus(projects.length ? '' : '暂无可读取的写作项目。');
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { active = false; };
  },[]);
  return <aside className="productionMaterials manuscriptPanel" aria-label="写作文稿">
    <header><strong>写作文稿</strong><button type="button" className="materialClose" aria-label="关闭写作文稿" onClick={close}>×</button></header>
    {source && (currentProjectId ? <small>{sources[0]?.name}</small> :
      <label className="manuscriptSource">来源写作项目<select value={source} onChange={event => {
        const value=event.target.value;
        try {localStorage.setItem(sourcePreference,value);} catch { /* The selection remains usable. */ }
        setSource(value);
      }}>{sources.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
    {source ? <ManuscriptList key={source} sourceId={source} ready={ready}/> : <p role="status">{status}</p>}
  </aside>;
}

