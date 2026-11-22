import { writingWorkspace } from '../projects/projectIdentity';
import {openPublicPrompts} from '../skills/publicPrompts';
import {renderQuestions} from './questionPanel';
import {workflowLabels,type WorkflowKind,type WorkflowRequest} from './writingWorkflow';
import './writingPanel.css';
import { mountFloatingLauncher } from './floatingLauncher';
import { loadWritingSession, subscribeWriting, startWriting, stopWriting, newWritingSession, listWritingSessions, openWritingSession, writeAssistantMessage, saveQuestionAnswers } from './writingSession';
import { listTextModels, type TextModel } from './writingClient';
import { writingStyles, writingStarters } from './styles';
import { writingPage } from './pageContext';
import { listProposals, getProposal, applyProposal, rejectProposal, undoProposal, readDocument, type Proposal, type ScriptBlock } from './documentStore';
import { getActiveWritingEditor } from '../script/editor';
import { getActiveContentEditor } from './contentEditor';
import { projectStorageKey } from '../projects/projectIdentity';
import { listContentProposals, getContentProposal, applyContentProposal, rejectContentProposal, undoContentProposal, type ContentProposal } from './contentProposals';
import { listWorkspaceChanges, getWorkspaceChange, applyWorkspaceChange, undoWorkspaceChange, rejectWorkspaceChange } from './workspaceChanges';
import { refreshWorkspaceView } from './workspaceFeedback';
import { episodeIndex } from './structuredTools';
import { MAX_WRITING_ROUNDS } from './toolRun';
import { openProjectFiles } from './projectFilesPanel';
import { projectFileId } from './projectFiles';
import { openSelectionWriter } from './selectionPanel';
import { listSelectionRuns, readSelectionRun, selectionUses } from './selectionRun';
import { decideScriptSetupTaskChange } from '../scriptSetup/scriptSetupTasks';
import { mountSelectionToolbar } from './selectionToolbar';
import {skillSelect,openSkillLibrary} from '../skills/skillPanel';

type Session = Awaited<ReturnType<typeof loadWritingSession>>;

const mounts = new WeakMap<HTMLElement, () => void>();
const statusLabels = { idle: '就绪', running: '正在写作', error: '发生错误', interrupted: '已中断' };
const proposalLabels = { pending: '待审批', applied: '已应用', rejected: '已拒绝', undone: '已撤销' };
function productionHistoryOnly(record: Proposal | Pick<ContentProposal, 'target'> | {screen: string}) {
  return writingWorkspace && ('screen' in record && record.screen === '04-storyboard' ||
    'target' in record && record.target.kind === 'storyboard');
}
const blockLabels: Record<string, string> = { scene: '场次', action: '动作', character: '角色', parenthetical: '括号', dialogue: '对白', transition: '转场', comment: '注释', subtitle: '字幕' };

/** A body-level portal: never attach fixed UI to the scaled screenplay canvas. */
export function mountWritingPanel(root: HTMLElement, episodeId = 'ep_001', episodeTitle = '第一集'): () => void {
  mounts.get(root)?.();
  const doc = root.ownerDocument;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag); node.className = cls; node.textContent = text; return node;
  }
  function button(text: string, action: (event: MouseEvent) => void, cls = '') {
    const node = el('button', `wp-button ${cls}`, text); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function field(text: string, control: HTMLElement) {
    const label = el('label', 'wp-field'); label.append(el('span', '', text), control); return label;
  }
  function option(select: HTMLSelectElement, value: string, text: string) {
    const node = el('option', '', text); node.value = value; select.append(node);
  }
  let disposed = false, opened = false, loaded = false;
  let session: Session | null = null;
  let models: TextModel[] = [];
  let commandBusy = false, proposalBusy = false, modelBusy = false, stopping = false;
  let sessionVersion = 0, historyVersion = 0;
  let historySignature = '', sessionProposalSignature = '';
  let sessionsVersion = 0, sessionsSignature = '';
  let returnFocus: HTMLElement | null = null;
  const portal = el('div', 'writing-panel-portal');
  const panel = el('aside', 'wp-panel');
  panel.id = `writing-panel-${crypto.randomUUID()}`;
  panel.hidden = true; panel.setAttribute('aria-label', '写作 Agent');
  function cornerArrow(reverse = false) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('wp-corner-arrow'); if (reverse) svg.classList.add('wp-corner-arrow-reverse');
    const path = doc.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M14.229 5.743a30.2 30.2 0 0 0-7.797-.152.95.95 0 0 0-.569.272m-.12 8.366a30.2 30.2 0 0 1-.152-7.797.95.95 0 0 1 .272-.569m0 0 12.728 12.728');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path); return svg;
  }
  const launch = el('button', 'wp-button wp-launch');
  launch.append(cornerArrow(), el('span', 'wp-launch-label', '写作 Agent'));
  launch.setAttribute('role', 'button'); launch.tabIndex = 0;
  if (launch instanceof HTMLButtonElement) launch.type = 'button';
  launch.addEventListener('click', () => setOpen(!opened));
  launch.addEventListener('keydown', event => { if (!(launch instanceof HTMLButtonElement) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setOpen(!opened); } });
  launch.setAttribute('aria-label', '展开写作 Agent'); launch.setAttribute('title', '单击展开写作 Agent，按住可拖动位置');
  launch.setAttribute('aria-controls', panel.id); launch.setAttribute('aria-expanded', 'false');
  const heading = el('div', 'wp-heading');
  const title = el('h2', '', '新会话'); heading.append(title);
  const close = button('', () => setOpen(false), 'wp-close'); close.append(cornerArrow(true)); close.setAttribute('aria-label', '收起写作面板'); close.title = '收起写作面板';
  const header = el('header', 'wp-header');
  const context = el('div', 'wp-context', episodeTitle);
  const status = el('span', 'wp-status', '尚未加载'); status.setAttribute('role', 'status');
  const fresh = button('新会话', () => { void command(async () => { await newWritingSession(); setHistoryOpen(false); }); });
  const historyToggle = button('历史', () => setHistoryOpen(!!sessionsRow.hidden), 'wp-header-button');
  const headerActions = el('div', 'wp-header-actions'); headerActions.append(historyToggle, fresh, close);
  const dock=button('停靠',()=>{panel.classList.toggle('wp-docked');dock.textContent=panel.classList.contains('wp-docked')?'浮动':'停靠';});headerActions.prepend(dock);
  heading.append(status); header.append(heading, headerActions);
  const sessions = el('select'); sessions.setAttribute('aria-label', '写作会话历史');
  const openSession = button('打开会话', () => { void command(async () => { await openWritingSession(sessions.value); setHistoryOpen(false); }); });
  const sessionsRow = el('div', 'wp-sessions'); sessionsRow.append(field('会话历史（打开不会发送请求）', sessions), openSession);
  sessionsRow.id = `${panel.id}-sessions`; sessionsRow.hidden = true;
  historyToggle.setAttribute('aria-controls', sessionsRow.id); historyToggle.setAttribute('aria-expanded', 'false');
  function setHistoryOpen(value: boolean) {
    sessionsRow.hidden = !value; historyToggle.setAttribute('aria-expanded', String(value));
    if (value) { void refreshSessions(); sessions.focus(); }
  }
  sessions.addEventListener('change', updateControls);
  let dismissedSessionError = '', sessionErrorKey = '';
  function errorNotice(label: string, onDismiss = () => {}) {
    const box = el('div', 'wp-error'); box.hidden = true;
    const text = el('span', 'wp-error-text'); text.setAttribute('role', 'alert'); text.setAttribute('aria-atomic', 'true');
    const dismiss = () => { box.hidden = true; onDismiss(); prompt.focus({ preventScroll: true }); };
    const control = button('×', dismiss, 'wp-error-close'); control.setAttribute('aria-label', label); control.title = label;
    box.append(text, control);
    box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } });
    return { box, text };
  }
  const { box: error, text: errorText } = errorNotice('关闭错误提示');
  const { box: sessionError, text: sessionErrorText } = errorNotice('关闭会话错误提示', () => { dismissedSessionError = sessionErrorKey; });
  const scroll = el('div', 'wp-scroll');
  const intro = el('div', 'wp-intro'); intro.append(el('p', '', writingWorkspace ? '围绕当前稿件构思大纲、拆分场次或润色对白。写入后可以查看记录和撤销。' : '可以直接写正文、分章节、分场次、生成大纲和分镜、提取人物地点道具。保存后可查看记录和撤销。'));
  const starters = el('div', 'wp-starters');
  function fillDraft(text: string) {
    prompt.value = text;
    prompt.dispatchEvent(new Event('input'));
    prompt.focus();
  }
  if (writingWorkspace) {
    const review = button('交稿检查', () => {
      readOnly.checked = true;
      rememberMode();
      fillDraft('请只读审校本次资料范围内的稿件。按章节、场次检查段落格式、角色名与对白归属、时间地点与动作连续性。对每个问题给出原文短引、定位和最小修改建议。注明实际读过的范围和仍待核对的内容。');
    }, 'wp-starter');
    review.title = '切换为只读分析，填入审校要求后可编辑并发送';
    starters.append(review);
  }
  for (const starter of writingStarters) starters.append(button(starter, () => fillDraft(starter), 'wp-starter'));
  intro.append(starters);
  const messages = el('div', 'wp-messages'); messages.setAttribute('aria-label', '写作会话消息');
  const history = el('details', 'wp-history');
  const historySummary = el('summary', '', '写入与提案记录 · 当前集');
  const historyContent = el('div', 'wp-history-content');
  const historyRefresh = button('刷新提案', () => { void refreshHistory(); });
  history.append(historySummary, el('p', 'wp-muted', writingWorkspace
    ? '历史独立于会话保留。可在这里批准或撤销写作提案，分镜记录可在制作工作区处理。'
    : '历史独立于会话保留。批准或撤销会写入提案标明的剧本、大纲、分镜或资产；拒绝仅更新提案状态。'), historyRefresh, historyContent);
  scroll.append(intro, messages, history);
  const conversation = el('div', 'wp-conversation');
  const bottom = button('↓ 返回底部', () => { scroll.scrollTop = scroll.scrollHeight; updateBottomButton(); }, 'wp-bottom');
  bottom.hidden = true; conversation.append(scroll, bottom);
  function nearBottom() { return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90; }
  function updateBottomButton() { bottom.hidden = nearBottom(); }
  scroll.addEventListener('scroll', updateBottomButton, { passive: true });
  const form = el('form', 'wp-composer');
  const model = el('select'); model.setAttribute('aria-label', '文本模型'); option(model, '', '请选择已配置的文本模型');
  const refreshModelsButton = button('刷新模型', () => { void refreshModels(); });
  const modelRow = el('div', 'wp-model-row'); modelRow.append(field('模型', model), refreshModelsButton);
  const modelHint = el('p', 'wp-muted', '读取 Lum 中已配置的文本模型。');
  const style = el('select'); for (const item of writingStyles) option(style, item.id, item.label);
  style.value=localStorage.getItem('writing:preferredStyle')||'unchanged';if(!style.value)style.value='unchanged';style.addEventListener('change',()=>localStorage.setItem('writing:preferredStyle',style.value));
  const scope = el('select'); option(scope, 'selection', '拉选文字'); option(scope, 'scene', '当前场次'); option(scope, 'episode', `整集 · ${episodeTitle}`); scope.value = 'episode';
  const settings = el('div', 'wp-settings'); settings.append(field('写作风格', style), field('资料范围', scope));
  let agentSkill:HTMLSelectElement|undefined;
  const agentSkillReady = skillSelect('agent');
  void agentSkillReady.then(select => {
    if(disposed) return;
    agentSkill = select;
    select.addEventListener('input', updateControls);
    settings.append(field('创作技能',select),button('管理 Skill',()=>void openSkillLibrary().catch(showError)));
    updateControls();
  }).catch(showError);
  const useAdvisor=(event:Event)=>{
    const id=(event as CustomEvent<string>).detail;
    void agentSkillReady.then(async select=>{
      if(disposed)return;
      await select.chooseSkill(id);
      if(!disposed)setOpen(true);
    }).catch(showError);
  };
  window.addEventListener('dsh:skill-advisor',useAdvisor);
  style.setAttribute('aria-label','写作风格');scope.setAttribute('aria-label','资料范围');
  const modeKey = projectStorageKey('writing:mode');
  const readOnly = el('input'); readOnly.type = 'checkbox'; readOnly.checked = localStorage.getItem(modeKey) === 'read';
  const readOnlyLabel = el('label', 'wp-readonly'); readOnlyLabel.append(readOnly, el('span', '', '只读分析（不写入）'));
  const autoWrite = el('input'); autoWrite.type = 'checkbox'; autoWrite.checked = localStorage.getItem(modeKey) !== 'review';
  const autoWriteLabel = el('label', 'wp-readonly'); autoWriteLabel.append(autoWrite, el('span', '', '直接写入（关闭后先生成待审批提案）'));
  const prompt = el('textarea'); prompt.rows = 3; prompt.maxLength = 12000; prompt.placeholder = '输入问题，讨论剧情、人物或当前页面的内容…'; prompt.setAttribute('aria-label', '写作请求');
  const draftKey=projectStorageKey(`writing:draft:${episodeId}`);prompt.value=localStorage.getItem(draftKey)||'';prompt.addEventListener('input',()=>localStorage.setItem(draftKey,prompt.value));
  const attachmentKey=projectStorageKey(`writing:attachments:${episodeId}`);let attachedFiles:{id:string;name:string}[]=[];let clearedAttachmentMessage='';
  try{const saved:unknown=JSON.parse(localStorage.getItem(attachmentKey)??'[]');if(Array.isArray(saved))attachedFiles=saved.filter(file=>{try{return projectFileId(file.id)&&typeof file.name==='string'&&file.name.length<=200;}catch{return false;}}).slice(0,10);}catch{/* Invalid drafts do not grant access to files. */}
  const attachmentList=el('div','wp-actions');attachmentList.setAttribute('aria-label','本次附带的资料');
  const renderAttachments=()=>{attachmentList.replaceChildren();for(const file of attachedFiles){const chip=button(`📎 ${file.name} ×`,()=>{attachedFiles=attachedFiles.filter(f=>f.id!==file.id);saveAttachments();});chip.dataset.attachedFile=file.id;chip.setAttribute('aria-label',`移除附件 ${file.name}`);attachmentList.append(chip);}attachmentList.hidden=!attachedFiles.length;};
  const saveAttachments=()=>{localStorage.setItem(attachmentKey,JSON.stringify(attachedFiles));renderAttachments();};renderAttachments();
  const attach=button('附带文件',()=>{void openProjectFiles(file=>{if(!attachedFiles.some(f=>f.id===file.id)){if(attachedFiles.length>=10)throw Error('一次最多附带10份资料');attachedFiles.push({id:file.id,name:file.name});}saveAttachments();}).catch(showError);});
  const disclosure = el('p', 'wp-disclosure', `发送即同意：请求及相关剧本、设定将传给所选供应商；一轮 Agent 最多调用模型${MAX_WRITING_ROUNDS}次，可能产生费用。不会自动重试失败请求。`);
  disclosure.id = `${panel.id}-disclosure`;
  const send = el('button', 'wp-button wp-primary', '同意并发送'); send.type = 'submit'; send.setAttribute('aria-describedby', disclosure.id);
  const stop = button('停止', () => { void stopCurrent(); });
  const actions = el('div', 'wp-actions'); actions.append(button('写作提示库',()=>void openPublicPrompts(fillDraft).catch(showError)),attach,el('span', 'wp-muted', 'Enter 发送'), stop, send);
  const preferences = el('details', 'wp-preferences');
  const preferencesSummary = el('summary', '', '设置 · 未选择模型');
  const configureModels = button('打开模型设置',()=>window.dispatchEvent(new CustomEvent('dsh:settings')));
  const preferencesBody = el('div', 'wp-preferences-body'); preferencesBody.append(context, modelRow, modelHint, configureModels, settings, readOnlyLabel, autoWriteLabel);
  preferences.append(preferencesSummary, preferencesBody);
  const mode = button('直接写入', () => { readOnly.checked = !readOnly.checked; rememberMode(); }, 'wp-mode');
  mode.setAttribute('aria-label', '切换只读或写入模式');
  const composerMeta = el('div', 'wp-composer-meta'); composerMeta.append(preferences, mode);
  const sendHint=el('p','wp-muted');sendHint.setAttribute('role','status');
  const workflowBox=el('section','wp-workflows');workflowBox.setAttribute('aria-label','创作与后处理');
  const workflowRange=el('select');workflowRange.setAttribute('aria-label','一键任务范围');option(workflowRange,'project','全部已写章节');option(workflowRange,'episode','当前章节');
  const workflowRangeKey=projectStorageKey('writing:workflowRange');workflowRange.value=localStorage.getItem(workflowRangeKey)==='episode'?'episode':'project';workflowRange.addEventListener('change',()=>localStorage.setItem(workflowRangeKey,workflowRange.value));
  const workflowScene=el('select');workflowScene.setAttribute('aria-label','正文分镜场次');option(workflowScene,'','跟随后处理范围 · 逐场分镜');
  let sceneVersion=0;
  async function refreshWorkflowScenes(){
    if (writingWorkspace) return;
    const version=++sceneVersion;
    try{
      const document=await readDocument(episodeId);
      if(disposed||version!==sceneVersion)return;
      const previous=workflowScene.value;workflowScene.replaceChildren();option(workflowScene,'','跟随后处理范围 · 逐场分镜');
      document.blocks.filter(block=>block.type==='scene').forEach((scene,index)=>option(workflowScene,scene.id,`${index+1} · ${scene.text}`));
      if([...workflowScene.options].some(item=>item.value===previous))workflowScene.value=previous;
    }catch(reason){if(!disposed)showError(reason);}
  }
  workflowScene.onchange=()=>{if(workflowScene.value){workflowRange.value='episode';localStorage.setItem(workflowRangeKey,'episode');}};
  workflowRange.addEventListener('change',()=>{if(workflowRange.value==='project')workflowScene.value='';});
  const scenesUpdated=()=>{if(opened)void refreshWorkflowScenes();};window.addEventListener('dsh:content-updated',scenesUpdated);
  const quickHistoryUpdated = () => { if (opened) void refreshHistory(); };
  window.addEventListener('dsh:selection-writing-updated', quickHistoryUpdated);
  const workflowActions=el('div','wp-workflow-actions');
  const workflowButtons=(Object.entries(workflowLabels) as [WorkflowKind,string][]).filter(([kind])=>!writingWorkspace||kind!=='storyboard').map(([kind,label])=>{const b=button(label,()=>void runWorkflow({kind,range:kind==='draft'?'project':workflowRange.value as 'project'|'episode',...(kind==='storyboard'&&workflowScene.value?{range:'episode',sceneBlockId:workflowScene.value}:{})}));workflowActions.append(b);return {kind,button:b};});
  const workflowStatus=el('p','wp-muted');workflowStatus.setAttribute('role','status');
  const resumeWorkflow=button('继续本任务',()=>{const task=session?.workflow;const previous=session?.messages.findLast(m=>m.role==='user');if(task&&previous&&task.state)void runWorkflow({kind:task.kind,range:task.range,rootEpisodeId:task.rootEpisodeId,resumeId:task.state.id,sceneBlockId:task.state.sceneBlockId},previous.text);});resumeWorkflow.hidden=true;
  workflowBox.append(field('后处理范围',workflowRange),...(!writingWorkspace?[field('正文分镜场次（仅一键分镜）',workflowScene)]:[]),workflowActions,workflowStatus,resumeWorkflow);
  form.append(composerMeta, attachmentList, prompt, sendHint, workflowBox, disclosure, actions);
  panel.append(header, sessionsRow, error, sessionError, conversation, form); portal.append(launch, panel); doc.body.append(portal);
  const disposeLauncher = mountFloatingLauncher(launch);
  // Resize can come from expanded settings, tool details, or the textarea, not only tokens.
  const resize = new ResizeObserver(updateBottomButton); resize.observe(scroll); resize.observe(messages); resize.observe(history);

  function showError(reason: unknown) {
    if (disposed) return;
    errorText.textContent = reason instanceof Error ? reason.message : String(reason); error.hidden = false;
  }
  function updateControls() {
    const running = session?.status === 'running';
    const chosen = model.value === '' ? undefined : models[Number(model.value)];
    preferencesSummary.textContent = chosen ? `设置 · ${chosen.label || chosen.modelId}` : '设置 · 请选择模型';
    if (writingWorkspace && agentSkill?.value) preferencesSummary.textContent += ' · ' + agentSkill.selectedOptions[0].text.split(' · ').slice(0,-1).join(' · ');
    preferencesSummary.title = preferencesSummary.textContent;
    mode.textContent = readOnly.checked ? '只读分析' : autoWrite.checked ? '直接写入 · 可撤销' : '提案模式 · 需审批';
    mode.dataset.readonly = String(readOnly.checked);
    mode.disabled = readOnly.disabled = !!running || commandBusy || proposalBusy || writingPage().id === 'chapter-draft';
    autoWrite.disabled = readOnly.disabled || readOnly.checked;
    send.disabled = !session || !agentSkill || running || commandBusy || proposalBusy || modelBusy || !prompt.value.trim() || !models[Number(model.value)] || model.value === '';
    const taskBusy=!session||!agentSkill||!!running||commandBusy||proposalBusy||modelBusy||!chosen||readOnly.checked||writingPage().id==='chapter-draft';
    for(const item of workflowButtons){item.button.disabled=taskBusy||item.kind==='draft'&&!prompt.value.trim();item.button.title=readOnly.checked?'请先切换为写入模式':item.kind==='draft'?'输入故事素材和要求，生成大纲、章节与正文':'读取所选章节正文并实际写入；已有内容会保留';}
    workflowRange.disabled=workflowScene.disabled=!!running||commandBusy;
    const task=session?.workflow;workflowStatus.textContent=task?`${task.label} · ${task.summary}${task.complete?' · 核验完成':''}`:'粘贴正文后，可选择范围并点击“根据正文自动整理”。';
    resumeWorkflow.hidden=!task||task.complete||(writingWorkspace&&task.kind==='storyboard');
    const lastRequest=session?.messages.findLastIndex(m=>m.role==='user')??0;
    const pendingTask=session?.messages.slice(lastRequest).some(m=>{const id=m.proposalId??m.contentProposalId??m.workspaceChangeId;return id&&(receiptStates.get(id)?.status??(m.applied?'applied':'pending'))==='pending';});
    resumeWorkflow.disabled=taskBusy||!!pendingTask;resumeWorkflow.title=pendingTask?'请先审批或拒绝本次待处理提案':'继续未完成部分。沿用本任务已保存的 Skill；旧记录缺失时会先请你确认。';
    sendHint.textContent = modelBusy ? '正在连接文本模型…' : !chosen ? '请在上方设置中选择文本模型后发送。' : !session ? '正在加载写作会话…' : '';
    sendHint.hidden=!sendHint.textContent;
    stop.disabled = !running || stopping;
    fresh.disabled = !session || running || commandBusy || proposalBusy;
    sessions.disabled = fresh.disabled;
    openSession.disabled = fresh.disabled || !sessions.value || sessions.value === session?.id;
    refreshModelsButton.disabled = modelBusy || running;
    model.disabled = modelBusy || running || commandBusy;
    historyContent.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = proposalBusy || !!running || commandBusy; });
    messages.querySelectorAll<HTMLButtonElement>('.wp-write-action').forEach(b => { b.disabled = proposalBusy || !!running || commandBusy; });
  }
  async function command(action: () => Promise<void>) {
    if (commandBusy || disposed) return;
    commandBusy = true; error.hidden = true; updateControls();
    try { await action(); } catch (reason) { showError(reason); }
    finally { commandBusy = false; if (!disposed) updateControls(); }
  }
  async function runWorkflow(task:WorkflowRequest, previousPrompt?:string) {
    const chosen=model.value===''?undefined:models[Number(model.value)];if(!chosen||readOnly.checked)return;
    const entered=prompt.value.trim();
    const text=previousPrompt?previousPrompt+(entered?'\n本次补充：'+entered:''):(task.kind==='draft'?entered:`请对${task.sceneBlockId?`当前章节所选场次（sceneBlockId=${task.sceneBlockId}）`:task.range==='project'?'全部已写章节':'当前章节'}执行${workflowLabels[task.kind]}，${task.kind==='storyboard'?'按场次生成并保存镜头，核验所选范围':'实际保存并逐章核验'}。${entered?'\n补充要求：'+entered:''}`);
    if(!text){showError('请先输入故事素材和写作要求');return;}
    await command(async()=>{
      await startWriting({prompt:text,workflow:task,fileIds:attachedFiles.map(f=>f.id),skillId:agentSkill?.value||undefined,providerId:chosen.providerId,modelId:chosen.modelId,styleId:style.value,scope:'episode',readOnly:readOnly.checked,autoWrite:autoWrite.checked});
      if(!disposed&&prompt.value.trim()===entered){prompt.value='';localStorage.removeItem(draftKey);}
    });
  }
  async function stopCurrent() {
    if (stopping || disposed || session?.status !== 'running') return;
    stopping = true; error.hidden = true; updateControls();
    try { await stopWriting(); } catch (reason) { showError(reason); }
    finally { stopping = false; if (!disposed) updateControls(); }
  }
  async function refreshModels() {
    if (modelBusy || disposed) return;
    modelBusy = true; modelHint.textContent = '正在读取实际配置的文本模型…'; updateControls();
    const previous = models[Number(model.value)]; const hadSelection = model.value !== '';
    try {
      const result = await listTextModels(); if (disposed) return;
      models = result.filter(item => item.providerId && item.modelId);
      model.replaceChildren(); option(model, '', models.length ? '请选择已配置的文本模型' : '暂无可用文本模型');
      models.forEach((item, i) => option(model, String(i), `${item.providerLabel} · ${item.label || item.modelId}`));
      const remembered=localStorage.getItem('writing:preferredModel');
      const globalDefault=models.findIndex(item=>item.isDefault);
      const selected = globalDefault>=0?globalDefault:hadSelection ? models.findIndex(item => item.providerId === previous?.providerId && item.modelId === previous.modelId) : models.findIndex(item=>JSON.stringify([item.providerId,item.modelId])===remembered);
      model.value = selected >= 0 ? String(selected) : models.length===1 ? '0' : '';
      if(model.value!==''){const chosen=models[Number(model.value)];localStorage.setItem('writing:preferredModel',JSON.stringify([chosen.providerId,chosen.modelId]));}else preferences.open=true;
      modelHint.textContent = models.length ? '使用你配置的供应商与模型；不会自动发送。' : '请在 Lum 的模型配置中添加文本模型及供应商密钥，再点击“刷新模型”。';
    } catch (reason) { if (!disposed) {modelHint.textContent = '模型列表读取失败；请检查 Lum 服务与文本模型配置，再刷新。';preferences.open=true;} showError(reason); }
    finally { modelBusy = false; if (!disposed) updateControls(); }
  }
  async function refreshSessions() {
    const version = ++sessionsVersion;
    const currentId = session?.id;
    const selected = sessions.value;
    try {
      const items = await listWritingSessions();
      if (disposed || version !== sessionsVersion || currentId !== session?.id) return;
      sessions.replaceChildren();
      for (const item of items) option(sessions, item.id, `${item.id === session?.id ? '当前 · ' : ''}${item.title} · ${item.messageCount}条${item.time ? ` · ${new Date(item.time).toLocaleString()}` : ''}`);
      sessions.value = items.some(item => item.id === selected) ? selected : session?.id || '';
      updateControls();
    } catch (reason) { if (version === sessionsVersion) showError(reason); }
  }
  const messageNodes = new Map<string, { node: HTMLElement; text: HTMLElement; question: HTMLElement; proposal: HTMLButtonElement; view: HTMLButtonElement; undo: HTMLButtonElement; insert: HTMLButtonElement; summary?: HTMLElement }>();
  const receiptStates = new Map<string, {status: Proposal['status']; readOnly: boolean}>();
  function updateReceiptStates() {
    for (const message of session?.messages ?? []) {
      const receipt = receiptStates.get(message.proposalId || message.contentProposalId || message.workspaceChangeId || '');
      const entry = messageNodes.get(message.id);
      if (!entry || !receipt) continue;
      const state = receipt.status;
      entry.view.hidden = state !== 'applied' || !message.proposalId;
      entry.undo.hidden = state !== 'applied' || receipt.readOnly;
      if (entry.summary) entry.summary.textContent = state === 'applied' ? `✓ ${message.workspaceChangeId?message.text:message.proposalId ? '已写入剧本正文' : '已写入页面内容'}` : state === 'undone' ? '已撤销本次写入' : state === 'pending' ? '待审批 · 尚未写入' : '已拒绝修改';
    }
  }
  async function revealScript(messageId: string) {
    const message = session?.messages.find(item => item.id === messageId);
    if (!message?.proposalId) return;
    try {
      const saved = await getProposal(message.episodeId??episodeId, message.proposalId);
      if (saved.status !== 'applied') throw Error('此项写入已撤销或尚未应用，请查看记录');
      const before = new Map(saved.before.map(b => [b.id, b.text]));
      window.dispatchEvent(new CustomEvent('dsh:reveal-script', { detail: { episodeId:saved.episodeId, blockIds: saved.after.filter(b => before.get(b.id) !== b.text).map(b => b.id) } }));
    } catch (reason) { showError(reason); }
  }
  function previewReply(messageId: string) {
    const message = session?.messages.find(item => item.id === messageId);
    if (!message || commandBusy || session?.status === 'running') return;
    const dialog = el('dialog', 'localDialog'); dialog.setAttribute('aria-label', '将回复写入剧本');
    const body = el('div', 'localDialogBody');
    const text = el('textarea'); text.value = message.text; text.rows = 15; text.style.cssText = 'width:100%;min-height:280px;white-space:pre-wrap'; text.setAttribute('aria-label', '待写入剧本内容');
    const feedback = el('p', 'localStatus'); feedback.setAttribute('role', 'status');
    const cancel = button('取消', () => dialog.close());
    const save = button('追加到本集正文', () => {
      save.disabled = true; cancel.disabled = true; text.disabled = true;
      feedback.textContent = '正在保存…';
      void command(async () => {
        try { await writeAssistantMessage(messageId, text.value); dialog.close(); await refreshHistory(); }
        catch (reason) { feedback.textContent = reason instanceof Error ? reason.message : String(reason); }
        finally { save.disabled = false; cancel.disabled = false; text.disabled = false; }
      });
    }, 'wp-primary');
    body.append(el('h2', '', '将回复写入剧本'), el('p', '', `追加到「${episodeTitle}」的剧本正文末尾。可先删去解释文字；原有正文会保留。`), text, feedback, save, cancel);
    dialog.append(body); doc.body.append(dialog);
    dialog.addEventListener('cancel', event => { if (save.disabled) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal(); text.focus();
  }
  function renderSession(next: Session) {
    if (disposed) return;
    // Measure before changing any DOM: streaming must not pull readers away from history.
    const changedSession = session?.id !== next.id;
    const follow = changedSession || nearBottom();
    if (changedSession) { sessions.value = next.id; messages.replaceChildren(); messageNodes.clear(); }
    session = next; const batch=next.progress?.toolBatch;
    status.textContent = next.status==='running'&&next.progress?`${statusLabels[next.status]} · ${next.progress.round}/${next.progress.maxRounds} 轮 · 已保存 ${next.progress.writes} 项${batch&&batch.total>8?` · 本轮 ${batch.completed}/${batch.total} 项（第 ${batch.index}/${batch.count} 批）`:''}`:statusLabels[next.status]; status.dataset.status = next.status;
    const activeRequest = next.messages.findLast(message => message.role === 'user');
    if (next.status === 'running' && activeRequest && prompt.value.trim() === activeRequest.text) { prompt.value = ''; localStorage.removeItem(draftKey); }
    if(next.status==='running'&&activeRequest&&activeRequest.id!==clearedAttachmentMessage){clearedAttachmentMessage=activeRequest.id;const sent=new Set(activeRequest.attachments?.map(f=>f.id));attachedFiles=attachedFiles.filter(f=>!sent.has(f.id));saveAttachments();}
    const firstRequest = next.messages.find(message => message.role === 'user' && message.text.trim())?.text.replace(/\s+/g, ' ').trim();
    title.textContent = firstRequest ? `${firstRequest.slice(0, 24)}${firstRequest.length > 24 ? '…' : ''}` : '新会话';
    title.title = firstRequest || '新会话';
    const listSignature = `${next.id}:${next.status}:${next.messages.length}`;
    if (listSignature !== sessionsSignature) { sessionsSignature = listSignature; void refreshSessions(); }
    sessionErrorKey = next.error ? `${next.id}:${activeRequest?.id ?? ''}:${next.error}` : '';
    if (changedSession || !next.error) dismissedSessionError = '';
    sessionErrorText.textContent = next.error || ''; sessionError.hidden = !next.error || sessionErrorKey === dismissedSessionError;
    intro.hidden = next.messages.length > 0;
    const ids = new Set(next.messages.map(message => message.id));
    for (const [id, entry] of messageNodes) if (!ids.has(id)) { entry.node.remove(); messageNodes.delete(id); }
    for (const message of next.messages) {
      let entry = messageNodes.get(message.id);
      if (!entry) {
        const node = el('article', `wp-message wp-message-${message.role}`);
        const text = el('div', 'wp-message-text'); const question = el('div', 'wp-question');
        const proposal = button('查看写入记录', () => {
          history.open = true;
          void refreshHistory().then(() => {
            if (disposed) return;
            const current = session?.messages.find(item => item.id === message.id);
            const key = current?.workspaceChangeId ? `workspace:${current.workspaceChangeId}` : current?.contentProposalId ? `content:${current.contentProposalId}` : current?.proposalId ? `script:${current.proposalId}` : '';
            const card = Array.from(historyContent.querySelectorAll<HTMLDetailsElement>('.wp-proposal')).find(item => item.dataset.proposalId === key);
            if (card) { card.open = true; card.scrollIntoView({ block: 'nearest' }); }
            else history.scrollIntoView({ block: 'nearest' });
          });
        });
        const view = button('查看剧本正文', () => { void revealScript(message.id); }, 'wp-write-action');
        const undo = button('撤销本次写入', event => {
          const current = session?.messages.find(item => item.id === message.id);
          const id = current?.proposalId || current?.contentProposalId || current?.workspaceChangeId;
          if (id) void actOnProposal(id, 'undo', current?.workspaceChangeId ? 'workspace' : current?.contentProposalId ? 'content' : 'script', event, current?.episodeId);
        }, 'wp-write-action');
        const insert = button('写入剧本正文', () => previewReply(message.id), 'wp-write-action');
        let summary: HTMLElement | undefined;
        if (message.role === 'tool') {
          const details = el('details', 'wp-tool-details'); summary = el('summary');
          details.append(summary, text); node.append(details, question, proposal);
        } else node.append(el('div', 'wp-message-role', message.role === 'user' ? '你' : '写作 Agent'), text, question, proposal);
        if (message.role === 'user' && message.writingSource) {
          const { skill, skillId } = message.writingSource;
          if (skill) {
            const detail = el('details', 'wp-tool-details');
            const heading = el('summary', '', '本轮 Skill · ' + skill.name);
            detail.append(heading);
            detail.addEventListener('toggle', () => {
              if (detail.open && detail.childElementCount === 1) detail.append(el('pre', 'wp-message-text', skill.instruction));
            });
            node.append(detail);
          } else {
            const label = skill === null ? '本轮未使用 Skill' : skillId ? '历史 Skill · ' + skillId + '（未保存当时指令）' : '旧记录未保存 Skill 来源';
            node.append(el('p', 'wp-muted', label));
          }
        }
        node.append(view, undo, insert);
        entry = { node, text, question, proposal, view, undo, insert, summary }; messageNodes.set(message.id, entry); messages.append(node);
      }
      const displayText = message.role === 'tool' && message.toolResult ? `${message.text}\n\n${message.toolResult}` : message.text+(message.attachments?.length?'\n\n📎 '+message.attachments.map(f=>f.name).join('、'):'');
      if (entry.text.textContent !== displayText) entry.text.textContent = displayText;
      // Display only runtime-emitted records; never infer tool execution from assistant prose.
      if (entry.summary) {
        const brief = message.text.replace(/\s+/g, ' ').trim();
        const state = message.toolStatus === 'running' ? '执行中' : message.toolStatus === 'error' ? '执行失败' : message.toolStatus === 'done' ? '已完成' : '工具记录';
        entry.summary.textContent = message.applied ? `✓ ${message.workspaceChangeId?message.text:message.proposalId ? '已写入剧本正文' : '已写入页面内容'}` : `${state} · ${message.toolName || brief.slice(0, 52)}${!message.toolName && brief.length > 52 ? '…' : ''}`;
      }
      renderQuestions(entry.question,message,next.status==='running',answers=>saveQuestionAnswers(message.id,answers),text=>{prompt.value=text;localStorage.setItem(draftKey,text);prompt.focus();updateControls();});
      entry.proposal.hidden = !message.proposalId && !message.contentProposalId && !message.workspaceChangeId;
      entry.view.hidden = !message.applied || !message.proposalId;
      // A historic receipt may predate workspace separation. Resolve its actual target before exposing undo.
      entry.undo.hidden = !message.applied || (writingWorkspace && !message.proposalId);
      const start = next.messages.indexOf(message);
      const turnStart = next.messages.slice(0, start).findLastIndex(item => item.role === 'user');
      const tail = next.messages.slice(turnStart + 1);
      const nextUser = tail.findIndex(item => item.role === 'user');
      const turnHasWrite = tail.slice(0, nextUser < 0 ? undefined : nextUser).some(item => item.proposalId || item.contentProposalId || item.workspaceChangeId);
      entry.insert.hidden = message.role !== 'assistant' || !message.text.trim() || !!message.proposalId || turnHasWrite || writingPage().id === 'chapter-draft';
    }
    // The composer and its textarea are deliberately never replaced during streaming.
    updateReceiptStates(); updateControls(); if (follow) scroll.scrollTop = scroll.scrollHeight; updateBottomButton();
    const signature = `${next.id}:${next.status}:${next.messages.map(m => `${m.proposalId || ''}:${m.contentProposalId || ''}:${m.workspaceChangeId || ''}`).join('|')}`;
    if (signature !== sessionProposalSignature) { sessionProposalSignature = signature; void refreshHistory(); }
  }
  function diffBlock(block: ScriptBlock | undefined, position: number, side: 'before' | 'after') {
    const box = el('div', `wp-diff-side wp-diff-${side}`);
    box.append(el('div', 'wp-diff-label', `${side === 'before' ? '修改前' : '修改后'}${block ? ` · 第 ${position + 1} 块 · ${blockLabels[block.type] || block.type}` : ' · 无此块'}`));
    box.append(el('pre', '', block?.text ?? '（空）')); return box;
  }
  function proposalCard(proposal: Proposal) {
    const card = el('details', 'wp-proposal'); card.dataset.proposalId = `script:${proposal.id}`;
    card.append(el('summary', '', `${proposalLabels[proposal.status]} · ${new Date(proposal.createdAt).toLocaleString()} · 基准 r${proposal.baseRevision}`));
    card.append(el('p', 'wp-muted', `提案 ${proposal.id} · 章节 ${proposal.episodeId}`));
    const before = new Map(proposal.before.map((block, index) => [block.id, { block, index }]));
    const after = new Map(proposal.after.map((block, index) => [block.id, { block, index }]));
    const ids = [...proposal.after.map(block => block.id), ...proposal.before.filter(block => !after.has(block.id)).map(block => block.id)];
    let changes = 0;
    for (const id of ids) {
      const a = before.get(id), b = after.get(id);
      if (a && b && a.block.text === b.block.text && a.block.type === b.block.type && a.index === b.index) continue;
      changes++;
      const row = el('div', 'wp-diff');
      row.append(el('div', 'wp-diff-kind', !a ? '新增块' : !b ? '删除块' : a.index !== b.index ? '内容 / 位置变化' : '修改块'), diffBlock(a?.block, a?.index ?? 0, 'before'), diffBlock(b?.block, b?.index ?? 0, 'after'));
      card.append(row);
    }
    if (!changes) card.append(el('p', 'wp-muted', '此提案没有正文差异。'));
    const buttons = el('div', 'wp-proposal-actions');
    if (proposal.status === 'pending') buttons.append(button('批准并写入当前集', event => { void actOnProposal(proposal.id, 'apply', 'script', event,proposal.episodeId); }, 'wp-primary'), button('拒绝', event => { void actOnProposal(proposal.id, 'reject', 'script', event,proposal.episodeId); }));
    if (proposal.status === 'applied') buttons.append(button('撤销此提案', event => { void actOnProposal(proposal.id, 'undo', 'script', event,proposal.episodeId); }));
    card.append(buttons); return card;
  }
  function contentProposalCard(proposal: ContentProposal) {
    const targetLabel = { outline: '大纲', storyboard: '分镜', entity: '资产' }[proposal.target.kind];
    const card = el('details', 'wp-proposal'); card.dataset.proposalId = `content:${proposal.id}`;
    card.append(el('summary', '', `${proposalLabels[proposal.status]} · ${targetLabel} · ${new Date(proposal.createdAt).toLocaleString()}`));
    card.append(el('p', 'wp-muted', `目标 ${proposal.target.id} · 提案 ${proposal.id} · 当前集 ${episodeId}`));
    const labels: Record<string, string> = { title: '标题', html: '正文（纯文本预览）', name: '名称', meta: '标签', desc: '描述', type: '景别', angle: '角度', movement: '运镜', lens: '镜头' };
    const fields = new Set([...Object.keys(proposal.before), ...Object.keys(proposal.after)]);
    let changes = 0;
    for (const key of fields) {
      const before = proposal.before[key], after = proposal.after[key];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changes++;
      const text = (value: unknown) => {
        if (proposal.target.kind === 'outline' && key === 'html' && typeof value === 'string') {
          const parsed = new DOMParser().parseFromString(value, 'text/html');
          parsed.querySelectorAll('script,style,noscript,template').forEach(node => node.remove());
          return parsed.body.textContent || '（空）';
        }
        return value === undefined ? '（无此字段）' : typeof value === 'string' ? value || '（空）' : JSON.stringify(value);
      };
      const row = el('div', 'wp-diff'); row.append(el('div', 'wp-diff-kind', labels[key] || key));
      for (const side of ['before', 'after'] as const) {
        const box = el('div', `wp-diff-side wp-diff-${side}`);
        box.append(el('div', 'wp-diff-label', side === 'before' ? '修改前' : '修改后'), el('pre', '', text(side === 'before' ? before : after)));
        row.append(box);
      }
      card.append(row);
    }
    if (!changes) card.append(el('p', 'wp-muted', '此提案没有内容差异。'));
    if (productionHistoryOnly(proposal)) {
      card.append(el('p', 'wp-muted', '此分镜记录可在项目的制作工作区处理。'));
      return card;
    }
    const buttons = el('div', 'wp-proposal-actions');
    if (proposal.status === 'pending') buttons.append(button(`批准并写入${targetLabel}`, event => { void actOnProposal(proposal.id, 'apply', 'content', event); }, 'wp-primary'), button('拒绝', event => { void actOnProposal(proposal.id, 'reject', 'content', event); }));
    if (proposal.status === 'applied') buttons.append(button('撤销此提案', event => { void actOnProposal(proposal.id, 'undo', 'content', event); }));
    card.append(buttons); return card;
  }
  function workspaceCard(change:Awaited<ReturnType<typeof listWorkspaceChanges>>[number]) {
    const card=el('details','wp-proposal');card.dataset.proposalId=`workspace:${change.id}`;
    card.append(el('summary','',`${proposalLabels[change.status]} · ${change.label} · ${new Date(change.createdAt).toLocaleString()}`));
    card.append(el('p','wp-muted','操作为一个整体。撤销时保留之后的修改；存在冲突会停止撤销。'));
    const preview=el('div');
    card.append(preview);
    let previewVersion=0;
    card.addEventListener('toggle',async()=>{
      const version=++previewVersion;
      if(!card.open){preview.replaceChildren();return;}
      preview.textContent='正在读取记录…';
      try {
        const full=await getWorkspaceChange(change.id);
        if(!card.isConnected||!card.open||version!==previewVersion)return;
        const format=(value:unknown)=>JSON.stringify(value,(_key,part:unknown)=>{
          if(typeof part!=='string')return part;
          if(/^data:/i.test(part))return '（内嵌素材，预览已省略）';
          return part.length>12000?part.slice(0,12000)+'…':part;
        },2).slice(0,60000);
        const sections=document.createDocumentFragment();
        for(const script of full.scripts){
          const detail=el('details');
          detail.append(el('summary','',`章节 ${script.episodeId} · ${script.before?.blocks.length??0} → ${script.after.length} 段`),el('pre','',format({修改前:script.before?.blocks??[],修改后:script.after})));
          sections.append(detail);
        }
        for(const item of [...full.docs,...full.entities]){
          const detail=el('details');
          detail.append(el('summary','',item.key),el('pre','',format({修改前:item.before,修改后:item.after})));
          sections.append(detail);
        }
        preview.replaceChildren(sections);
      }catch(error){
        if(card.open&&version===previewVersion)preview.textContent=error instanceof Error?error.message:'无法读取记录';
      }
    });
    if (productionHistoryOnly(change)) {
      card.append(el('p', 'wp-muted', '此分镜记录可在项目的制作工作区处理。'));
      return card;
    }
    const actions=el('div','wp-proposal-actions');
    if(change.status==='pending')actions.append(button('批准并写入',event=>{void actOnProposal(change.id,'apply','workspace',event);},'wp-primary'),button('拒绝',event=>{void actOnProposal(change.id,'reject','workspace',event);}));
    if(change.status==='applied')actions.append(button('撤销此操作',event=>{void actOnProposal(change.id,'undo','workspace',event);}));
    card.append(actions);return card;
  }
  function selectionRunCard(run: Awaited<ReturnType<typeof listSelectionRuns>>[number]) {
    const card = el('details', 'wp-proposal');
    card.dataset.proposalId = 'selection:' + run.id;
    const label = { running: '请求未结束', generated: '已保存预览', failed: '失败', cancelled: '已停止' }[run.status];
    card.append(el('summary', '', '选区' + selectionUses[run.use] + ' · ' + label + ' · ' + new Date(run.createdAt).toLocaleString()));
    const detail = el('div');
    card.append(detail);
    let loaded = false;
    card.addEventListener('toggle', () => {
      if (!card.open || loaded) return;
      loaded = true;
      void readSelectionRun(run.id).then(saved => {
        if (!card.isConnected) return;
        detail.append(el('p', 'wp-muted', saved.episodeId + ' · 正文 r' + saved.revision + ' · '
          + (saved.scriptSetup ? '设定 v' + saved.scriptSetup.setupRevision : '设定未设置')),
          el('p', 'wp-muted', saved.model.providerLabel + ' · ' + (saved.model.label || saved.model.modelId) + ' · Skill ' + saved.skill.name),
          el('p', '', '原选区'), el('pre', '', saved.original));
        if (saved.result) detail.append(el('p', '', '模型生成结果'), el('pre', '', saved.result));
        if (saved.error) detail.append(el('p', '', saved.error));
        if (saved.proposalId) detail.append(el('p', 'wp-muted', '对应正文提案 · ' + saved.proposalId));
      }).catch(error => { detail.textContent = String(error); });
    });
    return card;
  }
  async function refreshHistory() {
    const version = ++historyVersion;
    try {
      const index=await episodeIndex();
      const [groups, contentProposals, workspaceChanges, selectionRuns] = await Promise.all([Promise.all([...index.chapters,...(index.archived??[])].map(c=>listProposals(c.episodeId).catch(()=>[]))), listContentProposals(episodeId), listWorkspaceChanges(), listSelectionRuns()]);
      const proposals=groups.flat();
      if (disposed || version !== historyVersion) return;
      receiptStates.clear();
      for (const p of [...proposals, ...contentProposals, ...workspaceChanges]) {
        receiptStates.set(p.id, {status: p.status, readOnly: productionHistoryOnly(p)});
      }
      updateReceiptStates();
      const signature = JSON.stringify([proposals, contentProposals, workspaceChanges, selectionRuns]);
      if (signature !== historySignature) {
        const follow = nearBottom();
        historySignature = signature;
        const expanded = new Set(Array.from(historyContent.querySelectorAll<HTMLDetailsElement>('details[open]')).map(node => node.dataset.proposalId));
        const cards = [
          ...proposals.map(p => ({ createdAt: p.createdAt, card: proposalCard(p) })),
          ...contentProposals.map(p => ({ createdAt: p.createdAt, card: contentProposalCard(p) })),
          ...workspaceChanges.map(p=>({createdAt:p.createdAt,card:workspaceCard(p)})),
          ...selectionRuns.map(run => ({ createdAt: run.createdAt, card: selectionRunCard(run) })),
        ].sort((a, b) => b.createdAt - a.createdAt);
        historyContent.replaceChildren(...cards.map(({ card }) => { card.open = expanded.has(card.dataset.proposalId); return card; }));
        if (!cards.length) historyContent.append(el('p', 'wp-muted', '还没有提案。只读分析不会生成提案。'));
        historySummary.textContent = `写入与提案记录 · 项目章节 / 资产 / 选区预览（${cards.length}）`;
        if (follow) scroll.scrollTop = scroll.scrollHeight;
        updateBottomButton();
      }
      updateControls();
    } catch (reason) { if (version === historyVersion) showError(reason); }
  }
  async function actOnProposal(id: string, action: 'apply' | 'reject' | 'undo', kind: 'script' | 'content' | 'workspace', event: MouseEvent, targetEpisode=episodeId) {
    // Approval comes only from the user's actual button activation, never runtime/model output.
    if (!event.isTrusted || proposalBusy || commandBusy || session?.status === 'running' || disposed) return;
    proposalBusy = true; error.hidden = true; updateControls();
    const host = doc.querySelector<HTMLElement>('.laper-host');
    const wasInert = host?.inert ?? false;
    const scriptEditor = getActiveWritingEditor(), contentEditor = getActiveContentEditor();
    let committed = false;
    try {
      const latest = kind==='workspace'?await getWorkspaceChange(id):kind === 'content' ? await getContentProposal(id) : await getProposal(targetEpisode, id);
      if (!latest || latest.status !== (action === 'undo' ? 'applied' : 'pending')) throw new Error('提案状态已变化或提案不存在，请刷新历史后重新查看。');
      if (productionHistoryOnly(latest)) throw new Error('请在项目的制作工作区处理此分镜记录。');
      if (action === 'reject') {
        if(kind==='workspace')await rejectWorkspaceChange(id);else if (kind === 'content') await rejectContentProposal(id); else await rejectProposal(targetEpisode, id);
      } else {
        if (kind === 'content' && 'target' in latest && latest.target.kind === 'entity' && doc.querySelector('.dsh-entity-mask')) throw new Error('请先保存或关闭资产编辑窗口');
        if (host) host.inert = true;
        // Capture adapters once: a navigation must not redirect reload to a different editor.
        await scriptEditor?.flush(); await contentEditor?.flush();
        if (disposed) return;
        if(kind==='workspace'){
          const candidateId = 'scriptSetupTaskId' in latest ? latest.scriptSetupTaskId : undefined;
          const result = action === 'undo' ? await undoWorkspaceChange(id)
            : candidateId ? await decideScriptSetupTaskChange(candidateId, id, true, false)
              : await applyWorkspaceChange(id, { approvedByUser: true });
          if (!result || result.status !== (action === 'undo' ? 'undone' : 'applied')) throw Error('未收到本次写入回执。');
          committed=true;
          const index=await episodeIndex();const target=index.chapters.find(c=>c.episodeId===result.episodeId)??index.chapters[0];
          if(host)host.inert=wasInert;
          await refreshWorkspaceView(target.episodeId,result.screen);
          window.dispatchEvent(new CustomEvent('dsh:content-updated'));
        }else if (kind === 'content') {
          const result = action === 'apply' ? await applyContentProposal(id, { approvedByUser: true }) : await undoContentProposal(id);
          committed = true;
          try { await scriptEditor?.reload(); await contentEditor?.reload(); }
          finally { doc.defaultView?.dispatchEvent(new CustomEvent('dsh:content-updated', { detail: result.proposal.target })); }
        } else {
          if (action === 'apply') await applyProposal(targetEpisode, id, { approvedByUser: true }); else await undoProposal(targetEpisode, id);
          committed = true;
          await scriptEditor?.reload(); await contentEditor?.reload();
          window.dispatchEvent(new CustomEvent('dsh:script-written',{detail:{episodeId:targetEpisode}}));
        }
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      showError(committed ? `已保存但页面刷新失败（提案已${action === 'undo' ? '撤销' : '应用'}），请重新打开对应页面。${message}` : reason);
    } finally {
      if (host) host.inert = wasInert;
      proposalBusy = false; if (!disposed) { await refreshHistory(); updateControls(); }
    }
  }
  async function initialize() {
    if (loaded) return; loaded = true;
    const version = sessionVersion;
    try { const initial = await loadWritingSession(); if (!disposed && version === sessionVersion) renderSession(initial); }
    catch (reason) { loaded = false; showError(reason); }
  }
  let motion: Animation | undefined;
  let motionVersion = 0;
  function setOpen(value: boolean) {
    if (disposed || (opened === value && !motion)) return;
    const version = ++motionVersion;
    const current = panel.hidden ? undefined : getComputedStyle(panel).transform;
    motion?.cancel(); motion = undefined;
    opened = value; panel.hidden = false; panel.inert = !value;
    launch.hidden = false; launch.setAttribute('aria-expanded', String(value));
    portal.dataset.open = String(value);
    const width = panel.offsetWidth, height = panel.offsetHeight;
    const collapsed = `scale(${130 / width}, ${44 / height})`;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    motion = panel.animate([
      { transform: current && current !== 'none' ? current : value ? collapsed : 'scale(1)', opacity: value ? 0 : 1, borderRadius: value ? '32px' : '18px' },
      { transform: value ? 'scale(1)' : collapsed, opacity: value ? 1 : 0, borderRadius: value ? '18px' : '32px' },
    ], { duration: reduced ? 0 : value ? 380 : 280, easing: value ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
    void motion.finished.then(() => {
      if (disposed || version !== motionVersion) return;
      motion?.cancel(); motion = undefined; panel.hidden = !opened; launch.hidden = opened;
      if (opened) prompt.focus({ preventScroll: true });
    }).catch(() => {});
    if (value) {
      const page = writingPage();
      context.textContent = `当前页面 · ${page.label}｜${episodeTitle}｜本集写作会话`;
      const contentEditable = ['03-outline', '04-storyboard', '06-characters', '07-locations', '08-props'].includes(page.id);
      scope.disabled = !page.script;
      readOnly.disabled = page.id === 'chapter-draft';
      if (!page.script) scope.value = 'episode';
      if (readOnly.disabled) readOnly.checked = true;
      readOnlyLabel.lastElementChild!.textContent = readOnly.disabled ? '当前章节只读分析' : '只读分析（不写入）';
      mode.title = '点击切换只读与写入。直接写入后可查看正文、撤销；设置中也可选择先审批。';
      context.textContent += readOnly.disabled ? '' : `｜剧本写入目标：${episodeTitle}正文${contentEditable ? '；也可编排章节、场次及共用资料' : ''}`;
      updateControls();
      returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : launch;
      void initialize(); if (session) void refreshSessions(); void refreshModels(); void refreshHistory();void refreshWorkflowScenes();
    } else if (panel.contains(doc.activeElement)) (returnFocus?.isConnected && !panel.contains(returnFocus) ? returnFocus : launch).focus({ preventScroll: true });
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); if (send.disabled) return;
    const chosen = models[Number(model.value)]; if (!chosen || model.value === '') return;
    const text = prompt.value.trim();
    void command(async () => {
      await startWriting({ prompt: text, fileIds:attachedFiles.map(f=>f.id), skillId:agentSkill?.value||undefined, providerId: chosen.providerId, modelId: chosen.modelId, styleId: style.value, scope: scope.value as 'selection' | 'scene' | 'episode', readOnly: readOnly.checked, autoWrite: autoWrite.checked });
      // Do not erase a next-message draft typed while the request was in flight.
      if (prompt.value.trim() === text) {prompt.value = '';localStorage.removeItem(draftKey);}
    });
  });
  let composing = false;
  prompt.addEventListener('compositionstart', () => { composing = true; });
  prompt.addEventListener('compositionend', () => { composing = false; });
  prompt.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat && !send.disabled) form.requestSubmit(send);
  });
  prompt.addEventListener('input', updateControls); model.addEventListener('change', updateControls);
  model.addEventListener('change',()=>{const m=models[Number(model.value)];if(model.value!==''&&m)localStorage.setItem('writing:preferredModel',JSON.stringify([m.providerId,m.modelId]));});
  const advisor=(event:Event)=>{const id=(event as CustomEvent).detail;if(writingStyles.some(s=>s.id===id)){style.value=id;setOpen(true);updateControls();}};
  window.addEventListener('dsh:advisor',advisor);
  const modelsChanged=()=>{if(opened)void refreshModels();};window.addEventListener('dsh:models-changed',modelsChanged);
  function rememberMode() { localStorage.setItem(modeKey, readOnly.checked ? 'read' : autoWrite.checked ? 'write' : 'review'); updateControls(); }
  readOnly.addEventListener('change', rememberMode); autoWrite.addEventListener('change', rememberMode);
  const showPanel = () => setOpen(true); window.addEventListener('dsh:show-writing', showPanel);
  const requestWriting=(event:Event)=>{setOpen(true);prompt.value=String((event as CustomEvent).detail);updateControls();prompt.focus();};window.addEventListener('dsh:request-writing',requestWriting);
  const autoStoryboard=(event:Event)=>{
    const detail=(event as CustomEvent).detail as {episodeId?:string;sceneBlockId?:string;title?:string};
    if(disposed||detail.episodeId!==episodeId||!detail.sceneBlockId)return;
    if(commandBusy||session?.status==='running'){showError('已有任务正在执行，请完成或停止后再自动分镜');return;}
    if(readOnly.checked){showError('当前为只读模式，请切换为提案或直接写入后再自动分镜。');return;}
    setOpen(true);
    void command(async()=>{
      await initialize();
      // Opening the panel starts model discovery. Wait for that one request, never submit twice.
      for(let attempt=0;modelBusy&&attempt<150;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
      if(disposed)return;
      const chosen=models[Number(model.value)];
      if(modelBusy||model.value===''||!chosen){preferences.open=true;throw Error('请先在写作 Agent 设置中选择文本模型，再点击自动分镜');}
      const text=`为这场戏创建剧作分镜镜头卡：${detail.title??''}。目标 episodeId=${episodeId}，sceneBlockId=${detail.sceneBlockId}。先读取本场真实正文和已有分镜，再实际调用 editStoryboard 写入。仅处理这一场，保留已有镜头，在已有内容基础上补足；包含画面描述、景别、角度、运动、焦段和秒数，并引用真实人物/地点/道具 ID。完成后读取分镜核验写入数量。`;
      await startWriting({prompt:text,workflow:{kind:'storyboard',range:'episode',sceneBlockId:detail.sceneBlockId},providerId:chosen.providerId,modelId:chosen.modelId,styleId:style.value,scope:'episode',readOnly:readOnly.checked,autoWrite:autoWrite.checked,requiredWrite:'storyboard'});
    });
  };
  if (!writingWorkspace) window.addEventListener('dsh:auto-storyboard',autoStoryboard);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } });
  const entryActions = { 改写: 'rewrite', 扩写: 'expand', 描写: 'describe' } as const;
  function captureEntry(event: MouseEvent) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || portal.contains(target) || target.closest('a,nav,[role="navigation"],[contenteditable="true"],[data-selection-toolbar]')) return;
    // Exact actionable labels only: never intercept broad containers or navigation.
    let candidate: Element | null = target;
    while (candidate && candidate !== root && root.contains(candidate)) {
      if (!candidate.matches('button,[role="button"],.cursor-pointer')) {
        candidate = candidate.parentElement;
        continue;
      }
      const label = (candidate.textContent || '').trim().replace(/\s+/g, ' ');
      if (Object.hasOwn(entryActions, label)) {
        if (candidate.matches('[disabled],[aria-disabled="true"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const entry = entryActions[label as keyof typeof entryActions];
        if(entry){void openSelectionWriter(entry).catch(reason=>{setOpen(true);showError(reason);});return;}
        setOpen(true); updateControls(); return;
      }
      candidate = candidate.parentElement;
    }
  }
  root.addEventListener('click', captureEntry, true);
  const disposeSelectionToolbar = mountSelectionToolbar(root);
  const unsubscribe = subscribeWriting(next => { sessionVersion++; renderSession(next); });
  updateControls();
  const dispose = () => {
    if (disposed) return; disposed = true; historyVersion++; motionVersion++; motion?.cancel();
    resize.disconnect(); unsubscribe(); disposeLauncher(); disposeSelectionToolbar(); root.removeEventListener('click', captureEntry, true); portal.remove();
    window.removeEventListener('dsh:advisor',advisor);
    window.removeEventListener('dsh:skill-advisor',useAdvisor);
    window.removeEventListener('dsh:models-changed',modelsChanged);
    window.removeEventListener('dsh:show-writing',showPanel);
    window.removeEventListener('dsh:request-writing',requestWriting);
    window.removeEventListener('dsh:auto-storyboard',autoStoryboard);
    window.removeEventListener('dsh:content-updated',scenesUpdated);
    window.removeEventListener('dsh:selection-writing-updated', quickHistoryUpdated);
    if (mounts.get(root) === dispose) mounts.delete(root);
  };
  mounts.set(root, dispose); return dispose;
}
