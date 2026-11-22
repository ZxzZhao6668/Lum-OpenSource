<template>
  <videoRetake v-if="ffmpeg && file && controller" :key="activeKey" :node="node" :file="file" :ffmpeg="ffmpeg" :signal="controller.signal" @close="close" />
</template>

<script setup lang="ts">
import { defineAsyncComponent, inject, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useVueFlow, type GraphNode } from "@vue-flow/core";
import { useNodeFfmpeg, type BrowserFfmpegFactory, type NodeMediaValue } from "@lum/nodes-scaffold/runtime";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";
import { showNodeError } from "@lum/node-shared/showNodeError";

const props = defineProps<{ node: GraphNode; file?: NodeMediaValue; disabled?: boolean }>();
const videoRetake = defineAsyncComponent({ loader: () => import("./videoRetake.vue") });
const getPersistence = useNodePersistence();
const getCanvasActive = inject("nodeCanvasActive", () => true);
const { findNode } = useVueFlow();
const loadFfmpeg = useNodeFfmpeg();
const ffmpeg = shallowRef<BrowserFfmpegFactory>();
const loading = ref(false);
const activeKey = ref(0);
let controller: AbortController | undefined;

function close() {
  controller?.abort();
  controller = undefined;
  ffmpeg.value = undefined;
  loading.value = false;
}

watch([() => props.file, () => props.file?.url, () => props.file?.mimeType, () => getPersistence?.()?.directory,
  () => getPersistence?.()?.canvasPath, () => props.disabled, getCanvasActive], close, { flush: "sync" });
onScopeDispose(close);

async function open() {
  if (!props.file || props.disabled || controller || !getCanvasActive()) return;
  const persistence = getPersistence?.(), node = props.node, file = props.file;
  const current = controller = new AbortController();
  loading.value = true;
  try {
    if (!persistence) throw Error("画布尚未就绪");
    const factory = await loadFfmpeg(current.signal);
    current.signal.throwIfAborted();
    const active = getPersistence?.();
    if (findNode(node.id) !== node || props.file !== file || active?.directory !== persistence.directory || active.canvasPath !== persistence.canvasPath || !getCanvasActive()) throw Error("视频来源或画布已切换");
    // ACT: UMD 节点在首次打开才初始化面板；固定目录工厂进入子组件 setup 后才创建重拍状态。
    activeKey.value++;
    ffmpeg.value = factory;
  } catch (error) {
    if (!current.signal.aborted) showNodeError(error, "无法打开片段重拍");
    if (controller === current) close();
  } finally {
    if (controller === current) loading.value = false;
  }
}
defineExpose({ open, loading });
</script>
