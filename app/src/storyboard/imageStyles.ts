/** Visual presets are stored as part of the user's requirements, so the existing
 * prompt fingerprint and stale-source checks cover style changes as well. */
export const imageStyles = [
  {id:'',name:'保持原设定',instruction:''},
  {id:'film',name:'电影写实',instruction:'电影写实风格，真实材质与自然光影，画面具有影视质感。'},
  {id:'photo',name:'摄影写实',instruction:'写实摄影风格，细节自然，质感可信，光线和比例符合真实摄影。'},
  {id:'historical',name:'古风写实',instruction:'古风写实风格，服饰、建筑和材质符合故事时代，色彩克制，具有历史氛围。'},
  {id:'ink',name:'中国水墨',instruction:'中国水墨风格，宣纸肌理与墨色浓淡结合，保留主体清晰轮廓和必要色彩。'},
  {id:'gongbi',name:'国风工笔',instruction:'中国工笔画风格，细致线描、典雅设色，保留主体外观和结构细节。'},
  {id:'anime',name:'日式动漫',instruction:'日式动画风格，清晰线条和分层色彩，人物及资产设定保持一致。'},
  {id:'comic',name:'漫画插画',instruction:'漫画插画风格，清晰轮廓和有表现力的明暗，保持资产设定一致。'},
  {id:'oil',name:'油画',instruction:'油画风格，可见细腻笔触与丰富层次，主体清楚，色彩协调。'},
  {id:'watercolor',name:'水彩',instruction:'水彩插画风格，透明叠色与柔和纸张纹理，保持主体结构清晰。'},
  {id:'3d',name:'三维动画',instruction:'三维动画风格，造型清晰、材质统一，呈现柔和自然的立体光照。'},
] as const;
const prefix='【Lum 图片风格】';
export function imageStyleId(requirements:string){
  const line=requirements.split('\n',1)[0];
  return imageStyles.find(style=>style.id&&line===prefix+style.instruction)?.id??'';
}
export function applyImageStyle(requirements:string,id:string){
  const style=imageStyles.find(item=>item.id===id);if(!style)throw Error('图片风格不存在');
  const current=imageStyleId(requirements);
  const rest=current?requirements.slice(requirements.indexOf('\n')+1):requirements;
  return style.id?prefix+style.instruction+'\n'+rest:rest;
}
