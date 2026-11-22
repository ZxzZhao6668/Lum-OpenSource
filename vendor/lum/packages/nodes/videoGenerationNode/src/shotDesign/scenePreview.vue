<template>
  <svg class="scenePreview" :class="{ flip }" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient :id="`${uid}sky`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="colors[0]" /><stop offset="1" :stop-color="colors[1]" /></linearGradient>
      <linearGradient :id="`${uid}water`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="colors[2]" /><stop offset="1" :stop-color="colors[3]" /></linearGradient>
      <linearGradient :id="`${uid}haze`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="colors[1]" stop-opacity="0" /><stop offset="1" :stop-color="colors[1]" stop-opacity=".55" /></linearGradient>
      <radialGradient :id="`${uid}glow`"><stop offset="0" :stop-color="colors[5]" stop-opacity=".75" /><stop offset="1" :stop-color="colors[5]" stop-opacity="0" /></radialGradient>
    </defs>
    <rect width="320" height="180" :fill="`url(#${uid}sky)`" />
    <g :style="layerStyle(0)">
      <template v-if="scene === 'peaks'">
        <circle cx="236" cy="58" r="48" :fill="`url(#${uid}glow)`" /><circle cx="236" cy="58" r="16" :fill="colors[5]" />
        <path d="M0 122L38 88L66 106L112 60L150 104L196 74L240 112L282 86L320 106V180H0Z" :fill="colors[2]" />
        <rect y="92" width="320" height="52" :fill="`url(#${uid}haze)`" />
      </template>
      <template v-else-if="scene === 'city'">
        <circle cx="64" cy="42" r="38" :fill="`url(#${uid}glow)`" /><circle cx="64" cy="42" r="12" :fill="colors[5]" />
        <path d="M0 92h26V76h22v22h8V64h18v24h28V70h24v26h26V58h20v26h30V72h24v22h32V180H0Z" :fill="colors[2]" />
        <rect y="112" width="320" height="50" :fill="`url(#${uid}haze)`" />
      </template>
      <template v-else-if="scene === 'room'">
        <rect x="196" y="22" width="92" height="92" rx="2" :fill="colors[5]" opacity=".92" />
        <path d="M242 22V114M196 68H288" :stroke="colors[3]" stroke-width="3" fill="none" />
        <rect x="196" y="22" width="92" height="92" rx="2" fill="none" :stroke="colors[3]" stroke-width="4" />
      </template>
      <template v-else-if="scene === 'dunes'">
        <circle cx="228" cy="72" r="74" :fill="`url(#${uid}glow)`" /><circle cx="228" cy="72" r="32" :fill="colors[5]" opacity=".95" />
        <path d="M0 120Q70 92 150 114T320 100V180H0Z" :fill="colors[2]" />
      </template>
      <template v-else-if="scene === 'forest'">
        <path d="M150 0H192L252 180H128Z" :fill="colors[5]" opacity=".09" />
        <path d="M24 0h6V180h-6ZM58 0h5V180h-5ZM98 0h6V180h-6ZM136 0h4V180h-4ZM214 0h5V180h-5ZM252 0h6V180h-6ZM286 0h5V180h-5Z" :fill="colors[2]" />
        <rect y="96" width="320" height="64" :fill="`url(#${uid}haze)`" />
      </template>
      <template v-else-if="scene === 'sea'">
        <circle cx="204" cy="70" r="46" :fill="`url(#${uid}glow)`" /><circle cx="204" cy="70" r="14" :fill="colors[5]" />
        <path d="M222 104Q246 82 274 94Q296 100 320 94V104Z" :fill="colors[3]" opacity=".85" />
      </template>
      <template v-else>
        <rect x="130" y="62" width="60" height="56" :fill="colors[1]" />
        <rect x="148" y="74" width="24" height="44" :fill="colors[5]" opacity=".92" />
      </template>
    </g>
    <g :style="layerStyle(1)">
      <template v-if="scene === 'peaks'">
        <path d="M0 152L52 120L96 142L150 112L198 138L246 124L320 150V180H0Z" :fill="colors[3]" />
      </template>
      <template v-else-if="scene === 'city'">
        <path d="M10 112h40v68H10ZM58 96h34v84H58ZM98 120h44v60H98ZM150 100h36v80h-36ZM192 116h40v64h-40ZM240 90h38v90h-38ZM284 110h36v70h-36Z" :fill="colors[3]" />
        <path d="M66 104h3v4h-3ZM74 104h3v4h-3ZM66 114h3v4h-3ZM82 124h3v4h-3ZM158 108h3v4h-3ZM166 118h3v4h-3ZM174 108h3v4h-3ZM248 98h3v4h-3ZM256 108h3v4h-3ZM264 98h3v4h-3ZM248 120h3v4h-3ZM20 122h3v4h-3ZM36 132h3v4h-3ZM108 130h3v4h-3ZM124 140h3v4h-3ZM200 126h3v4h-3ZM216 136h3v4h-3ZM292 120h3v4h-3ZM306 130h3v4h-3Z" :fill="colors[5]" opacity=".85" />
        <rect y="160" width="320" height="20" :fill="colors[4]" />
        <ellipse cx="259" cy="167" rx="20" ry="2.6" :fill="colors[5]" opacity=".28" />
      </template>
      <template v-else-if="scene === 'room'">
        <path d="M196 22H288L206 180H52Z" :fill="colors[5]" opacity=".14" />
        <rect x="36" y="38" width="56" height="40" :fill="colors[2]" :stroke="colors[3]" stroke-width="3" />
        <rect y="152" width="320" height="28" :fill="colors[3]" />
        <path d="M0 136h70v6H0ZM58 142h5v14h-5Z" :fill="colors[3]" />
      </template>
      <template v-else-if="scene === 'dunes'">
        <path d="M0 142Q90 116 190 140T320 128V180H0Z" :fill="colors[3]" />
        <path d="M274 132L281 98L290 99L287 134Z" :fill="colors[4]" />
      </template>
      <template v-else-if="scene === 'forest'">
        <path d="M70 0h12V180H70ZM232 0h11V180h-11Z" :fill="colors[3]" />
        <path d="M0 156Q160 144 320 158V180H0Z" :fill="colors[4]" />
        <g :fill="colors[5]"><circle v-for="([x, y], index) in fireflies" :key="index" :cx="x" :cy="y" r="4.5" opacity=".2" /><circle v-for="([x, y], index) in fireflies" :key="`dot${index}`" :cx="x" :cy="y" r="1.6" /></g>
      </template>
      <template v-else-if="scene === 'sea'">
        <rect y="104" width="320" height="76" :fill="`url(#${uid}water)`" />
        <path d="M190 110h28v2h-28ZM195 119h19v2h-19ZM187 129h34v2h-34ZM197 141h17v2h-17ZM190 155h30v2h-30Z" :fill="colors[5]" opacity=".5" />
      </template>
      <template v-else>
        <path d="M0 0H320L190 62H130Z" :fill="colors[2]" />
        <path d="M0 0L130 62V118L0 180Z" :fill="colors[3]" /><path d="M320 0L190 62V118L320 180Z" :fill="colors[3]" />
        <path d="M320 0L190 62V118L320 180Z" fill="#000" opacity=".14" />
        <path d="M0 180H320L190 118H130Z" :fill="colors[4]" />
        <path d="M148 118h24l18 62h-60Z" :fill="colors[5]" opacity=".14" />
        <path d="M40 19V161M82 39V141M110 52V128M280 19V161M238 39V141M210 52V128" :stroke="colors[2]" stroke-width="1.5" opacity=".75" fill="none" />
        <g :fill="colors[5]" opacity=".85"><ellipse cx="160" cy="18" rx="15" ry="3" /><ellipse cx="160" cy="40" rx="9" ry="2" /><ellipse cx="160" cy="53" rx="5" ry="1.3" /></g>
      </template>
    </g>
    <g v-for="ghost in ghosts" :key="ghost" :transform="figureTransform(ghost)" :opacity="ghost ? 0.5 - ghost * 0.14 : 1">
      <path v-if="scene === 'sea'" d="M-24 6H24L17 15H-17Z" :fill="colors[4]" />
      <g :fill="colors[4]" :stroke="colors[5]" stroke-opacity=".45" stroke-width=".5">
        <circle cx="0" cy="-27" r="3.6" /><path d="M-4.5-22.5Q0-24.5 4.5-22.5L6.5-6L3-6L2.4 0H-2.4L-3-6H-6.5Z" />
      </g>
    </g>
    <g :style="layerStyle(2)">
      <template v-if="scene === 'peaks'">
        <path d="M0 180V132L22 126L62 127L94 134L108 152L116 180Z" :fill="colors[4]" /><path d="M320 180V162L290 152L262 166L250 180Z" :fill="colors[4]" />
      </template>
      <template v-else-if="scene === 'city'">
        <path d="M258 118h2v44h-2Z" :fill="colors[4]" /><circle cx="259" cy="116" r="3.2" :fill="colors[5]" />
      </template>
      <template v-else-if="scene === 'room'">
        <path d="M252 180V142Q252 128 266 128H320V180Z" :fill="colors[4]" />
      </template>
      <template v-else-if="scene === 'dunes'">
        <path d="M0 166Q130 142 320 170V180H0Z" :fill="colors[4]" />
      </template>
      <template v-else-if="scene === 'forest'">
        <path d="M-6 0h28V180H-6ZM296 0h30V180h-30ZM0 0H320V20Q240 40 160 24T0 30Z" :fill="colors[4]" />
      </template>
      <template v-else-if="scene === 'sea'">
        <path d="M0 180V150Q24 138 52 152L70 180Z" :fill="colors[4]" /><path d="M320 180V164Q296 154 276 180Z" :fill="colors[4]" />
      </template>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import type { SceneColors, SceneKey } from "./catalog";

const props = withDefaults(defineProps<{
  scene: SceneKey;
  colors: SceneColors;
  /** 主体脚下的位置；不传时使用场景的默认位置。 */
  subject?: [number, number];
  /** 主体运动进度，0 到 1。 */
  time?: number;
  flip?: boolean;
  /** 远景、中景、前景各自的模糊量。 */
  blur?: [number, number, number];
  trail?: boolean;
}>(), { time: 0.5 });
const uid = useId();
const fireflies = [[120, 90], [204, 70], [176, 118], [92, 128], [226, 112], [150, 60]];
// 每个场景的主体默认位置、大小和可移动的距离。
const figures: Record<SceneKey, { at: [number, number]; scale: number; travel: number }> = {
  peaks: { at: [66, 127], scale: 1, travel: 14 },
  city: { at: [150, 162], scale: 1.3, travel: 120 },
  room: { at: [120, 198], scale: 3.6, travel: 16 },
  dunes: { at: [120, 134], scale: 1.1, travel: 110 },
  forest: { at: [176, 154], scale: 1, travel: 60 },
  sea: { at: [128, 114], scale: 0.62, travel: 90 },
  corridor: { at: [160, 131], scale: 1.05, travel: 0 },
};
const ghosts = computed(() => props.trail ? [3, 2, 1, 0] : [0]);

function figureTransform(ghost: number) {
  const figure = figures[props.scene];
  const [x, y] = props.subject ?? figure.at;
  return `translate(${x + (props.time - 0.5 - ghost * 0.035) * figure.travel} ${y}) scale(${figure.scale})`;
}

function layerStyle(index: number) {
  const amount = props.blur?.[index];
  return amount ? { filter: `blur(${amount}px)` } : undefined;
}
</script>

<style scoped lang="scss">
.scenePreview {
  display: block;
  width: 100%;
  height: 100%;

  &.flip { transform: scaleX(-1); }
}
</style>
