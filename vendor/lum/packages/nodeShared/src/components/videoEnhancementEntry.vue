<template>
  <el-button v-if="file" text :disabled="disabled || !getCanvasActive()" @click.stop="open">视频超分</el-button>
  <videoEnhancementPanel v-if="opened && file" :node="node" :file="file" @close="close" />
</template>

<script setup lang="ts">
import { defineAsyncComponent, inject, ref, watch } from "vue";
import { ElButton } from "element-plus";
import type { GraphNode } from "@vue-flow/core";
import type { NodeMediaValue } from "@lum/nodes-scaffold/runtime";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";

const props = defineProps<{ node: GraphNode; file?: NodeMediaValue; disabled?: boolean }>();
const videoEnhancementPanel = defineAsyncComponent(() => import("./videoEnhancementPanel.vue"));
const getCanvasActive = inject("nodeCanvasActive", () => true);
const getPersistence = useNodePersistence();
const opened = ref(false);
function close() { opened.value = false; }
function open() { if (!props.disabled && getCanvasActive()) opened.value = true; }
watch([() => props.node, () => props.file, () => props.file?.url, () => props.file?.mimeType, () => props.disabled,
  () => getPersistence?.()?.directory, () => getPersistence?.()?.canvasPath, getCanvasActive], close, { flush: "sync" });
</script>
