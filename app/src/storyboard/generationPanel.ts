import type { Shot } from "./storyboard";
import { lumRequest } from "./lumClient";
import { initializeGeneration, refreshAssets, getAssets, getShotGeneration, effectiveShotLinks, setLinks, uploadAsset, previewImage, startGeneration, hasActiveTask, cancelGeneration, resumeGeneration, selectOutput, subscribeGeneration, generationError, sceneContext } from "./generationState";
import type { Asset, AssetLink, ImageModel, GenerationConfig } from "./generationState";
import "./generationPanel.css";
import { openEntityDetails } from '../entities/entityDetails';
import { showToast } from '../ui/toast';
import { getGenerationDefaults,saveGenerationConfig } from './generationState';
import { getActiveContentEditor } from '../writing/contentEditor';
import { bindImagePreview } from '../ui/imageViewer';
import { prepareShotPrompt } from './generationState';
import { chooseShotSetup, confirmShotAppearanceLocks, shotStyleLabel } from '../scriptSetup/shotSetup';
import { getAsset } from './generationState';
import { createImagePromptEditor } from './imagePromptEditor';
import {readImageDefaults,fillImageDimension,fillImageModels} from './imageDefaults';
import {loadDoc,saveDoc} from '../data/db';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
const action = (text: string, fn: () => void | Promise<void>) => { const b = node("button", "sbButton", text); b.type = "button"; b.onclick = () => { void fn(); }; return b; };
function panel(title: string) {
  const mask = node("div", "sbGenMask"); const box = node("section", "sbGenPanel"); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", title);
  const cleanup = new Set<()=>void>();
  const header = node("header"); const close = () => { mask.remove(); cleanup.forEach(fn=>fn()); cleanup.clear(); }; header.append(node("h2", "", title), action("关闭", close));
  const body = node("div", "sbGenBody"); const error = node("p", "sbGenError"); error.setAttribute("role", "status");
  box.append(header, body, error); mask.append(box); mask.addEventListener("keydown", e => { if (e.key === "Escape") close(); }); document.body.append(mask); header.querySelector("button")?.focus();
  return { mask, body, error, close, onClose:(fn:()=>void)=>cleanup.add(fn) };
}
function chooseFile(): Promise<File | undefined> {
  return new Promise(resolve => { const input = node("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/webp,image/gif"; input.onchange = () => resolve(input.files?.[0]); input.addEventListener("cancel", () => resolve(undefined)); input.click(); });
}
function thumbnail(path: { path: string; mimeType: string }, label: string) {
  const img = node("img", "sbGenThumb"); img.alt = label;
  void previewImage(path).then(url => { img.src = url; }).catch(() => { img.alt = "图片暂不可用"; }); return img;
}
export async function openAssetPicker(shot: Shot, insertMention?: (asset: Asset) => void, changed?:()=>void) {
  const ui = panel(`${shot.no} · 引用资产`);
  try {
    await initializeGeneration(); await refreshAssets(); if (!ui.mask.isConnected) return;
    let links: AssetLink[] = structuredClone(effectiveShotLinks(shot));
    const saveLinks=async()=>{await setLinks(shot.id,links);shot.entityIds=links.filter(link=>getAssets().some(asset=>asset.id===link.assetId&&asset.entityId)).map(link=>link.assetId);changed?.();};
    const search = node("input", "sbGenInput"); search.placeholder = "搜索人物、地点、道具或图片…"; search.setAttribute("aria-label", "搜索引用资产");
    const tabs = node("div", "sbGenTabs"); let kind = "all";
    const list = node("div", "sbAssetList");
    const note = node("p", "sbGenNote", "关联人物、地点和道具后，会自动引用它们的图片和资料。每份资产可选择一张参考图；独立图片可自行勾选。上传图片保存在本地工作区。");
    const render = () => {
      list.replaceChildren(); const assets = getAssets().filter(a => (kind === "all" || a.kind === kind) && `${a.name} ${a.desc}`.toLowerCase().includes(search.value.toLowerCase()));
      for (const asset of assets) {
        const item = node("div", "sbAssetItem"); const row = node("div", "sbAssetTitle"); const check = node("input"); check.type = "checkbox"; check.checked = links.some(l => l.assetId === asset.id); check.setAttribute("aria-label", `引用${asset.name}`);
        check.onchange = () => { links = check.checked ? [...links, { assetId: asset.id, useImage: !!asset.entityId && !!asset.images.length }] : links.filter(l => l.assetId !== asset.id); render(); };
        const title = node("label"); title.append(check, node("strong", "", asset.name)); row.append(title, node("span", "sbGenNote", ({ character: "人物", location: "地点", prop: "道具", image: "图片" } as Record<string,string>)[asset.kind] || asset.kind));
        item.append(row, node("p", "sbAssetDesc", asset.desc || "尚无资产描述"));
        const refs = node("div", "sbAssetImages"); const link = links.find(l => l.assetId === asset.id);
        if(link && asset.entityId && asset.images.length)link.useImage=true;
        for (const image of asset.images) { const choose = action("", () => { if (!links.some(l => l.assetId === asset.id)) links.push({ assetId: asset.id, useImage: true, imagePath: image.path }); else { const l = links.find(l => l.assetId === asset.id)!; l.useImage = true; l.imagePath = image.path; } render(); }); choose.append(thumbnail(image, asset.name)); choose.setAttribute("aria-label", `选用${asset.name}参考图`); choose.classList.toggle("selected", !!link?.useImage && (link.imagePath === image.path || !link.imagePath && image === asset.images[0])); refs.append(choose); }
        const upload = action(asset.images.length ? "添加参考图" : "上传参考图", async () => {
          try { const file = await chooseFile(); if (!file) return; upload.disabled = true; ui.error.textContent = "正在上传参考图…"; await uploadAsset(file, asset); ui.error.textContent = ""; render(); } catch (e) { ui.error.textContent = String(e instanceof Error ? e.message : e); } finally { upload.disabled = false; }
        }); refs.append(upload); item.append(refs);
        if (link) {
          const mode = node("label", "sbGenCheck"); const useImage = node("input"); useImage.type = "checkbox"; useImage.checked = link.useImage; useImage.disabled = !asset.images.length || !!asset.entityId;
          useImage.onchange = () => { link.useImage = useImage.checked; link.imagePath ??= asset.images[0]?.path; render(); };
          mode.append(useImage, node("span", "", asset.images.length ? asset.entityId ? "关联资产图自动参考" : "同时使用选中的图片参考" : "仅引用资料（尚无参考图）")); item.append(mode);
        }
        if (insertMention) item.append(action(`插入 @${asset.name}`, async () => { try { if (!links.some(l => l.assetId === asset.id)) links.push({ assetId: asset.id, useImage: !!asset.entityId && !!asset.images.length }); await saveLinks(); insertMention(asset); ui.close(); } catch (e) { ui.error.textContent = String(e); } }));
        list.append(item);
      }
      if (!assets.length) list.append(node("p", "sbGenNote", "没有匹配的资产。可以上传图片，或先在人物／地点／道具页建立资产。"));
    };
    for (const [id, label] of [["all","全部"],["character","人物"],["location","地点"],["prop","道具"],["image","图片"]]) tabs.append(action(label, () => { kind = id; render(); }));
    search.oninput = render;
    const uploadNew = action("＋ 上传独立图片资产", async () => { try { const file = await chooseFile(); if (!file) return; uploadNew.disabled = true; ui.error.textContent = "正在上传…"; const asset = await uploadAsset(file); links.push({ assetId: asset.id, useImage: true, imagePath: asset.images[0].path }); ui.error.textContent = ""; render(); } catch (e) { ui.error.textContent = String(e instanceof Error ? e.message : e); } finally { uploadNew.disabled = false; } });
    ui.body.append(note, search, tabs, uploadNew, list, action("保存引用", async () => { try { await saveLinks(); ui.close(); } catch (e) { ui.error.textContent = String(e); } })); render(); search.focus();
  } catch (error) { ui.error.textContent = error instanceof Error ? error.message : String(error); }
}
export async function openGeneration(shot: Shot,configureOnly=false,episodeId?:string) {
  const ui = panel(`${shot.no} · ${configureOnly?'生成设置':'生成分镜'}`); ui.body.append(node("p", "sbGenNote", "正在读取 Lum 图片模型…"));
  try {
    if (!configureOnly && episodeId && await chooseShotSetup(episodeId,[shot.id],{alive:()=>ui.mask.isConnected}))
      shot = (await loadDoc<Shot[]>(`storyboard:${episodeId}`))?.find(item=>item.id===shot.id) ?? shot;
    await initializeGeneration(); await refreshAssets(); const { models } = await lumRequest<{ models: ImageModel[] }>("models"); if (!ui.mask.isConnected) return;
    const options = models.filter(m => m.type === "image"); ui.body.replaceChildren();
    if (!options.length) { ui.body.append(node("p", "sbGenNote", "没有可用图片模型，请先在项目设置中配置。"),action('打开项目设置',()=>{ui.close();window.dispatchEvent(new Event('dsh:settings'));})); return; }
    const meta = getShotGeneration(shot.id); const saved = meta.config??getGenerationDefaults()?.config;
    const defaults=await readImageDefaults();const preferences=await loadDoc<{includeContext:boolean}>(`image:options:${shot.id}`);if(!ui.mask.isConnected)return;
    const model = node("select", "sbGenInput"); model.setAttribute("aria-label", "生图模型");
    fillImageModels(model,options,defaults,saved);
    const params = node("div", "sbGenParams");
    const ratio = node("select", "sbGenInput"), size = node("select", "sbGenInput"); ratio.setAttribute("aria-label", "画幅比例"); size.setAttribute("aria-label", "图片尺寸");
    const change = () => { const m = options[Number(model.value)]; fillImageDimension(ratio,m?.imageRatios,defaults.ratio??saved?.ratio); fillImageDimension(size,m?.imageSizes,defaults.size??saved?.size); };
    model.onchange = ()=>{change();updateSubmit();}; change();
    const field = (label: string, input: HTMLElement) => { const el = node("label", "sbGenField"); el.append(node("span", "", label), input); return el; };
    params.append(field("画幅比例",ratio),field("图片尺寸",size));
    const refs = node("div", "sbGenReferences");
    let reviewedReferences: Awaited<ReturnType<typeof prepareShotPrompt>>['references'] | undefined;
    const renderRefs=()=>{
      refs.replaceChildren();const links=effectiveShotLinks(shot);let number=0;
      if(reviewedReferences){for(const reference of reviewedReferences){const item=node('div','sbGenRefChip',`${reference.image?`参考图 ${++number} · `:''}${reference.name} · ${reference.image?'资料＋图片':'仅资料（无图片参考）'}`);if(reference.image)item.prepend(thumbnail(reference.image,reference.name));refs.append(item);}if(!reviewedReferences.length)refs.append(node('p','sbGenNote','本镜头尚未关联资产参考图'));return;}
      if (!links.length) refs.append(node("p", "sbGenNote", "未绑定资产：本次仅使用文字。请先在卡片的引用资产中关联人物、地点或道具。"));
      links.forEach(link => { const asset = getAssets().find(a => a.id === link.assetId); const image = asset?.images.find(i => i.path === link.imagePath) ?? asset?.images[0];const item = node("div", "sbGenRefChip", `${link.useImage&&image?`参考图 ${++number} · `:''}${asset?.name ?? "已失效资产"} · ${link.useImage&&image ? "资料＋图片" : "仅资料（无图片参考）"}`); if (link.useImage && image) item.prepend(thumbnail(image,asset!.name)); refs.append(item); });
    };renderRefs();
    const description = node("div", "sbGenPrompt", shot.desc || "尚未填写镜头描述");
    const context = await sceneContext(shot);
    const contextLabel = node("label", "sbGenCheck"); const useContext = node("input"); useContext.type = "checkbox"; useContext.disabled = !context;useContext.checked=!!context&&(preferences?.includeContext??meta.includeContext??getGenerationDefaults()?.includeContext??true);
    contextLabel.append(useContext,node("span","",context ? `附带本场剧本上下文（${context.length}字，可选）` : "暂无可关联的本场剧本"));
    const advanced = node("details"); advanced.append(node("summary", "", "模型额外参数（可选）")); const other = node("textarea", "sbGenInput"); const chosenModel=options[Number(model.value)];other.value = JSON.stringify(chosenModel?.providerId===saved?.providerId&&chosenModel?.modelId===saved?.modelId?saved?.other??{}:{},null,2); other.rows = 3; other.setAttribute("aria-label", "模型额外参数 JSON"); advanced.append(node("p","sbGenNote","仅填写所选供应商支持的参数；不确定时保持 {}。参考图支持范围由供应商校验，不假定所有模型均支持多图。"),other);
    model.onchange=()=>{change();other.value='{}';updateSubmit();};
    let promptEditor: Awaited<ReturnType<typeof createImagePromptEditor>> | undefined, submitting=false;
    const updateSubmit=()=>{submit.disabled=submitting||hasActiveTask(shot.id)||!options[Number(model.value)]||(!configureOnly&&!promptEditor?.ready);submit.setAttribute('aria-busy',String(submitting||hasActiveTask(shot.id)));};
    const submit = action(configureOnly?'保存设置':"生成分镜", async () => {
      if(submitting)return;
      try {
        const extra: unknown = JSON.parse(other.value || "{}"); if (!extra || Array.isArray(extra) || typeof extra !== "object") throw new Error("额外参数必须是 JSON 对象");
        const m = options[Number(model.value)];if(!m)throw Error('请选择可用图片模型'); const config: GenerationConfig = { providerId:m.providerId,modelId:m.modelId,...(ratio.value ? { ratio:ratio.value } : {}),...(size.value ? { size:size.value } : {}),other:extra as Record<string,unknown> };
        submitting=true;updateSubmit();await getActiveContentEditor()?.flush();
        const reviewed=configureOnly?undefined:await promptEditor!.getReviewed();
        if (!configureOnly) {
          const current = episodeId ? (await loadDoc<Shot[]>(`storyboard:${episodeId}`))?.find(item=>item.id===shot.id) : shot;
          if (!current) throw Error('镜头已删除，请重新打开分镜');
          await confirmShotAppearanceLocks([current]);
        }
        if(!ui.mask.isConnected)return;
        await saveGenerationConfig(shot.id,config,useContext.checked);if(!configureOnly){ui.error.textContent = "正在提交已确认的提示词与参考图…";await startGeneration(shot, config, "", reviewed,()=>ui.mask.isConnected);}ui.close();
      } catch (e) { ui.error.textContent = e instanceof Error ? e.message : String(e); }
      finally{submitting=false;updateSubmit();}
    }); submit.classList.add("sbGeneratePrimary");updateSubmit();
    ui.body.append(field("图片模型", model),params,node("h3","","本次引用"),refs,node("h3","","镜头描述"),description,node('p','sbGenNote',shotStyleLabel(shot.setupSnapshot)),contextLabel,advanced,node("p","sbGenNote","将发送镜头描述、参数和所选资产资料／图片给配置的模型服务商，可能产生费用。未配置凭据时任务会明确报错，旧图不会被清空。"),submit);
    if(!configureOnly){
      promptEditor=await createImagePromptEditor({key:shot.id,use:'storyboard-image',isAlive:()=>ui.mask.isConnected,readSource:async(skill,requirements)=>{await getActiveContentEditor()?.flush();const source=await prepareShotPrompt(shot,useContext.checked,skill,requirements);if(ui.mask.isConnected){reviewedReferences=source.references;description.textContent=source.basePrompt;renderRefs();}return source;},onReadyChange:updateSubmit});
      if(!ui.mask.isConnected){promptEditor.dispose();return;}
      submit.before(promptEditor.element);ui.onClose(()=>promptEditor?.dispose());updateSubmit();
    }
    useContext.onchange=()=>{promptEditor?.invalidate();void saveDoc(`image:options:${shot.id}`,{includeContext:useContext.checked}).catch(error=>{ui.error.textContent=String(error);});};
    ui.onClose(subscribeGeneration(()=>{if(ui.mask.isConnected){renderRefs();updateSubmit();}}));
  } catch (e) { ui.error.textContent = e instanceof Error ? e.message : String(e); }
}
export async function openHistory(shot: Shot) {
  const ui = panel(`${shot.no} · 生成历史`); await initializeGeneration();
  const meta = getShotGeneration(shot.id); ui.body.append(action("恢复原分镜图", async () => { try { await selectOutput(shot.id); ui.close(); } catch (e) { ui.error.textContent = String(e); } }));
  if (!meta.history.length) ui.body.append(node("p","sbGenNote","尚无生成记录"));
  meta.history.forEach(h => {
    const item = node("article","sbHistoryItem"); item.append(node("h3","",new Date(h.createdAt).toLocaleString()),node("p","",`${h.config.modelId} · ${stateLabel(h.state)}`));
    if (h.message) item.append(node("p","sbGenNote",h.message));
    if (h.state === 'interrupted' && h.resumable !== false) item.append(action('恢复取图', async () => { try { await resumeGeneration(shot.id,h.taskId); ui.close(); } catch (error) { ui.error.textContent = String(error); } }));
    const images = node("div","sbAssetImages"); h.outputs.forEach(image => { const output = node('div','sbHistoryOutput'); const preview = thumbnail(image,shot.no); bindImagePreview(preview,()=>previewImage(image)); const choose = action("选用此图",async () => { try { await selectOutput(shot.id,image); ui.close(); } catch (e) { ui.error.textContent = String(e); } }); output.append(preview,choose); images.append(output); });
    const details = node("details"); details.append(node("summary","","查看当时的提示词与参数"),node("pre","sbGenPrompt",`${h.prompt}\n\n${JSON.stringify(h.config,null,2)}`)); item.append(images,details); ui.body.append(item);
  });
}
const stateLabel = (state: string) => ({ submitting:"提交中",running:"生成中",unknown:"核对任务状态",resuming:"恢复取图中",succeeded:"已完成",failed:"生成失败",interrupted:"任务中断",cancelled:"已取消",cancelling:"正在取消" } as Record<string,string>)[state] || state;
export function mountGeneration(card: HTMLElement, shot: Shot, changed: () => void, more?:(anchor:HTMLElement)=>void,episodeId?:string) {
  const zone = node("div","sbGenerationZone"); card.append(zone);
  const mediaBox=card.querySelector<HTMLElement>('.sbImage');
  const overlay=node('div','lumGenerationOverlay'),overlayLabel=node('strong','','正在生成');
  overlay.append(overlayLabel,node('div','lumGenerationTrack'),node('small','','完成后自动更新'));overlay.hidden=true;overlay.setAttribute('aria-hidden','true');mediaBox?.append(overlay);
  const desc = card.querySelector<HTMLTextAreaElement>(".sbDescription");
  const mention = () => openAssetPicker(shot, asset => { if (!desc) return; const start = desc.selectionStart; const end = desc.selectionEnd; const before = desc.value.slice(0,start).replace(/@$/, ""); desc.value = `${before}@${asset.name} ${desc.value.slice(end)}`; shot.desc = desc.value; desc.dispatchEvent(new Event('input',{bubbles:true}));changed(); desc.focus(); },changed);
  if(!more)desc?.addEventListener("keyup", e => { if (e.key === "@" && !e.isComposing) void mention(); });
  let submitting=false;
  const refresh = () => {
    if (!card.isConnected) { unsubscribe(); return; }
    const meta = getShotGeneration(shot.id); zone.replaceChildren();
    const chips = node("div","sbAssetChips"); effectiveShotLinks(shot).forEach(link => { const asset = getAsset(link.assetId);const chip=action(`@${asset?.name ?? "失效资产"}${link.useImage ? " · 图" : ""}`,()=>{if(asset?.entityId)void openEntityDetails(asset.entityId).catch(error=>showToast(String(error)));else void mention();});chip.className='sbGenRefChip';chip.dataset.entityId=asset?.entityId??'';chips.append(chip); });
    const controls = node("div","sbGenActions"); const generate = action(more?'生成':'生成分镜', async() => {if(submitting)return;submitting=true;try{await getActiveContentEditor()?.flush();await openGeneration(shot,false,episodeId);}catch(error){showToast(String(error));}finally{submitting=false;refresh();}}); generate.disabled = submitting||hasActiveTask(shot.id);generate.title='选择 Skill 并优化提示词，确认后生成分镜图';
    if(more){const menu=action('···',()=>more(menu));menu.setAttribute('aria-label','更多');generate.classList.add('sbCardGenerate');controls.append(generate,menu);}else controls.append(action("@ 引用资产",mention),generate,action("历史",()=>openHistory(shot)));zone.append(chips,controls);
    if (meta.history.some(h => h.state === 'interrupted' && h.resumable !== false)) controls.prepend(action('恢复取图', async () => { try { await resumeGeneration(shot.id); } catch (error) { showToast(String(error)); } }));
    if (hasActiveTask(shot.id)) zone.append(action("取消任务",async () => { try { if (!confirm("取消后将停止本地任务跟踪，但供应商可能仍在处理，不能保证停止收费或退款。确定取消？")) return; await cancelGeneration(shot.id); } catch(e) { message.textContent = String(e); } }));
    const latest = meta.history[0]; const message = node("p","sbGenTaskStatus", generationError() || (latest ? `${stateLabel(latest.state)}${latest.message ? ` · ${latest.message}` : ""}` : "")); message.setAttribute("role","status"); zone.append(message);
    const active=hasActiveTask(shot.id);overlay.hidden=!active;overlayLabel.textContent=latest?stateLabel(latest.state):'正在生成';mediaBox?.toggleAttribute('data-lum-generating',active);
  };
  const unsubscribe = subscribeGeneration(refresh);
  const linkChanged=(event:Event)=>{if((event as CustomEvent).detail===shot.id)refresh();};window.addEventListener('dsh:shot-links-updated',linkChanged);
  void initializeGeneration().then(refresh).catch(e=>{zone.textContent=`生图模块初始化失败：${String(e)}`;});
  return ()=>{unsubscribe();window.removeEventListener('dsh:shot-links-updated',linkChanged);};
}
