<template>
  <div class="wheelColumn">
    <span class="wheelLabel" :id="id">{{ label }}</span>
    <div ref="wheel" class="genreWheel" role="listbox" tabindex="0" :aria-labelledby="id"
      :aria-activedescendant="id + '-' + selectedIndex" @wheel="onWheel"
      @keydown.up.prevent="step(-1)" @keydown.down.prevent="step(1)"
      @keydown.home.prevent="select(0)" @keydown.end.prevent="select(options.length - 1)">
      <div v-for="{ index, offset, option } in visibleOptions" :id="id + '-' + index" :key="option.label"
        role="option" class="genreOption" :class="{ current: !offset, far: Math.abs(offset) === 2 }"
        :aria-selected="!offset" :aria-posinset="index + 1" :aria-setsize="options.length"
        :title="option.hint" @click="wheel?.focus({ preventScroll: true }); select(index)">
        {{ option.label }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import type { SetupOption } from "./scriptSetupCatalog";

const props = defineProps<{ label: string; options: SetupOption[]; selected: string }>();
const emit = defineEmits<{ select: [label: string] }>();
const id = useId();
const wheel = ref<HTMLDivElement>();
const selectedIndex = computed(() => props.options.findIndex(option => option.label === props.selected));
const indexAt = (offset: number) => (selectedIndex.value + offset + props.options.length) % props.options.length;
const visibleOptions = computed(() => [-2, -1, 0, 1, 2].map(offset => {
  const index = indexAt(offset);
  return { index, offset, option: props.options[index]! };
}));

function select(index: number) {
  const label = props.options[index]!.label;
  if (label !== props.selected) emit("select", label);
}
function step(offset: number) { select(indexAt(offset)); }

let lastWheelTime = -Infinity;
let distance = 0;
let stepped = false;
function onWheel(event: WheelEvent) {
  if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  const now = performance.now();
  // 一次触控板滑动包含连续的惯性事件，只跨过一个题材。
  if (now - lastWheelTime > 110 || Math.sign(event.deltaY) !== Math.sign(distance)) {
    distance = 0;
    stepped = false;
  }
  lastWheelTime = now;
  distance += event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 160 : 1);
  if (!stepped && Math.abs(distance) >= 16) {
    step(Math.sign(distance));
    stepped = true;
  }
}
</script>

<style lang="scss" scoped>
.wheelColumn {
  min-width: 0;
  text-align: center;

  .wheelLabel {
    display: block;
    margin-bottom: 6px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
  .genreWheel {
    border-radius: 10px;
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }

    .genreOption {
      display: grid;
      place-items: center;
      min-height: 32px;
      padding: 2px;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--el-text-color-regular);
      font-size: 14px;
      white-space: nowrap;
      cursor: pointer;
      touch-action: manipulation;

      &.far { color: var(--el-text-color-secondary); }
      &:hover { background: var(--el-fill-color-light); }
      &.current {
        background: var(--el-color-primary-light-9);
        border-color: var(--el-color-primary-light-7);
        color: var(--el-text-color-primary);
        font-weight: 700;
      }
    }
  }
}
</style>
