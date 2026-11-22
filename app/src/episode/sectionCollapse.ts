import { loadDoc, saveDoc } from '../data/db';
import { showToast } from '../ui/toast';

export async function upgradeCollapsibleSection(
  root: HTMLElement,
  { docKey }: { docKey: string; title?: string; itemPattern?: RegExp },
) {
  const toggle = root.querySelector<HTMLButtonElement>('[data-scene-toggle]');
  const list = root.querySelector<HTMLElement>('[data-scene-list]');
  if (!toggle || !list) return;
  const stored = await loadDoc<{ collapsed: boolean }>(docKey);
  if (!root.contains(list)) return;

  const setCollapsed = (collapsed: boolean) => {
    list.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  setCollapsed(!!stored?.collapsed);
  toggle.onclick = async () => {
    toggle.disabled = true;
    const collapsed = !list.hidden;
    try {
      await saveDoc(docKey, { collapsed });
      setCollapsed(collapsed);
    } catch (error) {
      showToast(String(error));
    } finally {
      toggle.disabled = false;
    }
  };
}