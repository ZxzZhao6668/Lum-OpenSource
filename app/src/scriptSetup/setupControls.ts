import { field, node } from '../ui/localUi';
import type { ChoiceSnapshot, GrowthStage } from './scriptSetupModel';
import { matchesCatalog, readCatalogPreferences, saveCustomChoice, toChoice, type CustomDimension } from './scriptSetupCatalog';

export interface SetupView {
  body: HTMLElement;
  change(): void;
  notice(message: string, error?: boolean): void;
  perform(work: () => Promise<void>): Promise<void>;
}
export function button(text: string, run: (button: HTMLButtonElement) => void, cls = '') {
  const b = node('button', text, `localButton ${cls}`.trim()); b.type = 'button'; b.onclick = () => run(b); return b;
}
export function selectControl(label: string, items: [string, string][], value: string, change: (id: string) => void) {
  const wrap = node('label', '', 'localField'), select = node('select');
  wrap.append(node('span', label), select);
  for (const [id, text] of items) {
    const option = node('option', text); option.value = id; select.add(option);
  }
  select.value = value; select.onchange = () => change(select.value);
  return {wrap, select};
}
export function textControl(label: string, value: string, change: (value: string) => void, options: {multiline?: boolean; max?: number; list?: string[]} = {}) {
  const {wrap, input} = field(label, value, options.multiline);
  input.maxLength = options.max ?? 3000; input.oninput = () => change(input.value);
  if (options.list && input instanceof HTMLInputElement) {
    const suggestions = node('datalist'); suggestions.id = `ss-list-${crypto.randomUUID()}`;
    for (const text of options.list) { const option = node('option'); option.value = text; suggestions.append(option); }
    input.setAttribute('list', suggestions.id); wrap.append(suggestions);
  }
  return {wrap, input};
}
export function checkbox(label: string, checked: boolean, change: (value: boolean) => void) {
  const wrap = node('label', '', 'ssCheck'), check = node('input');
  check.type = 'checkbox'; check.checked = checked; check.onchange = () => change(check.checked);
  wrap.append(check, node('span', label)); return wrap;
}
export function subtitle(text: string) { return node('h4', text, 'ssSubtitle'); }
export function note(text: string) { return node('p', text, 'ssNote'); }
export function searchControl(label: string) {
  const input = node('input', '', 'localSearch ssSearch'); input.type = 'search'; input.placeholder = label; input.setAttribute('aria-label', label);
  return input;
}
export function labelledButton(label: string, accessibleName: string, run: () => void) {
  const b = button(label, run); b.setAttribute('aria-label', accessibleName); return b;
}
export function focusLater(el: HTMLElement | null | undefined) { if (el) queueMicrotask(() => { if (el.isConnected) el.focus(); }); }
export function customEditor(view: SetupView, dimension: CustomDimension, onSaved: (choice: ChoiceSnapshot) => void, existing?: ChoiceSnapshot) {
  const editor = node('form', '', 'ssCustom');
  const name = textControl('名称', existing?.label ?? '', () => {}, {max:120});
  const desc = textControl('说明（可选）', existing?.description ?? '', () => {}, {max:1200});
  const actions = node('div', '', 'ssRow');
  const commit = node('button', existing ? '保存新名称 / 说明' : '保存自定义选项', 'localButton'); commit.type = 'submit';
  actions.append(commit, button('取消', () => editor.remove()));
  editor.append(name.wrap, desc.wrap, actions);
  editor.onsubmit = event => {
    event.preventDefault();
    void view.perform(async () => {
      const choice = saveCustomChoice(dimension, name.input.value, desc.input.value, existing?.id);
      editor.remove(); onSaved(choice); view.notice(existing ? '自定义选项已更新；已保存的历史仍保留原标题。' : '已加入自定义目录。');
    });
  };
  focusLater(name.input); return editor;
}
export function choicePicker<T extends ChoiceSnapshot>(view: SetupView, groups: {name?: string; choices: readonly T[]}[], options: {
  label: string; active: () => readonly ChoiceSnapshot[]; pick: (item: T | ChoiceSnapshot) => void;
  custom?: CustomDimension; aliases?: Record<string, string[]>; limit?: number; afterChange?: () => void;
}) {
  const wrap = node('div', '', 'ssChoicePicker'), bar = node('div', '', 'ssRow'), results = node('div', '', 'ssChoiceGroups');
  const search = searchControl(options.label);
  const customSlot = node('div');
  bar.append(search);
  if (options.custom) bar.append(button('自定义', () => {
    customSlot.replaceChildren(customEditor(view, options.custom!, () => refresh()));
  }));
  function refresh(focusId?: string) {
    results.replaceChildren();
    const custom = options.custom;
    const all = custom ? [...groups, {name: '我的自定义', choices: readCatalogPreferences().custom.filter(c => c.dimension === custom).map(toChoice)}] : groups;
    const selected = options.active();
    for (const group of all) {
      const groupItems = group.choices.filter(item => matchesCatalog(search.value, group.name, item.label, item.description, ...(options.aliases?.[item.id] ?? [])));
      if (!groupItems.length) continue;
      const row = node('div', '', 'ssChoiceList');
      if (group.name) results.append(subtitle(group.name));
      for (const item of groupItems) {
        const isSelected = selected.some(sel => sel.id === item.id);
        const btn = button(item.label, () => {
          if (!isSelected && options.limit !== undefined && selected.length >= options.limit) {
            view.notice(`最多选择 ${options.limit} 项，请先移除已选项。`, true); return;
          }
          options.pick(item); options.afterChange?.(); refresh(item.id);
        });
        btn.dataset.choice = item.id; btn.setAttribute('aria-pressed', String(isSelected));
        if (item.description) btn.title = item.description;
        row.append(btn);
        if (custom && item.id.startsWith('custom-')) row.append(labelledButton('改名', `重命名：${item.label}`, () => {
          customSlot.replaceChildren(customEditor(view, custom, () => refresh(item.id), item));
        }));
      }
      results.append(row);
    }
    if (!results.childElementCount) results.append(note('没有匹配的选项。'));
    if (focusId) focusLater([...results.querySelectorAll<HTMLButtonElement>('[data-choice]')].find(item => item.dataset.choice === focusId));
  }
  search.oninput = () => refresh();
  wrap.append(bar, customSlot, results); refresh();
  return {wrap, refresh};
}
export function orderList<T>(items: T[], label: (item: T) => string, change: () => void) {
  const list = node('ol', '', 'ssOrder');
  list.setAttribute('aria-label', '已选项优先顺序');
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    items.splice(to, 0, items.splice(from, 1)[0]); change(); render(to);
  };
  let dragged: number | undefined;
  function render(focus?: number) {
    list.replaceChildren();
    items.forEach((item, index) => {
      const li = node('li'); li.draggable = true; li.ondragstart = event => { dragged = index; event.dataTransfer?.setData('text/plain', String(index)); };
      li.ondragover = event => { if (dragged !== undefined) event.preventDefault(); };
      li.ondragend = () => { dragged = undefined; };
      li.ondrop = event => { if (dragged !== undefined) { event.preventDefault(); move(dragged, index); dragged = undefined; } };
      const name = label(item);
      const up = labelledButton('↑', `上移：${name}`, () => move(index, index - 1));
      up.disabled = index === 0;
      const down = labelledButton('↓', `下移：${name}`, () => move(index, index + 1));
      down.disabled = index === items.length - 1;
      const remove = labelledButton('移除', `移除：${name}`, () => {items.splice(index, 1); change(); render(Math.min(index, items.length - 1));});
      li.append(node('span', `${index+1} · ${name}`), up, down, remove); list.append(li);
      if (index === focus) { li.tabIndex = -1; focusLater(li); }
    });
    if (!items.length) list.append(node('li', '未设置'));
  }
  render();
  return {list, render};
}
export function editStages(stages: GrowthStage[], change: () => void) {
  const wrap = node('div', '', 'ssStageList');
  function render(focus?: number) {
    wrap.replaceChildren();
    stages.forEach((stage, index) => {
      const group = node('fieldset', '', 'ssGroup'); group.append(node('legend', `阶段 ${index+1}`));
      const title = textControl('阶段名称', stage.title, value => {stage.title = value; change();}, {max:120});
      group.append(title.wrap, textControl('阶段 / 集数范围', stage.scope, value => {stage.scope = value; change();}, {max:600}).wrap,
        textControl('阶段目标 / 状态', stage.state, value => {stage.state = value; change();}, {multiline:true}).wrap,
        labelledButton('移除阶段', `移除阶段 ${index+1}`, () => { stages.splice(index, 1); change(); render(); }));
      wrap.append(group);
      if (focus === index) focusLater(title.input);
    });
    const add = button('添加阶段', () => {stages.push({title: `阶段 ${stages.length+1}`, scope: '', state: ''}); change(); render(stages.length-1);});
    add.disabled = stages.length >= 40; wrap.append(add);
  }
  render(); return wrap;
}

