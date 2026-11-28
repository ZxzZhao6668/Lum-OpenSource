import { useEffect, useId, useRef, useState } from 'react';
import { currentProjectId } from '../projects/projectIdentity';
import { createProject, listWritingProjectChoices, loadProjectCover, openProject, requireOpenableProject, type Project, type ProjectKind } from '../projects/projectStore';
import { checkProjectCanvas, prepareWorkspaceNavigation } from './productionBridge';
import './canvasProjectSwitcher.css';

const localCanvasId = 'localProject';
const localCanvasOpenedKey = 'lum:localCanvasOpenedAt';
type CanvasProject = Pick<Project, 'id' | 'name' | 'openedAt'>;

function isCurrentCanvas(id: string) {
  return id === currentProjectId || (!currentProjectId && (id === localCanvasId || id === 'legacy'));
}

function ProjectCover({ id }: { id: string }) {
  const [cover, setCover] = useState<string>();
  useEffect(() => {
    if (id === localCanvasId) return;
    let active = true;
    void loadProjectCover(id).then(image => { if (active) setCover(image); }).catch(() => {});
    return () => { active = false; };
  }, [id]);
  return <span className="canvasProjectCover">
    {cover
      ? <img src={cover} alt="" loading="lazy" decoding="async" onError={() => setCover(undefined)} />
      : <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>}
  </span>;
}

export type CoordinateProjectSwitch = (work: (saveWriting: () => Promise<void>) => Promise<void>) => Promise<void>;

export function CanvasProjectSwitcher({ projectName, ready, prepareSwitch }: {
  projectName: string;
  ready: boolean;
  prepareSwitch?: CoordinateProjectSwitch;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const switching = useRef(false);
  const [newProject, setNewProject] = useState<Project>();
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [mode, setMode] = useState<'recent' | 'open' | 'create'>('recent');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('script');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready || currentProjectId) return;
    try { localStorage.setItem(localCanvasOpenedKey, String(Date.now())); } catch { /* Browser storage can be disabled. */ }
  }, [ready]);

  async function refresh() {
    setLoading(true);
    try {
      const writingProjects = await listWritingProjectChoices();
      let localOpenedAt = 0;
      try { localOpenedAt = Number(localStorage.getItem(localCanvasOpenedKey)) || 0; } catch { /* The canvas remains available. */ }
      const choices = writingProjects.map(project => ({
        id: project.id,
        name: project.name,
        openedAt: Math.max(project.openedAt || project.createdAt, project.id === 'legacy' ? localOpenedAt : 0),
      }));
      if (!choices.some(project => project.id === 'legacy')) {
        choices.push({ id: localCanvasId, name: '本地画布', openedAt: localOpenedAt });
      }
      setProjects(choices.sort((a, b) => b.openedAt - a.openedAt));
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  function show() {
    const element = dialog.current;
    const bounds = trigger.current?.getBoundingClientRect();
    if (!element || !bounds || element.open) return;
    element.style.setProperty('--picker-top', `${Math.round(bounds.bottom + 8)}px`);
    element.style.setProperty('--picker-left', `${Math.round(bounds.left)}px`);
    setMode('recent');
    setSearch('');
    setError('');
    element.showModal();
    void refresh();
  }

  useEffect(() => {
    if (mode === 'open') searchInput.current?.focus();
    if (mode === 'create') nameInput.current?.focus();
  }, [mode]);

  async function switchProject(project?: CanvasProject) {
    if (switching.current || (project && isCurrentCanvas(project.id))) return;
    switching.current = true;
    setBusy(true);
    setError('');
    try {
      const work = async (saveWriting: () => Promise<void>) => {
        const target = project ?? newProject;
        if (target) {
          if (target.id !== localCanvasId) await requireOpenableProject(target.id);
          await checkProjectCanvas(target.id);
        }
        await saveWriting();
        await prepareWorkspaceNavigation('leave', true);
        if (target?.id === localCanvasId) location.assign('/?view=canvas');
        else if (target) await openProject(target.id, 'canvas');
        else {
          const created = await createProject(name, kind);
          setNewProject(created);
          await checkProjectCanvas(created.id);
          await openProject(created.id, 'canvas');
        }
      };
      if (prepareSwitch) await prepareSwitch(work);
      else await work(async () => {});
      dialog.current?.close();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      switching.current = false;
      setBusy(false);
    }
  }

  const visible = projects.filter(project => {
    const name = isCurrentCanvas(project.id) ? projectName : project.name;
    return mode !== 'open' || name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  return <>
    <button className="canvasProjectTrigger" type="button" ref={trigger} aria-haspopup="dialog" aria-controls={id} title={projectName} disabled={!ready} onClick={show}>
      <span>{projectName}</span><span aria-hidden="true">⌄</span>
    </button>
    <dialog className="canvasProjectDialog" id={id} ref={dialog} aria-label="切换项目" aria-busy={busy}
      onCancel={event => { if (switching.current) event.preventDefault(); }}>
      <header>
        <h2>{mode === 'create' ? '新建项目' : mode === 'open' ? '打开已有项目' : '切换项目'}</h2>
        <button type="button" aria-label="关闭项目切换" disabled={busy} onClick={() => dialog.current?.close()}>×</button>
      </header>
      {mode === 'create' ? <form onSubmit={event => { event.preventDefault(); void switchProject(); }}>
        <label>项目类型<select disabled={busy || !!newProject} value={kind} onChange={event => setKind(event.target.value as ProjectKind)}>
          <option value="script">剧本</option><option value="novel">小说</option>
        </select></label>
        <label>项目名称<input ref={nameInput} disabled={busy || !!newProject} value={name} onChange={event => setName(event.target.value)} required maxLength={120} /></label>
        <footer>
          <button type="button" disabled={busy} onClick={() => { setNewProject(undefined); setMode('recent'); setError(''); void refresh(); }}>取消</button>
          <button type="submit" disabled={busy || !name.trim()}>{newProject ? '重新打开' : '创建并打开'}</button>
        </footer>
      </form> : <>
        {mode === 'open' && <input ref={searchInput} disabled={busy} value={search} onChange={event => setSearch(event.target.value)} aria-label="搜索已有项目" placeholder="搜索项目名称" />}
        <div className="canvasProjectList">
          {visible.map(project => {
            const current = isCurrentCanvas(project.id);
            const opened = project.openedAt ? new Date(project.openedAt) : undefined;
            return <button type="button" key={project.id} className="canvasProjectCard" aria-current={current || undefined}
              disabled={busy || current} onClick={() => void switchProject(project)}>
              <ProjectCover id={project.id} />
              <span><strong>{current ? projectName : project.name}</strong>
                <small>{opened ? <>最近打开 <time dateTime={opened.toISOString()}>{opened.toLocaleString('zh-CN', { hour12: false })}</time></> : '尚未打开'}</small>
              </span>
              {current && <span className="canvasProjectCurrent">当前项目</span>}
            </button>;
          })}
          {loading ? <p role="status">正在读取项目…</p> : !visible.length && <p>没有找到项目</p>}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={() => { setName(''); setKind('script'); setNewProject(undefined); setError(''); setMode('create'); }}>新建项目</button>
          {mode === 'recent' && <button type="button" disabled={busy} onClick={() => setMode('open')}>打开已有项目</button>}
        </footer>
      </>}
      {busy && <p role="status">正在保存并切换项目…</p>}
      {error && <p role="alert">{error}</p>}
    </dialog>
  </>;
}
