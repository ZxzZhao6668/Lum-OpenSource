import { node } from '../ui/localUi';
import { CATALOG_REVISION, DIRECTIONS, GENRES, INDUSTRY_ALIASES, markCatalogRecent, matchesCatalog, readCatalogPreferences,
  toChoice, toggleCatalogFavorite } from './scriptSetupCatalog';
import type { GenreChoice, ScriptSetupPayload } from './scriptSetupModel';
import { button, customEditor, focusLater, note, searchControl, selectControl, textControl, type SetupView } from './setupControls';

export function renderGenrePanel(view: SetupView, payload: ScriptSetupPayload, side: 'primary' | 'secondary', finish: () => void) {
  const current = payload.genre[side];
  const excluded = payload.genre[side === 'primary' ? 'secondary' : 'primary']?.id;
  const search = searchControl('搜索题材、细分或方向，如 机床');
  const filters = selectControl('目录范围', [['all','全部'],['recent','最近使用'],['favorites','我的收藏'],['custom','我的自定义']], 'all', () => render());
  const results = node('div', '', 'ssCatalog'), customSlot = node('div');
  let expanded = current?.id ?? '';
  const pick = (value: GenreChoice) => {
    if (value.id === excluded) { view.notice('主辅题材不能重复。', true); return; }
    payload.genre[side] = value; payload.genre.catalogRevision = CATALOG_REVISION;
    view.change();
    try { markCatalogRecent(value.subtype?.id ?? value.id); } catch { /* Preference storage is optional. */ }
    finish(); view.notice('题材已更新，已有核心看点和融合说明保留。');
  };
  function render(focusId?: string) {
    const prefs = readCatalogPreferences();
    results.replaceChildren();
    const query = search.value, selectedFilter = filters.select.value;
    const catalog = [...GENRES, ...prefs.custom.filter(c => c.dimension === 'genre').map(c => ({...c, aliases:[], conflict:'', subtypes:[]}))];
    const order = selectedFilter === 'recent' ? prefs.recent : null;
    if (order) {
      const rank = (g: typeof catalog[number]) => order.findIndex(id => id === g.id || g.subtypes.some(s => s.id === id));
      catalog.sort((a,b) => rank(a) - rank(b));
    }
    for (const item of catalog) {
      const custom = item.id.startsWith('custom-');
      if (selectedFilter === 'custom' && !custom) continue;
      const isFiltered = selectedFilter === 'recent' || selectedFilter === 'favorites';
      const showIds = isFiltered ? (selectedFilter === 'recent' ? prefs.recent : prefs.favorites) : [];
      if (isFiltered && ![item.id, ...item.subtypes.map(sub => sub.id)].some(id => showIds.includes(id))) continue;
      const allMatch = matchesCatalog(query, item.label, item.description, ...item.aliases);
      const visible = item.subtypes.filter(sub => (allMatch || matchesCatalog(query, item.label, sub.label, sub.description, ...sub.aliases))
        && (!isFiltered || showIds.includes(item.id) || showIds.includes(sub.id)));
      if (!allMatch && !visible.length) continue;
      const article = node('article', '', 'ssCatalogCard');
      const title = node('div', '', 'ssRow');
      const toggle = button(item.label, () => { expanded = expanded === item.id ? '' : item.id; render(item.id); }, 'ssCatalogTitle');
      toggle.dataset.catalogFocus = item.id; toggle.setAttribute('aria-expanded', String(expanded === item.id || !!query));
      const choose = button('选为' + (side === 'primary' ? '主题材' : '融合题材'), () => pick(toChoice(item)));
      choose.disabled = item.id === excluded;
      choose.setAttribute('aria-label', `${choose.textContent}：${item.label}`);
      const star = (id: string, label: string) => {
        const active = prefs.favorites.includes(id);
        const b = button(active ? '已收藏' : '收藏', () => void view.perform(async () => {toggleCatalogFavorite(id); render(`favorite:${id}`);}));
        b.dataset.catalogFocus = `favorite:${id}`; b.setAttribute('aria-label', `收藏：${label}`); b.setAttribute('aria-pressed', String(active)); return b;
      };
      title.append(toggle, choose, star(item.id, item.label));
      if (custom) title.append(button('改名', () => customSlot.replaceChildren(customEditor(view, 'genre', () => render(item.id), item))));
      article.append(title);
      if (item.description) article.append(note(item.description));
      if (expanded === item.id || query || isFiltered) {
        if (item.conflict) article.append(note(`融合提示：${item.conflict}`));
        for (const subtype of visible) {
          const row = node('div', '', 'ssSubtype ssRow'), itemButton = button(subtype.label, () => pick({...toChoice(item), subtype:toChoice(subtype)}));
          itemButton.disabled = item.id === excluded;
          row.append(itemButton, node('small', subtype.description), star(subtype.id, subtype.label)); article.append(row);
        }
      }
      results.append(article);
    }
    if (!results.childElementCount) results.append(note('没有符合条件的题材。'));
    if (query.trim() && selectedFilter === 'all') {
      const related = [...DIRECTIONS, ...prefs.custom.filter(c=>c.dimension==='direction')].filter(item => matchesCatalog(query, item.label, item.description, ...(item.id === 'industry' ? INDUSTRY_ALIASES : [])));
      if (related.length) results.append(note(`匹配故事方向：${related.map(i => i.label).join('、')}。在「核心看点」中选择。`));
    }
    if (focusId) focusLater([...results.querySelectorAll<HTMLButtonElement>('[data-catalog-focus]')].find(el => el.dataset.catalogFocus === focusId));
  }
  search.oninput = () => render();
  const bar = node('div', '', 'ssRow');
  bar.append(search, filters.wrap, button('新建自定义题材', () => customSlot.replaceChildren(customEditor(view, 'genre', () => { filters.select.value = 'custom'; render(); }))));
  view.body.append(bar, customSlot, results, textControl('融合说明（移除辅题材后保留）', payload.genre.fusionNote, value => {
    payload.genre.fusionNote = value; view.change();
  }, {multiline:true}).wrap);
  render();
}

