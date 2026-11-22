<template>
  <img v-if="url" class="assetThumb" :src="url" :alt="alt" draggable="false" />
  <span v-else class="assetThumb empty"><slot>{{ image ? "读取中…" : "" }}</slot></span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useNodeFiles } from "@lum/nodes-scaffold/workspaceFiles";

const props = defineProps<{ image: { path: string; mimeType: string } | null; alt?: string }>();
const { useFileUrl } = useNodeFiles();
const file = computed(() => props.image ? { url: props.image.path, mimeType: props.image.mimeType } : undefined);
const url = useFileUrl(file, () => {});
</script>

<style lang="scss" scoped>
.assetThumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;

  &.empty {
    display: grid;
    place-items: center;
    color: var(--el-text-color-placeholder);
    font-size: 12px;
  }
}
</style>
