import { chooseShotSetup, compileShotSetup, shotStyleLabel } from '../scriptSetup/shotSetup';
import { readScriptSetup, readScriptSetupWorkspaceEpoch } from '../scriptSetup/scriptSetupStore';
import { db, loadDoc, saveDoc } from "../data/db";
import { equalDocumentValue } from '../data/equalDocumentValue';
import { registerContentEditor, getActiveContentEditor } from "../writing/contentEditor";
import { initializeMentions, setShotDescription } from './mentionModel';
import "./storyboard.css";
import { mountGeneration, openHistory, openAssetPicker, openGeneration } from "./generationPanel";
import { initializeGeneration, selectOutput } from "./generationState";
import {openShotBatch} from './shotBatchPanel';
import {openShotVideo} from './shotVideoPanel';
import { sceneRef, UNASSIGNED_SCENE } from "../script/sceneIdentity";
import type { ScriptBlock } from "../script/editor";
import { migrateSceneReferences } from "./sceneReferences";
import { repairTemplateShots } from './templateMigration';
import { showSceneAssets } from '../entities/assetLinks';
import { showToast } from '../ui/toast';
import { type Shot, storyScenes, shotNumber, validDuration } from './shotModel';
import { defaultViewOptions, type ViewOptions, renderStoryboardBoard, renderStoryboardTable, mountShotThumbnail, showDisplayOptions, showShotMenu, viewShotImage } from './storyboardViews';
import { node as uiNode, action } from '../ui/localUi';
import { listMentionEntities, mountShotMentions } from './shotMentions';
import {mountImageDefaults} from './imageDefaults';
import {mountCardLayout} from '../canvas/cardLayout';
export type { Shot } from './shotModel';


type View = { x: number; y: number; zoom: number };
type ViewMode = "canvas" | "board" | "table";
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
  const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
};
const button = (text: string, action: () => void) => {
  const el = element("button", "sbButton", text); el.type = "button"; el.onclick = action; return el;
};

export async function upgradeStoryboard(root: HTMLElement, episodeId = "ep_001") {
  const docKey = `storyboard:${episodeId}`;
  const container = root.querySelector<HTMLElement>("[data-shot-world]");
  const viewport = container?.closest<HTMLElement>("[data-canvas-container]");
  if (!container || !viewport || viewport.dataset.storyboardReady) return;
  viewport.dataset.storyboardReady = "1";
  const sceneButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-scene-block-id]"));
  const sceneId = (b: HTMLElement) => sceneRef(b.dataset.sceneBlockId!);
  const sceneLabel = (b: HTMLElement) => (b.textContent??'').trim().replace(/\s+/g, " ");
  const knownScenes = new Set(sceneButtons.map(sceneId));
  let activeScene = sceneButtons[0] ? sceneId(sceneButtons[0]) : UNASSIGNED_SCENE;
  const scriptBlocks = await loadDoc<ScriptBlock[]>(`script:${episodeId}`) ?? [];
  const scenes = storyScenes(scriptBlocks);
  const migrated = await migrateSceneReferences(episodeId, scriptBlocks);
  const stored = await repairTemplateShots(episodeId, activeScene) ?? migrated;
  let storedSnapshot = stored;
  const snapshotShots = (items: Shot[]) => items.map(({image, ...shot}) => ({...structuredClone(shot), image}));
  let shots: Shot[] = snapshotShots(stored ?? []);
  for (const shot of shots) {
    shot.sceneId ??= activeScene;
    shot.image ??= '';
  }
  const initialEntities=await listMentionEntities();shots.forEach(shot=>initializeMentions(shot,initialEntities));
  const initialViews = await loadDoc<Record<string, View>>(`${docKey}:views`);
  let views = initialViews ?? {};
  const storedMode = await loadDoc<string>(`${docKey}:mode`);
  let mode: ViewMode = storedMode === "canvas" || storedMode === "table" ? storedMode : "board";
  const options: ViewOptions = { ...defaultViewOptions(), ...await loadDoc<Partial<ViewOptions>>(`${docKey}:display`) };
  const rememberedScene = await loadDoc<string>(`${docKey}:activeScene`);
  if (rememberedScene && (knownScenes.has(rememberedScene) || rememberedScene === UNASSIGNED_SCENE)) activeScene = rememberedScene;
  if (!root.isConnected || !viewport.isConnected) return;
  let view: View = views[activeScene] ?? { x: 0, y: 0, zoom: 1 };
  viewport.classList.add("sbViewport"); viewport.tabIndex = 0; viewport.setAttribute("aria-label", "分镜无限画布");
  const status = element("span", "sbStatus", "已保存");
  let queue: Promise<void> = Promise.resolve();
  let storedViewsJson = JSON.stringify(initialViews);
  let saved = snapshotShots(shots);
  let savedViews = JSON.stringify(views);
  const cleanups: Array<()=>void> = [];
  const clearImages = () => { cleanups.splice(0).forEach(fn=>fn()); };
  let cleanupWorkspace=()=>{};
  let cardLayout:ReturnType<typeof mountCardLayout>|undefined;
  const detach = new MutationObserver(()=>{if(!viewport.isConnected){clearImages();cleanupWorkspace();detach.disconnect();}});
  detach.observe(root,{childList:true,subtree:true});
  let reloading = false;
  let isActive = () => false;
  let dialogDraft: { mask: HTMLElement; capture(): void; dirty(): boolean } | undefined;
  const assertActive = () => {
    if (!isActive()) throw new Error("分镜页面已离开，不能保存旧页面内容");
  };
  const enqueue = (key: string, snapshot: unknown, complete: () => void) => {
    const operation = queue.catch(() => {}).then(async () => {
      assertActive();
      await saveDoc(key, snapshot);
      complete();
    });
    queue = operation;
    return operation;
  };
  const saveShots = () => {
    assertActive();
    if (reloading) throw new Error("分镜正在刷新，请稍后保存");
    const snapshot = snapshotShots(shots);
    const operation = queue.catch(() => {}).then(async () => {
      assertActive();
      const committed = new Map(saved.map(shot => [shot.id, shot]));
      for (const shot of snapshot) {
        // A queued edit may have captured the shot before its first save fixed the style.
        const fixed = committed.get(shot.id)?.setupSnapshot;
        if (!shot.setupSnapshot && fixed) shot.setupSnapshot = fixed;
      }
      // A navigation flush must not write a stale clean snapshot over an Agent commit.
      if (equalDocumentValue(snapshot, saved)) return;
      status.textContent = "保存中…";
      const newShots = snapshot.filter(shot => !shot.setupSnapshot && !committed.has(shot.id));
      for (const shot of newShots) shot.setupSnapshot = await compileShotSetup(shot, episodeId, isActive, true);
      assertActive();
      await db.transaction('rw', db.docs, async () => {
        if (!equalDocumentValue(await loadDoc(docKey), storedSnapshot)) throw Error('分镜已在其他操作中更新，当前草稿已保留，请先备份草稿再重新打开');
        if (newShots.length) {
          const [epoch, setup] = await Promise.all([readScriptSetupWorkspaceEpoch(),readScriptSetup()]);
          if (newShots.some(shot=>shot.setupSnapshot!.workspaceEpoch!==epoch || shot.setupSnapshot!.visual?.setupVersionId!==setup?.versionId))
            throw Error('项目设定已变化，请重新保存分镜');
        }
        await saveDoc(docKey, snapshot);
      });
      for (const frozen of newShots) {
        const live = shots.find(shot => shot.id === frozen.id);
        if (live && !live.setupSnapshot) live.setupSnapshot = frozen.setupSnapshot;
      }
      storedSnapshot = snapshot;
      saved = snapshot;
      status.textContent = equalDocumentValue(shots, saved) ? "已保存" : "有未保存修改";
    });
    queue = operation;
    return operation;
  };
  const persist = () => {
    if (!isActive() || reloading) return;
    void saveShots().catch(error => { if (isActive()) {status.textContent = String(error instanceof Error ? error.message : error);showToast(status.textContent);} });
  };
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  const persistView = () => {
    const snapshot = structuredClone(views), serialized = JSON.stringify(snapshot);
    const operation = queue.catch(() => {}).then(async () => {
      assertActive();
      if (serialized === savedViews) return;
      await db.transaction('rw', db.docs, async () => {
        if (JSON.stringify(await loadDoc(`${docKey}:views`)) !== storedViewsJson) throw Error('分镜视图已变化，请重新打开');
        await saveDoc(`${docKey}:views`, snapshot);
      });
      savedViews = storedViewsJson = serialized;
    });
    queue = operation;
    return operation;
  };
  const saveView = () => {
    if (!isActive() || reloading) return;
    views = { ...views, [activeScene]: { ...view } }; clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      if (!isActive() || reloading) return;
      void persistView().catch(() => { if (isActive()) status.textContent = "视图保存失败，草稿已保留"; });
    }, 180);
  };
  const zoomLabel = element("span", "sbZoom");
  const applyView = () => {
    container.style.transform = mode === "canvas" ? `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` : "none";
    viewport.style.backgroundSize = `${24 * view.zoom}px ${24 * view.zoom}px`;
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  };
  const zoomAt = (zoom: number, x: number, y: number) => {
    const next = Math.min(2, Math.max(.2, zoom)); const ratio = next / view.zoom;
    view = { x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio, zoom: next }; applyView(); saveView();
  };
  const visibleShots = () => shots.filter(s => activeScene === UNASSIGNED_SCENE ? !knownScenes.has(s.sceneId ?? "") : s.sceneId === activeScene);
  const fit = () => {
    const list = visibleShots(); if (!list.length) { view = { x: 0, y: 0, zoom: 1 }; }
    else {
      const left = Math.min(...list.map(s => s.x)), top = Math.min(...list.map(s => s.y));
      const width = Math.max(...list.map(s => s.x + 360)) - left, height = Math.max(...list.map(s => s.y + (container.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(s.id)}"]`)?.offsetHeight || 580))) - top;
      const zoom = Math.min(1, Math.max(.2, Math.min((viewport.clientWidth - 100) / width, (viewport.clientHeight - 130) / height)));
      view = { x: (viewport.clientWidth - width * zoom) / 2 - left * zoom, y: 55 - top * zoom, zoom };
    } applyView(); saveView();
  };
  const controls = element("div", "sbControls");
  controls.append(button("−", () => zoomAt(view.zoom / 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2)), zoomLabel,
    button("＋", () => zoomAt(view.zoom * 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2)),
    button("适应画布", fit), button("100%", () => zoomAt(1, viewport.clientWidth / 2, viewport.clientHeight / 2)), status);
  const unassigned = button("未关联镜头", () => switchScene(UNASSIGNED_SCENE));
  unassigned.classList.add("sbUnassigned");
  controls.append(unassigned);
  const header = root.querySelector<HTMLElement>('.lumStoryboardHeader')!;
  const batchButton=button('批量管理',()=>{void (async()=>{try{await saveShots();if(!shots.length)throw Error('当前集没有分镜');await openShotBatch(episodeId,structuredClone(shots),mode==='canvas'?activeScene:'');}catch(error){showToast(error instanceof Error?error.message:String(error));}})();});batchButton.classList.add('sbBatch');header.append(batchButton);
  const videoButton=button('视频制作',()=>{void (async()=>{try{await saveShots();await openShotVideo(episodeId,mode==='canvas'?activeScene:'');}catch(error){showToast(error instanceof Error?error.message:String(error));}})();});videoButton.classList.add('sbVideoProduction');header.append(videoButton);
  const hint = element("div", "sbHint", "拖动空白处平移 · 滚轮平移 · Ctrl / ⌘ + 滚轮缩放 · 拖动卡片非编辑区域移动");
  viewport.append(controls, hint);
  const counter = element("span", "sbCounter"); viewport.append(counter);
  const cardTabs=new Map<string,'image'|'lens'>();
  const totalCount = root.querySelector<HTMLElement>('[data-shot-count]');
  const sceneIndex = () => sceneButtons.findIndex(b => sceneId(b) === activeScene);
  const markScene = () => sceneButtons.forEach(b=>{const selected=sceneId(b)===activeScene;b.classList.toggle('sbActiveScene',selected);b.setAttribute('aria-current',String(selected));b.style.removeProperty('border-color');b.style.removeProperty('box-shadow');});
  const persistOptions = () => {if(!isActive())return;void enqueue(`${docKey}:display`,structuredClone(options),()=>{}).catch(error=>showToast(String(error)));render();};
  const generateScene = (scene: typeof scenes[number]) => {
    window.dispatchEvent(new CustomEvent('dsh:auto-storyboard',{detail:{episodeId,sceneBlockId:scene.blockId,title:scene.title}}));
  };
  const openScene = (id:string,shotId?:string) => {
    mode='canvas';switchScene(id);
    void enqueue(`${docKey}:mode`,mode,()=>{}).catch(error=>showToast(String(error)));
    if(shotId){const shot=shots.find(s=>s.id===shotId);if(shot){view={x:Math.max(30,(viewport.clientWidth-360)/2)-shot.x,y:80-shot.y,zoom:1};applyView();saveView();container.querySelector(`[data-shot-id="${CSS.escape(shotId)}"]`)?.classList.add('sbFocusedShot');}}
  };
  let scriptPanel:HTMLElement|undefined;
  const closeScript=()=>{scriptPanel?.remove();scriptPanel=undefined;scriptButton.hidden=mode!=='canvas';};
  const showScript = () => {
    const scene=scenes.find(s=>s.id===activeScene);if(!scene){showToast('此镜头尚未关联真实场次');return;}
    scriptPanel?.remove();scriptPanel=uiNode('aside','','sbScriptPanel');scriptPanel.setAttribute('aria-label','本场剧本');const header=uiNode('header'),body=uiNode('div','','sbScriptBody');header.append(uiNode('h3','本场剧本'),action('收起',closeScript));body.append(uiNode('h4',scene.title));
    scene.blocks.slice(1).forEach(block=>{const p=uiNode('p',block.text);p.dataset.blockType=block.type;body.append(p);});
    scriptPanel.append(header,body,action('到剧本中编辑',()=>{closeScript();window.dispatchEvent(new CustomEvent('dsh:reveal-script',{detail:{episodeId,blockIds:[scene.blockId]}}));}));scriptPanel.onpointerdown=e=>e.stopPropagation();scriptPanel.onwheel=e=>e.stopPropagation();scriptPanel.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();closeScript();scriptButton.focus();}};viewport.append(scriptPanel);scriptButton.hidden=true;header.querySelector('button')?.focus();
  };

  const edit = (shot: Shot) => {
    if (!isActive() || reloading || !shots.includes(shot)) return;
    if (dialogDraft?.mask.isConnected) { dialogDraft.mask.querySelector<HTMLInputElement>("input")?.focus(); return; }
    const mask = element("div", "dsh-entity-mask"); const dialog = element("form", "dsh-entity-dialog");
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", "编辑镜头");
    dialog.append(element("div", "dsh-entity-title", `编辑 ${shot.no}`), element('p', '', shotStyleLabel(shot.setupSnapshot)));
    const fields = [["no", "镜号"], ["type", "景别"], ["angle", "角度"], ["movement", "运镜"], ["lens", "焦段"], ["desc", "画面描述"], ["staging", "场面调度"], ["notes", "备注"]] as const;
    const inputs = fields.map(([key, label]) => {
      const wrap = element("label", "dsh-entity-field"); const input = ['desc','staging','notes'].includes(key) ? element("textarea") : element("input");
      input.className = "dsh-entity-input"; input.value = shot[key]??''; input.setAttribute('aria-label',label); wrap.append(element("span", "", label), input); dialog.append(wrap); return { key, input };
    });
    const durationWrap = element('label','dsh-entity-field'),duration = element('input','dsh-entity-input');duration.type='number';duration.min='0.01';duration.max='3600';duration.step='0.01';duration.value=String(shot.duration??'');duration.setAttribute('aria-label','时长（秒）');durationWrap.append(element('span','','时长（秒）'),duration);dialog.append(durationWrap);
    const captureDuration=()=>{if(duration.value)shot.duration=validDuration(duration.value);else delete shot.duration;};
    const sceneField = element("label", "dsh-entity-field");
    const sceneSelect = element("select", "dsh-entity-input");
    sceneSelect.setAttribute("aria-label", "所属场次");
    const none = element("option", "", "未关联场次"); none.value = UNASSIGNED_SCENE; sceneSelect.append(none);
    sceneButtons.forEach(b => { const option = element("option", "", sceneLabel(b)); option.value = sceneId(b); sceneSelect.append(option); });
    const originalSelection = knownScenes.has(shot.sceneId ?? "") ? shot.sceneId! : UNASSIGNED_SCENE;
    const originalScene = shot.sceneId;
    sceneSelect.value = originalSelection;
    sceneField.append(element("span", "", "所属场次"), sceneSelect); dialog.append(sceneField);
    const selectedScene = () => sceneSelect.value === originalSelection ? originalScene : sceneSelect.value;
    const captureScene = () => { shot.sceneId = selectedScene(); };
    dialogDraft = {
      mask,
      capture: () => {
        if (!mask.isConnected || !shots.includes(shot)) return;
        inputs.forEach(({ key, input }) => { if(key==='desc')setShotDescription(shot,input.value);else shot[key] = input.value; });
        captureDuration();
        captureScene();
        const description = container.querySelector<HTMLTextAreaElement>(`[data-shot-id="${CSS.escape(shot.id)}"] .sbDescription`);
        if (description) description.value = shot.desc;
      },
      dirty: () => mask.isConnected && (inputs.some(({ key, input }) => input.value !== (shot[key]??'')) || duration.value!==String(shot.duration??'') || selectedScene() !== shot.sceneId),
    };
    const actions = element("div", "dsh-entity-actions");
    actions.append(button("删除镜头", () => { if (isActive() && !reloading && shots.includes(shot) && confirm(`删除 ${shot.no}？`)) { shots = shots.filter(s => s.id !== shot.id); persist(); render(); mask.remove(); } }), button("取消", () => mask.remove()));
    const save = button("保存", () => {}); save.type = "submit"; actions.append(save); dialog.append(actions);
    dialog.onsubmit = e => { e.preventDefault(); if (!isActive() || reloading || !shots.includes(shot)) return; try{captureDuration();}catch(error){showToast(String(error));return;}inputs.forEach(({ key, input }) => { shot[key] = input.value; }); captureScene(); persist(); render(); mask.remove(); };
    mask.onkeydown = e => { if (e.key === "Escape") mask.remove(); };
    mask.append(dialog); document.body.append(mask); inputs[0].input.focus();
  };
  const upload = (shot: Shot) => {
    const input = element("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) { alert("请选择不超过 10MB 的图片"); return; }
      const reader = new FileReader(); reader.onload = async () => { try { await initializeGeneration(); await selectOutput(shot.id); if (!isActive() || reloading || !shots.includes(shot)) return; if(shot.mediaPin){(shot.mediaHistory??=[]).push({image:shot.image,pin:shot.mediaPin});delete shot.mediaPin;} shot.image = String(reader.result); persist(); render(); } catch { alert("图片选择状态保存失败，请重试"); } }; reader.readAsDataURL(file);
    }; input.click();
  };
  const updateConnections = () => {
    const svg=container.querySelector<SVGSVGElement>('.sbConnections');if(!svg)return;
    // Read all card geometry before touching SVG. Appending between offsetHeight
    // reads used to force a fresh layout for every connection.
    const points=visibleShots().map(shot=>{
      const card=container.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(shot.id)}"]`);
      return card?{x:shot.x,y:shot.y+Math.min(120,card.offsetHeight/2)}:undefined;
    });
    const paths=document.createDocumentFragment();
    for(let i=1;i<points.length;i++){
      const previous=points[i-1],next=points[i];if(!previous||!next)continue;
      const x1=previous.x+360,y1=previous.y,x2=next.x,y2=next.y,bend=Math.max(35,Math.abs(x2-x1)*.45);
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M ${x1} ${y1} C ${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`);paths.append(path);
    }
    svg.replaceChildren(paths);
  };
  const updateSceneStatus=()=>{
    viewport!.dataset.activeScene=activeScene;
    const activeButton=sceneButtons.find(b=>sceneId(b)===activeScene);
    counter.textContent=`${activeButton?sceneLabel(activeButton):'未关联场次'} · ${visibleShots().length} 个镜头`;
    unassigned.textContent=`未关联镜头 (${shots.filter(s=>!knownScenes.has(s.sceneId??'')).length})`;
    unassigned.setAttribute('aria-pressed',String(activeScene===UNASSIGNED_SCENE));
    if(totalCount)totalCount.textContent=`${shots.length} 个镜头`;
  };
  function render() {
    viewport!.dataset.viewMode = mode;
    root.dataset.storyboardMode = mode;
    viewport!.dataset.activeScene = activeScene;
    modeButtons.forEach(({ button, value }) => {
      button.setAttribute("aria-pressed", String(mode === value)); button.classList.toggle("sbSelectedView", mode === value);
    });
    clearImages();container!.replaceChildren(); const list = visibleShots();
    updateSceneStatus();
    if (arrange) arrange.disabled = mode !== 'canvas';
    displayButton.hidden=mode==='canvas';displayButton.textContent=mode==='board'?'显示选项':'显示';
    if(mode!=='canvas')closeScript();else if(scriptPanel)showScript();scriptButton.hidden=mode!=='canvas'||!!scriptPanel;
    if(mode!=='canvas'){
      cardLayout?.reset();
      const context={shots,scenes,options,changed:persist,optionsChanged:persistOptions,open:openScene,edit,generate:generateScene,image:(box:HTMLElement,shot:Shot,label:string)=>{cleanups.push(mountShotThumbnail(box,shot,label));},mentions:(input:HTMLTextAreaElement,shot:Shot)=>{cleanups.push(mountShotMentions(input,shot,persist));},assets:(shot:Shot)=>{void showSceneAssets(episodeId,shot.sceneId).catch(error=>showToast(String(error)));}};
      if(mode==='board')renderStoryboardBoard(container!,context);else renderStoryboardTable(container!,context);
      return;
    }
    if (!list.length) {
      const empty = element("div", "sbEmpty", activeScene === UNASSIGNED_SCENE ? "未关联的镜头会保留在这里，可通过“编辑镜头”重新选择所属场次。" : "本场暂无镜头，点击“新增镜头”开始。" );
      container!.append(empty);
    }
    const connections=document.createElementNS('http://www.w3.org/2000/svg','svg');connections.classList.add('sbConnections');connections.setAttribute('aria-hidden','true');container!.append(connections);
    list.forEach(shot => {
      const card = element("article", "sbCard"); card.dataset.shotId = shot.id; card.style.transform = `translate(${shot.x}px, ${shot.y}px)`;
      const head = element("div", "sbCardHead");
      const switchCard=(value:'image'|'lens')=>{cardTabs.set(shot.id,value);card.dataset.cardTab=value;imageTab.setAttribute('aria-selected',String(value==='image'));lensTab.setAttribute('aria-selected',String(value==='lens'));if(card.isConnected)updateConnections();};
      const imageTab=button('分镜',()=>switchCard('image')),lensTab=button('镜头',()=>switchCard('lens'));imageTab.setAttribute('role','tab');lensTab.setAttribute('role','tab');head.setAttribute('role','tablist');imageTab.setAttribute('aria-label',`${shot.no} 分镜`);lensTab.setAttribute('aria-label',`${shot.no} 镜头`);head.append(imageTab,lensTab);switchCard(cardTabs.get(shot.id)??'image');
      const language=element('div','sbLensPanel');language.append(element('h4','','镜头语言'));
      const languageFields=[['type','景别',['大远景 (EWS)','远景 (WS)','长景 (LS)','全景 (FS)','中景 (MS)','中近景 (MCU)','近景 (CU)','特写 (ECU)']],['angle','角度',['平视','俯视','仰视','倾斜']],['movement','运动',['固定','摇镜','俯仰','推拉','跟拍','升降','手持']],['lens','焦段',['14mm','24mm','35mm','50mm','85mm','135mm','200mm']]] as const;
      const languageGrid=element('div','sbLensGrid');
      for(const [key,label,values] of languageFields){const wrap=element('div'),choice=button(shot[key]||'未选择',()=>{showShotMenu(choice,['未选择',...new Set([shot[key],...values])].filter(Boolean).map(value=>[value,()=>{shot[key]=value==='未选择'?'':value;choice.textContent=value;refreshTags();persist();}]),{label,selected:shot[key]||'未选择'});});choice.setAttribute('aria-label',`${shot.no} ${label}`);choice.setAttribute('aria-haspopup','menu');choice.dataset.lensField=key;wrap.append(element('span','',label),choice);languageGrid.append(wrap);}language.append(languageGrid);
      const imageBox = element("div", "sbImage");
      imageBox.append(element("span", "sbImagePlaceholder", "尚无分镜图"));
      cleanups.push(mountShotThumbnail(imageBox,shot,shot.no));
      const displayed=shotNumber(shot,shots,scenes,false);imageBox.append(element("span", "sbNumber", displayed));
      imageBox.ondblclick=()=>{void viewShotImage(shot).catch(error=>showToast(String(error)));};
      const tags = element("div", "sbTags");
      const refreshTags=()=>{tags.replaceChildren();tags.append(button(displayed,()=>edit(shot)));[shot.type,shot.angle,shot.movement,shot.lens].filter(Boolean).forEach(t=>tags.append(button(t,()=>switchCard('lens'))));if(shot.duration)tags.append(button(`${shot.duration}s`,()=>edit(shot)));};refreshTags();
      const desc = element("textarea", "sbDescription"); desc.value = shot.desc; desc.placeholder = "描述这一镜头的画面、情绪与意图…"; desc.setAttribute("aria-label", `${shot.no} 画面描述`);
      const uploadButton=button('▧',()=>upload(shot));uploadButton.classList.add('sbUploadImage');uploadButton.setAttribute('aria-label','上传图片');imageBox.append(uploadButton);
      const viewButton=button('⤢',()=>{void viewShotImage(shot).catch(error=>showToast(String(error)));});viewButton.classList.add('sbViewImage');viewButton.setAttribute('aria-label','查看图片');imageBox.append(viewButton);
      imageBox.onclick=e=>{if((e.target as HTMLElement).closest('button')||!imageBox.querySelector('img'))return;void viewShotImage(shot).catch(error=>showToast(String(error)));};imageBox.ondblclick=null;
      const description=element('div','sbDescriptionBox');description.append(tags,desc);
      cleanups.push(mountShotMentions(desc,shot,()=>{persist();window.dispatchEvent(new CustomEvent('dsh:shot-links-updated',{detail:shot.id}));}));
      const main=element('div','sbShotFront');main.append(imageBox,description);card.append(head,main,language);container!.append(card);
      const menu=(anchor:HTMLElement,extended=false)=>{const items:Array<[string,()=>void|Promise<void>]>= [['上传图片',()=>upload(shot)],['清空图像',async()=>{if(!isActive()||!shots.includes(shot))return;await initializeGeneration();await selectOutput(shot.id);if(shot.mediaPin){(shot.mediaHistory??=[]).push({image:shot.image,pin:shot.mediaPin});delete shot.mediaPin;}shot.image='';persist();render();}],['删除',()=>{if(!isActive()||!shots.includes(shot)||!confirm(`删除 ${displayed}？`))return;shots=shots.filter(s=>s.id!==shot.id);persist();render();}]];if(extended)items.push(['编辑镜头',()=>edit(shot)],['引用资产',()=>openAssetPicker(shot,undefined,persist)],['本场资料',()=>showSceneAssets(episodeId,shot.sceneId)],['生成设置',()=>openGeneration(shot,true)],['生成历史',()=>openHistory(shot)],['采用最新项目设定',async()=>{try{await saveShots();await chooseShotSetup(episodeId,[shot.id],{adopt:true,alive:isActive});}catch(error){showToast(error instanceof Error?error.message:String(error));}}],['复制镜头',()=>{if(!isActive())return;const copy={...structuredClone(shot),id:crypto.randomUUID(),no:`SHOT ${String(list.length+1).padStart(2,'0')}`,x:shot.x+40,y:shot.y+40};delete copy.setupSnapshot;shots.splice(shots.indexOf(shot)+1,0,copy);persist();render();}]);showShotMenu(anchor,items);};
      card.oncontextmenu=e=>{if((e.target as HTMLElement).closest('textarea,input,select'))return;e.preventDefault();menu(card,true);};
      cleanups.push(mountGeneration(card, shot, () => { if (card.isConnected && shots.includes(shot)) persist(); },anchor=>menu(anchor,true),episodeId));
      let drag: { x: number; y: number; ox: number; oy: number; moved:boolean } | undefined;let suppressClick=false,imageClick=false;
      card.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}else if(imageClick){imageClick=false;e.preventDefault();e.stopImmediatePropagation();viewButton.focus();void viewShotImage(shot).catch(error=>showToast(String(error)));}},true);
      // Pointer capture retargets clicks to the card; retain the original image hit.
      card.onpointerdown = e => { imageClick=false;if (mode !== "canvas" || e.button !== 0||(e.target as HTMLElement).closest('button,input,textarea,select,.sbCardHead,.sbMentionEditor,.sbLensGrid')) return; e.stopPropagation();suppressClick=false;imageClick=imageBox.contains(e.target as Node)&&!!imageBox.querySelector('img');card.setPointerCapture(e.pointerId);drag = { x: e.clientX, y: e.clientY, ox: shot.x, oy: shot.y,moved:false }; };
      card.onpointermove = e => { if (!drag) return;if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return;drag.moved=true;card.classList.add('dragging');shot.x = Math.round(drag.ox + (e.clientX - drag.x) / view.zoom); shot.y = Math.round(drag.oy + (e.clientY - drag.y) / view.zoom); card.style.transform = `translate(${shot.x}px, ${shot.y}px)`;updateConnections(); };
      const end = (e:PointerEvent) => { if (drag) { const moved=drag.moved;drag = undefined;if(moved||e.type!=='pointerup')imageClick=false;card.classList.remove("dragging");if(card.hasPointerCapture(e.pointerId))card.releasePointerCapture(e.pointerId);if(moved){suppressClick=true;persist();} } }; card.onpointerup = end; card.onpointercancel = end;card.onlostpointercapture=e=>{if(drag)end(e);};
    });
    updateConnections();
    cardLayout?.refresh();
  }
  let pan: { x: number; y: number; ox: number; oy: number } | undefined;
  viewport.onpointerdown = e => {
    if (mode !== "canvas") return;
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest(".sbCard, .sbControls, button")) return;
    e.preventDefault(); viewport.focus(); viewport.setPointerCapture(e.pointerId); pan = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }; viewport.classList.add("panning");
  };
  viewport.onpointermove = e => { if (!pan) return; view.x = pan.ox + e.clientX - pan.x; view.y = pan.oy + e.clientY - pan.y; applyView(); };
  const endPan = () => { if (pan) { pan = undefined; viewport.classList.remove("panning"); saveView(); } }; viewport.onpointerup = endPan; viewport.onpointercancel = endPan;
  viewport.addEventListener("wheel", e => {
    if (mode !== "canvas") return;
    if ((e.target as HTMLElement).closest("textarea") && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); const rect = viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(view.zoom * Math.exp(-e.deltaY * .002), e.clientX - rect.left, e.clientY - rect.top);
    else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); saveView(); }
  }, { passive: false });
  const add = root.querySelector<HTMLButtonElement>('[data-shot-action="add"]'); if (add) add.onclick = e => {
    e.stopPropagation(); const shot: Shot = { id: crypto.randomUUID(), no: `SHOT ${String(visibleShots().length + 1).padStart(2, "0")}`, type: "中景", angle: "平视", movement: "固定", lens: "35mm", desc: "", image: "", sceneId: activeScene, x: (viewport.clientWidth / 2 - view.x) / view.zoom - 180, y: (90 - view.y) / view.zoom };
    shots.push(shot); render(); persist(); edit(shot);
  };
  const arrange = root.querySelector<HTMLButtonElement>('[data-shot-action="arrange"]'); if (arrange) arrange.onclick = e => { e.stopPropagation(); void cardLayout?.arrange(); };
  const displayBar=element('div','sbDisplayBar'),displayButton=button('显示选项',()=>{if(mode!=='canvas')showDisplayOptions(displayButton,options,mode,persistOptions);});displayBar.append(displayButton);viewport.parentElement?.insertBefore(displayBar,viewport);
  if(viewport.parentElement){const defaults=mountImageDefaults(viewport.parentElement);displayBar.before(defaults);}
  const scriptButton=button('本场剧本',showScript);scriptButton.classList.add('sbSceneScript');viewport.append(scriptButton);
  function switchScene(next: string) {
    if (!isActive() || reloading) return;
    cardLayout?.reset();
    const repaint=mode==='canvas'||!!dialogDraft;
    dialogDraft?.capture(); dialogDraft?.mask.remove(); dialogDraft = undefined;
    views = { ...views, [activeScene]: { ...view } };
    activeScene = next; view = views[activeScene] ?? { x: 0, y: 0, zoom: 1 };
    markScene();
    if(repaint)render();else updateSceneStatus();
    applyView(); saveView(); persist();
    void enqueue(`${docKey}:activeScene`,activeScene,()=>{}).catch(error=>showToast(String(error)));
    if(mode!=='canvas')container!.querySelector<HTMLElement>(`[data-scene-ref="${CSS.escape(next)}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});
  }
  sceneButtons.forEach(b => b.addEventListener("click", e => {
    e.preventDefault(); e.stopImmediatePropagation(); switchScene(sceneId(b));
  }, true));
  sceneButtons.forEach(b => b.classList.add("sbSceneOption"));
  markScene();
  root.querySelector<HTMLButtonElement>('[data-shot-action="previous"]')?.addEventListener("click", e => { e.stopPropagation(); sceneButtons[Math.max(0, sceneIndex() - 1)]?.click(); });
  root.querySelector<HTMLButtonElement>('[data-shot-action="next"]')?.addEventListener("click", e => { e.stopPropagation(); sceneButtons[Math.min(sceneButtons.length - 1, sceneIndex() + 1)]?.click(); });
  const modeButtons: { button: HTMLButtonElement; value: ViewMode }[] = [];
  for (const [name, value] of [["分镜板", "board"], ["画布", "canvas"], ["镜头表", "table"]] as const) {
    const tab = root.querySelector<HTMLButtonElement>(`[data-shot-mode="${value}"]`);
    if (!tab) continue;
    tab.disabled = false;
    tab.setAttribute("aria-label", name);
    modeButtons.push({ button: tab, value });
    tab.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      if (!isActive() || reloading) return;
      capture(); dialogDraft?.capture(); dialogDraft?.mask.remove(); dialogDraft = undefined;
      mode = value; render(); applyView(); persist();
      void enqueue(`${docKey}:mode`, mode, () => {}).catch(() => { if (isActive()) status.textContent = "视图偏好保存失败，请重试"; });
    };
  }
  const capture = () => {
    container.querySelectorAll<HTMLInputElement>('input[data-shot-field="duration"]').forEach(input=>{
      const shot=shots.find(s=>s.id===input.closest<HTMLElement>('[data-shot-id]')?.dataset.shotId);
      if(shot){if(input.value)shot.duration=validDuration(input.value);else delete shot.duration;}
    });
    container.querySelectorAll<HTMLTextAreaElement>(".sbDescription").forEach(input => {
      const id = input.closest<HTMLElement>("[data-shot-id]")?.dataset.shotId;
      const shot = shots.find(s => s.id === id);
      if (shot) setShotDescription(shot,input.value);
    });
  };
  const dirty = () => !equalDocumentValue(shots, saved) || !!dialogDraft?.dirty();
  isActive = registerContentEditor(viewport, {
    hasUnsavedChanges: () => dirty() || JSON.stringify(views) !== savedViews,
    async flush() {
      assertActive();
      if (reloading) throw new Error("分镜正在刷新，请稍后保存");
      clearTimeout(viewTimer);
      try {
        do {
          capture(); dialogDraft?.capture();
          await saveShots();
          capture();
        } while (dirty());
        views = { ...views, [activeScene]: { ...view } };
        if (JSON.stringify(views) !== savedViews) await persistView();
        await queue;
        assertActive();
      } catch (error) { status.textContent = "保存失败，草稿已保留，请重试"; throw error; }
    },
    async reload() {
      assertActive(); capture();
      if (dirty()) throw new Error("分镜仍有未保存草稿，请先保存再刷新");
      reloading = true;
      try {
        await queue;
        const latest = await loadDoc<Shot[]>(docKey);
        assertActive(); capture();
        if (dirty()) throw new Error("刷新期间分镜发生编辑，已保留草稿");
        if (!Array.isArray(latest)) throw new Error("分镜数据不存在或无效，已保留当前内容");
        dialogDraft?.mask.remove(); dialogDraft = undefined;
        cardLayout?.reset();shots = snapshotShots(latest);
        storedSnapshot = latest;
        // Preserve the legacy scene fallback without replacing explicitly empty images.
        shots.forEach(s => { s.sceneId ??= sceneButtons[0] ? sceneId(sceneButtons[0]) : UNASSIGNED_SCENE; });
        const entities=await listMentionEntities();shots.forEach(shot=>initializeMentions(shot,entities));
        saved = snapshotShots(shots);
        render(); applyView(); status.textContent = "已保存";
      } finally { reloading = false; }
    },
  });
  const entityUpdated=(event:Event)=>{
    if((event as CustomEvent).detail?.kind!=='entity'||!isActive())return;
    void queue.then(async()=>{if(!isActive())return;await getActiveContentEditor()?.reload();}).catch(error=>{status.textContent=String(error);showToast(String(error));});
  };
  window.addEventListener('dsh:content-updated',entityUpdated);
  cardLayout=mountCardLayout({viewport,toolbar:controls,cardSelector:'.sbCard',active:()=>isActive()&&!reloading&&mode==='canvas',
    items:()=>mode!=='canvas'?[]:visibleShots().flatMap(shot=>{const card=container.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(shot.id)}"]`);return card?[{id:shot.id,element:card,x:shot.x,y:shot.y,width:card.offsetWidth,height:card.offsetHeight}]:[];}),
    apply:positions=>{for(const shot of visibleShots()){const p=positions[shot.id];if(!p)continue;shot.x=p.x;shot.y=p.y;const card=container.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(shot.id)}"]`);if(card)card.style.transform=`translate(${p.x}px, ${p.y}px)`;}updateConnections();},
    commit:saveShots,error:showToast});
  hint.textContent='拖动空白处平移 · Shift + 拖动框选 · 选中后可排列 · Ctrl / ⌘ + Z 撤销排列';
  cleanupWorkspace=()=>{window.removeEventListener('dsh:content-updated',entityUpdated);cardLayout?.destroy();};
  render(); applyView();
}
