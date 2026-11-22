<template>
  <section class="terrainPanel" role="dialog" aria-label="图片生成场地" @keydown.stop @pointerdown.stop @wheel.stop>
    <header><strong>图片生成场地</strong><button :disabled="uploading" @click="$emit('close')">{{ busy ? '取消并关闭' : '关闭' }}</button></header>
    <p class="hint">通过你配置的视觉 API 读取参考图，检索本机模型组块并搭建白模。背面与尺寸需要估计；请在下方选择支持看图的模型。</p>
    <slot name="modelPicker" />
    <label>场景参考图<select v-model="selectedPath" :disabled="busy || !!preview || uploading"><option value="">选择地点或场景图片</option><option v-for="reference in choices" :key="reference.path" :value="reference.path">{{ reference.label }}</option></select></label>
    <label class="uploadLabel">上传场景图片<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传场景图片" :disabled="busy || !!preview || uploading" @change="upload" /></label>
    <img v-if="imageUrl" class="referenceImage" :src="imageUrl" alt="场景建模参考图片" />
    <p v-else class="hint">{{ uploading ? '正在保存图片…' : loading ? '正在读取参考图…' : '支持PNG、JPEG、WebP，最大20MB。' }}</p>
    <div class="options"><label>场地宽度（米）<input v-model.number="width" aria-label="场地宽度（米）" type="number" min="3" max="200" step="1" :disabled="busy || !!preview" /></label><label>建模细节<select v-model.number="maxParts" :disabled="busy || !!preview"><option :value="24">简洁 · 最多24部件</option><option :value="48">标准 · 最多48部件</option><option :value="80">精细 · 最多80部件</option></select></label></div>
    <label>补充说明<textarea v-model="instruction" rows="3" :disabled="busy || !!preview" placeholder="例如：保留中间道路，两侧是房屋，留出人物行走空间" /></label>
    <p class="hint">同一地点再次生成会替换此前生成的场地部件，人物、机位与动作保留。先预览，应用后保存。</p>
    <p v-if="localError || error" class="error" role="alert">{{ localError || error }}<button aria-label="关闭场地错误提示" @click="localError='';$emit('dismissError')">关闭</button></p>
    <template v-if="preview">
      <p class="summary">{{ preview.summary }}</p><p>场地 {{ preview.width }} × {{ preview.depth }} 米，{{ preview.objectIds.length - 1 }} 个部件。</p>
      <details><summary>看图依据与估计</summary><ul><li v-for="item in preview.observations" :key="item">{{ item }}</li><li v-for="item in preview.assumptions" :key="item">估计：{{ item }}</li></ul></details>
      <div class="buttons"><button @click="$emit('frame')">查看整个场地</button><button @click="$emit('apply')">应用场地</button><button @click="$emit('discard')">取消预览</button></div>
    </template>
    <div v-else><p v-if="busy" role="status">{{ progress || '正在准备场地…' }}</p><div class="buttons"><button :disabled="busy || uploading || loading || !imageUrl || !reference" @click="generate">{{ busy ? '总 Agent 正在看图建模…' : '生成场地预览' }}</button><button v-if="busy" @click="$emit('cancel')">取消生成</button></div></div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { terrainRequestSchema, type TerrainReference, type TerrainRequest, type TerrainSet } from "./previsTerrain";
const props = defineProps<{ references: TerrainReference[]; progress?: string; busy: boolean; error: string; preview?: TerrainSet; readReference: (reference: TerrainReference) => Promise<Blob>; uploadReference: (file: File) => Promise<TerrainReference> }>();
const emit = defineEmits<{ generate: [request: TerrainRequest, instruction: string]; close: []; apply: []; discard: []; cancel: []; frame: []; dismissError: [] }>();
const uploaded = ref<TerrainReference[]>([]), selectedPath = ref(props.references[0]?.path ?? "");
const choices = computed(() => [...new Map([...props.references, ...uploaded.value].map(reference => [reference.path, reference])).values()]);
const reference = computed(() => choices.value.find(reference => reference.path === selectedPath.value));
const width = ref(24), maxParts = ref<24 | 48 | 80>(48), instruction = ref("");
const imageUrl = ref(""), localError = ref(""), loading = ref(false), uploading = ref(false);
let imageVersion = 0, disposed = false;
watch(reference, async value => {
  const version = ++imageVersion; localError.value = "";
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value); imageUrl.value = "";
  if (!value) { loading.value = false; return; }
  loading.value = true;
  try { const blob = await props.readReference(value); if (!disposed && version === imageVersion) imageUrl.value = URL.createObjectURL(blob); }
  catch (cause) { if (!disposed && version === imageVersion) localError.value = cause instanceof Error ? cause.message : "读取图片失败"; }
  finally { if (!disposed && version === imageVersion) loading.value = false; }
}, { immediate: true });
async function upload(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file || props.busy || props.preview) return;
  uploading.value = true; localError.value = "";
  try { const reference = await props.uploadReference(file); if (!disposed) { uploaded.value.push(reference); selectedPath.value = reference.path; } }
  catch (cause) { if (!disposed) localError.value = cause instanceof Error ? cause.message : "保存图片失败"; }
  finally { if (!disposed) uploading.value = false; }
}
function generate() {
  if (props.busy || !reference.value || loading.value || uploading.value) return;
  const parsed = terrainRequestSchema.safeParse({ reference: reference.value, width: width.value, maxParts: maxParts.value });
  if (!parsed.success) { localError.value = "请设置3–200米的场地宽度，并选择参考图和建模细节。"; return; }
  localError.value = ""; emit("generate", parsed.data, instruction.value.trim().slice(0,4000));
}
onBeforeUnmount(() => { disposed = true; imageVersion++; if (imageUrl.value) URL.revokeObjectURL(imageUrl.value); });
</script>

<style scoped>
.terrainPanel { position: absolute; top: 60px; right: 236px; bottom: 195px; width: 370px; max-width: 48%; z-index: 4; overflow-y: auto; box-sizing: border-box; padding: 16px; border: 1px solid #7aa9df; border-radius: 12px; background: #202a3a; box-shadow: 0 10px 35px #0008; font: 13px/1.45 system-ui,sans-serif; color: #e3e8f2; }
header,.buttons,.options { display: flex; gap: 8px; align-items: center; }header { justify-content: space-between; }header strong { font-size: 16px; }.hint { color: #b9c7de; font-size: 12px; }.referenceImage { width: 100%; max-height: 175px; object-fit: contain; background: #111721; border-radius: 7px; margin: 9px 0; }label { display:block; margin: 9px 0; }.options label { width: 50%; }input,select,textarea,button { font: inherit; color: inherit; border: 1px solid #46516a; border-radius: 6px; background: #242d3d; padding: 7px; box-sizing: border-box; }label>input,label>select,label>textarea { display:block; width:100%; margin-top:4px; }input[type=file] { font-size: 11px; }button { cursor:pointer; }button:disabled { opacity:.5; cursor:default; }.buttons { flex-wrap:wrap; margin-top:12px; }.error { color:#ffc9cd; background:#502d35; padding:10px; white-space:pre-wrap; overflow-wrap:anywhere; max-height:150px; overflow:auto; border-radius:6px; }details { font-size:12px; }summary { cursor:pointer; }ul { padding-left:18px; }.summary { white-space:pre-wrap; }textarea { resize:vertical; }
@media(max-width:1000px) { .terrainPanel { right:190px; width:330px; } }
</style>
