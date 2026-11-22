import { loadDoc } from '../data/db';
import { modal, node } from '../ui/localUi';
import type { ScriptBlock } from './editor';
import { sceneAtOrder } from './sceneIdentity';
import './sceneView.css';

export async function openScenePreview(label: string, episodeId = 'ep_001', blockId?: string): Promise<boolean> {
  const blocks = (await loadDoc<ScriptBlock[]>(`script:${episodeId}`)) ?? [];
  const scenes = blocks.filter(block => block.type === 'scene');
  const index = scenes.findIndex((block, i) => {
    if (blockId) return block.id === blockId;
    const scene = sceneAtOrder(block.text, i + 1);
    return [scene.intExt, scene.location, scene.timeOfDay && '- ' + scene.timeOfDay].filter(Boolean).join(' ') === label;
  });
  if (index < 0) return false;

  document.querySelector<HTMLDialogElement>('#dsh-spv')?.close();
  const { dialog, body } = modal('剧本片段');
  dialog.id = 'dsh-spv';
  dialog.classList.add('lumScenePreview');
  const page = node('article', '', 'lumSceneExcerpt');
  const mode = node('div', '', 'lumExcerptModes');
  mode.setAttribute('role', 'group');
  mode.setAttribute('aria-label', '剧本版式');
  for (const [id, name] of [['asian', '亚洲'], ['hollywood', '好莱坞']]) {
    const button = node('button', name, 'localButton');
    button.type = 'button';
    button.dataset.mode = id;
    button.setAttribute('aria-pressed', String(id === 'asian'));
    button.onclick = () => {
      page.dataset.mode = id;
      for (const other of mode.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
    };
    mode.append(button);
  }
  const start = blocks.indexOf(scenes[index]);
  const end = index + 1 < scenes.length ? blocks.indexOf(scenes[index + 1]) : blocks.length;
  const scene = sceneAtOrder(scenes[index].text, index + 1);
  const heading = node('h3', [`第 ${scene.index} 场`, scene.intExt, scene.location, scene.timeOfDay].filter(Boolean).join(' · '));
  page.append(heading);
  for (const block of blocks.slice(start + 1, end)) {
    const line = node('p', block.text);
    line.dataset.blockType = block.type;
    page.append(line);
  }
  body.append(mode, page);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  return true;
}
