import {mountWritingBoard} from '../novel/writingBoardPanel';
import {initializeProjectDraft} from '../episode/episodeDraft';
import {mountStoryBible} from '../novel/storyBiblePanel';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAppSettings } from "../state/appSettings";
import { upgradeScript, getActiveWritingEditor } from "../script/editor";
import { selectWritingEpisode,canSynchronizeScriptChapters,isWritingBusy } from "../writing/writingSession";
import { synchronizeScriptChapters } from '../episode/scriptChapterSync';
import { mountWritingPanel } from "../writing/writingPanel";
import { highlightScriptWrite } from '../writing/writeFeedback';
import { getActiveContentEditor } from "../writing/contentEditor";
import { showToast } from "../ui/toast";
import { upgradeEntities } from "../entities/entityScreens";
import { upgradeStoryboard } from "../storyboard/storyboard";
import { loadEpisodeIndex, upgradeEpisodePanel } from "../episode/episodePanel";
import { upgradeCollapsibleSection } from "../episode/sectionCollapse";
import { syncSceneList } from "../script/sceneListSync";
import { syncSceneCards } from "../script/sceneCardsSync";
import { upgradeSceneCards } from "../script/sceneCards";
import { mountSceneCanvas } from "../script/sceneCanvas";
import { upgradeOutline } from "../outline/outlineDoc";
import { mountEpisodeOverview } from '../outline/episodeOverview';
import { LumWorkspace } from "../canvas/LumWorkspace";
import { prepareWorkspaceNavigation } from "../canvas/productionBridge";
import type { Chapter } from "../episode/episodePanel";
import { closeChapterDraft } from '../episode/chapterView';
import { migrateChapterText } from '../episode/migrateChapterText';
import { mountAssetLinks } from '../entities/assetLinks';
import { mountWorkspaceTools } from '../ui/workspaceTools';
import { mountProjectPage } from '../screens/projectPages';
import { projectStorageKey, writingWorkspace } from '../projects/projectIdentity';
import type { ProjectKind } from '../projects/projectStore';
import { mountWritingExport } from '../export/writingExport';
import { mountBeatEntry,mountBeatWorkspace } from '../beats/beatWorkspace';
import { createCanvasRail, createWritingWorkspace, markRailRoute } from "./workspaceShell";
import { mountSharedAssetLibrary } from '../assetLibrary/libraryScreen';

const SELECTED_SCRIPT_KEY = projectStorageKey("dsh:selectedScript");
const CanvasBoard = lazy(async () => ({ default: (await import("../canvas/CanvasBoard")).CanvasBoard }));

const onLiftedRailClick = (e: Event) => {
  const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button') : null;
  if (!btn) return;
  if (btn.hasAttribute('data-dsh-home')) {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("dsh:nav", { detail: "home" }));
    return;
  }
  const route = btn.dataset.workspaceRoute;
  if (route) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("dsh:nav", { detail: route }));
  }
};

/** The full-screen canvas has its own compact navigation above the embedded view. */
function liftRail(root: HTMLElement | null, screen: string) {
  if (!root) return;
  const mounted = document.querySelector<HTMLElement>('[data-dsh-lifted="1"]');
  if (mounted) {
    markRailRoute(mounted, screen);
    return;
  }
  const rail = createCanvasRail(screen);
  rail.dataset.dshLifted = '1';
  const bounds = root.getBoundingClientRect();
  rail.style.left = Math.round(bounds.left) + 'px';
  rail.style.top = Math.round(bounds.top) + 'px';
  document.body.append(rail);
  rail.addEventListener('click', onLiftedRailClick);
}

function dropRail() {
  document.querySelector('[data-dsh-lifted="1"]')?.remove();
}

export function WorkspaceHost({ projectKind = 'script' }: { projectKind?: ProjectKind }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const writingCleanup = useRef<(() => void) | undefined>(undefined);
  const [screen, setScreen] = useState("01-script");
  const [canvasOpened, setCanvasOpened] = useState(false);
  const legacyCanvas = new URLSearchParams(window.location.search).get("legacyCanvas") === "1";
  const screenRef = useRef("01-script");
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  const openSettings = useAppSettings((s) => s.setOpen);
  const settingsOpen = useAppSettings((s) => s.open);
  useEffect(() => { if (settingsOpen || screen === "04-storyboard") setCanvasOpened(true); }, [settingsOpen, screen]);
  useEffect(() => {
    const start = () => setCanvasOpened(true);
    window.addEventListener("dsh:requireLum", start);
    window.addEventListener("dsh:requireToonflow", start);
    return () => {
      window.removeEventListener("dsh:requireLum", start);
      window.removeEventListener("dsh:requireToonflow", start);
    };
  }, []);

  const navigation = useRef(0);
  const selectedScript = useRef({ id: "ep_001", title: "未分章草稿" });
  const go = useCallback(
    async (id: string, episodeId = selectedScript.current.id, episodeTitle = selectedScript.current.title, options: {outlineView?: 'board'|'document'; requireEpisode?: boolean; outlineDocId?: string} = {}) => {
      if (writingWorkspace && ['canvas','virtualStage','04-storyboard','16-asset-library'].includes(id)) return;
      if (id === 'home' && isWritingBusy()) {
        showToast('请先停止当前写作任务再返回主页');
        return;
      }
      const ticket = ++navigation.current;
      // 在首次保存前冻结旧页面，避免异步加载期间的新输入在卸载时丢失。
      if (hostRef.current) { hostRef.current.inert = true; hostRef.current.setAttribute('aria-busy', 'true'); }
      try {
      try { await closeChapterDraft(); await getActiveWritingEditor()?.flush(); await getActiveContentEditor()?.flush(); }
      catch (error) { showToast(error instanceof Error ? error.message : "剧本保存失败，已保留当前页面"); return; }
      if (ticket !== navigation.current) return;
      if (["canvas", "virtualStage"].includes(screenRef.current)) {
        try { await prepareWorkspaceNavigation(id === "canvas" || id === "virtualStage" ? id : "leave"); }
        catch (error) { showToast(error instanceof Error ? error.message : "片场保存失败，已保留当前页面"); return; }
        if (ticket !== navigation.current) return;
      }
      if (id === 'home') {
        // 保存期间可能启动了新的 AI 任务；再次检查后才离开当前项目。
        if (isWritingBusy()) { showToast('请先停止当前写作任务再返回主页'); return; }
        window.location.assign('/');
        return;
      }
      if(id==='03-outline'&&options.outlineView==='board'&&await canSynchronizeScriptChapters()){
        if(ticket!==navigation.current)return;
        const synced=await synchronizeScriptChapters({approvedByUser:true},{cancelled:()=>ticket!==navigation.current});
        if(ticket!==navigation.current)return;
        if(synced.skipped.length)showToast(synced.skipped.join('；'));
      }
      if (id === "canvas" || id === "virtualStage") {
        writingCleanup.current?.(); writingCleanup.current = undefined;
        setCanvasOpened(true);
        setScreen(id);
        window.setTimeout(() => {if(ticket===navigation.current)liftRail(hostRef.current, id);}, 0);
        return;
      }
      dropRail();
      const index = await loadEpisodeIndex();
      if (ticket !== navigation.current) return;
      const requested = index?.chapters.find(c=>(c.episodeId??c.id)===episodeId);
      if (!requested && options.requireEpisode) { showToast('该剧集已归档或不存在，请从当前列表选择'); return; }
      const entry = requested ?? index?.chapters[0];
      if(entry?.episodeId){ episodeId=entry.episodeId;episodeTitle=entry.title; }
      try { await selectWritingEpisode(episodeId); } catch (error) { showToast(String(error)); return; }
      if (ticket !== navigation.current) return;
      {
        selectedScript.current = { id: episodeId, title: episodeTitle };
        try { localStorage.setItem(SELECTED_SCRIPT_KEY, episodeId); } catch { /* Storage may be disabled. */ }
      }
      if(id==='01-script')await migrateChapterText(episodeId);
      if(ticket!==navigation.current)return;
      writingCleanup.current?.(); writingCleanup.current = undefined;
      const host = hostRef.current;
      if (!host) return;
      const previousScroll = host.querySelector<HTMLElement>('[data-dsh-side-panel]')?.scrollTop ?? 0;
      host.replaceChildren(createWritingWorkspace(id, projectKind, options.outlineView === 'board'));
      hostRef.current!.dataset.episodeId=episodeId;
      hostRef.current!.dataset.screen=id;
      hostRef.current!.dataset.outlineView=id==='03-outline'?(options.outlineView??'document'):'';
      screenRef.current=id;
      mountWritingExport(hostRef.current!,episodeId,id);
      setScreen(id);
      if (id === "01-script" && hostRef.current) {
        upgradeScript(hostRef.current, episodeId);
      }
      if (hostRef.current) writingCleanup.current = mountWritingPanel(hostRef.current, episodeId, episodeTitle);
      // 人物 / 地点 / 道具 接管为数据驱动
      if (hostRef.current) {
        const kinds: Record<string, "character" | "location" | "prop"> = {
          "06-characters": "character",
          "07-locations": "location",
          "08-props": "prop",
        };
        const kind = kinds[id];
        if (kind) await upgradeEntities(hostRef.current, kind);
        if (id==='16-asset-library') mountSharedAssetLibrary(hostRef.current);
        if (ticket !== navigation.current) return;

        await upgradeEpisodePanel(hostRef.current, index);
        if (ticket !== navigation.current) return;
        await mountProjectPage(hostRef.current,id,episodeId,episodeTitle);
        if (ticket !== navigation.current) return;
        await mountWorkspaceTools(hostRef.current,episodeId);
        if(ticket!==navigation.current)return;
        if(id==='14-bible')await mountStoryBible(hostRef.current,episodeId,()=>ticket===navigation.current);
        if(id==='15-whiteboard')await mountWritingBoard(hostRef.current,episodeId,()=>ticket===navigation.current);
        if (ticket !== navigation.current) return;
        if (id === "01-script") {
          const heading = hostRef.current.querySelector(".segment-btn");
          if (heading) heading.textContent = `剧本 · ${episodeTitle}`;
        }
        if (id === "03-outline") {
          if(options.outlineView==='board')await mountEpisodeOverview(hostRef.current,()=>ticket===navigation.current);
          else {
            await upgradeOutline(hostRef.current, episodeId, {chapters:index?.chapters??[],docId:options.outlineDocId});
            mountBeatEntry(hostRef.current);
          }
          if (ticket !== navigation.current) return;
        }
        if(id==='13-beats'){
          await mountBeatWorkspace(hostRef.current,episodeId,()=>ticket===navigation.current);
          if(ticket!==navigation.current)return;
        }
        await syncSceneList(hostRef.current, episodeId);
        if (ticket !== navigation.current) return;
        if (id === "04-storyboard") await upgradeStoryboard(hostRef.current, episodeId);
        if (id === "05-scenes") {
          await syncSceneCards(hostRef.current, episodeId);
          if (ticket !== navigation.current) return;
          await upgradeSceneCards(hostRef.current, episodeId);
          if (ticket !== navigation.current) return;
          await mountSceneCanvas(hostRef.current, episodeId);
        }
        void upgradeCollapsibleSection(hostRef.current, {
          title: "场次",
          docKey: `scenes:${episodeId}`,
          itemPattern: /^\d+\s*\./,
        });
        if (id === '01-script') await getActiveWritingEditor()?.flush();
        await mountAssetLinks(hostRef.current,episodeId);
        const sidebar = host.querySelector<HTMLElement>('[data-dsh-side-panel]');
        if (sidebar && ticket === navigation.current && previousScroll) sidebar.scrollTop = previousScroll;
      }
      } catch(error) { showToast(`页面打开失败：${error instanceof Error?error.message:String(error)}`); }
      finally { if(ticket===navigation.current&&hostRef.current){hostRef.current.inert=false;hostRef.current.removeAttribute('aria-busy');hostRef.current.style.visibility='';} }
    },
    [projectKind],
  );

  useEffect(() => {
    let cancelled = false;
    const initialNavigation = navigation.current;
    void (async () => {
      let selected: Chapter | undefined;
      try {
        await initializeProjectDraft();
        const id = localStorage.getItem(SELECTED_SCRIPT_KEY);
        const panel = await loadEpisodeIndex();
        selected = panel?.chapters.find(chapter => chapter.episodeId === id) ?? panel?.chapters[0];
      } catch { /* Fall back to the first episode if preferences are unavailable. */ }
      if (!cancelled && navigation.current === initialNavigation) {
        await go(writingWorkspace ? "01-script" : "04-storyboard", selected?.episodeId ?? "ep_001", selected?.title ?? "未分章草稿");
      }
    })();
    return () => { cancelled = true; };
  }, [go]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const navigate = (event: MouseEvent) => {
      const control = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-workspace-route]') : null;
      if (!control || !host.contains(control)) return;
      const route = control.dataset.workspaceRoute;
      const fromEpisodeBoard = route === '03-outline' && host.dataset.outlineView === 'board';
      if (route && (route !== screenRef.current || fromEpisodeBoard || host.hasAttribute('aria-busy'))) {
        void go(route);
      }
    };
    host.addEventListener('click', navigate);
    return () => host.removeEventListener('click', navigate);
  }, [go]);

  useEffect(() => {
    const onNav = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      if (id) void go(id);
    };
    const onScript = (event: Event) => {
      const { episodeId, title } = (event as CustomEvent).detail;
      void go("01-script", episodeId, title);
    };
    window.addEventListener("dsh:open-script", onScript);
    const onEpisode = (event: Event) => {
      const {episodeId,title}=(event as CustomEvent<{episodeId:string;title?:string}>).detail;
      const current=screenRef.current;
      const onBoard=current==='03-outline'&&hostRef.current?.dataset.outlineView==='board';
      const target=!onBoard&&['01-script','02-cover','03-outline','04-storyboard','05-scenes','13-beats'].includes(current)?current:'01-script';
      void go(target,episodeId,title,{requireEpisode:true});
    };
    const onOutline = (event: Event) => {
      const {episodeId,title,docId}=(event as CustomEvent<{episodeId:string;title?:string;docId?:string}>).detail;
      void go('03-outline',episodeId,title,{requireEpisode:true,outlineDocId:docId});
    };
    const onEpisodeBoard = () => { void go('03-outline',undefined,undefined,{outlineView:'board'}); };
    const onEpisodesChanged = () => {
      const outlineView=hostRef.current?.dataset.outlineView==='board'?'board':'document';
      void go(screenRef.current,undefined,undefined,{outlineView});
    };
    window.addEventListener('dsh:open-episode',onEpisode);
    window.addEventListener('dsh:open-outline',onOutline);
    window.addEventListener('dsh:open-episode-board',onEpisodeBoard);
    window.addEventListener('dsh:episodes-changed',onEpisodesChanged);
    const onRevealScript = (event: Event) => {
      const { episodeId, blockIds } = (event as CustomEvent<{episodeId: string; blockIds: string[]}>).detail;
      void go('01-script', episodeId).then(() => {
        if (selectedScript.current.id !== episodeId || screenRef.current !== '01-script') return;
        highlightScriptWrite(blockIds);
        window.dispatchEvent(new Event('dsh:show-writing'));
      });
    };
    const onScriptWritten = (event: Event) => {
      const { episodeId } = (event as CustomEvent<{episodeId: string}>).detail;
      if (hostRef.current && selectedScript.current.id === episodeId) void syncSceneList(hostRef.current, episodeId);
    };
    window.addEventListener('dsh:reveal-script', onRevealScript);
    const onPrepareScriptWrite = (event: Event) => {
      const { episodeId, resolve, reject } = (event as CustomEvent<{episodeId: string; resolve: () => void; reject: (error: unknown) => void}>).detail;
      void go('01-script', episodeId).then(async () => {
        if (selectedScript.current.id !== episodeId || !getActiveWritingEditor()) throw Error('无法打开目标剧集，未执行写入');
        await getActiveWritingEditor()!.flush();
        window.dispatchEvent(new Event('dsh:show-writing'));
        resolve();
      }).catch(reject);
    };
    window.addEventListener('dsh:prepare-script-write', onPrepareScriptWrite);
    const onRefreshWriting=(event:Event)=>{
      const {episodeId,screen,resolve,reject}=(event as CustomEvent<{episodeId:string;screen:string;resolve:()=>void;reject:(error:unknown)=>void}>).detail;
      void go(screen,episodeId).then(()=>{
        if(hostRef.current?.dataset.episodeId!==episodeId||hostRef.current.dataset.screen!==screen)throw Error('目标页面未打开');
        window.dispatchEvent(new Event('dsh:show-writing'));resolve();
      }).catch(reject);
    };
    window.addEventListener('dsh:refresh-writing',onRefreshWriting);
    window.addEventListener('dsh:script-written', onScriptWritten);
    const onSettings = () => openSettings(true);
    window.addEventListener("dsh:settings", onSettings);
    window.addEventListener("dsh:nav", onNav);
    return () => {
      window.removeEventListener("dsh:open-script", onScript);
      window.removeEventListener('dsh:open-episode',onEpisode);
      window.removeEventListener('dsh:open-outline',onOutline);
      window.removeEventListener('dsh:open-episode-board',onEpisodeBoard);
      window.removeEventListener('dsh:episodes-changed',onEpisodesChanged);
      window.removeEventListener('dsh:reveal-script', onRevealScript);
      window.removeEventListener('dsh:prepare-script-write', onPrepareScriptWrite);
      window.removeEventListener('dsh:refresh-writing',onRefreshWriting);
      window.removeEventListener('dsh:script-written', onScriptWritten);
      window.removeEventListener("dsh:nav", onNav);
      window.removeEventListener("dsh:settings", onSettings);
      writingCleanup.current?.();
      dropRail();
    };
  }, [go]);

  return (
    <>
      <div ref={hostRef} className="lumWritingHost laper-host" data-screen={screen} />
      {(canvasOpened || settingsOpen) && (
        <LumWorkspace active={(screen === "canvas" && !legacyCanvas) || screen === "virtualStage"} mode={screen === "virtualStage" ? "virtualStage" : "canvas"} settingsOpen={settingsOpen} onSettingsClose={() => { openSettings(false); window.dispatchEvent(new Event('dsh:models-changed')); }} onHome={() => { void go('home'); }} onStoryboard={() => { void go('04-storyboard'); }} />
      )}
      {screen === "canvas" && legacyCanvas && (
        <Suspense fallback={<p role="status">正在打开旧版画布…</p>}>
          <CanvasBoard onBack={() => void go('home')} />
        </Suspense>
      )}
    </>
  );
}
