<template>
  <div class="previewPane" @keydown.stop>
    <div class="previewGrid" :class="{ paired: !!candidateSrc }">
      <figure>
        <figcaption>原片</figcaption>
        <video v-if="sourceSrc" :key="sourceSrc" ref="original" :src="sourceSrc" preload="metadata" playsinline :muted="!!candidateSrc && audioSide !== 'original'" aria-label="原片预览" @loadedmetadata="sync" @timeupdate="readTime" @waiting="hold" @ended="pause" @error="mediaError = '当前浏览器无法解码原片'" />
      </figure>
      <figure v-if="candidateSrc">
        <figcaption>候选 · 仅比较替换范围</figcaption>
        <video :key="candidateSrc" ref="alternative" :src="candidateSrc" preload="metadata" playsinline :muted="audioSide !== 'candidate'" aria-label="候选片段预览" @loadedmetadata="sync" @waiting="hold" @ended="pause" @error="mediaError = '当前浏览器无法解码候选'" />
      </figure>
    </div>
    <p v-if="!sourceSrc" role="status">正在读取原片预览</p>
    <p v-if="mediaError" class="mediaError" role="alert">{{ mediaError }}</p>
    <div v-if="sourceSrc" class="previewControls">
      <el-button size="small" :disabled="!ready" @click="playing ? pause() : play()">{{ playing ? '暂停' : candidateSrc ? '同步播放' : '播放原片' }}</el-button>
      <input type="range" aria-label="预览播放位置（秒）" :min="0" :max="duration" :step="0.001" :value="offset" :disabled="!ready" @input="jump(Number(($event.target as HTMLInputElement).value))" />
      <span>{{ offset.toFixed(3) }} / {{ duration.toFixed(3) }} 秒</span>
      <label v-if="candidateSrc">试听
        <select v-model="audioSide" aria-label="试听音轨">
          <option value="original">原声</option>
          <option value="candidate">候选声</option>
          <option value="muted">静音</option>
        </select>
      </label>
    </div>
    <div v-if="sourceSrc && !playbackRange" class="thumbnailRail" aria-label="原片时间轴">
      <button v-for="frame in frames" :key="frame.time" type="button" :title="`${frame.time.toFixed(3)} 秒`" :aria-label="`预览原片 ${frame.time.toFixed(3)} 秒`" @click="jump(frame.time)">
        <img :src="frame.url" alt="" />
        <span>{{ frame.time.toFixed(2) }}</span>
      </button>
      <span v-if="selection" class="selectedRange" :style="{ left: (selection.start / duration * 100) + '%', width: ((selection.end - selection.start) / duration * 100) + '%' }" aria-hidden="true" />
    </div>
    <p v-if="sampling" class="quiet" role="status">正在从原片取样缩略图…</p>
    <p v-else-if="thumbnailError" class="quiet" role="status">{{ thumbnailError }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElButton } from "element-plus";
import type { VideoRetakeTimes } from "../videoRetake";

const props = defineProps<{
  sourceSrc: string;
  sourceDuration: number;
  selection?: VideoRetakeTimes;
  candidateSrc?: string;
  candidateStart?: number;
  playbackRange?: VideoRetakeTimes;
}>();
const original = ref<HTMLVideoElement>();
const alternative = ref<HTMLVideoElement>();
const offset = ref(0);
const playing = ref(false);
const sourceReady = ref(false);
const candidateReady = ref(false);
const mediaError = ref("");
const audioSide = ref("original");
const frames = ref<{ time: number; url: string }[]>([]);
const sampling = ref(false);
const thumbnailError = ref("");
const duration = computed(() => Math.max(0, props.playbackRange ? props.playbackRange.end - props.playbackRange.start : props.sourceDuration));
const ready = computed(() => sourceReady.value && (!props.candidateSrc || candidateReady.value) && duration.value > 0 && !mediaError.value);
let playRevision = 0;

function pause() {
  playRevision++;
  playing.value = false;
  original.value?.pause();
  alternative.value?.pause();
}

function seek(element: HTMLVideoElement | undefined, time: number) {
  if (!element || element.readyState < 1 || !Number.isFinite(element.duration)) return;
  const target = Math.max(0, Math.min(element.duration, time));
  if (Math.abs(element.currentTime - target) > 0.000001) element.currentTime = target;
}

function sync() {
  sourceReady.value = !!original.value?.videoWidth;
  candidateReady.value = !!alternative.value?.videoWidth;
  seek(original.value, (props.playbackRange?.start ?? 0) + offset.value);
  seek(alternative.value, (props.candidateStart ?? 0) + offset.value);
}

function jump(value: number) {
  pause();
  offset.value = Math.max(0, Math.min(duration.value, value));
  sync();
}

function hold() {
  if (playing.value) pause();
}

async function play() {
  const source = original.value;
  if (!source || !ready.value) return;
  if (offset.value >= duration.value - 0.001) jump(0);
  const revision = ++playRevision;
  const candidate = alternative.value;
  sync();
  try {
    await Promise.all([source.play(), candidate?.play()]);
    if (playRevision !== revision || source.paused || candidate?.paused) return;
    playing.value = true;
  } catch {
    if (playRevision !== revision) return;
    pause();
    mediaError.value = "预览无法开始播放";
  }
}

function readTime() {
  if (!playing.value || !original.value) return;
  const elapsed = original.value.currentTime - (props.playbackRange?.start ?? 0);
  if (elapsed >= duration.value) return jump(duration.value);
  offset.value = Math.max(0, elapsed);
  const candidate = alternative.value;
  const target = (props.candidateStart ?? 0) + offset.value;
  if (candidate && !candidate.seeking && Math.abs(candidate.currentTime - target) > 0.12) seek(candidate, target);
}

function release(element?: HTMLVideoElement) {
  if (!element) return;
  element.pause();
  element.removeAttribute("src");
  element.load();
}

watch(() => [props.sourceSrc, props.candidateSrc, props.playbackRange?.start, props.playbackRange?.end, props.candidateStart], () => {
  mediaError.value = "";
  audioSide.value = "original";
  jump(0);
});
watch(original, (_video, old) => { if (old) release(old); sourceReady.value = !!original.value?.videoWidth; }, { flush: "sync" });
watch(alternative, (_video, old) => { if (old) release(old); candidateReady.value = !!alternative.value?.videoWidth; }, { flush: "sync" });

watch(() => [props.sourceSrc, props.sourceDuration, !!props.playbackRange] as const, ([src, length, localRange], _old, onCleanup) => {
  frames.value = [];
  sampling.value = false;
  thumbnailError.value = "";
  if (!src || !length || localRange) return;
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  canvas.width = 120; canvas.height = 72;
  const context = canvas.getContext("2d");
  if (!context) { thumbnailError.value = "浏览器不支持时间轴取样"; return; }
  const count = 10;
  let timer = 0;
  let stopped = false;
  let time = 0;
  const stop = (error?: string) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    video.onloadeddata = video.onseeked = video.onerror = null;
    release(video);
    sampling.value = false;
    if (error) thumbnailError.value = error;
  };
  onCleanup(() => { stop(); frames.value = []; });
  function nextFrame() {
    clearTimeout(timer);
    timer = window.setTimeout(() => stop("部分缩略图读取超时，仍可输入秒数选择范围"), 12000);
    time = Math.min(length * (frames.value.length + 0.5) / count, Math.max(0, video.duration - 0.001));
    if (Math.abs(video.currentTime - time) < 0.000001) capture();
    else video.currentTime = time;
  }
  function capture() {
    try {
      if (!context || !video.videoWidth || !video.videoHeight) throw Error();
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      context.fillStyle = "#151515"; context.fillRect(0, 0, canvas.width, canvas.height);
      const width = video.videoWidth * scale, height = video.videoHeight * scale;
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      frames.value.push({ time, url: canvas.toDataURL("image/jpeg", 0.75) });
      if (frames.value.length >= count) stop(); else nextFrame();
    } catch { stop("浏览器无法为原片生成缩略图"); }
  }
  sampling.value = true;
  video.muted = true;
  video.preload = "auto";
  video.onloadeddata = nextFrame;
  video.onseeked = capture;
  video.onerror = () => stop("浏览器无法为原片生成缩略图");
  timer = window.setTimeout(() => stop("原片缩略图读取超时"), 12000);
  video.src = src;
}, { immediate: true });

onBeforeUnmount(() => {
  pause();
  release(original.value);
  release(alternative.value);
});
defineExpose({ jump, pause });
</script>

<style scoped>
.previewPane { display: grid; gap: 8px; min-width: 0; }
.previewPane p, figure { margin: 0; }
.previewGrid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.previewGrid.paired { grid-template-columns: repeat(2, minmax(0, 1fr)); }
figcaption { font-size: 12px; margin-bottom: 4px; }
video { display: block; width: 100%; height: clamp(112px, 28vh, 270px); background: #14171b; border-radius: 6px; object-fit: contain; }
.paired video { height: clamp(100px, 23vh, 220px); }
.previewControls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
.previewControls input { flex: 1 0 100px; min-width: 0; }
.previewControls select { color: var(--el-text-color-primary); background: var(--el-bg-color); }
.thumbnailRail { position: relative; display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 2px; overflow: clip; min-height: 38px; background: var(--el-fill-color); border-radius: 6px; }
.thumbnailRail button { position: relative; display: block; min-width: 0; padding: 0; border: 0; color: #fff; background: #161616; cursor: pointer; }
.thumbnailRail button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; z-index: 2; }
.thumbnailRail img { display: block; width: 100%; height: clamp(36px, 7vh, 66px); object-fit: cover; }
.thumbnailRail button span { position: absolute; inset: auto 0 0; background: #000a; font-size: 10px; text-align: center; }
.selectedRange { position: absolute; inset-block: 0; border: 2px solid var(--el-color-primary); box-shadow: 0 0 0 1000px #0004; box-sizing: border-box; pointer-events: none; }
.quiet { color: var(--el-text-color-secondary); font-size: 12px; }
.mediaError { color: var(--el-color-danger); }
@media (max-width: 460px) { .thumbnailRail button span { display: none; } }
</style>
