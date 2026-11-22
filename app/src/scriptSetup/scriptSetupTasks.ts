import { db, loadDoc, saveDoc, type DocRow } from '../data/db';
import { equalDocumentValue } from '../data/equalDocumentValue';
import { migrateChapterText } from '../episode/migrateChapterText';
import { closeChapterDraft } from '../episode/chapterView';
import { getActiveWritingEditor } from '../script/editor';
import { getActiveContentEditor } from '../writing/contentEditor';
import { readDocument } from '../writing/documentStore';
import { readWorldview } from '../worldview/worldviewModel';
import { cancelWriting, type TextModel } from '../writing/writingClient';
import { episodeIndex, prepareStructuredTool } from '../writing/structuredTools';
import { applyWorkspaceChange, getWorkspaceChange, rejectWorkspaceChange, type WorkspaceChange } from '../writing/workspaceChanges';
import { storyboardSceneRange } from '../writing/writingWorkflow';
import { validateAgentSkillSnapshot, validateSkill, type WritingSkill } from '../skills/skillStore';
import { scriptSetupFingerprint } from './characterProfiles';
import {
  checkedEpisodeSuggestions, checkedExtraction, checkedOutline, episodePlanTaskPrompt, extractTaskPrompt, outlineTaskPrompt,
  requestScriptSetupCandidate, taskArray, taskObject, taskText, type EpisodeSuggestion, type ExtractionSuggestion,
} from './scriptSetupAi';
import { compileScriptSetupContext, validateScriptSetupSnapshot, type ScriptSetupSnapshot } from './scriptSetupContext';
import { prepareScriptSetupContext, scriptSetupWriteMode } from './scriptSetupReview';
import { selectScriptSetupTaskSkill, validateTaskSkillSelection, type TaskSkillChoice, type TaskSkillSelection } from './scriptSetupTaskSkill';
import { setupFingerprint, setupInteger, type UnboundCharacter } from './scriptSetupModel';
import { assertScriptSetupProject, readScriptSetupWorkspaceEpoch, scriptSetupProjectId, ScriptSetupConflict } from './scriptSetupStore';

export const SCRIPT_SETUP_TASK_PREFIX = 'project:scriptSetupTask:';
const CHUNK = 16000;
const PLAN_BATCH = 10;
const ADOPT_BATCH = 50;
export type ScriptSetupTaskKind = 'extract' | 'outline' | 'episodePlan';
export type ExtractionRange = { kind: 'idea'; text: string } | { kind: 'episode'; episodeId: string } |
  { kind: 'scenes'; episodeId: string; sceneIds: string[] } | { kind: 'written' };

export interface TaskSource {
  key: string;
  label: string;
  fingerprint: string;
  episodeId?: string;
  revision?: number;
  sceneId?: string;
  chars: number;
}
interface Part {
  source: number;
  start: number;
  end: number;
}
type TaskResult = { kind: 'extract'; suggestions: ExtractionSuggestion[] } |
  { kind: 'outline'; outline: ReturnType<typeof checkedOutline> } |
  { kind: 'episodePlan'; episodes: EpisodeSuggestion[] };
interface Completion { part: number; result: TaskResult }
interface TaskReceipt { start: number; count: number; operationId: string }
export interface ScriptSetupTask {
  schemaVersion: 1;
  id: string;
  projectId: string;
  workspaceEpoch: string;
  episodeId: string;
  kind: ScriptSetupTaskKind;
  status: 'ready' | 'running' | 'complete' | 'cancelled' | 'failed';
  revision: number;
  createdAt: number;
  updatedAt: number;
  request: string;
  model: Pick<TextModel, 'providerId' | 'modelId' | 'label' | 'providerLabel'>;
  skill?: WritingSkill;
  skillSelection?: TaskSkillSelection;
  snapshot: ScriptSetupSnapshot | null;
  sources: TaskSource[];
  parts: Part[];
  completed: Completion[];
  storySource?: string;
  fallbackCanon?: { text: string; fingerprint: string };
  idea?: string;
  receipts: TaskReceipt[];
  error?: string;
}
interface TaskOptions {
  episodeId: string;
  kind: ScriptSetupTaskKind;
  range: ExtractionRange;
  request: string;
  count: number;
  model: TextModel;
  skillChoice: TaskSkillChoice;
}
export interface ScriptSetupTaskPreview {
  task: ScriptSetupTask;
  chapterCount: number;
  plannedCount: number;
}
const taskKey = (id: string) => SCRIPT_SETUP_TASK_PREFIX + id;

async function flushSources() {
  await closeChapterDraft();
  await getActiveWritingEditor()?.flush();
  await getActiveContentEditor()?.flush();
}
function documentText(blocks: readonly { id: string; type: string; text: string }[]) {
  return blocks.map(block => '[' + block.id + '][' + block.type + '] ' + block.text).join('\n');
}
async function sourceFor(episodeId: string, title: string, sceneId?: string) {
  const document = await readDocument(episodeId);
  const scene = sceneId && storyboardSceneRange(document.blocks, sceneId);
  if (sceneId && !scene) throw Error('所选场次已不存在，请重新选择。');
  const blocks = scene ? scene.blocks : document.blocks;
  const content = blocks.some(block => block.text.trim()) ? documentText(blocks) : '';
  const key = 'script:' + episodeId + (sceneId ? ':scene:' + sceneId : '');
  return {
    source: { key, label: scene ? title + ' / ' + scene.title : title, fingerprint: await scriptSetupFingerprint(content),
      episodeId, revision: document.revision, ...(sceneId ? { sceneId } : {}), chars: content.length } satisfies TaskSource,
    content,
  };
}
function partsFor(text: string, source: number) {
  const parts: Part[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + CHUNK, text.length);
    const line = text.lastIndexOf('\n', end - 1);
    if (end < text.length && line >= start + CHUNK / 2) end = line + 1;
    const tail = text.charCodeAt(end - 1);
    if (end < text.length && tail >= 0xd800 && tail <= 0xdbff) end--;
    parts.push({ source, start, end });
    start = end;
  }
  return parts;
}
function bodyPlain(value: string) {
  return new DOMParser().parseFromString(value, 'text/html').body.textContent ?? '';
}
async function readStorySource(episodeId: string) {
  const { index, ids, keys, values } = await db.transaction('r', db.docs, async () => {
    const index = await episodeIndex();
    const ids = [...new Set([episodeId, index.chapters.find(chapter => !chapter.draft)?.episodeId ?? 'ep_001'])];
    const keys = ['episode:ep_001', ...ids.map(id => 'outline:' + id)];
    return { index, ids, keys, values: await db.docs.bulkGet(keys) };
  });
  const outlines = values.slice(1).flatMap((row, i) =>
    ((row?.payload as { docs?: { id: string; title: string; html: string }[] } | undefined)?.docs ?? [])
      .filter(item => item.id !== 'world').map(item => ({ episodeId: ids[i], title: item.title, text: bodyPlain(item.html) })),
  );
  const storySource = JSON.stringify({ chapters: index.chapters.filter(chapter => !chapter.draft).map(({ episodeId: id, title }) => ({ episodeId: id, title })), outlines });
  if (storySource.length > 50000) throw Error('目标与首集的大纲、章节目录超过 50000 字。请先缩小参考范围或整理大纲。');
  const sources = await Promise.all(keys.map(async (key, i) => ({
    key, label: key.startsWith('outline:') ? '大纲 · ' + ids[i - 1] : '现有章节目录',
    fingerprint: await scriptSetupFingerprint(values[i]?.payload ?? null), chars: 0,
  })));
  return { storySource, sources };
}
async function fallbackCanon() {
  const world = await readWorldview();
  const canon = world.entries.filter(entry => entry.status === 'canon');
  const full = [world.overview, ...canon.map(entry => '[' + entry.id + '] ' + entry.key + '：' + entry.value)].filter(Boolean).join('\n');
  return {text: full.length > 20000 ? full.slice(0, 20000) + '\n仅提供正史资料摘要，显示前 20000 字符。' : full,
    fingerprint: await scriptSetupFingerprint([world.overview, canon])};
}
async function extractionCoverage(range: ExtractionRange, id: string) {
  const sources: TaskSource[] = [];
  const parts: Part[] = [];
  if (range.kind === 'idea') {
    const text = taskText(range.text, 50000);
    sources.push({ key: 'idea:' + id, label: '粘贴想法', fingerprint: await scriptSetupFingerprint(text), chars: text.length });
    parts.push(...partsFor(text, 0));
  } else {
    const index = await episodeIndex();
    const chapters = index.chapters.filter(chapter => range.kind === 'written' || chapter.episodeId === range.episodeId);
    if (!chapters.length) throw Error('所选剧集已不存在。');
    if (range.kind === 'scenes' && !range.sceneIds.length) throw Error('请选择至少一个真实场次。');
    for (const chapter of chapters) {
      if (chapter.content?.trim() || chapter.episodeId !== 'ep_001' && !await db.docs.get('script:' + chapter.episodeId))
        await migrateChapterText(chapter.episodeId);
      const scenes = range.kind === 'scenes' ? [...new Set(range.sceneIds)] : [undefined];
      for (const sceneId of scenes) {
        const { source, content } = await sourceFor(chapter.episodeId, chapter.title, sceneId);
        if (!source.chars) continue;
        parts.push(...partsFor(content, sources.length));
        sources.push(source);
      }
    }
  }
  if (!parts.length) throw Error('选定范围没有已写正文。');
  return { sources, parts };
}

export async function previewScriptSetupTask(options: TaskOptions): Promise<ScriptSetupTaskPreview> {
  assertScriptSetupProject();
  await flushSources();
  const epoch = await readScriptSetupWorkspaceEpoch();
  const index = await episodeIndex();
  if (!index.chapters.some(chapter => chapter.episodeId === options.episodeId)) throw Error('当前剧集已不存在。');
  const id = crypto.randomUUID();
  const purpose = options.kind === 'extract' ? 'outline' : options.kind;
  const { snapshot } = await prepareScriptSetupContext({ purpose, episodeId: options.episodeId, requestText: options.request || undefined });
  const chapterCount = index.chapters.filter(chapter => !chapter.draft).length;
  const plannedCount = options.kind === 'episodePlan' ? setupInteger(options.count, 1, 200, '规划集数') : 0;
  const common = options.kind === 'extract' ? await extractionCoverage(options.range, id) : await readStorySource(options.episodeId);
  const parts = 'parts' in common ? common.parts : options.kind === 'outline' ? [{ source: 0, start: 0, end: 1 }]
    : Array.from({ length: Math.ceil(plannedCount / PLAN_BATCH) }, (_, i) => ({ source: 0, start: i * PLAN_BATCH, end: Math.min((i + 1) * PLAN_BATCH, plannedCount) }));
  const baseCanon = snapshot ? undefined : await fallbackCanon();
  const skillSource = await selectScriptSetupTaskSkill(options.skillChoice, options);
  if (await readScriptSetupWorkspaceEpoch() !== epoch) throw new ScriptSetupConflict('工作区已恢复，请重新预览。');
  const model = { providerId: options.model.providerId, modelId: options.model.modelId, providerLabel: options.model.providerLabel, label: options.model.label };
  return {
    chapterCount, plannedCount,
    task: validateScriptSetupTask({
      schemaVersion: 1, id, projectId: scriptSetupProjectId, workspaceEpoch: epoch, episodeId: options.episodeId,
      kind: options.kind, status: 'ready', revision: 1, createdAt: Date.now(), updatedAt: Date.now(),
      request: options.request, model, ...skillSource, snapshot, sources: common.sources, parts, completed: [],
      storySource: 'storySource' in common ? common.storySource : undefined, fallbackCanon: baseCanon,
      idea: options.kind === 'extract' && options.range.kind === 'idea' ? options.range.text : undefined,
      receipts: [],
    }),
  };
}

type TaskControl = { signal: AbortSignal; onChange: (task: ScriptSetupTask) => void };
function assertOrigin(task: ScriptSetupTask) {
  assertScriptSetupProject(task.projectId);
  return readScriptSetupWorkspaceEpoch().then(epoch => {
    if (epoch !== task.workspaceEpoch) throw new ScriptSetupConflict('工作区已恢复，旧任务保持历史状态。请重新预览。');
  });
}
function withTaskLock<T>(id: string, run: () => Promise<T>) {
  return navigator.locks.request('lum:scriptSetup:' + db.name + ':' + id, { ifAvailable: true }, lock => {
    if (!lock) throw Error('这个候选正在另一个窗口处理。');
    return run();
  });
}
export async function listScriptSetupTasks() {
  assertScriptSetupProject();
  const tasks: ScriptSetupTask[] = [];
  await db.docs.where('key').startsWith(SCRIPT_SETUP_TASK_PREFIX).each(row => {
    tasks.push(validateScriptSetupTask(row.payload, row.key));
  });
  return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
}
async function readTask(id: string) { return validateScriptSetupTask(await loadDoc(taskKey(id)), taskKey(id)); }
async function saveTask(task: ScriptSetupTask, expectedRevision?: number) {
  return db.transaction('rw', db.docs, async () => {
    await assertOrigin(task);
    const previous = await db.docs.get(taskKey(task.id));
    if (expectedRevision === undefined ? !!previous : !previous || (previous.payload as ScriptSetupTask).revision !== expectedRevision)
      throw new ScriptSetupConflict('候选任务已在其他窗口修改，请重新读取。');
    const next = validateScriptSetupTask({
      ...task, revision: expectedRevision === undefined ? 1 : expectedRevision + 1, updatedAt: Date.now(),
    });
    await saveDoc(taskKey(next.id), next);
    return next;
  });
}
async function checkedSource(task: ScriptSetupTask, source: TaskSource) {
  let content = '';
  let fingerprint: string;
  let revision: number | undefined;
  if (source.episodeId) {
    const fresh = await sourceFor(source.episodeId, source.label, source.sceneId);
    content = fresh.content;
    fingerprint = fresh.source.fingerprint;
    revision = fresh.source.revision;
  } else if (task.idea !== undefined) {
    content = task.idea;
    fingerprint = await scriptSetupFingerprint(content);
  } else fingerprint = await scriptSetupFingerprint(await loadDoc(source.key));
  if (source.fingerprint !== fingerprint || source.revision !== revision || source.chars !== content.length)
    throw new ScriptSetupConflict('来源已改变：' + source.label + '。原候选保留，请按最新范围重新预览。');
  return content;
}

export function runScriptSetupTask(task: ScriptSetupTask, control: TaskControl, resume = false) {
  return withTaskLock(task.id, async () => {
    await assertOrigin(task);
    let current = resume ? await readTask(task.id) : await saveTask(task);
    if (current.status === 'complete') return current;
    const guard = async () => {
      if (control.signal.aborted) throw new DOMException('已停止', 'AbortError');
      await assertOrigin(current);
    };
    async function report(update: Partial<ScriptSetupTask>) {
      current = await saveTask({ ...current, ...update }, current.revision);
      control.onChange(current);
    }
    try {
      await guard();
      const purpose = current.kind === 'extract' ? 'outline' : current.kind;
      const active = await compileScriptSetupContext({ purpose, episodeId: current.episodeId, overrideFields: current.snapshot?.overrideFields });
      await guard();
      if (!equalDocumentValue(active.snapshot, current.snapshot) || !active.snapshot && !equalDocumentValue(current.fallbackCanon, await fallbackCanon())) throw new ScriptSetupConflict('已确认设定、正史或项目来源已变化。原候选保留，请重新预览。');
      await report({ status: 'running', error: undefined });
      if (current.kind !== 'extract') for (const source of current.sources) await checkedSource(current, source);
      let cachedSource = -1;
      let sourceText = '';
      for (let partNumber = current.completed.length; partNumber < current.parts.length; partNumber++) {
        const part = current.parts[partNumber];
        await guard();
        const previous = current.kind === 'episodePlan' ? current.completed.flatMap(entry => entry.result.kind === 'episodePlan' ? entry.result.episodes : []) : [];
        const total = current.parts.at(-1)!.end;
        let prompt: ReturnType<typeof outlineTaskPrompt>;
        let segment = '';
        if (current.kind === 'extract') {
          if (cachedSource !== part.source) {
            sourceText = await checkedSource(current, current.sources[part.source]);
            cachedSource = part.source;
          }
          segment = sourceText.slice(part.start, part.end);
          prompt = extractTaskPrompt(current.sources[part.source].label + ' · ' + (part.start + 1) + '–' + part.end + ' 字符', segment);
        } else if (current.kind === 'outline') prompt = outlineTaskPrompt(current.request, current.storySource!);
        else prompt = episodePlanTaskPrompt(current.request, current.storySource!, part.start + 1, part.end, total, previous);

        await guard();
        const requestId = crypto.randomUUID();
        const cancel = () => { void cancelWriting(requestId).catch(() => {}); };
        control.signal.addEventListener('abort', cancel, { once: true });
        let raw: unknown;
        try { raw = await requestScriptSetupCandidate(requestId, current.model, current.skill, current.snapshot, prompt, current.fallbackCanon?.text); }
        finally { control.signal.removeEventListener('abort', cancel); }
        await guard();
        let result: TaskResult;
        if (current.kind === 'extract') {
          const suggestions = checkedExtraction(raw, segment).map(suggestion => suggestion.field === 'characters'
            ? { ...suggestion, value: (suggestion.value as UnboundCharacter[]).map(character =>
              ({ ...character, draftProfileId: crypto.randomUUID() })) } : suggestion);
          result = { kind: 'extract', suggestions };
        }
        else if (current.kind === 'outline') result = { kind: 'outline', outline: checkedOutline(raw) };
        else {
          const episodes = checkedEpisodeSuggestions(raw, part.end - part.start);
          if (episodes.some(episode => previous.some(item => item.title === episode.title))) throw Error('集纲候选与前批标题重复，请重新提交未完成的批次。');
          result = { kind: 'episodePlan', episodes };
        }
        const completed = [...current.completed, { part: partNumber, result }];
        await report({ completed, status: completed.length === current.parts.length ? 'complete' : 'running' });
      }
    } catch (error) {
      const stopped = control.signal.aborted;
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 12000) || '候选处理失败。';
      await report({
        status: stopped ? 'cancelled' : 'failed',
        error: stopped ? '已停止本地处理。已保存批次可查看；供应商状态以实际执行为准。' : detail,
      });
    }
    return current;
  });
}

export function taskEpisodeSuggestions(task: ScriptSetupTask) {
  return task.completed.flatMap(entry => entry.result.kind === 'episodePlan' ? entry.result.episodes : []);
}
function taskOutline(task: ScriptSetupTask) {
  const result = task.completed[0]?.result;
  if (result?.kind !== 'outline') throw Error('还没有可采纳的总纲。');
  return result.outline;
}
export async function taskReceipts(task: ScriptSetupTask) {
  const list: { link: TaskReceipt; change: WorkspaceChange | null; applied: boolean; episodes: { episodeId: string; title: string }[] }[] = [];
  await db.transaction('r', db.docs, async () => {
    for (const link of task.receipts) {
      const change = await getWorkspaceChange(link.operationId).catch(() => null);
      const documents = change?.docs.filter(row => row.key.startsWith('outline:')) ?? [];
      const chapters = (await episodeIndex()).chapters;
      const episodes = (change?.result.chapters ?? []) as { episodeId: string; title: string }[];
      const applied = change?.status === 'applied' && (documents.length > 0 || episodes.length > 0)
        && (await Promise.all(documents.map(async row => {
          // Other outline documents may be added later. Verify the actual inserted content by ID.
          const after = (row.after as { docs: { id: string; title: string; html: string }[] }).docs;
          const before = (row.before as { docs?: { id: string; title: string; html: string }[] } | undefined)?.docs ?? [];
          const inserted = after.filter(item => !before.some(old => old.id === item.id));
          const current = await loadDoc<{ docs: typeof after }>(row.key);
          return inserted.length > 0 && inserted.every(item => current?.docs.some(found => equalDocumentValue(found, item)));
        }))).every(Boolean)
        && episodes.every(episode => chapters.some(item => item.episodeId === episode.episodeId && item.title === episode.title && !item.draft)
          && change.scripts.some(script => script.episodeId === episode.episodeId && !!script.applied))
        && (await Promise.all(episodes.map(async episode => !!await db.docs.get('script:' + episode.episodeId)))).every(Boolean);
      list.push({ link, change, applied: !!applied, episodes: applied ? episodes : [] });
    }
  });
  return list;
}

async function checkAdoptionSources(task: ScriptSetupTask, receipts: Awaited<ReturnType<typeof taskReceipts>>, start: number) {
  const prior = receipts.filter(receipt => receipt.applied && receipt.link.start < start).sort((a, b) => a.link.start - b.link.start);
  let covered = 0;
  for (const receipt of prior) {
    if (receipt.link.start !== covered) throw Error('历史批次次序已变化，请核对旧回执。');
    covered += receipt.link.count;
  }
  if (covered !== start) throw Error('前序采纳记录已变化，请核对旧回执。');
  for (const source of task.sources) {
    const existing = prior.findLast(receipt => receipt.change?.docs.some(row => row.key === source.key));
    const written = existing?.change?.docs.find(row => row.key === source.key);
    if (written) {
      if (!equalDocumentValue(await loadDoc(source.key), written.after))
        throw new ScriptSetupConflict('采纳后目录或参考大纲已改变：' + source.label + '。请核对候选后重新规划。');
    } else await checkedSource(task, source);
  }
}

export async function adoptScriptSetupTask(id: string) {
  return withTaskLock(id, async () => {
    const mode = scriptSetupWriteMode();
    if (mode === 'read') throw Error('只读模式可以查看候选，不能采纳。');
    await flushSources();
    let task = await readTask(id);
    await assertOrigin(task);
    if (task.status !== 'complete' || task.kind === 'extract') throw Error('只有完整总纲或集纲候选可采纳。');
    let change = await db.transaction('rw', db.docs, db.entities, async () => {
      await assertOrigin(task);
      await assertAdoptionSetup(task);
      const receipts = await taskReceipts(task);
      if (receipts.some(item => !item.change)) throw Error('候选写入回执缺失，请核对历史后重新规划。');
      if (receipts.some(receipt => receipt.change?.status === 'pending')) throw Error('请先处理本候选的待审批提案。');
      if (receipts.some(receipt => receipt.change?.status === 'applied' && !receipt.applied))
        throw Error('实际目标内容已变化。请核对旧回执和候选后重新规划。');
      const start = receipts.filter(item => item.applied).reduce((count, item) => count + item.link.count, 0);
      const outline = task.kind === 'outline' ? taskOutline(task) : undefined;
      const chapters = taskEpisodeSuggestions(task).slice(start, start + ADOPT_BATCH);
      if (outline ? start !== 0 : !chapters.length) throw Error('本候选已采纳。');
      await checkAdoptionSources(task, receipts, start);
      const snapshot = await readDocument(task.episodeId);
      const scope = { snapshot, scriptSetup: task.snapshot, editableIds: [], readOnly: false, allowAppend: true, autoWrite: mode === 'write' };
      const candidate = { taskId: task.id, appendEpisodePlan: task.kind === 'episodePlan' };
      const prepared = outline
        ? await prepareStructuredTool('writeOutline', { episodeId: task.episodeId, op: 'create', ...outline }, scope, candidate)
        : await prepareStructuredTool('editEpisodes', { op: 'plan', chapters }, scope, candidate);
      task = await saveTask({ ...task, receipts: [...task.receipts, { start, count: outline ? 1 : chapters.length, operationId: prepared.id }] }, task.revision);
      return prepared;
    });
    if (mode === 'write' && scriptSetupWriteMode() === 'write') change = await commitTaskChange(task, change.id, false);
    return { task, change };
  });
}
async function assertAdoptionSetup(task: ScriptSetupTask) {
  const kind = task.kind;
  if (kind === 'extract') throw Error('提取候选不写入项目大纲。');
  const active = await compileScriptSetupContext({ purpose: kind, episodeId: task.episodeId, overrideFields: task.snapshot?.overrideFields });
  if (!active.snapshot && !equalDocumentValue(task.fallbackCanon, await fallbackCanon())) throw new ScriptSetupConflict('已确认世界观已改变，请重新预览。');
  const relevantSources = (value: ScriptSetupSnapshot | null) => value?.sourceVersions.filter(source => source.key === 'project:meta' || source.key.startsWith('project:worldview'));
  if (active.snapshot?.setupVersionId !== task.snapshot?.setupVersionId ||
    !equalDocumentValue(relevantSources(active.snapshot), relevantSources(task.snapshot)) ||
    !equalDocumentValue(active.snapshot?.omittedSetupFields, task.snapshot?.omittedSetupFields) ||
    !equalDocumentValue(active.snapshot?.profileVersions, task.snapshot?.profileVersions))
    throw new ScriptSetupConflict('设定、正史或人物档案已改变，请重新核对后生成候选。');
}
async function commitTaskChange(task: ScriptSetupTask, operationId: string, approved: boolean, refresh = true) {
  const change = await db.transaction('rw', db.docs, db.entities, async () => {
    await assertOrigin(task);
    const mode = scriptSetupWriteMode();
    if (mode === 'read' || !approved && mode !== 'write') throw Error('当前写入模式要求另行批准。');
    const receipt = task.receipts.find(item => item.operationId === operationId);
    if (!receipt) throw Error('该提案不属于此候选。');
    const validateSources = async (taskId: string) => {
      if (taskId !== task.id) throw Error('该提案不属于此候选。');
      await assertAdoptionSetup(task);
      await checkAdoptionSources(task, await taskReceipts(task), receipt.start);
    };
    const pending = await getWorkspaceChange(operationId);
    if (!pending.scriptSetupTaskId && pending.status === 'pending') await validateSources(task.id);
    return applyWorkspaceChange(operationId, approved ? { approvedByUser: true } : { agentWriteEnabled: true }, validateSources);
  });
  if (refresh && change.status === 'applied') {
    window.dispatchEvent(new Event('dsh:episodes-changed'));
    window.dispatchEvent(new Event('dsh:content-updated'));
  }
  return change;
}
export async function decideScriptSetupTaskChange(id: string, operationId: string, approve: boolean, refresh = true) {
  return withTaskLock(id, async () => {
    const task = await readTask(id);
    await assertOrigin(task);
    if (!task.receipts.some(receipt => receipt.operationId === operationId)) throw Error('该提案不属于此候选。');
    if (approve) { await flushSources(); return commitTaskChange(task, operationId, true, refresh); }
    return db.transaction('rw', db.docs, db.entities, async () => {
      await assertOrigin(task);
      return rejectWorkspaceChange(operationId);
    });
  });
}

export function validateScriptSetupTask(value: unknown, key?: string): ScriptSetupTask {
  const task = taskObject(value, ['schemaVersion', 'id', 'projectId', 'workspaceEpoch', 'episodeId', 'kind', 'status', 'revision', 'createdAt',
    'updatedAt', 'request', 'model', 'skill', 'skillSelection', 'snapshot', 'sources', 'parts', 'completed', 'storySource', 'fallbackCanon', 'idea', 'receipts', 'error']);
  const id = taskText(task.id, 80);
  if (task.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(id) || key !== undefined && key !== taskKey(id)
    || !['extract', 'outline', 'episodePlan'].includes(String(task.kind)) || !['ready', 'running', 'complete', 'cancelled', 'failed'].includes(String(task.status)))
    throw Error('任务 ID、状态或版本无效。');
  taskText(task.projectId, 200); taskText(task.workspaceEpoch, 100, true); taskText(task.episodeId, 200);
  for (const field of ['revision', 'createdAt', 'updatedAt']) setupInteger(task[field], 1, Number.MAX_SAFE_INTEGER, '候选任务版本');
  taskText(task.request, 12000, true);
  if (task.error !== undefined) taskText(task.error, 12000);
  if (task.fallbackCanon !== undefined) {
    if (task.snapshot !== null) throw Error('已有设定快照的候选不能使用另一份正史。');
    const canon = taskObject(task.fallbackCanon, ['text', 'fingerprint']);
    taskText(canon.text, 20200, true); setupFingerprint(canon.fingerprint, '正史来源指纹');
  }
  const model = taskObject(task.model, ['providerId', 'modelId', 'providerLabel', 'label']);
  taskText(model.providerId, 1000); taskText(model.modelId, 1000); taskText(model.providerLabel, 1000, true); taskText(model.label, 1000, true);
  if (task.skillSelection !== undefined) {
    validateTaskSkillSelection(task.skillSelection, task.skill);
    if (task.skill !== undefined) validateAgentSkillSnapshot(task.skill);
  } else if (task.skill !== undefined && !validateSkill(task.skill).uses.includes('agent')) throw Error('候选 Skill 用途无效。');
  if (task.snapshot === null && task.fallbackCanon === undefined) throw Error('候选缺少正史来源。');
  if (task.snapshot !== null) {
    const snapshot = validateScriptSetupSnapshot(task.snapshot);
    if (snapshot.projectId !== task.projectId || snapshot.workspaceEpoch !== task.workspaceEpoch || snapshot.episodeId !== task.episodeId
      || snapshot.purpose !== (task.kind === 'extract' ? 'outline' : task.kind))
      throw Error('候选快照项目、工作区或目标不一致。');
  }
  const sources = taskArray(task.sources, 10000, raw => {
    const source = taskObject(raw, ['key', 'label', 'fingerprint', 'chars', 'episodeId', 'revision', 'sceneId']);
    taskText(source.key, 1000); taskText(source.label, 102000); setupFingerprint(source.fingerprint, '正文指纹');
    setupInteger(source.chars, 0, 10_000_000, '来源字符数量');
    if (source.episodeId !== undefined) {
      taskText(source.episodeId, 200); setupInteger(source.revision, 0, Number.MAX_SAFE_INTEGER, '正文版本');
      if (source.sceneId !== undefined) taskText(source.sceneId, 200);
      if (source.key !== 'script:' + source.episodeId + (source.sceneId ? ':scene:' + source.sceneId : '')) throw Error('来源文档 ID 无效。');
    } else if (source.sceneId !== undefined || source.revision !== undefined) throw Error('来源版本无效。');
    return source as unknown as TaskSource;
  }, 1);
  if (new Set(sources.map(source => source.key)).size !== sources.length) throw Error('候选来源重复。');
  const bySource = Array<number>(sources.length).fill(0);
  const parts = taskArray(task.parts, 100000, raw => {
    const part = taskObject(raw, ['source', 'start', 'end']);
    const source = setupInteger(part.source, 0, sources.length - 1, '来源索引');
    const endLimit = task.kind === 'extract' ? sources[source].chars : task.kind === 'outline' ? 1 : 200;
    const begin = setupInteger(part.start, 0, endLimit - 1, '范围起点');
    const end = setupInteger(part.end, begin + 1, endLimit, '范围终点');
    if (begin !== bySource[source] || end - begin > (task.kind === 'extract' ? CHUNK : PLAN_BATCH)) throw Error('候选任务范围不连续。');
    bySource[source] = end;
    return { source, start: begin, end };
  }, 1);
  if (task.kind === 'extract') {
    if (sources.some((source, i) => source.chars <= 0 || bySource[i] !== source.chars)) throw Error('候选提取范围不完整。');
    if (task.idea !== undefined) {
      if (taskText(task.idea, 50000).length !== sources[0].chars || sources.length !== 1 || sources[0].key !== 'idea:' + id)
        throw Error('候选想法来源失配。');
    } else if (sources.some(source => !source.episodeId)) throw Error('候选缺少真实正文来源。');
  } else {
    taskText(task.storySource, 50000);
    if (sources.some(source => source.episodeId || source.chars) || parts.some(part => part.source !== 0) || task.idea !== undefined)
      throw Error('大纲候选来源无效。');
  }
  let expected = 0;
  const episodeTitles = new Set<string>();
  const completed = taskArray(task.completed, parts.length, raw => {
    const entry = taskObject(raw, ['part', 'result']);
    if (entry.part !== expected) throw Error('候选完成记录重复或不连续。');
    const part = parts[expected++];
    const resultField = task.kind === 'extract' ? 'suggestions' : task.kind === 'outline' ? 'outline' : 'episodes';
    const result = taskObject(entry.result, ['kind', resultField]);
    if (result.kind !== task.kind) throw Error('候选结果类型与任务不符。');
    if (result.kind === 'extract') checkedExtraction(result.suggestions);
    if (result.kind === 'outline') checkedOutline(result.outline);
    if (result.kind === 'episodePlan') for (const episode of checkedEpisodeSuggestions(result.episodes, part.end - part.start)) {
      if (episodeTitles.has(episode.title)) throw Error('集纲候选标题重复。');
      episodeTitles.add(episode.title);
    }
    return entry;
  });
  if ((task.status === 'complete') !== (completed.length === parts.length)) throw Error('候选任务状态与实际完成范围不符。');
  const receipts = new Set<string>();
  taskArray(task.receipts, 2000, raw => {
    const receipt = taskObject(raw, ['start', 'count', 'operationId']);
    const max = task.kind === 'episodePlan' ? episodeTitles.size : task.kind === 'outline' ? 1 : 0;
    const start = setupInteger(receipt.start, 0, max - 1, '采纳起点');
    setupInteger(receipt.count, 1, Math.min(ADOPT_BATCH, max - start), '采纳范围');
    const id = taskText(receipt.operationId, 200);
    if (receipts.has(id) || task.status !== 'complete') throw Error('候选操作回执重复或无效。');
    receipts.add(id);
  });
  return value as ScriptSetupTask;
}
export function validateScriptSetupTaskBackup(rows: readonly DocRow[]) {
  const mediaIds: string[] = [];
  const index = new Map(rows.map(row => [row.key, row.payload]));
  const linked = new Set<string>();
  for (const row of rows) {
    if (!row.key.startsWith(SCRIPT_SETUP_TASK_PREFIX)) continue;
    const task = validateScriptSetupTask(row.payload, row.key);
    for (const receipt of task.receipts) {
      const proposalKey = 'writing:workspaceChange:' + receipt.operationId;
      const change = index.get(proposalKey) as WorkspaceChange | undefined;
      if (change?.id !== receipt.operationId || linked.has(proposalKey) || change.scriptSetupTaskId !== undefined && change.scriptSetupTaskId !== task.id || !Array.isArray(change.docs) || !Array.isArray(change.scripts)
          || !['pending', 'applied', 'undone', 'rejected'].includes(change.status))
        throw Error('备份中的候选操作回执缺失或无效。');
      linked.add(proposalKey);
    }
    if (task.snapshot?.visual.style.referenceMediaId) mediaIds.push(task.snapshot.visual.style.referenceMediaId);
  }
  for (const row of rows) {
    if (row.key.startsWith('writing:workspaceChange:') && (row.payload as WorkspaceChange | undefined)?.scriptSetupTaskId !== undefined && !linked.has(row.key))
      throw Error('备份缺少写入提案对应的剧本设定候选。');
  }
  return mediaIds;
}

