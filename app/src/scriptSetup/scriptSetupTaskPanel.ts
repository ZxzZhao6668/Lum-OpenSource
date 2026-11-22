import { node } from '../ui/localUi';
import { getActiveWritingEditor } from '../script/editor';
import { listTextModels, type TextModel } from '../writing/writingClient';
import { readDocument } from '../writing/documentStore';
import { refreshWorkspaceView } from '../writing/workspaceFeedback';
import { listSkills } from '../skills/skillStore';
import { incorporateExtraction, type ExtractionSuggestion } from './scriptSetupAi';
import { SETUP_FIELDS, type ScriptSetupPayload, type SetupField } from './scriptSetupModel';
import { setupFieldValue } from './scriptSetupContext';
import { scriptSetupWriteMode } from './scriptSetupReview';
import { readScriptSetupState, readScriptSetupWorkspaceEpoch, scriptSetupProjectId } from './scriptSetupStore';
import {
  adoptScriptSetupTask, decideScriptSetupTaskChange, listScriptSetupTasks, previewScriptSetupTask, runScriptSetupTask, taskEpisodeSuggestions, taskReceipts,
  type ExtractionRange, type ScriptSetupTask, type ScriptSetupTaskKind, type ScriptSetupTaskPreview,
} from './scriptSetupTasks';
import type { TaskSkillChoice } from './scriptSetupTaskSkill';
import { button, checkbox, note, selectControl, subtitle, textControl } from './setupControls';

interface TaskPanelOptions {
  getDraft: () => ScriptSetupPayload;
  applyDraft: (next: ScriptSetupPayload) => void;
  openEpisode: () => boolean;
}
const activeCandidates = new Map<string, AbortController>();
const kinds: Record<ScriptSetupTaskKind, string> = { extract: '提取剧本设定', outline: '总纲候选', episodePlan: '集纲候选' };
const statusLabels: Record<ScriptSetupTask['status'], string> = {
  ready: '待发起', running: '运行记录未结束', complete: '候选已保存', cancelled: '已停止', failed: '失败', 
};
function taskSkillDescription(task: ScriptSetupTask) {
  const name = task.skill?.name ?? '无匹配 Skill';
  switch (task.skillSelection?.mode) {
    case 'none': return 'Skill · 不使用';
    case 'auto': return 'Skill · 自动选择 · ' + name + '。' + task.skillSelection.reason;
    case 'manual': return 'Skill · 手动选择 · ' + name + '。' + task.skillSelection.reason;
    default: return task.skill ? 'Skill · ' + task.skill.name + '（历史记录未保存选择模式）' : 'Skill · 历史记录未保存选择模式';
  }
}
export function renderScriptSetupTasks(parent: HTMLElement, episodeId: string, options: TaskPanelOptions) {
  const section = node('section', '', 'ssTaskPanel');
  parent.append(section);
  const form = node('div', '', 'ssGroup');
  const status = node('p', '', 'ssNote'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const previewBox = node('div');
  const history = node('div');
  const detail = node('div');
  section.append(form, status, previewBox, history, detail);

  let kind: ScriptSetupTaskKind = 'extract';
  let extraction: ExtractionRange['kind'] = 'idea';
  let models: TextModel[] = [];
  let skillLoading = false, skillLoadToken = 0;
  let scenes: { id: string; title: string }[] = [];
  let selectedScenes = new Set<string>();
  let modelBusy = false, working = false;
  let tokens = 0;
  let historyRequest = 0;
  let preview: ScriptSetupTaskPreview | undefined;
  let controller: AbortController | undefined;

  const kindControl = selectControl('候选类型', Object.entries(kinds), kind, id => {
    kind = id as ScriptSetupTaskKind; updateFields(); invalidate();
  });
  const rangeControl = selectControl('提取范围', [
    ['idea', '粘贴想法'], ['episode', '当前集正文'], ['scenes', '当前集所选场次'], ['written', '全部已写章节'],
  ], extraction, id => { extraction = id as ExtractionRange['kind']; updateFields(); invalidate(); });
  const idea = textControl('粘贴想法', '', invalidate, { multiline: true, max: 50000 });
  const request = textControl('本次创作要求', '', invalidate, { multiline: true, max: 12000 });
  let countEdited = false;
  const count = textControl('本次规划集数', '1', () => { countEdited = true; invalidate(); });
  count.input.setAttribute('type', 'number'); count.input.setAttribute('min', '1'); count.input.setAttribute('max', '200');
  const scenesBox = node('fieldset', '', 'ssGroup');
  const model = selectControl('文本模型', [['', '正在读取配置…']], '', invalidate);
  const skillMode = selectControl('Skill 选择方式', [['none', '不使用 Skill'], ['auto', '自动选择'], ['manual', '手动选择']], 'none', mode => {
    updateFields(); invalidate();
    if (mode === 'manual') void loadSkills();
  });
  const skill = selectControl('写作 Skill', [['', '请选择写作 Skill']], '', invalidate);
  const skillHint = note('');
  const modelStatus = note('');
  const refresh = button('刷新模型', () => void loadModels());
  const previewButton = button('预览范围与影响', () => void showPreview(), 'ssPrimary');
  form.append(kindControl.wrap, rangeControl.wrap, idea.wrap, scenesBox, request.wrap, count.wrap,
    model.wrap, refresh, modelStatus, skillMode.wrap, skill.wrap, skillHint, previewButton);

  function showStatus(text: string, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function invalidate() {
    tokens++;
    if (preview) showStatus('输入已修改，请重新预览。');
    preview = undefined;
    previewBox.replaceChildren();
    updateButtons();
  }
  function updateFields() {
    rangeControl.wrap.hidden = kind !== 'extract';
    idea.wrap.hidden = kind !== 'extract' || extraction !== 'idea';
    scenesBox.hidden = kind !== 'extract' || extraction !== 'scenes';
    request.wrap.hidden = kind === 'extract';
    count.wrap.hidden = kind !== 'episodePlan';
    skill.wrap.hidden = skillMode.select.value !== 'manual';
    skillHint.hidden = skillMode.select.value === 'none';
    skillHint.textContent = skillMode.select.value === 'auto' ? '预览时按任务类型和明确线索在本地匹配，显示结果与理由。'
      : '从 Lum 的写作 Skill 目录选择。';
    if (!scenesBox.hidden) void loadScenes();
  }
  function updateButtons() {
    previewButton.disabled = working || modelBusy || model.select.value === ''
      || skillMode.select.value === 'manual' && (skillLoading || !skill.select.value)
      || (kind === 'extract' && (extraction === 'idea' ? !idea.input.value.trim() : extraction === 'scenes' && !selectedScenes.size))
      || (kind === 'episodePlan' && (!Number.isInteger(Number(count.input.value)) || Number(count.input.value) < 1 || Number(count.input.value) > 200));
    refresh.disabled = modelBusy || working;
    model.select.disabled = modelBusy || working || !models.length;
    for (const input of [kindControl.select, rangeControl.select, idea.input, request.input, count.input, skillMode.select]) input.disabled = working;
    skill.select.disabled = working || skillLoading;
    scenesBox.disabled = working;
  }
  const modelKey = (model: Pick<TextModel, 'providerId' | 'modelId'>) => JSON.stringify([model.providerId, model.modelId]);
  function addOption(select: HTMLSelectElement, value: string, label: string) {
    const option = node('option', label); option.value = value; select.add(option);
  }
  async function loadSkills() {
    const token = ++skillLoadToken;
    const prior = skill.select.value;
    skillLoading = true;
    updateButtons();
    try {
      const available = await listSkills('agent');
      if (!section.isConnected || token !== skillLoadToken) return;
      skill.select.replaceChildren();
      addOption(skill.select, '', available.length ? '请选择写作 Skill' : '暂无写作 Skill');
      for (const item of available) addOption(skill.select, item.id, item.name);
      skill.select.value = available.some(item => item.id === prior) ? prior : '';
    } catch (error) {
      if (!section.isConnected || token !== skillLoadToken) return;
      skill.select.value = '';
      showStatus('Skill 列表读取失败：' + String(error), true);
    } finally {
      if (token === skillLoadToken) { skillLoading = false; updateButtons(); }
    }
  }
  async function loadModels() {
    const prior = model.select.value;
    modelBusy = true;
    invalidate();
    modelStatus.textContent = '正在读取 Lum 文本模型配置…';
    try {
      models = (await listTextModels()).filter(item => item.providerId && item.modelId);
      model.select.replaceChildren();
      addOption(model.select, '', models.length ? '请选择文本模型' : '暂无可用文本模型');
      for (const item of models) addOption(model.select, modelKey(item), item.providerLabel + ' · ' + (item.label || item.modelId));
      const selected = models.find(item => modelKey(item) === prior) ?? models.find(item => item.isDefault) ??
        models.find(item => modelKey(item) === localStorage.getItem('writing:preferredModel')) ?? (models.length === 1 ? models[0] : undefined);
      model.select.value = selected ? modelKey(selected) : '';
      modelStatus.textContent = models.length ? '按所选范围预览后可显式发起请求。供应商费用以实际配置为准。'
        : '暂无可用文本模型。请在 Lum 的「模型配置」中添加文本模型，再刷新。';
    } catch (error) {
      const modelError = error instanceof Error ? error.message : String(error);
      models = [];
      model.select.replaceChildren();
      addOption(model.select, '', '模型列表未读取');
      modelStatus.textContent = '模型列表读取失败：' + modelError + '。请确认 Lum 服务，再刷新。';
    } finally { modelBusy = false; updateButtons(); }
  }
  async function loadScenes() {
    scenesBox.replaceChildren(node('legend', '选择真实场次'), note('正在读取当前集场次…'));
    try {
      await getActiveWritingEditor()?.flush();
      const doc = await readDocument(episodeId);
      scenes = doc.blocks.filter(block => block.type === 'scene').map(block => ({ id: block.id, title: block.text.trim() || '未命名场次' }));
      selectedScenes = new Set([...selectedScenes].filter(id => scenes.some(scene => scene.id === id)));
      scenesBox.replaceChildren(node('legend', '选择真实场次'));
      if (!scenes.length) scenesBox.append(note('当前集没有真实场次。可选择当前集正文，或先在剧本页分场。'));
      for (const [i, scene] of scenes.entries()) {
        const option = checkbox(String(i + 1) + ' · ' + scene.title, selectedScenes.has(scene.id), checked => {
          if (checked) selectedScenes.add(scene.id); else selectedScenes.delete(scene.id);
          invalidate();
        });
        scenesBox.append(option);
      }
      updateButtons();
    } catch (error) { scenesBox.replaceChildren(note(String(error))); }
  }
  function selectedRange(): ExtractionRange {
    if (extraction === 'idea') return { kind: 'idea', text: idea.input.value };
    if (extraction === 'scenes') return { kind: 'scenes', episodeId, sceneIds: scenes.filter(scene => selectedScenes.has(scene.id)).map(scene => scene.id) };
    if (extraction === 'written') return { kind: 'written' };
    return { kind: 'episode', episodeId };
  }
  async function showPreview() {
    if (working) return;
    const selectedModel = models.find(item => modelKey(item) === model.select.value);
    if (!selectedModel) { showStatus('请先选择已配置的文本模型。', true); return; }
    const mode = skillMode.select.value;
    const skillChoice: TaskSkillChoice = mode === 'manual' ? { mode, skillId: skill.select.value } : { mode: mode === 'auto' ? 'auto' : 'none' };
    invalidate();
    working = true; updateButtons(); showStatus('正在读取所选范围和已确认设定…');
    const currentToken = ++tokens;
    try {
      const next = await previewScriptSetupTask({
        episodeId, kind, range: selectedRange(), request: kind === 'extract' ? '' : request.input.value,
        count: Number(count.input.value), model: selectedModel, skillChoice,
      });
      if (!section.isConnected || currentToken !== tokens) return;
      preview = next;
      renderPreview(next);
      showStatus('预览就绪。');
    } catch (error) { if (section.isConnected) showStatus(error instanceof Error ? error.message : String(error), true); }
    finally { working = false; updateButtons(); }
  }
  function showSources(task: ScriptSetupTask) {
    const details = node('details', '', 'ssGroup');
    details.append(node('summary', '来源版本及已完成范围'));
    const done = new Set(task.completed.map(entry => entry.part));
    const coverage = new Map<number, { total: number; done: number }>();
    for (const [number, part] of task.parts.entries()) {
      const value = coverage.get(part.source) ?? { total: 0, done: 0 };
      value.total++; if (done.has(number)) value.done++;
      coverage.set(part.source, value);
    }
    for (const [i, source] of task.sources.entries()) {
      const part = coverage.get(i);
      const text = source.label + (source.revision === undefined ? '' : ' · 正文 v' + source.revision) +
        ' · ' + source.fingerprint.slice(0, 12) + (source.chars ? ' · ' + source.chars + ' 字符' : '') +
        (part && task.kind === 'extract' ? ' · ' + part.done + '/' + part.total + ' 批' : '');
      details.append(note(text));
    }
    return details;
  }
  function renderPreview(value: ScriptSetupTaskPreview) {
    const { task, chapterCount, plannedCount } = value;
    const mode = scriptSetupWriteMode();
    const impact = task.kind === 'extract' ? '生成后可逐项选择写入当前可编辑草稿。'
      : task.kind === 'outline' ? '采纳会在当前集大纲中新建一个文档。'
        : '采纳会依次追加 ' + plannedCount + ' 集到真实目录，现有正式章节 ' + chapterCount + ' 集；每批采纳最多 50 集。';
    previewBox.replaceChildren(subtitle(kinds[task.kind] + '预览'),
      note('模型 · ' + task.model.providerLabel + ' · ' + (task.model.label || task.model.modelId)),
      note(taskSkillDescription(task)),
      note('已确认设定 · ' + (task.snapshot ? 'v' + task.snapshot.setupRevision : '未设置') + ' · ' + task.parts.length + ' 批模型请求'),
      note('当前写入模式 · ' + (mode === 'read' ? '只读' : mode === 'review' ? '提案审批' : '直接写入')),
      note(impact), showSources(task));
    if (task.skill) {
      const method = node('details', '', 'ssGroup');
      method.append(node('summary', '本次使用的 Skill 指令'), node('pre', task.skill.instruction));
      previewBox.append(method);
    }
    if (task.snapshot) {
      const version = node('details', '', 'ssGroup');
      version.append(node('summary', '本次已固定的设定与覆盖'));
      if (task.snapshot.omittedSetupFields.length) version.append(note('采用正史，略去 ' + task.snapshot.omittedSetupFields.map(field => SETUP_FIELDS[field]).join('、')));
      if (task.snapshot.overrideFields.length) version.append(note('本次覆盖 ' + task.snapshot.overrideFields.map(field => SETUP_FIELDS[field]).join('、')));
      if (task.snapshot.payload.constraints.lockedFields.length) version.append(note('锁定 ' + task.snapshot.payload.constraints.lockedFields.map(field => SETUP_FIELDS[field]).join('、')));
      if (task.kind === 'episodePlan' && task.snapshot.payload.structure.episodeCount && chapterCount + plannedCount > task.snapshot.payload.structure.episodeCount)
        version.append(note('现有集数与本次新增合计 ' + (chapterCount + plannedCount) + '，超过设定目标 ' + task.snapshot.payload.structure.episodeCount + ' 集。'));
      version.append(note('人物范围 · ' + task.snapshot.characters.map(character => character.name + ' [' + (character.entityId ?? character.draftProfileId) + ']').join('、')));
      previewBox.append(version);
    }
    const generate = button('确认生成候选', b => {
      if (preview !== value || working) return;
      b.disabled = true; preview = undefined; previewBox.replaceChildren();
      void run(task, false);
    }, 'ssPrimary');
    previewBox.append(generate);
  }
  async function run(task: ScriptSetupTask, resume: boolean) {
    if (working) return;
    working = true; updateButtons();
    controller = new AbortController();
    activeCandidates.set(task.id, controller);
    const running = controller;
    const pagehide = () => running.abort();
    window.addEventListener('pagehide', pagehide, { once: true });
    const progress = (record: ScriptSetupTask) => {
      if (!section.isConnected) return;
      showStatus(kinds[record.kind] + ' · 已保存 ' + record.completed.length + '/' + record.parts.length + ' 批。' + (record.error ?? ''), record.status === 'failed');
      detail.replaceChildren(subtitle(kinds[record.kind]),
        button('停止处理', b => { b.disabled = true; controller?.abort(); }), showSources(record));
    };
    progress(task);
    try {
      const completed = await runScriptSetupTask(task, { signal: controller.signal, onChange: progress }, resume);
      if (!section.isConnected) return;
      await refreshHistory(completed.id);
    } catch (error) { if (section.isConnected) showStatus(error instanceof Error ? error.message : String(error), true); }
    finally {
      window.removeEventListener('pagehide', pagehide);
      if (activeCandidates.get(task.id) === running) activeCandidates.delete(task.id);
      working = false; controller = undefined; updateButtons();
    }
  }

  async function refreshHistory(selectedId?: string) {
    const call = ++historyRequest;
    try {
      const rows = await listScriptSetupTasks();
      if (!section.isConnected || historyRequest !== call) return;
      history.replaceChildren(subtitle('已保存候选'));
      if (!rows.length) { history.append(note('还没有候选。')); return; }
      const selection = selectControl('候选记录', [['', '选择候选'], ...rows.map(row => [row.id,
        kinds[row.kind] + ' · ' + statusLabels[row.status] + ' · ' + new Date(row.updatedAt).toLocaleString('zh-CN') + ' · ' + row.id.slice(0, 8)] as [string, string])], selectedId ?? '', id => {
        if (!controller) void showRecord(rows.find(row => row.id === id));
      });
      history.append(selection.wrap, button('刷新候选记录', () => { if (!controller) void refreshHistory(selection.select.value); }));
      if (selectedId) await showRecord(rows.find(row => row.id === selectedId));
    } catch (error) { showStatus(String(error), true); }
  }
  let display = 0;
  async function showRecord(task?: ScriptSetupTask) {
    const call = ++display;
    detail.replaceChildren();
    if (!task) return;
    const current = task.projectId === scriptSetupProjectId && await readScriptSetupWorkspaceEpoch() === task.workspaceEpoch;
    if (!section.isConnected || display !== call) return;
    detail.append(subtitle(kinds[task.kind] + ' · ' + statusLabels[task.status]),
      note(task.completed.length + '/' + task.parts.length + ' 批已保存 · ' + task.model.providerLabel + ' · ' + (task.model.label || task.model.modelId) +
        ' · ' + (task.snapshot ? '设定 v' + task.snapshot.setupRevision : '设定未设置')),
      note(taskSkillDescription(task)), showSources(task));
    if (task.error) detail.append(note(task.error));
    if (!current) detail.append(note('记录来自恢复前的工作区版本，可查看候选。继续任务请重新预览。'));
    const running = activeCandidates.get(task.id);
    if (running && !running.signal.aborted) {
      detail.append(note('该候选正在本窗口处理。可停止处理或用刷新读取最新已保存批次。'),
        button('停止处理此候选', b => { b.disabled = true; running.abort(); }));
    } else if (task.status !== 'complete' && current) {
      detail.append(note('继续只提交尚未保存的批次。中断或超时时，先核对供应商是否已处理过当前批次。'));
      const resume = button('继续未完成批次', b => { if (!working && models.some(item => modelKey(item) === modelKey(task.model))) { b.disabled = true; void run(task, true); } });
      resume.disabled = !models.some(item => modelKey(item) === modelKey(task.model));
      if (resume.disabled) detail.append(note('继续需要原任务的文本模型，当前配置中未找到。'));
      detail.append(resume);
    }
    if (task.kind === 'extract') showExtraction(task);
    else await showAdoption(task, current, call);
  }
  function showExtraction(task: ScriptSetupTask) {
    const selected = new Map<SetupField, { suggestion: ExtractionSuggestion; source: { key: string; fingerprint: string } }>();
    const boxes = new Map<SetupField, HTMLInputElement[]>();
    const choose = button('将所选候选放入草稿', () => {
      try {
        const latest = options.getDraft();
        const changes = [...selected.values()].filter(item => !latest.constraints.lockedFields.includes(item.suggestion.field));
        if (!changes.length) throw Error('当前选择没有可修改的字段，请核对草稿锁定状态。');
        options.applyDraft(incorporateExtraction(latest, changes));
      } catch (error) { showStatus(String(error), true); }
    }, 'ssPrimary');
    choose.disabled = true;
    const candidateList = node('div', '', 'ssChoiceGroups');
    const candidates = task.completed.flatMap(entry => entry.result.kind === 'extract'
      ? entry.result.suggestions.map(suggestion => ({ suggestion, source: task.sources[task.parts[entry.part].source], part: task.parts[entry.part] })) : []);
    const draft = options.getDraft();
    if (!candidates.length) { detail.append(note('当前保存的批次没有建议。')); return; }
    function page(start: number) {
      boxes.clear();
      candidateList.replaceChildren();
      for (const candidate of candidates.slice(start, start + 30)) {
        const { suggestion, source, part } = candidate;
        const item = node('details', '', 'ssGroup');
        item.append(node('summary', SETUP_FIELDS[suggestion.field] + ' · ' + (suggestion.basis === 'evidence' ? '原文依据' : '推断')),
          note(source.label + ' · ' + (part.start + 1) + '–' + part.end + ' 字符' + (source.revision === undefined ? '' : ' · v' + source.revision)));
        if (suggestion.evidence) item.append(node('pre', suggestion.evidence));
        item.append(note('当前草稿'), node('pre', JSON.stringify(setupFieldValue(draft, suggestion.field), null, 2)),
          note('候选'), node('pre', JSON.stringify(suggestion.value, null, 2)));
        const pick = checkbox(draft.constraints.lockedFields.includes(suggestion.field) ? '字段已锁定' : '选择此字段候选',
          selected.get(suggestion.field) === candidate, checked => {
            if (checked) {
              selected.set(suggestion.field, candidate);
              for (const other of boxes.get(suggestion.field) ?? []) if (other !== control) other.checked = false;
            } else if (selected.get(suggestion.field) === candidate) selected.delete(suggestion.field);
            choose.disabled = !selected.size;
          });
        const control = pick.querySelector('input')!;
        control.disabled = draft.constraints.lockedFields.includes(suggestion.field);
        const group = boxes.get(suggestion.field) ?? [];
        group.push(control); boxes.set(suggestion.field, group); item.append(pick); candidateList.append(item);
      }
      if (start > 0) candidateList.append(button('上一页', () => page(start - 30)));
      if (start + 30 < candidates.length) candidateList.append(button('下一页', () => page(start + 30)));
    }
    detail.append(candidateList, choose); page(0);
  }
  async function showAdoption(task: ScriptSetupTask, current: boolean, call: number) {
    const suggested = taskEpisodeSuggestions(task);
    if (task.kind === 'outline') {
      const result = task.completed[0]?.result;
      if (result?.kind === 'outline') detail.append(subtitle(result.outline.title), node('pre', result.outline.text));
    } else {
      const list = node('div', '', 'ssChoiceGroups');
      detail.append(list);
      function page(start: number) {
        list.replaceChildren();
        for (const [index, episode] of suggested.slice(start, start + 20).entries()) {
          const article = node('details', '', 'ssGroup');
          article.append(node('summary', (start + index + 1) + ' · ' + episode.title), node('pre', episode.summary)); list.append(article);
        }
        if (start) list.append(button('上一页', () => page(start - 20)));
        if (start + 20 < suggested.length) list.append(button('下一页', () => page(start + 20)));
      }
      page(0);
    }
    const receipts = await taskReceipts(task);
    if (!detail.isConnected || call !== display) return;
    const readOnly = scriptSetupWriteMode() === 'read';
    const total = task.kind === 'outline' ? 1 : suggested.length;
    const applied = receipts.filter(receipt => receipt.applied).reduce((sum, receipt) => sum + receipt.link.count, 0);
    const pending = receipts.some(item => item.change?.status === 'pending');
    if (receipts.length) detail.append(note('读回复核成功 ' + applied + '/' + total));
    for (const receipt of receipts) {
      const { change, link } = receipt;
      const label = receipt.applied ? '已写入并核对' : change?.status === 'applied' ? '写入后目标已变化' : change?.status === 'undone' ? '已撤销'
        : change?.status === 'rejected' ? '已拒绝' : change?.status === 'pending' ? '待审批' : '回执缺失';
      detail.append(note(label + ' · ' + link.operationId));
      if (change?.status === 'pending' && current && !readOnly) {
        const decide = (approve: boolean) => asyncAction(async () => {
          await decideScriptSetupTaskChange(task.id, link.operationId, approve); await refreshHistory(task.id);
        });
        detail.append(button('批准实际写入', decide(true), 'ssPrimary'), button('拒绝此提案', decide(false)));
      }
    }
    const written = receipts.flatMap(item => item.episodes);
    if (written.length && current) {
      const episode = selectControl('选择已核对的剧集', written.map(item => [item.episodeId, item.title]), written[0].episodeId, () => {});
      detail.append(episode.wrap, button('打开选集正文任务', asyncAction(async () => {
        const fresh = await taskReceipts(task);
        const target = fresh.flatMap(item => item.episodes).find(item => item.episodeId === episode.select.value);
        if (!target) throw Error('这集的真实写入回执或大纲已变化，请刷新后核对。');
        if (!options.openEpisode()) return;
        await refreshWorkspaceView(target.episodeId, '01-script');
        window.dispatchEvent(new CustomEvent('dsh:request-writing', { detail: '请按本集已保存集纲和已确认剧本设定写这一集正文，保留已有内容。' }));
      })));
    }
    if (task.status === 'complete' && current && !pending && applied < total) {
      const adopt = button(readOnly ? '只读 · 采纳不可用' : task.kind === 'outline' ? '采纳为实际总纲'
        : '采纳第 ' + (applied + 1) + '–' + Math.min(applied + 50, total) + ' 集', asyncAction(async () => {
        await adoptScriptSetupTask(task.id); await refreshHistory(task.id);
      }), 'ssPrimary');
      adopt.disabled = readOnly; detail.append(adopt);
    }
  }
  function asyncAction(run: () => Promise<void>) {
    return (b: HTMLButtonElement) => {
      b.disabled = true;
      void run().catch(error => showStatus(error instanceof Error ? error.message : String(error), true)).finally(() => { b.disabled = false; });
    };
  }

  // Closing the task pane never launches or repeats a provider request. An explicitly
  // started job continues in its original project, with its record available on reopen.
  updateFields();
  void loadModels().then(() => refreshHistory());
  void readScriptSetupState().then(state => {
    const planned = state.confirmed?.payload.structure.episodeCount;
    if (section.isConnected && !working && !countEdited && planned !== undefined && count.input.value !== String(planned)) {
      count.input.value = String(planned);
      if (kind === 'episodePlan') invalidate();
    }
  }).catch(error => showStatus(String(error), true));
}

