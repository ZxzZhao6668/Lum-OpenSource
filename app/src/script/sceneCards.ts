import { db, loadDoc, saveDoc } from '../data/db';
import { writingWorkspace } from '../projects/projectIdentity';
import { action, field, modal } from '../ui/localUi';
import { showToast } from '../ui/toast';
import { readDocument, saveDocument } from '../writing/documentStore';
import { renderSceneList } from './sceneListSync';
import { openScenePreview } from './scenePreview';

type Descriptions = Record<string, string>;

export async function upgradeSceneCards(root: HTMLElement, episodeId = 'ep_001') {
  const key = `scene:desc:${episodeId}`;
  const cards = root.querySelectorAll<HTMLElement>('[data-scene-cards] article[data-scene-block-id]');
  if (!cards.length) return;
  const descriptions = await loadDoc<Descriptions>(key) ?? {};
  for (const card of cards) {
    if (!card.isConnected) return;
    const id = card.dataset.sceneBlockId!;
    const ref = 'block:' + id;
    const title = card.querySelector<HTMLElement>('[data-scene-title]')!;
    const description = card.querySelector<HTMLElement>('[data-scene-description]')!;
    description.textContent = descriptions[ref] ?? '';
    const open = async () => {
      if (!await openScenePreview(title.textContent ?? '', episodeId, id)) showToast('该场次已发生变化，请重新打开场次页');
    };
    card.onclick = event => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('button');
      if (!button || button.dataset.sceneAction === 'preview') void open().catch(error => showToast(String(error)));
    };
    const edit = card.querySelector<HTMLButtonElement>('[data-scene-action=edit]')!;
    edit.onclick = async () => {
      try {
        const base = await readDocument(episodeId);
        const original = base.blocks.find(block => block.id === id && block.type === 'scene');
        if (!original) throw Error('该场次已移除，请重新打开场次页');
        const oldDescription = (await loadDoc<Descriptions>(key))?.[ref] ?? '';
        if (!card.isConnected) return;
        const { dialog, body } = modal('编辑场次');
        dialog.id = 'dsh-scene-dialog';
        const name = field('场次标题', title.textContent ?? '');
        const oldTitle = name.input.value;
        const detail = field('场次描述', oldDescription, true);
        body.append(name.wrap, detail.wrap, action('保存', async () => {
          const nextTitle = name.input.value.trim();
          if (!nextTitle) throw Error('请输入场次标题');
          const next = await db.transaction('rw', db.docs, async () => {
            const map = (await loadDoc<Descriptions>(key)) ?? {};
            if ((map[ref] ?? '') !== oldDescription) throw Error('场次描述已在其他页面修改，请重新打开');
            const current = await readDocument(episodeId);
            if (current.revision !== base.revision) throw Error('剧本已发生变化，请重新打开场次');
            if (detail.input.value !== oldDescription) await saveDoc(key, { ...map, [ref]: detail.input.value });
            if (nextTitle === oldTitle) return current;
            const prefix = original.text.match(/^\s*\d+\s*[.、]\s*/)?.[0] ?? '';
            return saveDocument(episodeId, base.blocks.map(block => block.id === id ? { ...block, text: prefix + nextTitle } : block), base.revision);
          });
          title.textContent = nextTitle;
          description.textContent = detail.input.value;
          const list = root.querySelector<HTMLElement>('[data-scene-list]');
          if (list) renderSceneList(list, next.blocks);
          dialog.close();
          if (next.revision !== base.revision) window.dispatchEvent(new CustomEvent('dsh:script-saved', { detail: next.blocks.length }));
          showToast('场次已保存');
        }));
        name.input.focus();
      } catch (error) { showToast(String(error)); }
    };
    const production = card.querySelector<HTMLButtonElement>('[data-scene-action=canvas]')!;
    if (writingWorkspace) production.remove();
    else production.onclick = () => window.dispatchEvent(new CustomEvent('dsh:nav', { detail: 'canvas' }));
  }
}
