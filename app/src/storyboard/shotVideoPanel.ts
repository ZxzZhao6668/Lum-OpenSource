import {node, modal, action, field} from '../ui/localUi';
import {showToast} from '../ui/toast';
import {listSkills, getSkill} from '../skills/skillStore';
import {listTextModels, generateWriting, cancelWriting} from '../writing/writingClient';
import {loadProductionCatalog} from '../canvas/productionClips';
import {shotSceneFilter} from './shotSceneFilter';
import {shotVideoSource, withVideoSettings, sendShotVideoBatch, type VideoSettings, type VideoSource} from './shotVideoBatch';
import { chooseShotSetup, confirmShotAppearanceLocks, shotStyleText } from '../scriptSetup/shotSetup';
import './shotVideoPanel.css';

export async function openShotVideo(episodeId: string, initialSceneId = '') {
  const {dialog, body} = modal('分镜视频制作');
  dialog.classList.add('shotVideoDialog');
  const status = node('p', '正在读取分镜…'); status.setAttribute('role', 'status');
  body.append(status);
  let busy = false, importing = false, stopped = false;
  const requests = new Set<string>();
  const cancel = () => { stopped = true; for (const id of requests) void cancelWriting(id).catch(() => {}); };
  dialog.addEventListener('close', cancel, {once: true});
  dialog.addEventListener('cancel', event => { if (importing) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  try {
    let modelError = '';
    const [catalog, skills, styles, models] = await Promise.all([
      loadProductionCatalog(episodeId), listSkills('video-prompt'), listSkills('video-style'),
      listTextModels().catch(e => { modelError = e instanceof Error ? e.message : String(e); return []; }),
    ]);
    if (!dialog.isConnected) return;
    const chapter = catalog.chapters.find(c => c.episodeId === episodeId);
    if (!chapter || chapter.unavailable || !chapter.shots.length) throw Error('本集没有可制作的分镜，请先添加分镜');
    if (!skills.length) throw Error('暂无视频制作 Skill，请在 Skill 管理中添加');
    const filter = shotSceneFilter(chapter.scenes, chapter.shots, initialSceneId);
    const layout = node('div', '', 'shotVideoLayout'), sidebar = node('aside', '', 'shotVideoSidebar');
    const sidebarHead = node('div', '', 'shotVideoSidebarHead'), count = node('h3');
    const selectionActions = node('div', '', 'shotVideoSelectionActions'), list = node('div', '', 'shotVideoList');
    const editor = node('section', '', 'shotVideoEditor'), settingsGrid = node('div', '', 'shotVideoSettings');
    const make = (label: string) => {
      const wrap = node('label', label), select = node('select');
      select.setAttribute('aria-label', label); wrap.append(select); settingsGrid.append(wrap); return select;
    };
    const option = (select: HTMLSelectElement, text: string, value: string) => { const o = node('option', text); o.value = value; select.append(o); };
    const skill = make('视频制作 Skill'); skills.forEach(s => option(skill, s.name, s.id));
    const style = make('视频风格'); option(style, '使用镜头固定画风', ''); styles.forEach(s => option(style, s.name, s.id));
    const model = make('提示词优化模型'); models.forEach((m, i) => option(model, `${m.providerLabel} · ${m.label || m.modelId}`, String(i)));
    if (!models.length) option(model, '暂不可用 · 可直接使用原分镜', '');
    const preferred = localStorage.getItem('writing:preferredModel');
    const index = models.findIndex(m => JSON.stringify([m.providerId, m.modelId]) === preferred);
    if (index >= 0) model.value = String(index);
    const extra = field('统一补充要求', '', true); extra.input.maxLength = 4000;
    extra.input.placeholder = '例如：缓慢推进镜头，保持人物服饰一致，傍晚暖色光线…';
    const settings = (): VideoSettings => ({skill: skills.find(s => s.id === skill.value)!, style: styles.find(s => s.id === style.value), extra: extra.input.value});
    const freshSettings = async (): Promise<VideoSettings> => ({skill: await getSkill(skill.value, 'video-prompt'), style: style.value ? await getSkill(style.value, 'video-style') : undefined, extra: extra.input.value});
    const prompts = node('div', '', 'shotVideoPrompts');
    prompts.append(node('h3', '逐镜提示词'));
    const items: {shot: VideoSource['shot']; row: HTMLElement; check: HTMLInputElement; detail: HTMLDetailsElement; state: HTMLElement; output: ReturnType<typeof field>['input']; source: VideoSource; origin: HTMLElement; custom: boolean; needsReview: boolean}[] = [];
    for (const [i, shot] of chapter.shots.entries()) {
      if (!dialog.isConnected) return;
      const source = await shotVideoSource(catalog, episodeId, shot.id, settings());
      const row = node('label', '', 'shotVideoRow'), check = node('input'); check.type = 'checkbox'; check.checked = true; check.setAttribute('aria-label', `选择镜头 ${shot.no}`);
      const info = node('span');
      info.append(node('strong', `镜头 ${shot.no} · ${shot.duration || 5} 秒`), node('small', source.scene.title), node('p', shot.desc || '未填写镜头描述'));
      const assets = source.materials.filter(m => m.kind === 'entity');
      info.append(node('small', assets.length ? `关联资产 ${assets.length} 项 · ${assets.filter(m => m.image).length} 张参考图` : '尚未关联资产'));
      row.append(check, info); list.append(row);
      const detail = node('details', '', 'shotVideoPrompt'), summary = node('summary', `镜头 ${shot.no} · ${shot.type} · ${shot.duration || 5} 秒`);
      detail.open = i === 0;
      const state = node('small', '使用原分镜 · 可直接进入画布');
      const output = field(`镜头 ${shot.no} 视频提示词`, source.original, true); output.input.maxLength = 10000;
      const origin = node('p', source.styleLabel, 'shotVideoHint');
      summary.append(state); detail.append(summary, origin, output.wrap); prompts.append(detail);
      const item = {shot, row, check, detail, state, origin, output: output.input, source, custom: false, needsReview: false};
      output.input.oninput = () => { item.custom = true; state.textContent = '已手动编辑'; detail.dataset.error = 'false'; };
      check.onchange = () => update();
      items.push(item);
    }
    const visible = () => items.filter(i => filter.matches(i.shot));
    const chosen = () => visible().filter(i => i.check.checked);
    const empty = node('p', '本场暂无分镜，可先在分镜板点击本场“自动分镜”。', 'shotSceneEmpty'); list.append(empty);
    filter.select.onchange = () => update();
    const all = action('全选分镜', () => { visible().forEach(i => i.check.checked = true); update(); });
    const none = action('清空选择', () => { visible().forEach(i => i.check.checked = false); update(); });
    const readSelected = async (selected: typeof items) => {
      await chooseShotSetup(episodeId, selected.map(item => item.shot.id), {alive: () => dialog.open && !stopped});
      const [fresh, selectedSettings] = await Promise.all([loadProductionCatalog(episodeId), freshSettings()]);
      for (const item of selected) {
        const source = await shotVideoSource(fresh, episodeId, item.shot.id, selectedSettings);
        if (selectedSettings.style && source.shot.setupSnapshot?.locked)
          throw Error(`镜头 ${source.shot.no} 的项目画风已锁定，请取消本次覆盖或先在剧本设定器核对锁定字段`);
        if (!item.source.shot.setupSnapshot && source.shot.setupSnapshot) {
          item.source = source; item.origin.textContent = source.styleLabel;
          if (!item.custom) item.output.value = source.original;
          else {item.needsReview = true; item.state.textContent = '画风已固定 · 请重新优化，或核对并确认现有提示词';}
        }
      }
      return [fresh, selectedSettings] as const;
    };
    const showError = (error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); };
    const reset = action('使用原分镜提示词', async () => {
      if (busy) return;
      busy = true; update();
      try {
        stopped = false;
        const [fresh, selectedSettings] = await readSelected(chosen());
        for (const item of chosen()) {
          item.source = await shotVideoSource(fresh, episodeId, item.shot.id, selectedSettings);
          item.origin.textContent = item.source.styleLabel;
          item.output.value = item.source.original; item.custom = false;
          item.needsReview = false;
          item.state.textContent = '已使用原分镜与当前风格'; item.detail.dataset.error = 'false';
        }
        status.textContent = '已更新所选提示词，可直接进入画布。';
      } catch (e) { showError(e); } finally { busy = false; update(); }
    });
    const keep = action('保留当前提示词并确认', async () => {
      if (busy) return;
      stopped = false; busy = true; update();
      try {
        const [fresh, selectedSettings] = await Promise.all([loadProductionCatalog(episodeId), freshSettings()]);
        const reviewed = [];
        for (const item of chosen().filter(item => item.needsReview)) {
          const source = await shotVideoSource(fresh, episodeId, item.shot.id, selectedSettings);
          if (source.contentSignature !== item.source.contentSignature) throw Error('原分镜或资产已变化，请重新读取分镜，已编辑文字保留。');
          reviewed.push({item, source});
        }
        for (const {item, source} of reviewed) {
          item.source = source; item.needsReview = false;
          item.state.textContent = '已确认手工提示词';
        }
        status.textContent = '将使用当前手工提示词；新要求请直接写入提示词中。';
      } catch (e) { showError(e); } finally { busy = false; update(); }
    });
    const optimize = action('AI 批量优化提示词', async () => {
      if (busy || !chosen().length) return;
      const selectedModel = models[Number(model.value)];
      if (!selectedModel || model.value === '') { status.textContent = '请先配置文本模型，或直接使用原分镜进入画布。'; return; }
      const selected = chosen(); let completed = 0, failed = 0, cursor = 0;
      stopped = false; busy = true; update();
      status.textContent = `正在同时优化 ${selected.length} 个分镜…`;
      try {
        const [fresh, selectedSettings] = await readSelected(selected);
        await confirmShotAppearanceLocks(selected.map(item=>fresh.chapters.find(c=>c.episodeId===episodeId)!.shots.find(s=>s.id===item.shot.id)!));
        // Model calls stay concurrent. Check returned prompts one at a time so each does not hold a full image catalog.
        let validation = Promise.resolve();
        const verifySource = (before: VideoSource) => {
          const result = validation.then(async () => {
            const current = await shotVideoSource(await loadProductionCatalog(episodeId), episodeId, before.shot.id, await freshSettings());
            if (current.signature !== before.signature) throw Error('分镜或设置已变化，请重新优化');
          });
          validation = result.catch(() => {});
          return result;
        };
        const worker = async () => {
          while (!stopped && dialog.isConnected && cursor < selected.length) {
            const item = selected[cursor++]; let requestId = '';
            try {
              const before = await shotVideoSource(fresh, episodeId, item.shot.id, selectedSettings);
              if (stopped || !dialog.isConnected) break;
              item.state.textContent = 'AI 正在优化…'; item.detail.dataset.error = 'false';
              requestId = crypto.randomUUID(); requests.add(requestId);
              const response = await generateWriting({requestId, providerId: selectedModel.providerId, modelId: selectedModel.modelId, context: {
                systemPrompt: `你是视频制作提示词编辑。依据用户文本和当前分镜，输出可直接用于视频生成的提示词，只写本镜可见内容、动作与运镜。关联资产仅是候选资料，不代表出镜名单；按本镜主体、景别和动作判断是否需要，不罗列人物设定或无关资产。空镜、景物、物件特写不添加人物；手部或局部特写不添加全身、面部描述；画外音、回忆提及及前后镜人物不代表本镜出场。用户指定无人或不出镜时优先遵守。不得为了展示资产改变构图、剧情、景别或新增人物。不虚构素材或声称看过图片。只输出当前镜头的提示词。\n视频制作 Skill：${selectedSettings.skill.instruction}\n视频风格：${selectedSettings.style?.instruction ?? (shotStyleText(before.shot.setupSnapshot) || '保持原风格')}`,
                messages: [{role: 'user', content: `当前分镜：\n${before.original}\n待优化文本：\n${item.output.value}\n候选资产（仅在本镜需要时参考）：\n${before.materials.filter(m => m.kind === 'entity').map(m => m.text).join('\n\n')}\n用户要求：${selectedSettings.extra}`, timestamp: Date.now()}], tools: [],
              }}, () => {});
              if (stopped || !dialog.isConnected) { item.state.textContent = '已停止 · 保留原提示词'; continue; }
              const msg = response.message as {content?: {type: string; text?: string}[]};
              if (!Array.isArray(msg?.content) || msg.content.some(p => p.type === 'toolCall')) throw Error('模型未返回可用的视频提示词');
              const value = msg.content.filter(p => p.type === 'text').map(p => p.text ?? '').join('').trim();
              if (!value || value.length > 10000) throw Error('视频提示词为空或过长');
              await verifySource(before);
              if (stopped || !dialog.isConnected) continue;
              item.output.value = value; item.source = before; item.custom = true;
              item.needsReview = false;
              item.state.textContent = 'AI 已优化 · 可编辑'; completed++;
            } catch (e) {
              failed++; item.detail.dataset.error = 'true';
              item.state.textContent = `优化未完成：${e instanceof Error ? e.message : String(e)}；原提示词已保留`;
            } finally { if (requestId) requests.delete(requestId); }
            status.textContent = `已优化 ${completed}/${selected.length} 个分镜${failed ? `，${failed} 个未完成` : ''}。`;
          }
        };
        await Promise.all(Array.from({length: Math.min(12, selected.length)}, worker));
        if (stopped) status.textContent = '已停止优化，已完成的提示词保留。';
      } catch (e) { showError(e); } finally { busy = false; update(); }
    });
    const stop = action('停止优化', () => { cancel(); status.textContent = '正在停止优化，已完成的提示词保留。'; });
    const create = action('进入画布并创建节点', async () => {
      if (busy || !chosen().length) return;
      const selected = chosen(); busy = importing = true; stopped = false; update();
      try {
        const [fresh, selectedSettings] = await readSelected(selected);
        const drafts = [];
        for (const item of selected) {
          const current: VideoSource = await shotVideoSource(fresh, episodeId, item.shot.id, selectedSettings);
          if (item.needsReview || current.signature !== item.source.signature) throw Error(`镜头 ${item.shot.no} 的分镜或设置已变化，请重新优化、使用原分镜提示词，或核对后点击“保留当前提示词并确认”。`);
          drafts.push({source: current, prompt: item.output.value.trim()});
        }
        await confirmShotAppearanceLocks(drafts.map(draft=>draft.source.shot));
        status.textContent = `正在把 ${selected.length} 个分镜送入同一画布…`;
        const result = await sendShotVideoBatch(episodeId, drafts, selectedSettings, () => dialog.isConnected && !stopped, (i, message) => {
          selected[i].state.textContent = message;
          status.textContent = `镜头 ${selected[i].shot.no}：${message}`;
        });
        const message = `已送入 ${result.completed}/${result.total} 个分镜。${result.warnings.join('')}`;
        if (result.failures.length) status.textContent = message + result.failures.join('；') + '。已保存的节点保留，可再次点击继续。';
        else { showToast(message + '请在视频节点选择模型后生成。'); dialog.close(); }
      } catch (e) { showError(e); } finally { busy = importing = false; update(); }
    });
    const changed = () => {
      for (const item of items) {
        item.origin.textContent = withVideoSettings(item.source, settings()).styleLabel;
        if (item.custom) { item.needsReview = true; item.state.textContent = '设置已变化 · 请编辑提示词后确认，或重新优化'; }
        else { item.source = withVideoSettings(item.source, settings()); item.output.value = item.source.original; }
      }
      status.textContent = '统一设置已更新；已编辑的提示词保留，请核对后继续。';
      update();
    };
    skill.onchange = style.onchange = changed; extra.input.oninput = changed;
    function update() {
      const selected = chosen();
      count.textContent = `当前场次已选 · ${selected.length}/${visible().length} 镜`;
      items.forEach(item => { item.row.hidden = !filter.matches(item.shot); item.detail.hidden = item.row.hidden || !item.check.checked; });
      empty.hidden = visible().length > 0;
      for (const el of [all, none, filter.select, skill, style, model, extra.input, ...items.flatMap(i => [i.check, i.output])]) el.disabled = busy;
      all.disabled = none.disabled = busy || !visible().length;
      optimize.disabled = busy || !selected.length || !models.length;
      reset.disabled = create.disabled = busy || !selected.length;
      keep.hidden = !selected.some(item => item.needsReview); keep.disabled = busy;
      stop.hidden = !busy || importing; stop.disabled = stopped;
      dialog.querySelector<HTMLButtonElement>('header button')!.disabled = importing;
      create.textContent = importing ? '正在创建节点…' : `进入画布并创建节点（${selected.length}）`;
    }
    selectionActions.append(all, none); sidebarHead.append(filter.wrap, count, selectionActions); sidebar.append(sidebarHead, list);
    const actions = node('div', '', 'shotVideoActions'); actions.append(optimize, reset, keep, stop);
    editor.append(node('h3', '统一制作设置'), settingsGrid, extra.wrap, actions,
      node('p', 'Skill 用于 AI 优化。关联资产会作为候选接入画布，在视频节点由 AI 按本镜内容筛选；只有提示词中 @ 引用的资产才参与生成。', 'shotVideoHint'), prompts);
    layout.append(sidebar, editor);
    const footer = node('footer', '', 'shotVideoFooter'); footer.append(status, create);
    body.replaceChildren(node('p', '选择场次 → 勾选分镜 → 优化提示词 → 进入画布。全选、优化和创建节点仅处理当前显示的分镜。', 'shotVideoIntro'), layout, footer);
    status.textContent = modelError ? `文本模型暂不可用：${modelError}。可使用原分镜进入画布。` : '每个分镜单独保留提示词和参考图，按镜头顺序送入同一画布。';
    update();
  } catch (e) { status.textContent = e instanceof Error ? e.message : String(e); body.replaceChildren(status); }
}

