import type { ShotMediaPin, ShotMediaHistory } from './shotMedia';
import type { ScriptBlock } from '../script/editor';
import { parseScene, sceneRef, UNASSIGNED_SCENE } from '../script/sceneIdentity';
import type { ShotSetupSnapshot } from '../scriptSetup/shotSetup';
import type { ShotMention } from './mentionModel';

export interface Shot {
  id: string; no: string; type: string; angle: string; movement: string;
  lens: string; desc: string; x: number; y: number; sceneId?: string; image?: string;
  duration?: number; entityIds?: string[]; staging?: string; notes?: string;
  descMentions?: ShotMention[];
  setupSnapshot?: ShotSetupSnapshot;
  mediaPin?: ShotMediaPin; mediaHistory?: ShotMediaHistory[];
}
export type StoryScene = { id: string; blockId: string; title: string; index: number; intExt: string; location: string; timeOfDay: string; blocks: ScriptBlock[] };
export const shotFields = [['no','镜号'],['type','景别'],['angle','角度'],['movement','运动'],['lens','焦段'],['duration','时长'],['desc','镜头描述']] as const;
export type ShotField = typeof shotFields[number][0];
export const boardFields = [['image','剧照预览'],['type','景别'],['angle','角度'],['movement','运动'],['lens','焦段'],['duration','时长'],['desc','画面描述'],['staging','场面调度'],['notes','备注']] as const;
export type BoardField = typeof boardFields[number][0];
export function storyScenes(blocks: ScriptBlock[]): StoryScene[] {
  const scenes: StoryScene[] = [];
  blocks.forEach((block, i) => {
    if (block.type !== 'scene') return;
    const next = blocks.findIndex((b, at) => at > i && b.type === 'scene');
    scenes.push({ ...parseScene(block.text, scenes.length+1)!, index: scenes.length+1, id: sceneRef(block.id), blockId: block.id, title: block.text, blocks: blocks.slice(i, next<0 ? blocks.length : next) });
  });
  return scenes;
}
export function sceneShots(shots: Shot[], id: string, scenes: StoryScene[]) {
  return shots.filter(s => id === UNASSIGNED_SCENE ? !scenes.some(scene => scene.id === s.sceneId) : s.sceneId === id);
}
export function shotNumber(shot: Shot, shots: Shot[], scenes: StoryScene[], full = true) {
  // Preserve intentional user-defined identifiers; automatic SHOT labels follow order.
  if (shot.no && !/^(?:SHOT\s*)?\d+(?:-\d+)?$/i.test(shot.no.trim())) return shot.no;
  const scene = scenes.find(s => s.id === shot.sceneId);
  const local = String(sceneShots(shots, scene?.id ?? UNASSIGNED_SCENE, scenes).findIndex(s => s.id === shot.id)+1).padStart(2,'0');
  return full ? `${scene ? String(scene.index).padStart(2,'0') : '未关联'}-${local}` : `SHOT ${local}`;
}
export function validDuration(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 3600) throw Error('时长需为大于 0、不超过 3600 的秒数');
  return Math.max(.01, Math.round(number*100)/100);
}
