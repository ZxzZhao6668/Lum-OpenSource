import { loadDoc } from '../data/db';
import type { ScriptBlock } from './editor';
import { sceneAtOrder } from './sceneIdentity';

export function renderSceneList(list: HTMLElement, blocks: readonly ScriptBlock[]) {
  const scenes = blocks.filter(block => block.type === 'scene');
  const existing = new Map(Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-scene-block-id]'),
    row => [row.dataset.sceneBlockId!, row]));
  const rows = scenes.map((block, index) => {
    const scene = sceneAtOrder(block.text, index + 1);
    const label = [scene.index + '.', scene.intExt, scene.location, scene.timeOfDay].filter(Boolean).join(' ');
    const row = existing.get(block.id) ?? document.createElement('button');
    row.type = 'button';
    row.dataset.sceneBlockId = block.id;
    if (row.textContent !== label) row.textContent = label;
    return row;
  });
  if (!rows.length) {
    if (!list.querySelector('.dsh-scene-empty')) {
      const empty = document.createElement('p');
      empty.className = 'dsh-scene-empty';
      empty.textContent = '暂无场次';
      list.replaceChildren(empty);
    }
  } else if (list.children.length !== rows.length || rows.some((row, i) => row !== list.children[i])) {
    list.replaceChildren(...rows);
  }
}

export async function syncSceneList(root: HTMLElement, episodeId = 'ep_001') {
  const list = root.querySelector<HTMLElement>('[data-scene-list]');
  if (!list) return;
  const blocks = (await loadDoc<ScriptBlock[]>(`script:${episodeId}`)) ?? [];
  if (root.contains(list)) renderSceneList(list, blocks);
}
