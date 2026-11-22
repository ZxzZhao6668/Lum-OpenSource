<template>
  <section class="libraryPanel" aria-label="本地模型组块库">
    <header><strong>本地模型库</strong><button :disabled="loading" @click="load(true)">刷新</button></header>
    <p>模型保存在本机。加入片场后携带所用网格，可离线继续编辑。</p>
    <form class="searchRow" @submit.prevent="load(true)"><input v-model="query" maxlength="200" placeholder="搜索：树 / 岩石 / window" aria-label="模型关键词" /><button :disabled="loading">搜索</button></form>
    <select v-model="category" aria-label="模型类别" @change="load(true)"><option value="">全部类别</option><option v-for="item in categories" :key="item">{{ item }}</option></select>
    <p role="status">{{ loading ? '读取本地索引…' : `${total} 个模型` }}<span v-if="invalid"> · {{ invalid }} 个索引无效</span></p>
    <div v-if="error" class="libraryError" role="alert"><span>{{ error }}</span><button type="button" aria-label="关闭模型库错误" @click="error=''">关闭</button></div>
    <div class="modelList"><button v-for="item in items" :key="item.id" :disabled="disabled || !!loadingModel" class="modelCard" @click="choose(item)"><img v-if="item.hasPreview" :src="'/api/stageLibrary/preview?id='+encodeURIComponent(item.id)" :alt="item.name" loading="lazy" /><span v-else class="modelShape" aria-hidden="true">{{ item.category === '自然' ? '♧' : item.category === '建筑' ? '▥' : '◇' }}</span><strong>{{ item.name }}</strong><span>{{ item.dimensions.x.toFixed(1) }} × {{ item.dimensions.y.toFixed(1) }} × {{ item.dimensions.z.toFixed(1) }} m</span><small>{{ item.triangles.toLocaleString() }} 面 · {{ item.license }}</small><span class="modelAction">{{ loadingModel === item.id ? '加载网格…' : '＋ 加入片场' }}</span></button></div>
    <button v-if="items.length < total" :disabled="loading" @click="load(false)">加载更多</button>
    <details><summary>导入 GLB 到本地库</summary><label>名称<input v-model="name" maxlength="100" placeholder="留空使用文件名" /></label><label>分类<select v-model="importCategory"><option v-for="item in categories" :key="item">{{ item }}</option></select></label><label>检索标签<input v-model="tags" maxlength="600" placeholder="用逗号分隔：古代, 树, 梧桐, tree" /></label><label>来源<input v-model="source" maxlength="500" placeholder="作者或来源网址" /></label><label>许可<input v-model="license" maxlength="100" placeholder="例如 CC0 / 自有模型" /></label><input type="file" accept=".glb" aria-label="导入GLB到本地模型库" :disabled="disabled || importing" @change="importFile" /><p>静态 GLB ≤12 MB、≤2 万三角面。保留形状与主色；不含贴图、骨骼动画。单位米，自动居中落地。</p><p v-if="importing" role="status">正在解析并保存…</p></details>
    <details v-if="directory"><summary>模型库位置</summary><p class="directory">{{ directory }}</p><p>此目录独立于程序。备份整个目录即可迁移模型库。</p></details>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { stageMeshDimensions, type StageLibraryEntry, type StageLibraryModel } from "@lum/node-shared/stageLibrary";
import { importStageModel } from "./stageModel";
import { readStageLibrary, saveStageLibrary, searchStageLibrary } from "./stageLibrary";
const props = defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ add: [model: StageLibraryModel] }>();
const categories = ["建筑", "自然", "室内", "道具", "其他"] as const;
const query = ref(""), category = ref(""), items = ref<StageLibraryEntry[]>([]), total = ref(0), invalid = ref(0), directory = ref("");
const error = ref(""), loading = ref(false), loadingModel = ref(""), importing = ref(false);
const name = ref(""), tags = ref(""), source = ref(""), license = ref("自有模型"), importCategory = ref<StageLibraryEntry["category"]>("其他");
const lifetime = new AbortController();
let searchController: AbortController | undefined;
async function load(reset: boolean) {
  searchController?.abort(); const controller = new AbortController(); searchController = controller;
  loading.value = true; error.value = "";
  try {
    const result = await searchStageLibrary(query.value.trim(), category.value, reset ? 0 : items.value.length, controller.signal);
    if (controller.signal.aborted) return;
    items.value = reset ? result.items : [...items.value, ...result.items]; total.value = result.total; invalid.value = result.invalid; directory.value = result.directory;
  } catch (cause) { if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (searchController === controller) loading.value = false; }
}
async function choose(item: StageLibraryEntry) {
  if (props.disabled || loadingModel.value) return;
  loadingModel.value = item.id; error.value = "";
  try { const model = await readStageLibrary(item.id, lifetime.signal); if (!props.disabled && !lifetime.signal.aborted) emit("add", model); }
  catch (cause) { if (!lifetime.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { loadingModel.value = ""; }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file || props.disabled || importing.value) return;
  importing.value = true; error.value = "";
  try {
    if (!license.value.trim()) throw new Error("请填写模型许可或使用权来源");
    const metadata = { name: (name.value.trim() || file.name.replace(/\.glb$/i, "")).slice(0, 100), category: importCategory.value, tags: tags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 30), source: source.value.trim(), license: license.value.trim() };
    const meshParts = await importStageModel(file); lifetime.signal.throwIfAborted();
    await saveStageLibrary({ version: 1, id: "import", ...metadata, meshParts, dimensions: stageMeshDimensions(meshParts), triangles: meshParts.reduce((sum, part) => sum + part.indices.length / 3, 0) }, lifetime.signal);
    query.value = ""; category.value = ""; await load(true);
  } catch (cause) { if (!lifetime.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { importing.value = false; }
}
onMounted(() => load(true));
onBeforeUnmount(() => { searchController?.abort(); lifetime.abort(); });
</script>

<style scoped lang="scss">
.libraryPanel { color:inherit; font-size:12px;
  header,.searchRow { display:flex;align-items:center;gap:8px;justify-content:space-between; } header strong { font-size:16px; }
  p { color:var(--el-text-color-secondary,#b5bdcb);line-height:1.6; } input,select,button { font:inherit;color:inherit;background:var(--el-fill-color-light,#252e3b);border:1px solid var(--el-border-color,#536075);border-radius:10px;padding:8px;box-sizing:border-box;min-width:0; }
  button { cursor:pointer; } button:disabled { opacity:.5;cursor:wait; } input:focus-visible,button:focus-visible,select:focus-visible { outline:2px solid var(--el-color-primary,#8cafff);outline-offset:2px; }
  .searchRow { margin:12px 0; input { flex:1; width:0; } } >select { width:100%; }
  .modelList { display:grid;grid-template-columns:1fr 1fr;gap:8px; } .modelCard { display:flex;align-items:stretch;flex-direction:column;text-align:left;gap:6px;overflow-wrap:anywhere; strong { font-size:12px; } small,>span:not(.modelShape) { font-size:10px; } &:hover:not(:disabled) { border-color:var(--el-color-primary,#a8c1ff);background:var(--el-fill-color,#3c4a60); } }
  .modelCard img { width:100%;height:76px;object-fit:contain;border-radius:8px;background:#ccd2db; } .modelShape { display:grid;place-items:center;height:44px;font-size:30px;color:var(--el-text-color-secondary,#b5bdcb); } .modelAction { border-top:1px solid var(--el-border-color,#536075);padding-top:7px; }
  details { margin-top:16px;padding-top:12px;border-top:1px solid var(--el-border-color,#536075);summary { cursor:pointer; } label { display:block;margin:10px 0;input,select { display:block;width:100%;margin-top:4px; } } input[type=file] { width:100%; } }
  .directory { overflow-wrap:anywhere;user-select:text; }.libraryError { display:flex;gap:8px;border:1px solid var(--el-color-danger,#d5747e);border-radius:10px;padding:8px;margin:8px 0;span { flex:1;overflow-wrap:anywhere; } }
}
</style>
