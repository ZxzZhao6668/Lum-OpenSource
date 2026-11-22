<template>
  <details class="storySources" @toggle="open = ($event.currentTarget as HTMLDetailsElement).open">
    <summary>剧情素材与分镜 <span>{{ selectedAssets.length }} 张素材 · {{ selectedShots.length }} 条分镜</span></summary>
    <div v-if="open" class="sourceBody">
      <p>AI 可将一条分镜拆成多格。所选分镜按原顺序全部覆盖。图片最多 {{ storyGridImageLimit }} 张（含当前原图）。</p>
      <div class="sourceTabs" aria-label="剧情素材来源">
        <el-button v-for="item in views" :key="item.id" :type="scope === item.id ? 'primary' : 'default'"
          :aria-pressed="scope === item.id" :disabled="item.id !== 'canvas' && !host" @click="scope = item.id">{{ item.label }}</el-button>
      </div>
      <div class="sourceFilters">
        <el-input v-model="search" maxlength="120" clearable aria-label="搜索剧情素材或分镜" placeholder="搜索名称或镜头文字" />
        <el-select v-if="scope === 'shots'" v-model="scene" clearable filterable placeholder="所有场次" aria-label="筛选场次">
          <el-option v-for="item in scenes" :key="item.id" :value="item.id" :label="item.label" />
        </el-select>
        <el-select v-else-if="scope !== 'canvas'" v-model="category" clearable placeholder="所有类别" aria-label="筛选素材类别">
          <el-option value="location" label="场景" /><el-option value="character" label="人物" /><el-option value="prop" label="道具" />
        </el-select>
      </div>
      <p v-if="loading" role="status">正在读取剧情素材…</p>
      <p v-else-if="failure" class="sourceError" role="alert">{{ failure }}</p>
      <template v-else>
        <ul v-if="scope === 'shots' ? shotRows.length : assetRows.length" class="sourceList">
          <template v-if="scope === 'shots'">
            <li v-for="item in shotRows" :key="item.id">
              <button type="button" :disabled="disabled || (!shotSelected(item) && selectedShots.length >= 100)"
                :aria-pressed="shotSelected(item)" @click="chooseShot(item)">
                <strong>{{ item.label }} · {{ item.scene }}</strong><span>{{ item.summary || "此镜头没有画面描述" }}</span>
              </button>
            </li>
          </template>
          <template v-else>
            <li v-for="item in assetRows" :key="item.id">
              <button type="button" :disabled="disabled || (!assetSelected(item) && selectedAssets.length >= storyGridImageLimit - 1)"
                :aria-pressed="assetSelected(item)" @click="chooseAsset(item)">
                <strong>{{ item.label }}</strong><span>{{ storyGridCategories[item.category] }}</span>
              </button>
            </li>
          </template>
        </ul>
        <p v-else>当前筛选下没有可用{{ scope === "shots" ? "分镜" : "图片" }}。</p>
      </template>
      <div class="sourcePages">
        <el-button :disabled="loading || page === 0" @click="page--">上一页</el-button>
        <span>第 {{ page + 1 }} 页</span>
        <el-button :disabled="loading || !more" @click="page++">下一页</el-button>
        <el-button text :disabled="loading" @click="reload++">刷新列表</el-button>
      </div>
      <p v-if="selectedShots.length > cellCount" class="sourceError" role="alert">所选分镜多于格数，请增加格数或减少所选分镜。</p>
      <div v-if="selectedShots.length || selectedAssets.length" class="selectedSources">
        <h4>已选内容</h4>
        <ul>
          <li v-for="item in selectedShots" :key="item.id">
            <span>{{ item.label }} · {{ item.scene }}</span>
            <el-button text :disabled="disabled" @click="chooseShot(item)">移除</el-button>
          </li>
          <li v-for="item in selectedAssets" :key="item.id">
            <span>{{ storyGridCategories[item.category] }} · {{ item.label }}</span>
            <el-select v-if="item.scope === 'canvas'" class="canvasCategory" :modelValue="item.category" :disabled="disabled"
              :aria-label="'设置画布图片类别 · ' + item.label" @update:modelValue="value => changeCanvasCategory(item.id, value)">
              <el-option v-for="(label, kind) in storyGridCategories" :key="kind" :value="kind" :label="label" />
            </el-select>
            <el-button v-if="item.scope === 'canvas' || previews.has(item.id)" text :disabled="!previewFor(item.id)" @click="previewId = previewId === item.id ? '' : item.id">{{ previewId === item.id ? "隐藏预览" : "预览" }}</el-button>
            <el-button text :disabled="disabled" @click="chooseAsset(item)">移除</el-button>
          </li>
        </ul>
        <imageWorkbenchPreview v-if="previewId && previewFor(previewId)" :label="previewFor(previewId)!.name" :media="previewFor(previewId)" :workspace="workspace" />
        <el-button v-if="selectedAssets.length" :disabled="disabled" @click="emit('prepare')">准备所选图片</el-button>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ElButton, ElInput, ElOption, ElSelect } from "element-plus";
import {
  requestStoryGridSources, storyGridHost, storyGridImageLimit, storyGridPageSize,
  type StoryGridAsset, type StoryGridCatalog, type StoryGridCategory, type StoryGridContext, type StoryGridSelection, type StoryGridShot,
} from "@lum/node-shared/storyGridSources";
import type { WorkspaceFiles } from "@lum/nodes-scaffold/workspaceFiles";
import type { ImageWorkbenchNamedReference } from "../imageWorkbenchChildren";
import { storyGridCategories } from "../useStoryGridSources";
import imageWorkbenchPreview from "./imageWorkbenchPreview.vue";

const props = defineProps<{
  context?: StoryGridContext;
  workspace?: WorkspaceFiles;
  selection?: StoryGridSelection;
  references: ImageWorkbenchNamedReference[];
  sourceReferenceId?: string;
  previews: ReadonlyMap<string, ImageWorkbenchNamedReference>;
  disabled: boolean;
  cellCount: number;
}>();
const emit = defineEmits<{ select: [assets: StoryGridAsset[], shots: StoryGridShot[]]; prepare: [] }>();
const host = storyGridHost();
const views = [{ id: "project", label: "项目资产" }, { id: "shared", label: "共用资产库" }, { id: "canvas", label: "画布图片" }, { id: "shots", label: "项目分镜" }] as const;
const scope = ref<(typeof views)[number]["id"]>(host ? "project" : "canvas");
const open = ref(false);
const search = ref("");
const category = ref<StoryGridCategory>();
const scene = ref("");
const page = ref(0);
const reload = ref(0);
const loading = ref(false);
const failure = ref("");
const previewId = ref("");
const catalog = shallowRef<StoryGridCatalog>();
const scenes = computed(() => catalog.value?.scenes ?? []);
const selectedAssets = computed(() => props.selection?.assets ?? []);
const selectedShots = computed(() => props.selection?.shots ?? []);
const offset = computed(() => page.value * storyGridPageSize);
const canvasRows = computed(() => props.references.filter(item => item.id !== props.sourceReferenceId
  && (item.name + " " + item.path).toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const assetRows = computed<StoryGridAsset[]>(() => scope.value === "canvas"
  ? canvasRows.value.slice(offset.value, offset.value + storyGridPageSize).map(item => ({
    id: item.id, version: "", label: item.name.slice(0, 512), category: "image", scope: "canvas",
  }))
  : catalog.value?.assets ?? []);
const shotRows = computed(() => catalog.value?.shots ?? []);
const more = computed(() => scope.value === "canvas" ? canvasRows.value.length > offset.value + storyGridPageSize : !!catalog.value?.more);
let request: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

watch([scope, category, scene, search], () => { page.value = 0; }, { flush: "sync" });
watch([open, scope, category, scene, search, page, reload, () => props.context?.directory, () => props.context?.canvasPath], () => {
  request?.abort();
  clearTimeout(timer);
  failure.value = "";
  loading.value = !!(open.value && host && props.context && scope.value !== "canvas");
  if (!loading.value) return;
  const controller = request = new AbortController();
  const current = scope.value;
  if (current === "canvas") return;
  timer = setTimeout(async () => {
    try {
      catalog.value = await requestStoryGridSources<StoryGridCatalog>("catalog", props.context!, {
        query: { scope: current, search: search.value, offset: offset.value, scene: current === "shots" ? scene.value : undefined,
          category: current !== "shots" ? category.value : undefined },
      }, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) failure.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  }, 150);
});
onScopeDispose(() => { clearTimeout(timer); request?.abort(); });

function previewFor(id: string) {
  return props.previews.get(id) ?? props.references.find(item => item.id === id && selectedAssets.value.some(asset => asset.id === id && asset.scope === "canvas"));
}
function assetSelected(item: StoryGridAsset) {
  return selectedAssets.value.some(asset => asset.id === item.id);
}
function shotSelected(item: StoryGridShot) {
  return selectedShots.value.some(shot => shot.id === item.id);
}
function chooseAsset(item: StoryGridAsset) {
  const current = selectedAssets.value.find(asset => asset.id === item.id);
  const next = selectedAssets.value.filter(asset => asset.id !== item.id);
  if (!current || (item.scope !== "canvas" && current.version !== item.version)) next.push(item);
  emit("select", next, selectedShots.value);
}
function chooseShot(item: StoryGridShot) {
  const current = selectedShots.value.find(shot => shot.id === item.id);
  const next = selectedShots.value.filter(shot => shot.id !== item.id);
  if (!current || current.version !== item.version) next.push(item);
  emit("select", selectedAssets.value, next);
}
function changeCanvasCategory(id: string, category: StoryGridCategory) {
  emit("select", selectedAssets.value.map(asset => asset.id === id ? { ...asset, category } : asset), selectedShots.value);
}
</script>

<style scoped lang="scss">
.storySources {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  min-width: 0;
  summary {
    cursor: pointer;
    padding: 12px;
    font-weight: 600;
    span { color: var(--el-text-color-secondary); font-weight: 400; margin-inline-start: 8px; }
  }
  .sourceBody { display: grid; gap: 10px; padding: 0 12px 12px; }
  p { margin: 0; color: var(--el-text-color-secondary); }
  .sourceTabs, .sourcePages { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .sourceTabs :deep(.el-button), .sourcePages :deep(.el-button) { margin-left: 0; }
  .sourceFilters { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 1fr); gap: 8px; }
  .sourceList {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 5px;
    max-height: 230px;
    overflow: auto;
    padding: 3px;
    margin: 0;
    list-style: none;
    button {
      display: grid;
      gap: 3px;
      width: 100%;
      height: 100%;
      padding: 7px 9px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: 5px;
      color: var(--el-text-color-primary);
      background: var(--el-bg-color);
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
      span { color: var(--el-text-color-secondary); font-size: 12px; }
      &[aria-pressed="true"] { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
      &:disabled { cursor: default; opacity: .7; }
    }
  }
  .sourceError { color: var(--el-color-danger); }
  .selectedSources {
    display: grid;
    justify-items: start;
    gap: 5px;
    h4 { margin: 5px 0 0; }
    ul { list-style: none; margin: 0; padding: 0; width: 100%; max-height: 170px; overflow: auto; }
    .canvasCategory { width: 104px; }
    li {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      span { margin-inline-end: auto; overflow-wrap: anywhere; }
    }
  }
}
</style>
