<template>
  <article class="workPreview">
    <h3>{{ work.title }}</h3>
    <p class="byline">{{ work.author }} · {{ work.nodes.length }} 个节点 · {{ work.edges.length }} 条连线</p>
    <p v-if="work.description" class="description">{{ work.description }}</p>
    <svg class="graph" :viewBox="graph.bounds" role="img" aria-label="节点布局与连线">
      <g v-for="n in graph.groups" :key="n.id">
        <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="8" class="group" />
      </g>
      <line v-for="(e, i) in graph.edges" :key="i" :x1="e.from.x + e.from.w" :y1="e.from.y + e.from.h / 2" :x2="e.to.x" :y2="e.to.y + e.to.h / 2" />
      <g v-for="n in graph.cards" :key="n.id">
        <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="6" />
        <text :x="n.x + 8" :y="n.y + 17">{{ n.name.slice(0, 14) }}</text>
      </g>
    </svg>
    <div v-if="attached.length" class="mediaPreview">
      <h4>作品附件</h4>
      <div class="mediaOptions">
        <el-button v-for="n in attached" :key="n.id" size="small" :aria-pressed="activeMedia?.id === n.id"
          @click="previewMedia(n)">{{ n.label || n.id }} · {{ n.media.mimeType }} · {{ (mediaByteSize(n.media) / 1024).toFixed(0) }} KiB</el-button>
      </div>
      <div v-if="activeMedia">
        <img v-if="activeMedia.kind === 'image'" :src="activeMedia.url" :alt="activeMedia.label" />
        <video v-else-if="activeMedia.kind === 'video'" :src="activeMedia.url" controls preload="metadata" :aria-label="activeMedia.label" />
        <audio v-else :src="activeMedia.url" controls preload="metadata" :aria-label="activeMedia.label" />
        <el-button size="small" @click="clearMedia">收起附件</el-button>
      </div>
    </div>
    <details>
      <summary>查看节点内容</summary>
      <div v-for="n in work.nodes" :key="n.id" class="nodeDetail">
        <strong>{{ n.label || n.type }}</strong>
        <small>{{ n.type }}</small>
        <pre v-if="n.text || n.prompt">{{ n.text || n.prompt }}</pre>
      </div>
    </details>
  </article>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, watch } from "vue";
import { galleryMediaBlob, mediaByteSize, type GalleryMedia } from "./galleryMedia";
import type { GalleryCanvas } from "./galleryCanvas";

const props = defineProps<{ work: GalleryCanvas }>();
type AttachedNode = GalleryCanvas["nodes"][number] & { media: GalleryMedia };
const attached = computed(() => props.work.nodes.filter((node): node is AttachedNode => !!node.media));
const activeMedia = shallowRef<{ id: string; kind: string; url: string; label: string }>();
function clearMedia() {
  if (activeMedia.value) URL.revokeObjectURL(activeMedia.value.url);
  activeMedia.value = undefined;
}
function previewMedia(node: AttachedNode) {
  clearMedia();
  activeMedia.value = { id: node.id, label: node.label || node.id, kind: node.media.mimeType.split("/")[0]!,
    url: URL.createObjectURL(galleryMediaBlob(node.media)) };
}
watch(() => props.work, clearMedia, { flush: "sync" });
onScopeDispose(clearMedia);
const graph = computed(() => {
  const nodes = props.work.nodes;
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const shapes = nodes.map(n => {
    let { x, y } = n;
    let parent = n.parent;
    while (parent) {
      const group = lookup.get(parent)!;
      x += group.x; y += group.y; parent = group.parent;
    }
    return { id: n.id, name: n.label || n.type, group: n.type === "canvasGroup", x, y, w: n.width || 190, h: n.height || 52 };
  });
  const byId = new Map(shapes.map(n => [n.id, n]));
  const xmin = Math.min(...shapes.map(n => n.x)) - 20, ymin = Math.min(...shapes.map(n => n.y)) - 20;
  const width = Math.max(...shapes.map(n => n.x + n.w)) - xmin + 20, height = Math.max(...shapes.map(n => n.y + n.h)) - ymin + 20;
  return { bounds: [xmin, ymin, width, height].join(" "), groups: shapes.filter(n => n.group), cards: shapes.filter(n => !n.group),
    edges: props.work.edges.map(e => ({ from: byId.get(e.source)!, to: byId.get(e.target)! })) };
});
</script>

<style scoped lang="scss">
.workPreview {
  min-width: 0;
  h3 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
  .byline { margin: 5px 0 12px; color: var(--el-text-color-secondary); }
  .description, pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  .graph {
    display: block; width: 100%; height: 190px; background: var(--el-fill-color-light); border-radius: var(--el-border-radius-base);
    rect { fill: var(--el-bg-color); stroke: var(--el-color-primary); stroke-width: 1.5px; }
    .group { fill: var(--el-color-primary-light-9); stroke: var(--el-border-color); }
    line { stroke: var(--el-color-primary); stroke-width: 2px; }
    text { fill: var(--el-text-color-primary); font: 13px sans-serif; }
  }
  .mediaPreview { margin: 12px 0; }
  .mediaOptions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .mediaOptions :deep(.el-button) { margin: 0; max-width: 100%; white-space: normal; height: auto; }
  img, video, audio { display: block; max-width: 100%; max-height: 320px; margin-bottom: 8px; }
  details { margin-top: 12px; }
  summary { cursor: pointer; }
  .nodeDetail { padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
  small { margin-inline-start: 8px; color: var(--el-text-color-secondary); }
  pre { margin: 5px 0; max-height: 230px; overflow: auto; }
}
</style>
