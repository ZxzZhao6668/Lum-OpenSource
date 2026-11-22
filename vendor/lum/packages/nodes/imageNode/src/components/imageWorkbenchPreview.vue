<template>
  <figure class="workbenchPreview">
    <figcaption>{{ label }}</figcaption>
    <div v-if="media && !error" class="previewStage">
      <div v-if="url" class="previewFrame">
        <img :key="url" :src="url" :alt="label" draggable="false" @load="updateReady($event, true)" @error="updateReady($event, false)" />
        <span
          v-for="(region, index) in ready ? regions : []"
          :key="index"
          class="previewRegion"
          aria-hidden="true"
          :style="{ left: region.x * 100 + '%', top: region.y * 100 + '%', width: region.width * 100 + '%', height: region.height * 100 + '%' }" />
      </div>
      <p v-else role="status">正在读取图片…</p>
    </div>
    <p v-else-if="error" class="previewError" role="alert">{{ error }}</p>
    <p v-else class="previewEmpty">{{ empty }}</p>
  </figure>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { WorkspaceFiles } from "@lum/nodes-scaffold/workspaceFiles";
import { createWorkbenchPreview, type ImageNormalizedRect } from "../imageComposition";

const props = defineProps<{
  label: string;
  empty?: string;
  media?: { path: string; mimeType: string };
  workspace?: WorkspaceFiles;
  regions?: readonly ImageNormalizedRect[];
}>();
const emit = defineEmits<{ ready: [ready: boolean] }>();
const ready = ref(false);
const error = ref("");
const url = ref("");
watch(ready, value => emit("ready", value), { immediate: true, flush: "sync" });
watch([() => props.media?.path, () => props.media?.mimeType, () => props.workspace], async ([path, mimeType, workspace], _, onCleanup) => {
  let cancelled = false;
  onCleanup(() => {
    cancelled = true;
    if (url.value) URL.revokeObjectURL(url.value);
  });
  ready.value = false;
  error.value = "";
  url.value = "";
  if (!props.media) return;
  if (!path || !mimeType || !workspace) {
    error.value = "无法读取此图片：缺少工作区或图片来源";
    return;
  }
  const isCurrent = () => !cancelled && workspace === props.workspace && path === props.media?.path && mimeType === props.media?.mimeType;
  const check = () => {
    if (!isCurrent()) throw new DOMException("图片预览已切换", "AbortError");
  };
  try {
    const preview = await createWorkbenchPreview(() => workspace.read(path), check);
    check();
    url.value = URL.createObjectURL(preview);
  } catch (failure) {
    if (isCurrent()) error.value = path + " 预览失败：" + (failure instanceof Error ? failure.message : String(failure));
  }
}, { immediate: true });

function updateReady(event: Event, loaded: boolean) {
  if ((event.currentTarget as HTMLImageElement).getAttribute("src") !== url.value) return;
  ready.value = loaded;
  if (!loaded) {
    URL.revokeObjectURL(url.value);
    url.value = "";
    error.value = props.media?.path + " 预览失败：无法解码预览图片";
  }
}
</script>

<style scoped lang="scss">
.workbenchPreview {
  margin: 0;
  min-width: 0;
  figcaption { margin-bottom: 6px; font-weight: 600; }
  .previewStage, .previewEmpty, .previewError {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-light);
    overflow-wrap: anywhere;
    min-height: 72px;
  }
  .previewStage {
    display: grid;
    place-items: center;
  }
  .previewFrame {
    position: relative;
    max-width: 100%;
    overflow: hidden;
    img { display: block; max-width: 100%; max-height: 240px; }
    .previewRegion {
      position: absolute;
      pointer-events: none;
      border: 1px solid white;
      box-shadow: inset 0 0 0 1px #172427;
      box-sizing: border-box;
    }
  }
  .previewEmpty, .previewError { box-sizing: border-box; margin: 0; padding: 12px; }
  .previewEmpty { color: var(--el-text-color-secondary); }
  .previewError { color: var(--el-color-danger); }
}
</style>
