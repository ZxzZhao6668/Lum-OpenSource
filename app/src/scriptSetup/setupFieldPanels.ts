import { loadDoc } from '../data/db';
import type { EpisodeIndex } from '../episode/episodeManager';
import { readAssetMedia, type AssetMedia } from '../assetLibrary/assetMedia';
import { readWorldview } from '../worldview/worldviewModel';
import { writingStyles } from '../writing/styles';
import { node } from '../ui/localUi';
import { scriptSetupFingerprint } from './characterProfiles';
import {
  AUDIENCES, DIRECTION_GROUPS, ERAS, HIGHLIGHTS, INDUSTRY_ALIASES, MECHANISMS, STRUCTURE_PATTERNS, VISUAL_STYLES, matchesCatalog, toChoice, toVisual,
} from './scriptSetupCatalog';
import { SETUP_FIELDS, ordinaryMechanisms, type ScriptSetupPayload, type SetupField } from './scriptSetupModel';
import { button, checkbox, choicePicker, editStages, note, orderList, searchControl, selectControl, subtitle, textControl, type SetupView } from './setupControls';

export function renderAudience(view: SetupView, data: ScriptSetupPayload['audience']) {
  const chosen = orderList(data.choices, choice => choice.label, () => {view.change(); picker.refresh();});
  const picker = choicePicker(view, [{choices:AUDIENCES}], {
    label:'搜索受众', active:() => data.choices, custom:'audience', limit:2,
    pick:item => { const found = data.choices.findIndex(c => c.id === item.id); if (found < 0) data.choices.push(toChoice(item)); else data.choices.splice(found, 1); view.change(); chosen.render(); },
  });
  view.body.append(note('最多 2 项。受众只是表达和信息密度的参考。'), chosen.list, picker.wrap,
    textControl('语言', data.language, value => {data.language=value; view.change();}, {max:120}).wrap,
    textControl('叙事可理解度', data.accessibility, value => {data.accessibility=value; view.change();}, {max:1000,multiline:true}).wrap);
}
export function renderHooks(view: SetupView, data: ScriptSetupPayload['hooks']) {
  let dimension: 'direction' | 'highlight' = 'direction';
  const pickerSlot = node('div'), tabs = node('div', '', 'ssRow');
  let refresh = () => {};
  const list = orderList(data, item => item.label, () => {view.change(); refresh();});
  for (const [id, label] of [['direction','剧情方向'],['highlight','爽点 / 情绪标签']] as const) {
    const tab = button(label, () => {dimension=id; render();}); tab.dataset.dimension=id; tabs.append(tab);
  }
  function render() {
    const picker = choicePicker(view, dimension === 'direction' ? DIRECTION_GROUPS : [{choices:HIGHLIGHTS}], {
      label:dimension === 'direction' ? '搜索故事方向' : '搜索情绪与爽点', active:() => data, custom:dimension, limit:3,
      aliases:{industry:INDUSTRY_ALIASES}, pick:item => {
        const found = data.findIndex(c => c.id === item.id);
        if (found < 0) data.push({...toChoice(item),dimension}); else data.splice(found,1);
        view.change(); list.render();
      },
    });
    refresh = picker.refresh;
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.dimension === dimension));
    pickerSlot.replaceChildren(picker.wrap);
  }
  view.body.append(note('两个分类合计最多 3 项；第一项是故事的主要推动力。可用箭头或拖动调整顺序。'), list.list, tabs, pickerSlot); render();
}
export function renderSetting(view: SetupView, data: ScriptSetupPayload['setting']) {
  const selected = node('div'), entries = node('div', '', 'ssChoiceGroups');
  const search = searchControl('搜索已确认的世界观条目');
  const canon = node('details', '', 'ssGroup'); canon.append(node('summary', '引用已确认世界观'), note('这些条目仍由「世界观」管理；这里只保存引用和来源版本。'), search, entries);
  let currentWorld: Awaited<ReturnType<typeof readWorldview>>['entries'] | undefined;
  async function loadCanon() {
    if (currentWorld) return;
    entries.replaceChildren(note('正在读取条目…'));
    currentWorld = (await readWorldview()).entries.filter(entry => entry.status === 'canon');
    if (canon.isConnected) renderCanon();
  }
  function renderCanon() {
    if (!currentWorld) return;
    entries.replaceChildren();
    const all = currentWorld.filter(entry => matchesCatalog(search.value, entry.key, entry.category, ...entry.tags));
    for (const entry of all.slice(0, 60)) {
      const active = data.worldRefs.some(ref => ref.id === entry.id);
      const b = button(`${entry.category} · ${entry.key}`, () => {
        if (active) {data.worldRefs = data.worldRefs.filter(ref => ref.id !== entry.id); view.change(); renderCanon();}
        else void view.perform(async () => {
          if (data.worldRefs.length >= 100) throw Error('最多引用 100 条世界观。');
          const fingerprint = await scriptSetupFingerprint(entry);
          if (!b.isConnected) return;
          data.worldRefs.push({id:entry.id,fingerprint}); view.change(); renderCanon();
        });
      });
      b.setAttribute('aria-pressed',String(active)); entries.append(b);
    }
    for (const ref of data.worldRefs.filter(ref => !currentWorld!.some(entry => entry.id === ref.id))) {
      entries.append(button(`清除失效条目：${ref.id}`, () => {data.worldRefs = data.worldRefs.filter(item => item.id !== ref.id); view.change(); renderCanon();}));
    }
    if (!all.length) entries.append(note('没有可引用的匹配条目。'));
    if (all.length > 60) entries.append(note(`匹配 ${all.length} 项，显示前 60 项，请继续缩小搜索范围。`));
  }
  canon.ontoggle = () => {if (canon.open && !currentWorld) void view.perform(loadCanon);};
  search.oninput = renderCanon;
  function renderMechanisms() {
    selected.replaceChildren();
    for (const mechanism of data.mechanisms) {
      if (mechanism.id !== 'none-supernatural') selected.append(textControl(`${mechanism.label}规则 · ${mechanism.description ?? ''}`, mechanism.rules, value => {mechanism.rules=value;view.change();}, {max:4000,multiline:true}).wrap);
    }
    if (data.mechanisms.some(m => m.id === 'time-travel')) {
      selected.append(textControl('来历时代 / 时空', data.originEra, value => {data.originEra=value;view.change();}, {max:200}).wrap,
        textControl('来历与主体时空的关系', data.transition, value => {data.transition=value;view.change();}, {multiline:true}).wrap);
    }
  }
  const picker = choicePicker(view, [{choices:MECHANISMS}], {
    label:'搜索叙事机制', active:() => data.mechanisms,
    pick:item => {
      const index = data.mechanisms.findIndex(m => m.id === item.id);
      if (index >= 0) data.mechanisms.splice(index,1);
      else {
        const none = 'none-supernatural';
        if ((item.id === none && data.mechanisms.some(m => !ordinaryMechanisms.includes(m.id))) ||
            (data.mechanisms.some(m => m.id === none) && !ordinaryMechanisms.includes(item.id))) {
          view.notice('「无超自然机制」不能与超自然机制并用；可保留记忆缺失或双线时空。',true); return;
        }
        data.mechanisms.push({...toChoice(item), rules:''});
      }
      view.change(); renderMechanisms();
    },
  });
  view.body.append(note('主体时代与世界规则可以独立组合，例如「现代 + 末世」。留空时沿用已有设定。'),
    textControl('主体时代 / 朝代', data.mainEra, value => {data.mainEra=value;view.change();}, {list:ERAS,max:200}).wrap,
    textControl('地域', data.place, value => {data.place=value;view.change();}, {max:200}).wrap,
    textControl('补充世界规则', data.worldRules, value => {data.worldRules=value;view.change();}, {multiline:true,max:12000}).wrap,
    canon, subtitle('叙事机制'), picker.wrap, selected);
  renderMechanisms();
}
export function renderVisualStyle(view: SetupView, data: ScriptSetupPayload['visualStyle'], getStaged: () => AssetMedia | undefined, setStaged: (media?: AssetMedia) => void) {
  const search = searchControl('搜索风格、色彩、材质或光线'), list = node('div', '', 'ssVisualList');
  const refStatus = node('p', '', 'ssNote');
  const upload = node('input'); upload.type='file'; upload.accept='image/png,image/jpeg,image/webp'; upload.setAttribute('aria-label','选取画风参考图');
  const ref = node('fieldset', '', 'ssGroup'); ref.append(node('legend','参考图（可选）'), refStatus, upload, button('移除参考图', () => {
    delete data.referenceMediaId; setStaged(); view.change(); renderReference();
  }));
  function renderReference() { refStatus.textContent = data.referenceMediaId ? getStaged()?.id===data.referenceMediaId ? '已选参考原图，将在保存设定时固定到项目。' : '已保存参考原图，历史版本保留引用。' : '未选参考图'; }
  upload.onchange = () => {
    const file = upload.files?.[0];
    if (!file) return;
    void view.perform(async () => {
      try {
        const media = await readAssetMedia(file);
        if (upload.isConnected) { setStaged(media); data.referenceMediaId = media.id; view.change(); renderReference(); }
      } finally { upload.value=''; }
    });
  };
  function render(focusId?: string) {
    list.replaceChildren();
    const styles = VISUAL_STYLES.filter(item => matchesCatalog(search.value,item.label,item.palette,item.light,item.texture,item.composition));
    for (const item of styles) {
      const b = button('', () => {data.preset=toVisual(item);view.change();render(item.id);}, 'ssVisual');
      b.dataset.style = item.id; b.setAttribute('aria-pressed', String(item.id === data.preset?.id));
      const swatches = node('span', '', 'ssSwatchStrip'); swatches.setAttribute('aria-hidden','true');
      for (const color of item.swatches) {const tile=node('i');tile.style.backgroundColor=color;swatches.append(tile);}
      b.append(swatches,node('strong',item.label),node('small',`色彩：${item.palette} · 光线：${item.light}`),node('small',`材质：${item.texture} · 构图：${item.composition}`)); list.append(b);
      if (focusId === item.id) b.focus();
    }
    if (!styles.length) list.append(note('没有匹配的风格。'));
  }
  search.oninput = () => render();
  view.body.append(note('画风只用于视觉创作；可在「创作边界与文风」单独设定文风。'),
    search, list, button('清除预设画风', b => {delete data.preset;view.change();render();b.focus();}),
    textControl('补充画面风格', data.customText, value => {data.customText=value;view.change();}, {multiline:true,max:4000}).wrap, ref);
  render(); renderReference();
}
export function renderStructure(view: SetupView, data: ScriptSetupPayload['structure']) {
  const count = textControl('目标集数（1–200，留空表示未设置）',data.episodeCount?.toString() ?? '', value => {
    if (count.input instanceof HTMLInputElement && count.input.validity.badInput) data.episodeCount=Number.NaN;
    else if (!value) delete data.episodeCount; else data.episodeCount=Number(value);
    if (data.episodeCount && data.episodeCount >= 1 && data.episodeCount <= 200) slider.value=value;
    view.change(); warn();
  });
  if (count.input instanceof HTMLInputElement) {count.input.type='number';count.input.min='1';count.input.max='200';count.input.step='1';}
  const slider=node('input');slider.type='range';slider.min='1';slider.max='200';slider.value=String(data.episodeCount ?? 1);
  slider.setAttribute('aria-label','调整目标集数');slider.oninput=() => {data.episodeCount=Number(slider.value);count.input.value=slider.value;view.change();warn();};
  const warning=note('');
  let total: number | undefined;
  void loadDoc<EpisodeIndex>('episode:ep_001').then(index => {total=index?.chapters?.filter(e=>!e.draft).length;warn();}).catch(() => {});
  function warn() {
    warning.textContent = total && data.episodeCount && total > data.episodeCount
      ? `当前有 ${total} 个已建剧集，超出新规划的剧集会保留。` : '调整规划不会删除剧集或正文。';
  }
  const duration=textControl('每集目标时长（秒，可留空）',data.episodeDuration?.toString()??'',value=>{
    if (duration.input instanceof HTMLInputElement && duration.input.validity.badInput) data.episodeDuration=Number.NaN;
    else if (!value) delete data.episodeDuration; else data.episodeDuration=Number(value); view.change();
  });
  if (duration.input instanceof HTMLInputElement) {duration.input.type='number';duration.input.min='1';duration.input.max='86400';duration.input.step='1';}
  view.body.append(count.wrap,slider,warning,duration.wrap,
    textControl('结构模板',data.pattern,value=>{data.pattern=value;view.change();},{max:200,list:STRUCTURE_PATTERNS}).wrap,
    subtitle('故事阶段'),editStages(data.stages,view.change));warn();
}
export function renderConstraints(view: SetupView, data: ScriptSetupPayload) {
  const locks=node('fieldset','','ssGroup ssLocks');
  locks.append(node('legend','锁定字段'),note('锁定字段在套用创作预设时保留，供任务检查冲突。你仍可手动修改。'));
  for (const [key,label] of Object.entries(SETUP_FIELDS) as [SetupField,string][]) {
    locks.append(checkbox(label,data.constraints.lockedFields.includes(key),on=>{
      data.constraints.lockedFields=on?[...data.constraints.lockedFields,key]:data.constraints.lockedFields.filter(item=>item!==key);view.change();
    }));
  }
  view.body.append(selectControl('文风', [['inherit','沿用写作页'],...writingStyles.map(s=>[s.id,s.label] as [string,string])],data.writingStyle,value=>{data.writingStyle=value;view.change();}).wrap,
    textControl('必须保留（每行一项）',data.constraints.mustKeep.join('\n'),value=>{data.constraints.mustKeep=lines(value);view.change();},{multiline:true,max:60000}).wrap,
    textControl('必须避免（每行一项）',data.constraints.mustAvoid.join('\n'),value=>{data.constraints.mustAvoid=lines(value);view.change();},{multiline:true,max:60000}).wrap,locks);
}
function lines(value: string) {return [...new Set(value.split('\n').map(line=>line.trim()).filter(Boolean))];}

