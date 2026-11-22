import { loadDoc } from '../data/db';
import { migrateSceneReferences } from '../storyboard/sceneReferences';
import { node } from '../ui/localUi';
import type { ScriptBlock } from './editor';
import { sceneAtOrder } from './sceneIdentity';
import './sceneView.css';

export async function syncSceneCards(root: HTMLElement, episodeId = 'ep_001') {
  const container = root.querySelector<HTMLElement>('[data-scene-cards]');
  if (!container) return;
  const blocks = (await loadDoc<ScriptBlock[]>(`script:${episodeId}`)) ?? [];
  if (!container.isConnected) return;
  await migrateSceneReferences(episodeId, blocks);
  if (!container.isConnected) return;

  const cards = blocks.filter(block => block.type === 'scene').map((block, index) => {
    const scene = sceneAtOrder(block.text, index + 1);
    const card = node('article', '', 'lumSceneCard');
    card.dataset.sceneBlockId = block.id;
    const title = node('h3', [scene.intExt, scene.location, scene.timeOfDay && '– ' + scene.timeOfDay].filter(Boolean).join(' '));
    title.dataset.sceneTitle = '';
    const description = node('p');
    description.dataset.sceneDescription = '';
    const actions = node('div', '', 'lumSceneActions');
    for (const [id, label] of [['preview', '查看剧本片段'], ['edit', '编辑'], ['canvas', '打开画布']]) {
      const button = node('button', label, 'localButton');
      button.type = 'button';
      button.dataset.sceneAction = id;
      actions.append(button);
    }
    card.append(node('span', '第 ' + scene.index + ' 场', 'lumSceneNumber'), title, description, actions);
    return card;
  });
  const count = root.querySelector<HTMLElement>('[data-scene-card-count]');
  if (count) {
    count.dataset.sceneCount = 'true';
    count.textContent = String(cards.length);
  }
  const empty = node('p', '本章还没有场次。将正文段落设为“场次”即可在这里查看。', 'lumSceneEmpty');
  empty.id = 'dsh-scene-cards-empty';
  container.replaceChildren(...(cards.length ? cards : [empty]));
}
