<template>
  <section class="defaultModels" aria-label="全局默认模型">
    <h3>全局默认模型</h3>
    <p>设置语言、图片和视频模型。新节点和跟随默认设置的节点自动使用；单个节点仍可另选模型。</p>
    <label v-for="kind in kinds" :key="kind.id">
      <span>{{ kind.label }}</span>
      <el-select :modelValue="selected(kind.id)" filterable :loading="loading" :disabled="saving" :aria-label="kind.label" @update:modelValue="value => save(kind.id, value)">
        <el-option value="" label="未设置 · 单独选择" />
        <el-option v-if="selected(kind.id) && !options(kind.id).some(model => key(model) === selected(kind.id))" :value="selected(kind.id)" label="已选模型不可用，请重新选择" disabled />
        <el-option v-for="model in options(kind.id)" :key="key(model)" :value="key(model)" :label="`${model.providerLabel} · ${model.label || model.modelId}`" />
      </el-select>
    </label>
    <el-button :loading="loading" :disabled="saving" @click="load">刷新模型</el-button>
    <p v-if="status" role="status">{{ status }}</p>
  </section>
</template>

<script setup lang="ts">
import {onMounted,ref} from "vue";
import {ElButton,ElSelect,ElOption} from "element-plus";
import {useNodeAi,type NodeAiModel,type NodeMediaModel} from "@lum/nodes-scaffold/runtime";
import {settings,saveSettings} from "@/stores/settings";
const kinds=[{id:"language",label:"默认语言模型"},{id:"image",label:"默认图片模型"},{id:"video",label:"默认视频模型"},{id:"videoUpscale",label:"默认视频超分模型"},{id:"videoEdit",label:"默认视频编辑模型"}] as const;
type Kind=typeof kinds[number]["id"];
type Choice={providerId:string;modelId:string};
const ai=useNodeAi(),language=ref<NodeAiModel[]>([]),media=ref<NodeMediaModel[]>([]),loading=ref(false),saving=ref(false),status=ref("");
const key=(value:Choice)=>JSON.stringify([value.providerId,value.modelId]);
const selected=(kind:Kind)=>{const value=(settings.value.modelDefaults as Partial<Record<Kind,Choice>>|undefined)?.[kind];return value?.providerId&&value.modelId?key(value):"";};
const options=(kind:Kind)=>kind==="language"?language.value:media.value.filter(model=>{const type=kind.startsWith("image")?"image":"video";const operation=kind.endsWith("Upscale")?"upscale":kind.endsWith("Edit")?"edit":"generate";return model.type===type&&(model.operation??"generate")===operation;});
async function load(){loading.value=true;status.value="";try{const [languages,generate,edit,upscale]=await Promise.all([ai.getModels(),ai.getMediaModels(),ai.getMediaModels(undefined,"edit"),ai.getMediaModels(undefined,"upscale")]);language.value=languages;media.value=[...generate,...edit,...upscale];}catch(error){status.value=error instanceof Error?error.message:"模型读取失败";}finally{loading.value=false;}}
async function save(kind:Kind,value:string){
  const model=options(kind).find(item=>key(item)===value);if(value&&!model)return;
  saving.value=true;status.value="";
  try{await saveSettings(current=>({modelDefaults:{...(current.modelDefaults as object??{}),[kind]:model?{providerId:model.providerId,modelId:model.modelId}:null}}));status.value="默认模型已保存。节点手动选择仍可覆盖本次生成。";}
  catch(error){status.value=error instanceof Error?error.message:"保存失败，原设置保留";}finally{saving.value=false;}
}
onMounted(load);
</script>

<style scoped>
.defaultModels{padding:0 0 20px;border-bottom:1px solid var(--el-border-color-lighter);margin-bottom:20px}
.defaultModels h3{font-size:14px;margin:0 0 8px}.defaultModels p{font-size:12px;color:var(--el-text-color-secondary);line-height:1.7}
.defaultModels label{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;align-items:center;margin:12px 0;font-size:13px}.defaultModels .el-select{width:100%}
@media(max-width:600px){.defaultModels label{grid-template-columns:1fr;gap:6px}}
</style>
