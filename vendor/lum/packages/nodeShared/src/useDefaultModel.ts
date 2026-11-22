import {watch,type Ref} from "vue";

export function useDefaultModel(data: Ref<{model?:string;followDefaultModel?:boolean}>, models: Ref<{providerId:string;modelId:string;isDefault?:boolean}[]>, busy: Ref<boolean>) {
  watch([()=>data.value.followDefaultModel,()=>models.value.find(model=>model.isDefault),busy],([follow,model,running])=>{
    if(follow===false||running||!model)return;
    const key=JSON.stringify([model.providerId,model.modelId]);
    if(data.value.model!==key)data.value.model=key;
  },{immediate:true});
}
