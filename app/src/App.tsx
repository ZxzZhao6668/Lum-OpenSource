import { WorkspaceHost } from "./writing/WorkspaceHost";
import { useEffect, useState } from 'react';
import { ProjectHome } from './projects/ProjectHome';
import { currentProjectId } from './projects/projectIdentity';
import { getProject, type Project } from './projects/projectStore';
import { LumWorkspace } from './canvas/LumWorkspace';
import { LaunchHome } from './projects/launchHome';
import { prepareWorkspaceNavigation } from './canvas/productionBridge';
import { showToast } from './ui/toast';

async function returnHome() {
  try { await prepareWorkspaceNavigation('leave'); }
  catch (error) { showToast(error instanceof Error ? error.message : '画布保存失败，已保留当前页面'); return; }
  location.assign('/');
}

function ProjectWorkspace({ id }: { id: string }) {
  const [project,setProject]=useState<Project>();const [error,setError]=useState('');
  useEffect(()=>{let active=true;void getProject(id).then(value=>{if(!active)return;if(!value||value.trashedAt)setError('项目不存在或已移入回收站，请返回首页恢复。');else setProject(value);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[id]);
  if(error)return <div className="localPageBody" role="alert">{error} <a href="/">返回首页</a></div>;
  return project ? <WorkspaceHost projectKind={project.kind} projectName={project.name}/> : <p role="status">正在打开项目…</p>;
}
export function App() {
  const view=new URLSearchParams(location.search).get('view');
  const [settingsOpen,setSettingsOpen]=useState(view==='settings');
  const [settingsMounted,setSettingsMounted]=useState(view==='settings');
  const openSettings=()=>{setSettingsMounted(true);setSettingsOpen(true);};
  if(view==='canvas')return <LumWorkspace standalone active settingsOpen={false} onHome={()=>void returnHome()} onSettingsClose={()=>{}}/>;
  if(currentProjectId)return <ProjectWorkspace id={currentProjectId}/>;
  return <>
    <div style={{height:'100%'}} inert={settingsOpen}>{view==='writing'?<ProjectHome onSettings={openSettings}/>:<LaunchHome onSettings={openSettings}/>}</div>
    {settingsMounted&&<LumWorkspace standalone active={false} settingsOpen={settingsOpen} onHome={()=>void returnHome()} onSettingsClose={()=>setSettingsOpen(false)}/>}
  </>;
}
