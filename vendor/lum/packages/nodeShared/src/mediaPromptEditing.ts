export interface MediaPromptContext {
  prompt:string;
  storyboard:{label:string;text:string}[];
  references:{id:string;token:string;name:string;type:string;role:string;description:string;available:boolean;path?:string}[];
  previous?:{label:string;text:string;sameScene:boolean};
  next?:{label:string;text:string;sameScene:boolean};
  settings:{duration?:number;ratio?:string;model?:string;mode?:string;promptReferenceSelection?:boolean};
  warnings:string[];
}
export interface MediaPromptAnalysisState {
  model:string;
  followDefaultModel?:boolean;
  skillId?:string;
  requirements?:string;
  result?:{source:string;analysis:string;prompt:string};
}
export interface MediaPromptSkill {id:string;name:string;description:string;instruction?:string}

export function requestMediaPromptSkill<T>(method:"mediaCatalog"|"mediaSkill",kind:"image"|"video",skillId?:string,signal?:AbortSignal):Promise<T>{
  let origin="";try{origin=new URL(document.referrer).origin;}catch{}
  if(window.parent===window||!["http://127.0.0.1:5178","http://localhost:5178"].includes(origin))return Promise.reject(Error("请从 Lum 画布打开，以连接项目 Skill 库"));
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener("message",receive);signal?.removeEventListener("abort",abort);};
    const abort=()=>{cleanup();reject(Error("已停止读取 Skill"));};
    const receive=(event:MessageEvent)=>{if(event.source!==window.parent||event.origin!==origin||event.data?.type!=="lum:previsSkillResponse"||event.data.id!==id)return;cleanup();event.data.error?reject(Error(String(event.data.error))):resolve(event.data.result);};
    const timer=setTimeout(()=>{cleanup();reject(Error("Skill 读取超时，请刷新后重试"));},15000);
    window.addEventListener("message",receive);signal?.addEventListener("abort",abort,{once:true});
    if(signal?.aborted){abort();return;}
    window.parent.postMessage({type:"lum:previsSkillRequest",id,method,params:{kind,skillId}},origin);
  });
}
