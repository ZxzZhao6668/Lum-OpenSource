import { WORLD_ENTRIES, validateWorldEntries } from '../worldview/worldviewModel';
import { db } from '../data/db';
import { projectStorageKey } from '../projects/projectIdentity';
import { node, modal } from '../ui/localUi';
import { readDocument } from '../writing/documentStore';
import { prepareStructuredTool } from '../writing/structuredTools';
import { applyWorkspaceChange, getWorkspaceChange } from '../writing/workspaceChanges';
import { getActiveWritingEditor } from '../script/editor';
import { getActiveContentEditor } from '../writing/contentEditor';
import {
  compileScriptSetupContext, previewScriptSetupCanon, requiresCanonReview, saveCanonResolution, setupFieldValue,
  ScriptSetupCanonConflict, type CanonReview, type CompiledScriptSetup, type ScriptSetupContextOptions,
} from './scriptSetupContext';
import { PROFILE_FIELDS, SETUP_FIELDS, type ScriptSetupPayload, type SetupField } from './scriptSetupModel';
import { assertScriptSetupProject, readScriptSetupWorkspaceEpoch, ScriptSetupConflict } from './scriptSetupStore';
import { button, checkbox, note, subtitle, textControl } from './setupControls';
import './scriptSetupPanel.css';

export function scriptSetupWriteMode() {
  const mode = localStorage.getItem(projectStorageKey('writing:mode'));
  return mode === 'read' ? 'read' : mode === 'review' ? 'review' : 'write';
}

export function askCanonResolution(initial: CanonReview, payload: ScriptSetupPayload, episodeId: string, readOnly = false) {
  return new Promise<{ review: CanonReview; omittedFields: SetupField[] } | null>(resolve => {
    const { dialog, body } = modal('核对剧本设定与正史');
    dialog.classList.add('scriptSetupDialog');
    let settled = false;
    let updating = false;
    let review = initial;
    const omitted = new Set<SetupField>();
    const message = note('');
    message.setAttribute('role', 'status');
    function finish(result: Parameters<typeof resolve>[0]) {
      if (settled) return;
      settled = true;
      resolve(result);
    }
    dialog.addEventListener('close', () => finish(null), { once: true });
    function render() {
      body.replaceChildren(
        note('逐项对照下方剧本设定和已确认事实。勾选与正史冲突的字段可在新任务中略去它们，未勾选的字段将按你确认的兼容关系使用。'),
        subtitle('本版剧本设定'),
      );
      if (!review.fields.length) body.append(note('没有需要对照的叙事字段。'));
      for (const field of review.fields) {
        const details = node('details', '', 'ssGroup');
        details.append(node('summary', SETUP_FIELDS[field]), node('pre', JSON.stringify(setupFieldValue(payload, field), null, 2)));
        const option = checkbox('采用正史，略去' + SETUP_FIELDS[field], omitted.has(field), checked => {
          if (checked) omitted.add(field); else omitted.delete(field);
          confirm.disabled = review.missingRefs.length > 0 && !omitted.has('setting');
        });
        body.append(details, option);
      }
      if (review.profiles.length) {
        const profiles = node('details', '', 'ssGroup');
        profiles.append(node('summary', '关联的已应用人物档案'), node('pre', JSON.stringify(review.profiles, null, 2)));
        body.append(profiles);
      }
      if (review.staleRefs.length) body.append(note('需要重新核对的正史引用：' + review.staleRefs.join('、') + '。已改变的条目使用下方所示版本。已取消确认或删除的条目需要重新关联，或在新任务中略去时代 / 世界。'));
      body.append(subtitle('已确认世界观'));
      if (review.overview.trim()) {
        const overview = node('details', '', 'ssGroup');
        overview.append(node('summary', '项目世界观概览'), node('pre', review.overview));
        body.append(overview);
      }
      if (!review.canon.length) body.append(note('当前没有仍生效的已确认条目。'));
      for (const entry of review.canon) {
        const details = node('details', '', 'ssGroup'); details.open = review.canon.length <= 4 || review.staleRefs.includes(entry.id);
        details.append(node('summary', entry.category + ' · ' + entry.key + ' [' + entry.id + ']'), node('pre', entry.value));
        if (!readOnly && scriptSetupWriteMode() !== 'read') details.append(button('编辑此正史条目', () => {
          if (details.querySelector('textarea')) return;
          const value = textControl('新的已确认条目内容', entry.value, () => {}, { max: 20000, multiline: true });
          const actions = node('div', '', 'ssRow');
          const propose = button('提交世界观条目更新', () => void persist(), 'ssPrimary');
          actions.append(propose, button('取消编辑', () => {value.wrap.remove();actions.remove();}));
          details.append(value.wrap, actions); value.input.focus();
          async function persist() {
            if (updating) return;
            updating = true;
            confirm.disabled = true;
            propose.disabled = true;
            try {
              const mode = scriptSetupWriteMode();
              if (mode === 'read') throw Error('只读模式不能更新世界观。');
              if (value.input.value.trim() === entry.value.trim()) throw Error('条目内容没有修改。');
              await getActiveWritingEditor()?.flush();
              await getActiveContentEditor()?.flush();
              const snapshot = await readDocument(episodeId);
              const userPrompt = '保存世界观：明确更新选定的已确认条目';
              const change = await db.transaction('rw', db.docs, db.entities, async () => {
                assertScriptSetupProject(review.projectId);
                if (await readScriptSetupWorkspaceEpoch() !== review.workspaceEpoch) throw new ScriptSetupConflict();
                const current = validateWorldEntries(await db.docs.get(WORLD_ENTRIES).then(row => row?.payload) ?? []);
                if (JSON.stringify(current.find(item => item.id === entry.id)) !== JSON.stringify(entry)) throw Error('正史条目已变化，请重新打开核对。');
                return prepareStructuredTool('editWorldview', {
                  op: 'set', entries: [{ id: entry.id, value: value.input.value, status: 'canon' }], userRequestQuote: userPrompt,
                }, { snapshot, editableIds: [], readOnly: false, userPrompt });
              });
              message.textContent = '世界观提案待审批 · ' + change.id;
              async function commit() {
                if (!dialog.open) throw Error('已关闭核对，提案仍留在写入记录。');
                const currentMode = scriptSetupWriteMode();
                if (currentMode === 'read') throw Error('当前为只读模式，提案仍待审批。');
                const receipt = await db.transaction('rw', db.docs, db.entities, async () => {
                  assertScriptSetupProject(review.projectId);
                  if (await readScriptSetupWorkspaceEpoch() !== review.workspaceEpoch) throw new ScriptSetupConflict();
                  if (!dialog.open) throw Error('已关闭核对，提案仍留在写入记录。');
                  return applyWorkspaceChange(change.id, { approvedByUser: true });
                });
                if (receipt.status !== 'applied' || (await getWorkspaceChange(receipt.id)).status !== 'applied') throw Error('未收到已应用的正史回执。');
                if (!dialog.open) return;
                review = await previewScriptSetupCanon(payload);
                omitted.clear();
                message.textContent = '已写入正史 · ' + receipt.id + '。请核对新版本。';
                window.dispatchEvent(new CustomEvent('dsh:content-updated', { detail: { kind: 'worldview' } }));
                updating = false;
                render();
              }
              if (mode === 'write') await commit();
              else actions.replaceChildren(button('批准写入此条目', b => {
                if (updating) return;
                updating = true; b.disabled = true; confirm.disabled = true;
                void commit().catch(error => { message.textContent = String(error); b.disabled = false; })
                  .finally(() => { updating = false; confirm.disabled = review.missingRefs.length > 0 && !omitted.has('setting'); });
              }, 'ssPrimary'));
            } catch (error) { message.textContent = error instanceof Error ? error.message : String(error); propose.disabled = false; }
            finally { updating = false; confirm.disabled = review.missingRefs.length > 0 && !omitted.has('setting'); }
          }
        }));
        body.append(details);
      }
      const confirm = button('确认按上述核对结果使用', () => {
        if (updating) return;
        finish({ review, omittedFields: [...omitted] });
        dialog.close();
      }, 'ssPrimary');
      confirm.disabled = updating || review.missingRefs.length > 0 && !omitted.has('setting');
      const actions = node('div', '', 'ssRow'); actions.append(confirm, button('返回修改设定', () => dialog.close()));
      body.append(message, actions);
    }
    render();
  });
}

async function reviewLocks(snapshot: NonNullable<CompiledScriptSetup['snapshot']>, requestText: string) {
  const projectLocks = snapshot.payload.constraints.lockedFields;
  const profileLocks = snapshot.characters.filter(character => character.profile?.lockedFields.length);
  return new Promise<SetupField[] | null>(resolve => {
    const { dialog, body } = modal('确认本次请求与锁定设定');
    dialog.classList.add('scriptSetupDialog');
    const selection = new Set<SetupField>();
    body.append(note(projectLocks.length || profileLocks.length ? '请核对本次要求与锁定字段。如需改动锁定事实，返回设定器或人物档案后再提交。' : '如需临时改用本次偏好，可展开并选择覆盖字段。'),
      subtitle('本次要求'), node('pre', requestText));
    for (const field of projectLocks) {
      const value = field === 'characters' ? snapshot.characters : setupFieldValue(snapshot.payload, field);
      const details = node('details', '', 'ssGroup');
      details.append(node('summary', SETUP_FIELDS[field] + ' · 已锁定'), node('pre', JSON.stringify(value, null, 2)));
      body.append(details);
    }
    for (const character of profileLocks) {
      const profile = character.profile!;
      const values = Object.fromEntries(profile.lockedFields.map(field => [PROFILE_FIELDS[field as keyof typeof PROFILE_FIELDS] ?? field, profile[field]]));
      const details = node('details', '', 'ssGroup');
      details.append(node('summary', character.name + ' [' + (character.entityId ?? character.draftProfileId) + '] · 锁定人设'), node('pre', JSON.stringify(values, null, 2)));
      body.append(details);
    }
    const overrides = node('details', '', 'ssGroup');
    overrides.append(node('summary', '本次覆盖未锁定的创作偏好'));
    for (const [field, label] of Object.entries(SETUP_FIELDS) as [SetupField, string][]) {
      if (projectLocks.includes(field) || snapshot.omittedSetupFields.includes(field) ||
        (field === 'characters' && profileLocks.length) || field === 'mustKeep' || field === 'mustAvoid') continue;
      overrides.append(checkbox('按本次要求处理' + label, false, checked => { if (checked) selection.add(field); else selection.delete(field); }));
    }
    body.append(overrides, button(projectLocks.length || profileLocks.length ? '遵守锁定字段并继续' : '继续本次请求', () => { resolve([...selection]); dialog.close(); }, 'ssPrimary'),
      button('返回修改本次要求', () => dialog.close()));
    dialog.addEventListener('close', () => resolve(null), { once: true });
  });
}

/** Presents a visible preflight before the caller can send a request. */
export async function prepareScriptSetupContext(
  options: ScriptSetupContextOptions,
  controls: { cancelled?: () => boolean; readOnly?: boolean } = {},
): Promise<CompiledScriptSetup> {
  let compiled: CompiledScriptSetup;
  for (;;) {
    if (controls.cancelled?.()) throw Error('已停止，未发送模型请求。');
    try {
      compiled = await compileScriptSetupContext(options);
      break;
    } catch (error) {
      if (!(error instanceof ScriptSetupCanonConflict)) throw error;
      const result = await askCanonResolution(error.review, error.payload, options.episodeId, controls.readOnly);
      if (!result || controls.cancelled?.()) throw Error('已取消，本次未发送模型请求。');
      await saveCanonResolution(result.review, result.omittedFields, error.revision, error.versionId);
    }
  }
  if (!options.requestText || !compiled.snapshot || options.overrideFields !== undefined) return compiled;
  const overrides = await reviewLocks(compiled.snapshot, options.requestText);
  if (!overrides || controls.cancelled?.()) throw Error('已取消，本次未发送模型请求。');
  const refreshed = await compileScriptSetupContext({ ...options, overrideFields: overrides });
  if (!refreshed.snapshot || refreshed.snapshot.setupVersionId !== compiled.snapshot.setupVersionId
    || JSON.stringify(refreshed.snapshot.profileVersions) !== JSON.stringify(compiled.snapshot.profileVersions) && !overrides.includes('characters')
    || JSON.stringify(refreshed.snapshot.sourceVersions) !== JSON.stringify(compiled.snapshot.sourceVersions))
    throw new ScriptSetupConflict('锁定字段或来源已变化，请重新预览后提交。');
  return overrides.length ? refreshed : compiled;
}

export async function reviewSetupBeforeSave(payload: ScriptSetupPayload, episodeId: string) {
  const review = await previewScriptSetupCanon(payload);
  return requiresCanonReview(review) ? askCanonResolution(review, payload, episodeId) : { review, omittedFields: [] };
}

