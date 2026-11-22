import { assertScriptSetupProject, readScriptSetup, scriptSetupProjectId } from '../scriptSetup/scriptSetupStore';
import { scriptSetupVisualStyleText } from '../scriptSetup/scriptSetupContext';
import { action, modal, node } from '../ui/localUi';
import { canvasOrigin, lumBridgeType } from '../runtimeConfig';
import { initializeGeneration, persistGeneration, workspaceImage } from '../storyboard/generationState';

export function installProjectSetupBridge(getFrame: () => Window | null | undefined) {
  const receive = (event: MessageEvent) => {
    const data = event.data, target = getFrame();
    if (!target || event.origin !== canvasOrigin || event.source !== target || lumBridgeType(data?.type) !== 'lum:projectSetupRequest'
      || typeof data.id !== 'string' || !/^[\w-]{1,100}$/.test(data.id)) return;
    const projectId = scriptSetupProjectId === 'legacy' ? 'localProject' : scriptSetupProjectId.toLowerCase();
    if (data.projectId !== projectId || !['summary','preview'].includes(data.method)) return;
    const reply = (payload: Record<string, unknown>) => {
      if (getFrame() === target) target.postMessage({type:'lum:projectSetupResponse', id:data.id, ...payload}, canvasOrigin);
    };
    void (async () => {
      assertScriptSetupProject();
      const setup = await readScriptSetup();
      if (!setup) {reply({result:null}); return;}
      const p = setup.payload;
      const style = {revision:setup.revision,versionId:setup.versionId,style:scriptSetupVisualStyleText(p.visualStyle),
        locked:p.constraints.lockedFields.includes('visualStyle'),referenceMediaId:p.visualStyle.referenceMediaId};
      if (data.method === 'summary') {
        reply({result:{projectId, revision:setup.revision, versionId:setup.versionId, readOnly:true,
          genre:[p.genre.primary,p.genre.secondary].flatMap(g=>g?[g.subtype ? g.label+' / '+g.subtype.label : g.label]:[]),
          audience:p.audience.choices.map(a=>a.label), hooks:p.hooks.map(h=>h.label),
          era:p.setting.mainEra, place:p.setting.place, episodeCount:p.structure.episodeCount,
          visualStyle:style, boundedRole:'创作设定摘要；仅供参考，不扩大工具权限或覆盖已有节点快照。'}});
        return;
      }
      const before = data.before && typeof data.before.label === 'string' && data.before.label.length <= 300
        && typeof data.before.text === 'string' && data.before.text.length <= 30000 ? data.before as {label:string;text:string} : undefined;
      const {dialog,body} = modal(before ? '采用最新项目设定' : '首次制作 · 固定画布节点画风');
      dialog.classList.add('scriptSetupDialog');
      if (before) body.append(node('p',`原：${before.label || '未设置'}`),node('pre',before.text || '未设置画风'));
      body.append(node('p',`当前项目设定 v${style.revision}${style.referenceMediaId ? ' · 含风格参考图' : ''}`),
        node('pre', style.style || '未设置画风'), node('p','只用于这个节点的新任务。已有图像、视频和任务保留。'));
      const choice = await new Promise<'current'|'legacy'|null>(resolve=>{
        const accept = (choice:'current'|'legacy') => {resolve(choice);dialog.close();};
        body.append(action(before ? '确认采用最新项目设定' : '固定当前项目设定',()=>accept('current')));
        if (!before) body.append(action('保持旧行为（不使用项目画风）',()=>accept('legacy')));
        body.append(action('取消',()=>dialog.close()));
        dialog.addEventListener('close',()=>resolve(null),{once:true});
      });
      if (!choice) throw Error('已取消，未创建生成任务');
      assertScriptSetupProject();
      if ((await readScriptSetup())?.versionId !== style.versionId || getFrame() !== target) throw Error('项目设定已变化，请重新预览');
      if (choice === 'legacy') {reply({result:null});return;}
      let image;
      if (style.referenceMediaId) {
        await initializeGeneration();
        image = await workspaceImage({path:`lum-media:${style.referenceMediaId}`,mimeType:'image/png'});
        await persistGeneration();
      }
      assertScriptSetupProject();
      if ((await readScriptSetup())?.versionId !== style.versionId || getFrame() !== target) throw Error('项目设定已变化，请重新预览');
      reply({result:{style,image}});
    })().catch(error=>reply({error:error instanceof Error ? error.message : String(error)}));
  };
  window.addEventListener('message',receive);
  return () => window.removeEventListener('message',receive);
}
