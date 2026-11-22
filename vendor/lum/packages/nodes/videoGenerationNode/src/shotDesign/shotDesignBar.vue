<template>
  <div class="shotDesignBar" role="group" aria-label="镜头设定">
    <div v-for="item in entries" :key="item.kind" class="designEntry" :class="{ chosen: item.value }">
      <button type="button" class="designButton" :disabled="disabled" :title="item.value ? `${item.label}：${item.value}` : `选择${item.label}`" @click="opened = item.kind">
        <span class="designThumb" :class="{ preset: item.preset }">
          <presetThumb v-if="item.preset" :preset="item.preset" :kind="item.kind" />
          <img v-else :src="icons[item.kind]" alt="" draggable="false" />
        </span>
        <span class="designText"><small v-if="item.value">{{ item.label }}</small><b>{{ item.value || item.label }}</b></span>
      </button>
      <button v-if="item.value && !disabled" type="button" class="designClear" :aria-label="`清除${item.label}`" :title="`清除${item.label}`" @click="design[item.kind] = undefined"><icon-x :size="12" aria-hidden="true" /></button>
    </div>
    <presetPicker v-for="item in presetKinds" :key="item.kind" v-model="design[item.kind]" :kind="item.kind" :visible="opened === item.kind" @update:visible="opened = undefined" />
    <cameraPicker v-model="design.camera" :visible="opened === 'camera'" @update:visible="opened = undefined" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IconX } from "@tabler/icons-vue";
import styleIcon from "./icons/style.webp?inline";
import paletteIcon from "./icons/palette.webp?inline";
import compositionIcon from "./icons/composition.webp?inline";
import rhythmIcon from "./icons/rhythm.webp?inline";
import cameraIcon from "./icons/camera.webp?inline";
import presetThumb from "./presetThumb.vue";
import presetPicker from "./presetPicker.vue";
import cameraPicker from "./cameraPicker.vue";
import { cameraSummary, findPreset, presetKinds, type PresetKind, type ShotDesign } from "./catalog";

defineProps<{ disabled?: boolean }>();
const design = defineModel<ShotDesign>({ required: true });
const opened = ref<PresetKind | "camera">();
const icons = { style: styleIcon, palette: paletteIcon, composition: compositionIcon, rhythm: rhythmIcon, camera: cameraIcon };
const entries = computed(() => [
  ...presetKinds.map(({ kind, label }) => {
    const preset = findPreset(kind, design.value[kind]);
    return { kind, label, preset, value: preset?.label ?? "" };
  }),
  { kind: "camera" as const, label: "相机", preset: undefined, value: cameraSummary(design.value.camera) },
]);
</script>

<style scoped lang="scss">
.shotDesignBar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;

  .designEntry {
    position: relative;
    min-width: 0;

    .designButton {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 48px;
      padding: 0 10px;
      border: 1px solid var(--el-border-color-light);
      border-radius: 14px;
      background: var(--el-bg-color-overlay);
      color: var(--el-text-color-primary);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color 120ms ease, background-color 120ms ease;

      &:hover:not(:disabled) { border-color: var(--el-border-color); background: var(--el-fill-color-light); }
      &:disabled { opacity: 0.55; cursor: not-allowed; }

      .designThumb {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        overflow: hidden;
        border-radius: 7px;
        background: var(--el-fill-color);

        &.preset { height: 28px; }
        img { display: block; width: 100%; height: 100%; object-fit: contain; }
        :deep(.presetThumb) { height: 100%; aspect-ratio: auto; }
      }

      .designText {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.25;

        small { color: var(--el-text-color-secondary); font-size: 11px; }
        b { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      }
    }

    &.chosen .designButton { border-color: var(--el-color-primary-light-5); }

    .designClear {
      position: absolute;
      top: -6px;
      right: -6px;
      display: none;
      place-items: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--el-border-color);
      border-radius: 50%;
      background: var(--el-bg-color-overlay);
      color: var(--el-text-color-secondary);
      cursor: pointer;

      &:hover { color: var(--el-color-danger); }
    }
    &:hover .designClear,
    &:focus-within .designClear { display: grid; }
  }
}
</style>
