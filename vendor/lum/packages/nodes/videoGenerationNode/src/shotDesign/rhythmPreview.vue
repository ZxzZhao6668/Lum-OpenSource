<template>
  <span class="rhythmPreview">
    <span class="rhythmStage" :style="{ transform: frame.transform }">
      <scenePreview :scene="frame.scene" :colors="preset.colors" :time="frame.time" :flip="frame.flip" :trail="preset.trail && playing" />
    </span>
    <span class="rhythmTrack" aria-hidden="true">
      <span v-for="(shot, index) in preset.shots" :key="index" class="trackShot" :style="{ flexGrow: shot.span }">
        <i :style="{ width: `${Math.min(1, Math.max(0, (progress - starts[index]!.start) / shot.span)) * 100}%` }" />
      </span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import scenePreview from "./scenePreview.vue";
import type { RhythmPreset } from "./catalog";

const props = defineProps<{ preset: RhythmPreset; playing?: boolean }>();
// 一轮预览的秒数。
const loopSeconds = 6;
const progress = ref(0);
// 每个镜头的起点，以及到该镜头为止主体已经走过的进度（受变速影响）。
const starts = computed(() => {
  let start = 0, motion = 0;
  return props.preset.shots.map(shot => {
    const item = { start, motion };
    start += shot.span;
    motion += shot.span * (shot.rate ?? 1);
    return item;
  });
});
const frame = computed(() => {
  const { shots, frameRate } = props.preset;
  const shown = frameRate ? Math.floor(progress.value * loopSeconds * frameRate) / (loopSeconds * frameRate) : progress.value;
  const index = Math.max(0, starts.value.findLastIndex(item => item.start <= shown));
  const shot = shots[index]!, { start, motion } = starts.value[index]!;
  const local = Math.min(1, (shown - start) / shot.span);
  const [scale, x, y] = shot.from.map((value, axis) => value + ((shot.to ?? shot.from)[axis]! - value) * local);
  const total = shots.reduce((sum, item) => sum + item.span * (item.rate ?? 1), 0) || 1;
  // 放大后不能露出画面以外的空白。
  const limit = (1 - 1 / scale!) / 2;
  const shift = (value: number) => Math.min(limit, Math.max(-limit, value)) * 100;
  return {
    scene: shot.scene ?? props.preset.scene,
    flip: shot.flip,
    time: (motion + (shown - start) * (shot.rate ?? 1)) / total,
    transform: `scale(${scale}) translate(${shift((160 - x!) / 320)}%, ${shift((90 - y!) / 180)}%)`,
  };
});
let frameId = 0;
let last = 0;

function tick(now: number) {
  progress.value = (progress.value + Math.min(now - last, 100) / 1000 / loopSeconds) % 1;
  last = now;
  frameId = requestAnimationFrame(tick);
}

watch(() => props.playing, playing => {
  cancelAnimationFrame(frameId);
  progress.value = 0;
  if (!playing || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  last = performance.now();
  frameId = requestAnimationFrame(tick);
}, { immediate: true });
onBeforeUnmount(() => cancelAnimationFrame(frameId));
</script>

<style scoped lang="scss">
.rhythmPreview {
  position: absolute;
  inset: 0;
  overflow: hidden;

  .rhythmStage {
    position: absolute;
    inset: 0;
    transform-origin: center;
  }

  .rhythmTrack {
    position: absolute;
    right: 10%;
    bottom: 9px;
    left: 10%;
    display: flex;
    gap: 3px;
    height: 3px;

    .trackShot {
      flex: 0 0 0;
      overflow: hidden;
      border-radius: 2px;
      background: rgb(255 255 255 / 34%);

      i {
        display: block;
        height: 100%;
        background: var(--el-color-primary);
      }
    }
  }
}
</style>
