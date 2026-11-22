import {node} from '../ui/localUi';
import {UNASSIGNED_SCENE} from '../script/sceneIdentity';
import type {Shot} from './shotModel';
import './shotSceneFilter.css';

/** Filter by stable scene IDs; orphaned references remain available under 未分场. */
export function shotSceneFilter(scenes: {id: string; title: string}[], shots: Shot[], initialSceneId = '') {
  const known = new Set(scenes.filter(scene => scene.id !== UNASSIGNED_SCENE).map(scene => scene.id));
  const sceneOf = (shot: Shot) => shot.sceneId && known.has(shot.sceneId) ? shot.sceneId : UNASSIGNED_SCENE;
  const counts = new Map<string, number>();
  for (const shot of shots) counts.set(sceneOf(shot), (counts.get(sceneOf(shot)) ?? 0) + 1);
  const wrap = node('label', '选择场次', 'shotSceneFilter'), select = node('select');
  select.setAttribute('aria-label', '选择场次');
  const option = (value: string, title: string, count: number) => {
    const item = node('option', `${title}（${count} 镜）`); item.value = value; select.append(item);
  };
  option('', '全部场次', shots.length);
  for (const scene of scenes) if (scene.id !== UNASSIGNED_SCENE) option(scene.id, scene.title, counts.get(scene.id) ?? 0);
  if (counts.has(UNASSIGNED_SCENE)) option(UNASSIGNED_SCENE, '未分场镜头', counts.get(UNASSIGNED_SCENE)!);
  if ([...select.options].some(item => item.value === initialSceneId)) select.value = initialSceneId;
  wrap.append(select);
  return {wrap, select, matches: (shot: Shot) => !select.value || sceneOf(shot) === select.value};
}
