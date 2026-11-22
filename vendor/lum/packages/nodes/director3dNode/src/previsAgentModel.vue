<template>
  <div class="agentModelPicker">
    <label>AI 模型<select :value="model" :disabled="busy || loading" aria-label="片场 AI 模型" @change="emit('change',($event.target as HTMLSelectElement).value)"><option value="">请选择模型</option><option v-for="item in models" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
    <button :disabled="busy || loading" @click="emit('refresh')">{{ loading ? '加载中…' : '刷新模型' }}</button>
    <p v-if="!loading && !models.length">尚无可用模型，请在项目设置添加文本 / 视觉模型。可直接关闭片场后配置。</p>
    <p v-else-if="!model && !loading">在这里选择模型即可，无需离开片场；参考图任务请选择支持看图的模型。</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ models: {value:string;label:string}[]; model:string; busy:boolean; loading:boolean }>();
const emit = defineEmits<{change:[value:string];refresh:[]}>();
</script>

<style scoped>
.agentModelPicker { display:flex; flex-wrap:wrap; align-items:end; gap:8px; margin:12px 0;
  label { flex:1; min-width:160px; } select { display:block; width:100%; margin-top:5px; }
  select,button { box-sizing:border-box; max-width:100%; color:inherit; font:inherit; padding:7px 10px; border:1px solid var(--stageLine,#ffffff55); border-radius:10px; background:var(--stageGlass,#555a); backdrop-filter:var(--stageFrost,blur(16px)); text-shadow:var(--stageHeaderTextShadow,0 1px 3px #0008); }
  button { cursor:pointer; } button:hover:not(:disabled) { transform:translateY(-1px); border-color:#ffffffaa; } p { flex-basis:100%; margin:0; font-size:12px; line-height:1.5; }
}
</style>
