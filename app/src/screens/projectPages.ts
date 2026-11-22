import {mountWorldview} from '../worldview/worldviewWorkspace';
import { mainPanel } from '../ui/localUi';
import { mountCoverWorkspace } from './coverWorkspace';
import { mountSkillLibrary } from '../skills/skillPanel';

export async function mountProjectPage(root:HTMLElement,screen:string,episodeId='ep_001',episodeTitle='第一集'){
  if(screen==='02-cover'){
    await mountCoverWorkspace(root,episodeId,episodeTitle);return;
  }
  if(screen==='11-consultant'){
    const {body}=mainPanel(root,'技能 · Skill 库');await mountSkillLibrary(body,true,root.querySelector<HTMLElement>('[data-page-index]'));return;
  }
  if(screen==='09-worldview')await mountWorldview(root,episodeId);
}

