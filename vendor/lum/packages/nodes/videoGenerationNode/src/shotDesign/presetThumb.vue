<template>
  <span class="presetThumb">
    <rhythmPreview v-if="'shots' in preset" :preset="preset as RhythmPreset" :playing="playing" />
    <img v-else class="presetPhoto" :src="photos[`./photos/${kind}/${preset.id}.webp`]" alt="" loading="lazy" decoding="async" draggable="false" />
    <svg v-if="'guide' in preset" class="guideLines" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path :d="(preset as CompositionPreset).guide" /></svg>
    <span v-if="kind === 'palette'" class="swatches" aria-hidden="true"><i v-for="color in swatchColors" :key="color" :style="{ background: color }" /></span>
  </span>
</template>

<script lang="ts">
const photos = import.meta.glob<string>("./photos/*/*.webp", { eager: true, query: "?inline", import: "default" });
</script>

<script setup lang="ts">
import { computed } from "vue";
import rhythmPreview from "./rhythmPreview.vue";
import type { CompositionPreset, PresetKind, RhythmPreset, ScenePreset } from "./catalog";

const props = defineProps<{ preset: ScenePreset; kind: PresetKind; playing?: boolean }>();
// 色卡由暗到亮：近景、中景、远景、天空、光源。
const swatchColors = computed(() => [4, 3, 2, 1, 5].map(index => props.preset.colors[index]!));
</script>

<style scoped lang="scss">
.presetThumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--el-fill-color-dark);

  .presetPhoto {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .guideLines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 65%));

    path {
      fill: none;
      stroke: #fff;
      stroke-width: 1.1;
      stroke-dasharray: 4 3;
      opacity: 0.9;
    }
  }

  .swatches {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    height: 13%;

    i { flex: 1; }
  }
}
</style>
