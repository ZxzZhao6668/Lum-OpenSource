<template>
  <section class="bakeContent">
    <p>只烘焙场景与道具的环境遮蔽（AO）。人物始终排除，灯光和人物投影保持实时。</p>
    <p v-if="stale" role="status">模型、布局或动画已变化，旧缓存已停用，请重新烘焙。</p>
    <label v-if="bake">使用烘焙<input type="checkbox" :checked="bake.enabled && !stale" :disabled="busy || stale" @change="emit('enabled',($event.target as HTMLInputElement).checked)" /></label>
    <label v-if="bake">遮蔽强度 {{ Math.round(bake.strength * 100) }}%<input type="range" min="0" max="1" step=".05" :value="bake.strength" :disabled="busy" @change="emit('strength',Number(($event.target as HTMLInputElement).value))" /></label>
    <label>质量<select v-model.number="samples" :disabled="busy"><option :value="16">快速 · 16 次采样</option><option :value="32">标准 · 32 次采样</option><option :value="64">精细 · 64 次采样</option></select></label>
    <label>遮蔽距离（米）<input v-model.number="distance" type="number" min=".05" max="10" step=".05" :disabled="busy" /></label>
    <p>{{ count }} 个场景 / 道具可参与。移动道具仅计算自身遮蔽，不把背景阴影固定在道具上。低面数模型的细节仍受几何精度限制。</p>
    <div class="bakeButtons"><button :disabled="busy || !count || !validOptions" @click="emit('start',{samples,distance})">{{ bake ? '重新烘焙' : '开始烘焙' }}</button><button v-if="baking" @click="emit('cancel')">取消烘焙</button></div>
    <p v-if="progress" role="status">{{ progress }}</p>
    <details>
      <summary>根据参考图匹配光影</summary>
      <p>通过已配置的视觉 AI 联网读图，匹配主光方向、冷暖和补光。先预览应用，再按需烘焙；不会从图片凭空生成真实材质贴图。</p>
      <slot name="modelPicker" />
      <label>参考图片<select v-model="selectedPath" :disabled="busy || uploading"><option value="">选择项目图片</option><option v-for="reference in choices" :key="reference.path" :value="reference.path">{{ reference.label }}</option></select></label>
      <label>上传参考图<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy || uploading" @change="upload" /></label>
      <img v-if="imageUrl" :src="imageUrl" alt="光影参考图" class="referenceImage" />
      <button :disabled="busy || uploading || loading || !selected || !imageUrl" @click="selected && emit('matchReference',selected)">AI 匹配光影并预览</button>
    </details>
    <div v-if="error" class="bakeError" role="alert"><span>{{ error }}</span><button aria-label="关闭图片错误" @click="error=''">×</button></div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { StageBake, StageBakeOptions } from "@lum/node-shared/stageBake";
import type { TerrainReference } from "./previsTerrain";
const props = defineProps<{ bake?: StageBake; busy: boolean; baking: boolean; stale: boolean; count: number; progress: string; references: TerrainReference[]; uploadReference: (file: File) => Promise<TerrainReference>; readReference: (reference: TerrainReference) => Promise<Blob> }>();
const emit = defineEmits<{ start: [options: StageBakeOptions]; cancel: []; enabled: [value: boolean]; strength: [value: number]; matchReference: [reference: TerrainReference] }>();
const samples = ref<16 | 32 | 64>(props.bake?.samples ?? 32), distance = ref(props.bake?.distance ?? 1.5);
const selectedPath = ref(""), uploaded = ref<TerrainReference[]>([]), imageUrl = ref(""), error = ref(""), uploading = ref(false), loading = ref(false);
const validOptions = computed(() => Number.isFinite(distance.value) && distance.value >= .05 && distance.value <= 10);
const choices = computed(() => [...new Map([...props.references,...uploaded.value].map(reference => [reference.path,reference])).values()]);
const selected = computed(() => choices.value.find(reference => reference.path === selectedPath.value));
let version = 0, disposed = false;
watch(selected, async reference => {
  const current = ++version; if (imageUrl.value) URL.revokeObjectURL(imageUrl.value); imageUrl.value = ""; error.value = "";
  if (!reference) return;
  loading.value = true;
  try { const blob = await props.readReference(reference); if (!disposed && current === version) imageUrl.value = URL.createObjectURL(blob); }
  catch (cause) { if (!disposed && current === version) error.value = cause instanceof Error ? cause.message : "无法读取参考图"; }
  finally { if (current === version) loading.value = false; }
});
async function upload(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file || props.busy || uploading.value) return;
  uploading.value = true; error.value = "";
  try { const reference = await props.uploadReference(file); if (!disposed) { uploaded.value.push(reference); selectedPath.value = reference.path; } }
  catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : "无法保存参考图"; }
  finally { uploading.value = false; }
}
onBeforeUnmount(() => { disposed = true; version++; if (imageUrl.value) URL.revokeObjectURL(imageUrl.value); });
</script>

<style scoped>
.bakeContent { display:flex; flex-direction:column; gap:12px; min-width:0;
  p { margin:0; line-height:1.6; }
  label { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
  input,select,button { font:inherit; color:inherit; max-width:100%; box-sizing:border-box; border:1px solid var(--stageLine,#ffffff55); border-radius:10px; background:var(--stageGlass,#555a); backdrop-filter:var(--stageFrost,blur(16px)); padding:7px 10px; text-shadow:var(--stageHeaderTextShadow,0 1px 3px #0008); }
  input[type=range],input[type=file],select { width:100%; }
  input[type=number] { width:100px; }
  button { cursor:pointer; } button:hover:not(:disabled) { transform:translateY(-1px); border-color:#ffffffb0; background:#ffffff25; } button:disabled { opacity:.55; cursor:default; }
  .bakeButtons { display:flex; gap:8px; flex-wrap:wrap; }
  details { border-top:1px solid var(--stageLine,#ffffff55); padding-top:12px; } summary { cursor:pointer; margin-bottom:10px; } details>label,details>button { margin-top:12px; }
  .referenceImage { width:100%; max-height:170px; object-fit:contain; border-radius:12px; margin-top:10px; }
  .bakeError { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; overflow-wrap:anywhere; }
}
</style>
