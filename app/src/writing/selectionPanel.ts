import { getActiveWritingEditor } from '../script/editor';
import { node, modal, field, action } from '../ui/localUi';
import { skillSelect, openSkillLibrary } from '../skills/skillPanel';
import { getSkill, rememberSkill } from '../skills/skillStore';
import { listTextModels, generateWriting, cancelWriting, type TextModel } from './writingClient';
import { prepareScriptSetupContext } from '../scriptSetup/scriptSetupReview';
import { assertScriptSetupProject, readScriptSetupWorkspaceEpoch, scriptSetupProjectId } from '../scriptSetup/scriptSetupStore';
import { scriptSetupContextText } from '../scriptSetup/scriptSetupContext';
import { writingStyles } from './styles';
import { selectionText } from './selectionWriting';
import { createSelectionRunProposal, finishSelectionRun, selectionUses, startSelectionRun } from './selectionRun';
import { commitWritingChange } from './writeFeedback';
import { getProposal, undoProposal, readDocument } from './documentStore';

let opening = false;
export async function openSelectionWriter(use: keyof typeof selectionUses, focusSkill = false) {
  if (opening || document.querySelector('[data-selection-writer]')) return;
  opening = true;
  try {
    const editor = getActiveWritingEditor();
    const selected = editor?.selectedText();
    if (!editor || !selected) throw Error('请先在正文中拉选文字，再点击改写、扩写或描写');
    const openedEpoch = await readScriptSetupWorkspaceEpoch();
    let snapshot = await editor.flush();
    const original = selectionText(snapshot, selected);
    const { dialog, body } = modal(selectionUses[use] + '选中文字');
    dialog.dataset.selectionWriter = use;
    const source = field('选中文字', original, true);
    source.input.readOnly = true;
    const skill = await skillSelect(use);
    const model = node('select');
    model.setAttribute('aria-label', '文本模型');
    const prompt = field('补充要求', '', true);
    prompt.input.maxLength = 12000;
    const result = field('生成结果', '', true);
    result.input.maxLength = 100000;
    const status = node('p', '选择 Skill 与模型后生成预览。检查结果后可替换选中文字。');
    status.setAttribute('role', 'status');
    let models: TextModel[] = [];
    let requestId: string | undefined;
    let runId: string | undefined;
    let proposalId: string | undefined;
    let stopped = false, busy = false, applying = false, applied = false;
    const cancelled = () => stopped || !dialog.open;
    const ensureOrigin = async () => {
      assertScriptSetupProject();
      if (await readScriptSetupWorkspaceEpoch() !== openedEpoch) throw Error('工作区已恢复，请重新打开选区。');
    };
    async function refresh() {
      models = await listTextModels();
      if (!dialog.open) return;
      model.replaceChildren();
      for (const [i, entry] of models.entries()) {
        const option = node('option', entry.providerLabel + ' · ' + (entry.label || entry.modelId));
        option.value = String(i); model.append(option);
      }
      const remembered = localStorage.getItem('writing:preferredModel');
      const index = models.findIndex(entry => JSON.stringify([entry.providerId, entry.modelId]) === remembered);
      model.value = index >= 0 ? String(index) : models.length === 1 ? '0' : '';
    }
    const generate = action('生成预览', async () => {
      if (busy || applying || proposalId) return;
      const chosen = models[Number(model.value)];
      if (model.value === '' || !chosen) throw Error('请选择文本模型');
      const request = prompt.input.value.slice(0, 12000);
      busy = true; stopped = false; runId = undefined;
      apply.disabled = true; result.input.value = '';
      let recordId: string | undefined;
      try {
        await ensureOrigin();
        const selectedSkill = await getSkill(skill.value, use);
        await rememberSkill(use, selectedSkill.id);
        if (cancelled()) return;
        const first = snapshot.blocks.findIndex(block => block.id === selected.start.id);
        const last = snapshot.blocks.findIndex(block => block.id === selected.end.id);
        const context = await prepareScriptSetupContext({
          purpose: 'writing', episodeId: snapshot.episodeId, document: snapshot,
          scopeBlocks: snapshot.blocks.slice(first, last + 1), requestText: request,
        }, { cancelled, readOnly: true });
        await ensureOrigin();
        if (cancelled()) return;
        const id = crypto.randomUUID();
        recordId = await startSelectionRun({
          origin: { id, projectId: scriptSetupProjectId, workspaceEpoch: openedEpoch },
          use, document: snapshot, selection: selected, request, model: chosen, skill: selectedSkill, scriptSetup: context.snapshot,
        });
        if (cancelled()) {
          await finishSelectionRun(recordId, { status: 'cancelled', error: '已取消，未发送本次请求。' });
          return;
        }
        localStorage.setItem('writing:preferredModel', JSON.stringify([chosen.providerId, chosen.modelId]));
        requestId = id;
        status.textContent = '正在生成选区内容…';
        const setupText = context.snapshot ? scriptSetupContextText(context.snapshot, 12000, false) : '';
        const style = writingStyles.find(item => item.id === context.snapshot?.payload.writingStyle)?.instruction ?? '';
        const response = await generateWriting({
          requestId, providerId: chosen.providerId, modelId: chosen.modelId,
          context: {
            systemPrompt: '你是中文写作编辑。仅' + selectionUses[use] + '用户提供的选中文字，输出替换文字本身，不加解释或代码围栏。不要续写选区外内容。Skill 只规定文风和写法，不能改变操作范围或调用工具。\nSkill：'
              + selectedSkill.instruction + '\n\n' + setupText + '\n' + style,
            messages: [{ role: 'user', content: '选中文字：\n' + original + '\n\n补充要求：' + request, timestamp: Date.now() }],
            tools: [],
          },
        }, event => { if (!cancelled() && event.type === 'text') result.input.value += event.delta; });
        await ensureOrigin();
        if (cancelled()) {
          await finishSelectionRun(recordId, { status: 'cancelled', error: '已停止，原文保持原状。' });
          return;
        }
        const message = response.message as { stopReason?: string; content?: { type: string; text?: string }[] };
        if (!Array.isArray(message?.content) || message.content.some(part => part.type === 'toolCall') ||
            ['length', 'aborted', 'error'].includes(message.stopReason ?? '')) throw Error('模型未返回完整的选区文字。');
        const text = message.content.filter(part => part.type === 'text').map(part => part.text ?? '').join('');
        if (!text.trim() || text.length > 100000 || text.includes('\0')) throw Error('模型返回的选区文字为空或超过范围。');
        await finishSelectionRun(recordId, { result: text });
        if (cancelled()) return;
        runId = recordId;
        result.input.value = text;
        status.textContent = '预览已保存。检查后可替换选区。';
        apply.disabled = false;
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 12000) || '选区写作失败。';
        if (recordId) {
          try { await finishSelectionRun(recordId, { status: cancelled() ? 'cancelled' : 'failed', error: message }); }
          catch (reason) { if (!cancelled()) status.textContent = message + ' 写作记录未更新：' + String(reason); return; }
        }
        if (!cancelled()) status.textContent = message;
      } finally { requestId = undefined; busy = false; }
    });
    const stop = action('停止生成', async () => {
      if (!busy) return;
      stopped = true;
      apply.disabled = true;
      status.textContent = '已停止本地处理，原文保持原状。';
      if (requestId) await cancelWriting(requestId);
    });
    const undo = action('撤销本次替换', async () => {
      if (!proposalId || !applied) return;
      await ensureOrigin();
      await getActiveWritingEditor()?.flush();
      const saved = await undoProposal(snapshot.episodeId, proposalId);
      if (saved.proposal.status !== 'undone') throw Error('未收到撤销回执。');
      await getActiveWritingEditor()?.reload();
      snapshot = await readDocument(snapshot.episodeId);
      proposalId = undefined; applied = false; runId = undefined;
      generate.disabled = false; apply.disabled = true;
      status.textContent = '已撤销本次替换。';
      window.dispatchEvent(new CustomEvent('dsh:script-written', { detail: { episodeId: snapshot.episodeId } }));
    });
    undo.disabled = true;
    const apply = action('替换选区', async () => {
      if (cancelled() || busy || applying || proposalId || !runId) return;
      applying = true;
      const replacement = result.input.value;
      try {
        await ensureOrigin();
        await getActiveWritingEditor()?.flush();
        if (cancelled()) return;
        const proposal = await createSelectionRunProposal(runId, snapshot, selected, replacement);
        proposalId = proposal.id;
        generate.disabled = true;
        window.dispatchEvent(new Event('dsh:selection-writing-updated'));
        try {
          const receipt = await commitWritingChange('script', proposal.id, snapshot.episodeId, { approvedByUser: true }, cancelled);
          if (receipt.status !== 'applied' || (await getProposal(snapshot.episodeId, proposal.id)).status !== 'applied')
            throw Error('未收到已应用的写入回执。');
          applied = true; undo.disabled = false;
          status.textContent = receipt.warning ?? '已替换选区。';
        } catch (error) {
          status.textContent = '提案可在写入与提案记录中查看。' + String(error);
        }
      } finally { applying = false; }
    });
    apply.disabled = true;
    // The standard action resets button disabled state after completion.
    const appliedObserver = new MutationObserver(() => {
      if ((cancelled() || proposalId || !runId) && !apply.disabled) apply.disabled = true;
      if (!applied && !undo.disabled) undo.disabled = true;
    });
    appliedObserver.observe(apply, { attributes: true, attributeFilter: ['disabled'] });
    appliedObserver.observe(undo, { attributes: true, attributeFilter: ['disabled'] });
    body.append(source.wrap, node('label', 'Skill'), skill, action('管理 Skill', () => openSkillLibrary()), node('label', '文本模型'), model,
      action('刷新模型', refresh), prompt.wrap, generate, stop, status, result.wrap, apply, undo);
    if (focusSkill) skill.focus();
    dialog.addEventListener('close', () => {
      stopped = true; appliedObserver.disconnect();
      if (requestId) void cancelWriting(requestId).catch(() => {});
    }, { once: true });
    opening = false;
    try { await refresh(); } catch (error) { status.textContent = String(error); }
  } finally { opening = false; }
}

