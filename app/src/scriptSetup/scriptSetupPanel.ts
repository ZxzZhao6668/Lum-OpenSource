import './scriptSetupPanel.css';
import { loadDoc } from '../data/db';
import type { AssetMedia } from '../assetLibrary/assetMedia';
import type { ProjectMeta } from '../projects/projectWriting';
import { node } from '../ui/localUi';
import { closeLumDialog } from '../appearance/lumMotion';
import { CREATIVE_PRESETS, previewCreativePreset } from './scriptSetupCatalog';
import { SETUP_FIELDS, emptyScriptSetup, type CharacterEdit, type ScriptSetupPayload } from './scriptSetupModel';
import { readScriptSetupHistory, readScriptSetupState, restoreScriptSetupRevision, saveScriptSetup, ScriptSetupConflict, type ScriptSetupState } from './scriptSetupStore';
import { button, focusLater, note, subtitle, type SetupView } from './setupControls';
import { renderGenrePanel } from './setupGenrePanel';
import { renderAudience, renderConstraints, renderHooks, renderSetting, renderStructure, renderVisualStyle } from './setupFieldPanels';
import { reviewSetupBeforeSave } from './scriptSetupReview';
import { writeCanonResolution } from './scriptSetupContext';
import { renderScriptSetupTasks } from './scriptSetupTaskPanel';
import { renderCharacters } from './setupCharacterPanel';

type Panel = 'primary'|'secondary'|'audience'|'characters'|'setting'|'hooks'|'visualStyle'|'structure'|'constraints'|'history'|'presets'|'close'|'conflict'|'tasks';
const cards = [
  ['audience','01','目标受众'],['characters','02','角色设定'],['setting','03','时代 / 世界'],
  ['hooks','04','核心看点'],['visualStyle','05','画面风格'],['structure','06','剧本结构'],
] as const;
const titleFor = {
  primary:'选择主题材', secondary:'选择融合题材', audience:'目标受众', characters:'角色设定', setting:'时代 / 世界',
  hooks:'核心看点', visualStyle:'画面风格', structure:'剧本结构', constraints:'创作边界与文风',
  history:'已确认版本', presets:'创作预设', close:'有未保存的修改', conflict:'核对当前版本', tasks:'AI 提取与创作候选',
} satisfies Record<Panel,string>;
let opened: HTMLDialogElement | undefined;

export async function openScriptSetup(episodeId: string): Promise<void> {
  if (opened?.isConnected) {opened.focus();return;}
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = node('dialog', '', 'localDialog scriptSetupDialog');dialog.tabIndex=-1;
  dialog.setAttribute('aria-label','剧本设定器');
  dialog.dataset.episodeId=episodeId;
  const header=node('header'), title=node('h2','剧本设定器'), close=button('关闭',requestClose);
  const status=node('p','正在读取项目设定…','ssStatus');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const scroll=node('div','','localDialogBody ssScroll'), overview=node('section','','ssOverview');
  const panel=node('section','','ssPane'), panelTitle=node('h3'), panelBody=node('div','','ssPaneBody');
  const paneHead=node('header','','ssPaneHead');
  const back=button('返回设定概览', () => { if (!busy) clearPanel(); });
  paneHead.append(panelTitle,back);panel.append(paneHead,panelBody);panel.hidden=true;
  const footer=node('footer','','ssFooter'), footActions=node('div','','ssRow');
  const draftButton=button('保存草稿',()=>void perform(async()=>{await persist('draft');}));
  const confirmButton=button('仅保存设定',()=>void perform(async()=>{await persist('confirmed');}),'ssPrimary');
  footActions.append(draftButton,confirmButton);footer.append(status,footActions);
  header.append(title,close);scroll.append(overview,panel);dialog.append(header,scroll,footer);
  let state: ScriptSetupState | undefined, payload=emptyScriptSetup(), basePayload=emptyScriptSetup(), baseEdits='[]';
  const edits=new Map<string,CharacterEdit>();
  let panelId: Panel | undefined, resumePanel: Panel | undefined, returnFocus: HTMLElement | null=null, busy=false, dirty=false;
  let meta: ProjectMeta | null=null, dialogClosed=false, stagedMedia: AssetMedia | undefined;
  const calendar=new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'});
  const beforeUnload=(event: BeforeUnloadEvent)=>{if(dirty && !dialogClosed){event.preventDefault();event.returnValue='';}};
  const view: SetupView={body:panelBody,change,notice,perform};
  function notice(message: string, error=false) { status.textContent=message;status.dataset.error=String(error); }
  const snapshotEdits=()=>[...edits.values()];
  function change() {
    dirty=JSON.stringify(payload)!==JSON.stringify(basePayload)||JSON.stringify(snapshotEdits())!==baseEdits;
    if (!panelId) renderOverview(false);
    else renderOverview();
  }
  function setState(next: ScriptSetupState, replaceInput=false) {
    state=next;
    if (replaceInput) {stagedMedia=undefined;
      payload=structuredClone(next.draft?.payload??next.confirmed?.payload??emptyScriptSetup());edits.clear();
      for (const edit of next.draft?.characterEdits??[]) edits.set(edit.entityId,structuredClone(edit));
    }
    basePayload=structuredClone(next.draft?.payload??next.confirmed?.payload??emptyScriptSetup());
    baseEdits=JSON.stringify(next.draft?.characterEdits??[]);
    change();
  }
  function setBusy(value: boolean) {
    busy=value;dialog.setAttribute('aria-busy',String(value));
    // Keep the currently focused control in the dialog while asynchronous work runs.
    draftButton.disabled=value||!state;confirmButton.disabled=value||!state;
  }
  async function perform(work:()=>Promise<void>) {
    if (busy || dialogClosed) return;
    setBusy(true);
    try {await work();}
    catch(error) {if (!dialogClosed) notice(error instanceof Error ? error.message : String(error),true);}
    finally {setBusy(false);}
  }
  async function persist(saveStatus: 'draft'|'confirmed') {
    if(!state) return;
    try {
      const approval=saveStatus==='confirmed'?await reviewSetupBeforeSave(payload,episodeId):undefined;
      if (approval===null) {notice('本次确认已取消，当前输入保留。');return;}
      const saved=await saveScriptSetup(payload,state.version,saveStatus,snapshotEdits(),stagedMedia,approval?record=>writeCanonResolution(approval.review,approval.omittedFields,record):undefined);
      if (dialogClosed) return;
      // Keep the current object while an editor is mounted; its controls still reference it.
      stagedMedia=undefined; setState(saved);
      if (saveStatus==='draft') notice(`草稿 v${saved.draft!.revision} 已保存。新任务仍沿用已确认版。`);
      else notice(`设定 v${saved.confirmed!.revision} 已确认。${saved.draft?.characterEdits?.length?' 人物编辑保留在草稿，请单独应用。':''}`);
    } catch (error) {
      if (error instanceof ScriptSetupConflict && !dialogClosed) {
        showPanel('conflict');notice(error.message,true);return;
      }
      throw error;
    }
  }
  function requestClose() {
    if(busy) return;
    if(!dirty) {closeLumDialog(dialog);return;}
    if(panelId!=='close'){resumePanel=panelId;showPanel('close');}
  }
  function clearPanel() {
    panelId=undefined;panel.hidden=true;panelBody.replaceChildren();scroll.classList.remove('ssSplit');renderOverview();
    const match=returnFocus?.dataset.ssPanel;
    const target=match ? [...overview.querySelectorAll<HTMLElement>('[data-ss-panel]')].find(el=>el.dataset.ssPanel===match) : returnFocus;
    focusLater(target?.isConnected ? target : close);returnFocus=null;
  }
  function from(label:string, id:Panel, cls='') {
    const b=button(label,button=>showPanel(id,button),cls);b.dataset.ssPanel=id;return b;
  }
  function renderOverview(rebuild=true) {
    if(!state) return;
    const stateLabel=state.confirmed ? `已确认 v${state.confirmed.revision}` : '尚未确认';
    const draftLabel=state.draft ? ` · 草稿 v${state.draft.revision}` : '';
    const active=stateLabel+draftLabel+(dirty?' · 有未保存修改':'');
    if (!rebuild && overview.querySelector('.ssState')) {overview.querySelector('.ssState')!.textContent=active;return;}
    overview.replaceChildren();
    const info=node('div','','ssInfo'), project=node('div');
    project.append(node('strong',meta?.name??'当前项目'),node('p',active,'ssState'));
    if(meta?.synopsis){const synopsis=node('details','','ssSynopsis');synopsis.append(node('summary','查看项目梗概'),note(meta.synopsis));project.append(synopsis);}
    const tools=node('div','','ssRow');tools.append(from('创作预设','presets'),from('版本历史','history'));
    info.append(project,tools);overview.append(info);
    const genres=node('div','','ssGenres');
    function genreCard(side: 'primary'|'secondary') {
      const slot=node('div','','ssGenreSlot'), g=payload.genre[side], primary=side==='primary';
      const b=from('',side,`ssCircle rounded-full ${g?'ssCircleSet':''}`);
      b.append(node('small',primary?'主题材':'融合题材'),node('strong',g?.label??(primary?'选择题材':'＋ 添加')),
        node('span',g?.subtype?.label??(g?'点击切换':'可留下未设置')));
      if(!primary && !payload.genre.primary){b.disabled=true;b.title='请先选择主题材';}
      slot.append(b);
      if(g) {
        const remove=button(primary?'清除主题材':'移除融合题材',()=>{
          if (primary && payload.genre.secondary) {notice('请先移除融合题材，再清除主题材。',true);return;}
          delete payload.genre[side];change();renderOverview();focusLater(overview.querySelector<HTMLElement>(`[data-ss-panel="${side}"]`));notice('题材已移除，融合说明和核心看点保留，请检查是否仍适用。');
        },'ssQuiet');slot.append(remove);
      }
      return slot;
    }
    genres.append(genreCard('primary'),node('span','＋','ssJoin'),genreCard('secondary'));overview.append(genres);
    overview.append(note(payload.genre.fusionNote || '选择一个主题材，可搭配一个融合题材。'));
    if(payload.genre.fusionNote) overview.append(from('编辑融合说明','primary','ssQuiet'));
    const summaries = {
      audience:payload.audience.choices.map(c=>c.label).join('、')||payload.audience.language,
      characters:payload.characters.length?`${payload.characters.length} 人${edits.size?` · ${edits.size} 个待应用`:''}`:'',
      setting:[payload.setting.mainEra,payload.setting.place,...payload.setting.mechanisms.map(m=>m.label)].filter(Boolean).join(' · ')||(payload.setting.worldRules||payload.setting.worldRefs.length?'已设世界规则':''),
      hooks:payload.hooks.map(c=>c.label).join(' → '),
      visualStyle:payload.visualStyle.preset?.label||(payload.visualStyle.customText||payload.visualStyle.referenceMediaId?'自定义补充':''),
      structure:[payload.structure.episodeCount?`${payload.structure.episodeCount} 集`:'',payload.structure.pattern,payload.structure.stages.length?`${payload.structure.stages.length} 个阶段`:''].filter(Boolean).join(' · '),
    };
    const grid=node('div','','ssSummary');
    for(const [id,number,label] of cards) {
      const b=from('',id,'ssSummaryCard');
      b.append(node('small',number),node('strong',label),node('span',summaries[id]||'未设置'));grid.append(b);
    }
    overview.append(grid,from('创作边界与文风','constraints','ssQuiet'),from('AI 提取与创作候选','tasks','ssQuiet'));
  }
  function showPanel(id:Panel, trigger?:HTMLElement) {
    if (!state) return;
    const paneState=state;
    if (trigger) returnFocus=trigger;
    panelId=id;panel.hidden=false;scroll.classList.add('ssSplit');panelTitle.textContent=titleFor[id];panelTitle.tabIndex=-1;
    panelBody.replaceChildren();scroll.scrollTop=0;panel.scrollTop=0;focusLater(panelTitle);
    switch(id){
      case 'primary':case 'secondary':renderGenrePanel(view,payload,id,clearPanel);break;
      case 'audience':renderAudience(view,payload.audience);break;
      case 'characters':renderCharacters(view,payload,edits,state.version);break;
      case 'setting':renderSetting(view,payload.setting);break;
      case 'hooks':renderHooks(view,payload.hooks);break;
      case 'visualStyle':renderVisualStyle(view,payload.visualStyle,()=>stagedMedia,media=>{stagedMedia=media;});break;
      case 'structure':renderStructure(view,payload.structure);break;
      case 'constraints':renderConstraints(view,payload);break;
      case 'presets':renderPresets();break;
      case 'tasks':renderScriptSetupTasks(panelBody,episodeId,{ getDraft:()=>payload, applyDraft:next=>{ payload=next;change();clearPanel();notice('已选候选进入可编辑草稿。请核对并保存。'); }, openEpisode:()=>{if(dirty){notice('请先保存或放弃当前未保存的修改。',true);return false;}dialog.close();return true;} });break;
      case 'history':void renderHistory(paneState);break;
      case 'conflict':void renderConflict(paneState);break;
      case 'close':{
        const actions=node('div','','ssRow');
        actions.append(button('继续编辑',()=>resumePanel?showPanel(resumePanel):clearPanel()),button('保存草稿并关闭',()=>void perform(async()=>{
          await persist('draft');if(!dirty&&panelId==='close')closeLumDialog(dialog);
        }),'ssPrimary'),button('放弃本次修改并关闭',()=>{dirty=false;closeLumDialog(dialog);}));
        panelBody.append(note('你可以继续编辑、保存草稿，或放弃本次未保存的修改。已保存版本和已应用的人物档案会保留。'),actions);
        break;
      }
    }
  }
  async function renderHistory(paneState:ScriptSetupState){
    panelBody.append(note('正在读取已确认的历史版本…'));
    try {
      const rows=await readScriptSetupHistory();
      if(panelId!=='history'||dialogClosed)return;
      panelBody.replaceChildren(note('恢复会创建新的确认版。已保存草稿、世界观、人物档案和旧任务保留。'));
      if(!rows.length)panelBody.append(note('还没有已确认的版本。'));
      const list=node('div','','ssHistoryList');panelBody.append(list);
      function page(start:number) {
        list.replaceChildren();
        for(const row of rows.slice(start,start+20)){
          const card=node('article','','ssCatalogCard'), title=node('strong',`v${row.revision} · ${calendar.format(row.updatedAt)}${row.restoredFrom?` · 恢复自 v${row.restoredFrom}`:''}`);
          card.append(title,note(summary(row.payload)),button('恢复此版本',()=> {
            if(busy)return;
            if(dirty){notice('请先保存当前输入，再恢复历史。',true);return;}
            const currentVersion=state?.version??paneState.version;
            const preview=node('div','','ssGroup');
            preview.append(note(`将 v${row.revision} 恢复为新的确认版本。`),button('确认恢复',()=>void perform(async()=>{
              try { const next=await restoreScriptSetupRevision(row.revision,currentVersion);setState(next,true);clearPanel();
                notice(`已确认 v${next.confirmed!.revision}，恢复自 v${row.revision}。`);
              } catch(error){if(error instanceof ScriptSetupConflict){showPanel('conflict');notice(error.message,true);}else throw error;}
            }),'ssPrimary'),button('取消',()=>preview.remove()));
            card.querySelector('.ssGroup')?.remove();card.append(preview);focusLater(preview.querySelector('button'));
          }));
          list.append(card);
        }
        if(start>0)list.append(button('上一页',()=>page(start-20)));
        if(start+20<rows.length)list.append(button('下一页',()=>page(start+20)));
      }
      page(0);
    } catch(error){if(!dialogClosed&&panelId==='history'){panelBody.replaceChildren(note('历史记录读取失败。'));notice(error instanceof Error?error.message:String(error),true);}}
  }
  async function renderConflict(stale:ScriptSetupState){
    panelBody.append(note('正在比较最新版本…'));
    try {
      const latest=await readScriptSetupState();
      if(panelId!=='conflict'||dialogClosed)return;
      const remote=latest.draft?.payload??latest.confirmed?.payload??emptyScriptSetup();
      panelBody.replaceChildren(note(`当前已确认：${latest.confirmed?`v${latest.confirmed.revision}`:'无'}；草稿：${latest.draft?`v${latest.draft.revision}`:'无'}。你的输入仍保留。`));
      if(latest.version.workspaceEpoch!==stale.version.workspaceEpoch){
        panelBody.append(note('工作区已恢复，旧输入不能直接写回。可从这里查看本地值，或重新打开恢复后的工作区。'));
      }
      const differences=node('div','','ssChoiceGroups');
      for (const key of Object.keys(payload) as (keyof ScriptSetupPayload)[]) {
        if(JSON.stringify(payload[key])===JSON.stringify(remote[key]))continue;
        const details=node('details','','ssGroup');
        details.append(node('summary',SETUP_FIELDS[key as keyof typeof SETUP_FIELDS]??(key==='constraints'?'创作边界':'来源')),
          note('最新保存'),node('pre',JSON.stringify(remote[key],null,2)),note('我的输入'),node('pre',JSON.stringify(payload[key],null,2)));
        differences.append(details);
      }
      if(JSON.stringify(snapshotEdits())!==JSON.stringify(latest.draft?.characterEdits??[])){
        const details=node('details','','ssGroup');details.append(node('summary','待应用人物编辑'),note('最新保存'),node('pre',JSON.stringify(latest.draft?.characterEdits??[],null,2)),note('我的输入'),node('pre',JSON.stringify(snapshotEdits(),null,2)));differences.append(details);
      }
      panelBody.append(differences);
      const actions=node('div','','ssRow');
      actions.append(button('载入最新版本，放弃本次输入',()=>{setState(latest,true);clearPanel();notice('已载入最新版本。');}));
      if(latest.version.workspaceEpoch===stale.version.workspaceEpoch)actions.prepend(button('以最新版本为基准，保留我的输入',()=>{
        setState(latest);clearPanel();notice('已保留本地输入；再次保存会写入这里显示的值。');
      },'ssPrimary'));
      panelBody.append(actions);
    }catch(error){if(!dialogClosed&&panelId==='conflict')panelBody.replaceChildren(note(error instanceof Error?error.message:String(error)));}
  }
  function renderPresets(){
    const choices=node('div','','ssChoiceList'), preview=node('div');
    panelBody.append(note('预设先展示差异；只修改设定器草稿，保留锁定字段和已确认世界观。'),choices,preview);
    function showPreview(index: number) {
      const preset=CREATIVE_PRESETS[index];
      const previewBase=JSON.stringify(payload);
      const next=previewCreativePreset(payload,index);
      const heading=subtitle(`预览 · ${preset.name}`);
      heading.tabIndex=-1;
      preview.replaceChildren(heading);
      const diffs=[
        ['genre','题材组合',genreSummary(payload),genreSummary(next)],
        ['hooks','核心看点',payload.hooks.map(h=>h.label).join(' → '),next.hooks.map(h=>h.label).join(' → ')],
        ['setting','主体时代与机制',settingSummary(payload),settingSummary(next)],
      ];
      let changed=false;
      for(const [key,label,before,after] of diffs){
        const locked=payload.constraints.lockedFields.includes(key as 'genre'|'hooks'|'setting');
        if(locked)preview.append(note(`${label}：已锁定，保留「${before||'未设置'}」。`));
        else if(before!==after){changed=true;preview.append(note(`${label}：${before||'未设置'} → ${after||'未设置'}`));}
      }
      if(!changed)preview.append(note('没有可替换的字段。'));
      const apply=button('应用到当前草稿',()=>{
        if (JSON.stringify(payload)!==previewBase) {
          showPreview(index);
          notice('草稿在预览后有修改。请核对更新的差异，再应用预设。');
          return;
        }
        payload=next;
        change();
        clearPanel();
        notice('预设已应用到当前草稿，请核对后保存。');
      },'ssPrimary');
      apply.disabled=!changed;preview.append(apply);focusLater(changed?apply:heading);
    }
    for(const [index,preset] of CREATIVE_PRESETS.entries()) {
      choices.append(button(preset.name,()=>showPreview(index)));
    }
  }
  close.dataset.ssPanel='close';
  dialog.addEventListener('click',event=>{if(busy){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  dialog.addEventListener('beforeinput',event=>{if(busy)event.preventDefault();},{capture:true});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy){if(panelId==='close'&&resumePanel)showPanel(resumePanel);else if(panelId)clearPanel();else requestClose();}});
  dialog.addEventListener('close',()=>{dialogClosed=true;dialog.remove();if(opened===dialog)opened=undefined;window.removeEventListener('beforeunload',beforeUnload);focusLater(opener);},{once:true});
  window.addEventListener('beforeunload',beforeUnload);
  opened=dialog;document.body.append(dialog);dialog.showModal();
  await perform(async()=>{
    const [next,projectMeta]=await Promise.all([readScriptSetupState(),loadDoc<ProjectMeta>('project:meta')]);
    if(dialogClosed)return;
    meta=projectMeta;setState(next,true);renderOverview();notice(next.draft?'正在编辑保存过的草稿。':'保存设定仅更新当前项目。');
    focusLater(close);
  });
}
function genreSummary(data:ScriptSetupPayload){
  const {primary,secondary,fusionNote}=data.genre;
  return [primary,secondary].flatMap(g=>g?[g.subtype?`${g.label} / ${g.subtype.label}`:g.label]:[]).join(' ＋ ')+(fusionNote?` · ${fusionNote}`:'');
}
function settingSummary(data:ScriptSetupPayload){return [data.setting.mainEra,...data.setting.mechanisms.map(mechanism=>mechanism.label)].filter(Boolean).join(' · ');}
function summary(data:ScriptSetupPayload){return [genreSummary(data),data.hooks.map(h=>h.label).join(' → '),data.visualStyle.preset?.label,data.structure.episodeCount?`${data.structure.episodeCount} 集`:''].filter(Boolean).join(' · ')||'未设置字段';}

