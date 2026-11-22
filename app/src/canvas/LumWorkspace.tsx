import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./lumWorkspace.css";
import { currentProjectId } from "../projects/projectIdentity";
import { loadDoc } from "../data/db";
import {StageMaterialsPanel} from './ProductionMaterialsPanel';
import {WritingManuscriptsPanel} from './WritingManuscriptsPanel';
import {installAdoptionBridge} from './adoptionBridge';
import {installProjectSetupBridge} from './projectSetupBridge';
import {installStoryGridBridge} from './storyGridBridge';
import {installPrevisSkillBridge} from '../skills/previsBridge';

const origin = canvasOrigin;

/** 设置与画布共用原版实例，隐藏而不卸载，避免中断后台任务。 */
export function LumWorkspace({ active, settingsOpen, onSettingsClose, onHome, onStoryboard, standalone = false, mode = 'canvas' }: {
  active: boolean; settingsOpen: boolean; onSettingsClose: () => void; onHome: () => void; onStoryboard?: () => void; standalone?: boolean; mode?: 'canvas' | 'virtualStage';
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initialTheme = useRef(document.documentElement.dataset.lumTheme || 'lime');
  useEffect(()=>installPrevisSkillBridge(()=>frame.current?.contentWindow),[]);
  useEffect(()=>installAdoptionBridge(()=>frame.current?.contentWindow),[]);
  useEffect(()=>installProjectSetupBridge(()=>frame.current?.contentWindow),[]);
  useEffect(()=>installStoryGridBridge(()=>frame.current),[]);
  const [connection,setConnection]=useState<'loading'|'ready'|'error'>('loading');
  const [settingsReady,setSettingsReady]=useState(false);
  const [stageEditorOpen,setStageEditorOpen]=useState(false);
  const stageFullscreen=active&&stageEditorOpen&&!settingsOpen;
  useLayoutEffect(()=>{setSettingsReady(false);},[settingsOpen]);
  const [attempt,setAttempt]=useState(0);
  const [connectionNoticeDismissed,setConnectionNoticeDismissed]=useState(false);
  const reconnectButton=useRef<HTMLButtonElement>(null);
  const [materialsOpen,setMaterialsOpen]=useState(false);
  useEffect(()=>{setConnection('loading');setConnectionNoticeDismissed(false);const timer=setTimeout(()=>setConnection(current=>current==='ready'?current:'error'),12000);return()=>clearTimeout(timer);},[attempt]);
  useEffect(()=>{if(connectionNoticeDismissed&&connection==='error')reconnectButton.current?.focus();},[connectionNoticeDismissed,connection]);
  const latest = useRef({ settingsOpen, onSettingsClose, onHome, mode, active });
  useLayoutEffect(() => { latest.current = { settingsOpen, onSettingsClose, onHome, mode, active }; }, [settingsOpen, onSettingsClose, onHome, mode, active]);
  const syncCanvasActive = () => {
    const { active, settingsOpen, mode } = latest.current;
    frame.current?.contentWindow?.postMessage({ type: "laper:canvasActive", active: active && !settingsOpen && mode === "canvas" }, origin);
  };
  const syncSettings = () => {
    syncCanvasActive();
    frame.current?.contentWindow?.postMessage({ type: 'lum:appearanceRequest' }, origin);
    frame.current?.contentWindow?.postMessage({ type: "laper:settings", open: latest.current.settingsOpen }, origin);
    void loadDoc<{name:string}>('project:meta').then(meta=>{
      if(meta?.name)frame.current?.contentWindow?.postMessage({type:'laper:projectName',name:meta.name},origin);
    }).catch(()=>{});
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const type = lumBridgeType(event.data?.type);
      if (type === "lum:ready") {setConnection('ready');syncSettings();}
      if (type === "lum:settingsClosed") latest.current.onSettingsClose();
      if (type === "lum:settingsOpened") setSettingsReady(true);
      if (type === "lum:home") latest.current.onHome();
      if (type === "lum:stagePresentation" && typeof event.data.open === 'boolean') setStageEditorOpen(event.data.open);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useLayoutEffect(syncCanvasActive, [active, settingsOpen, mode]);
  useEffect(() => { syncSettings(); }, [settingsOpen]);
  useEffect(() => { if (active && connection === 'ready') frame.current?.contentWindow?.postMessage({type:'laper:workspacePanel',panel:mode},origin); }, [active,mode,connection]);
  useEffect(() => { window.addEventListener('dsh:project-renamed',syncSettings); return()=>window.removeEventListener('dsh:project-renamed',syncSettings); },[]);
  return (
    <section className={`dsh-lum-workspace dsh-toonflow-workspace${settingsOpen ? " is-settings" : ""}${standalone ? " is-standalone" : ""}${stageFullscreen ? " is-stage-fullscreen" : ""}`} data-connection={connection} data-settings-ready={settingsReady} hidden={!active && !settingsOpen} aria-label={settingsOpen?'Lum 设置':'Lum 画布工作区'}>
      <header className="dsh-lum-header dsh-toonflow-header">
        <button type="button" onClick={settingsOpen ? onSettingsClose : onHome}>{settingsOpen ? "← 关闭设置" : "← 返回首页"}</button>
        <span>{settingsOpen ? "项目设置" : mode === 'virtualStage' ? '虚拟片场' : "画布"}</span>
        {!settingsOpen&&mode==='canvas'&&onStoryboard&&<button type="button" onClick={onStoryboard} title="打开当前剧集的分镜">分镜</button>}
        {!settingsOpen&&<button type="button" aria-expanded={materialsOpen} style={{marginLeft:'auto'}} onClick={()=>setMaterialsOpen(value=>!value)}>{mode==='virtualStage'?'项目素材':'写作文稿'}</button>}
        {connection==='error'&&connectionNoticeDismissed&&<button ref={reconnectButton} type="button" onClick={()=>setAttempt(n=>n+1)}>重新连接画布</button>}
      </header>
      {connection!=='ready'&&!connectionNoticeDismissed&&<div className="canvasConnectionNotice" role="group" aria-label="画布连接提示" onKeyDown={event=>{if(event.key==='Escape'&&connection==='error'){event.preventDefault();event.stopPropagation();setConnectionNoticeDismissed(true);}}}>
        <span role="status" aria-live="polite">{connection==='loading'?'正在连接本地画布…':import.meta.env.VITE_LUM_DESKTOP==='1'?'画布连接未就绪，请重新连接；如仍失败，请退出后重新打开 Lum。':'未连接到画布服务，请运行“启动Lum.cmd”。'}</span>
        {connection==='error'&&<div className="canvasConnectionActions"><button type="button" onClick={()=>setAttempt(n=>n+1)}>重新连接</button><button type="button" aria-label="关闭连接提示" onClick={()=>setConnectionNoticeDismissed(true)}>关闭提示</button></div>}
      </div>}
      <div className="productionWorkspaceBody">
        {active&&materialsOpen&&!settingsOpen&&!stageFullscreen&&(mode==='virtualStage'
        ? <StageMaterialsPanel close={()=>setMaterialsOpen(false)}/>
        : <WritingManuscriptsPanel ready={connection==='ready'} close={()=>setMaterialsOpen(false)}/>)}
      <iframe ref={frame} onLoad={()=>{setStageEditorOpen(false);syncSettings();}}
        key={attempt}
        data-production-frame="true"
        title="Lum 画布"
        src={`${origin}/?project=${encodeURIComponent(currentProjectId && currentProjectId !== 'legacy' ? currentProjectId : 'localProject')}&lumTheme=${encodeURIComponent(initialTheme.current)}#/embeddedWorkspace`}
        allow="clipboard-read; clipboard-write; microphone; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      </div>
    </section>
  );
}

