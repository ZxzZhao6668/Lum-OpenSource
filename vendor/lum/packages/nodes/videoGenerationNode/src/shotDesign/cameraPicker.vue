<template>
  <el-dialog v-model="visible" class="shotDesignDialog cameraDialog" title="相机设置" width="min(980px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose @open="draft = { ...modelValue }">
    <div class="cameraPreview" :class="lens?.effect" role="img" :aria-label="`相机效果预览：${cameraSummary(draft) || '全部自动'}`">
      <div class="previewTone" :style="{ filter: body?.tone }">
        <div class="previewStage" :style="{ transform: `scale(${zoom})` }">
          <img class="previewPhoto" :src="cameraPhoto" alt="" draggable="false" />
          <div v-if="blur >= 0.4" class="previewDepth" :style="{ backdropFilter: `blur(${blur}px)` }" />
        </div>
      </div>
      <div v-if="body?.grain" class="previewGrain" :style="{ opacity: body.grain }" />
      <div v-if="body?.lines" class="previewLines" />
      <span v-if="body?.stamp" class="previewStamp">● REC 00:00:12</span>
      <div class="previewHud">
        <span v-for="field in cameraFields" :key="field.key"><small>{{ field.label }}</small>{{ optionOf(field.key)?.label ?? "Auto" }}</span>
      </div>
    </div>
    <div class="cameraFields">
      <div v-for="(field, index) in cameraFields" :key="field.key" class="cameraField">
        <el-button class="stepButton" text :icon="IconChevronUp" :aria-label="`上一个${field.label}`" @click="step(field.key, -1)" />
        <el-dropdown trigger="click" placement="top" :maxHeight="320" popperClass="cameraOptionMenu" @command="draft[field.key] = $event || undefined">
          <button type="button" class="fieldValue" :aria-label="`${field.label}：${optionOf(field.key)?.label ?? 'Auto'}`" @wheel.prevent="step(field.key, Math.sign($event.deltaY))">
            <component :is="fieldIcons[index]" :size="26" stroke="1.6" aria-hidden="true" />
            <span>{{ optionOf(field.key)?.label ?? "Auto" }}</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="" :class="{ currentOption: !draft[field.key] }">Auto</el-dropdown-item>
              <el-dropdown-item v-for="item in field.options" :key="item.id" :command="item.id" :class="{ currentOption: draft[field.key] === item.id }" :title="item.prompt">{{ item.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button class="stepButton" text :icon="IconChevronDown" :aria-label="`下一个${field.label}`" @click="step(field.key, 1)" />
        <span class="fieldLabel">{{ field.label }}</span>
      </div>
    </div>
    <template #footer>
      <div class="pickerFooter">
        <p class="pickerPrompt">{{ summaryPrompt || "四项都是 Auto 时不附加相机描述，由模型自行决定。" }}</p>
        <el-button text :disabled="!cameraSummary(draft)" @click="draft = {}">全部 Auto</el-button>
        <el-button type="primary" @click="confirm">确认</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus";
import { IconAperture, IconCamera, IconChevronDown, IconChevronUp, IconFocus2, IconRulerMeasure } from "@tabler/icons-vue";
import cameraPhoto from "./photos/camera.webp?inline";
import { cameraApertures, cameraBodies, cameraFields, cameraFocals, cameraLenses, cameraSummary, shotDesignPrompt, type CameraDesign } from "./catalog";

const visible = defineModel<boolean>("visible", { required: true });
const modelValue = defineModel<CameraDesign>();
const draft = ref<CameraDesign>({});
const fieldIcons = [IconCamera, IconFocus2, IconRulerMeasure, IconAperture];
const body = computed(() => cameraBodies.find(item => item.id === draft.value.body));
const lens = computed(() => cameraLenses.find(item => item.id === draft.value.lens));
// Auto 预览使用 35mm 和 f/4，微距与鱼眼镜头对同一张照片取景。
const zoom = computed(() => {
  const focal = cameraFocals.find(item => item.id === draft.value.focal)?.zoom ?? 1.55;
  const lensScale = lens.value?.effect === "macro" ? 1.7 : lens.value?.effect === "fisheye" ? 0.8 : 1;
  return Math.max(1, focal * lensScale);
});
const blur = computed(() => {
  const stop = cameraApertures.find(item => item.id === draft.value.aperture)?.stop ?? 4;
  return Math.min(8, 6 / stop * zoom.value ** 0.8 * (lens.value?.effect === "macro" ? 2 : 1));
});
const summaryPrompt = computed(() => shotDesignPrompt({ camera: draft.value }).split("\n")[1]);

function optionOf(key: keyof CameraDesign) {
  return cameraFields.find(field => field.key === key)!.options.find(item => item.id === draft.value[key]);
}

function step(key: keyof CameraDesign, offset: number) {
  const ids = ["", ...cameraFields.find(field => field.key === key)!.options.map(item => item.id)];
  draft.value[key] = ids[(ids.indexOf(draft.value[key] ?? "") + offset + ids.length) % ids.length] || undefined;
}

function confirm() {
  modelValue.value = cameraSummary(draft.value) ? { ...draft.value } : undefined;
  visible.value = false;
}
</script>

<style lang="scss">
.cameraDialog {
  .cameraPreview {
    position: relative;
    width: min(620px, 100%);
    aspect-ratio: 16 / 9;
    margin: 0 auto;
    overflow: hidden;
    border: 8px solid #000;
    border-radius: 36px;
    background: #000;

    .previewTone,
    .previewStage,
    .previewDepth,
    .previewGrain,
    .previewLines { position: absolute; inset: 0; }
    .previewStage { transform-origin: 49.5% 30%; transition: transform 260ms ease; }
    .previewPhoto { display: block; width: 100%; height: 100%; object-fit: cover; }
    .previewDepth {
      // 保留照片中同一焦平面上清晰的脸和上身，背景随光圈变化。
      mask: url("./cameraFocusMask.svg?inline") center / 100% 100% no-repeat;
      pointer-events: none;
    }

    .previewGrain {
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
      mix-blend-mode: overlay;
      pointer-events: none;
    }
    .previewLines {
      background: repeating-linear-gradient(to bottom, transparent 0 2px, rgb(0 0 0 / 28%) 2px 3px);
      pointer-events: none;
    }
    .previewStamp {
      position: absolute;
      top: 14px;
      left: 20px;
      color: #ff5a4f;
      font: 600 12px/1 ui-monospace, monospace;
      text-shadow: 0 1px 2px #000;
    }

    // 各镜头的画面特征。
    &::before,
    &::after {
      content: "";
      position: absolute;
      z-index: 1;
      pointer-events: none;
    }
    &.anamorphic::before { inset: 0; background: linear-gradient(#000 0 12.8%, transparent 12.8% 87.2%, #000 87.2%); }
    &.anamorphic::after {
      top: 24%;
      right: 0;
      left: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, rgb(120 190 255 / 85%) 22%, #fff 26%, rgb(120 190 255 / 70%) 34%, transparent 82%);
      filter: blur(1.2px);
    }
    &.vintage::before { inset: 0; background: radial-gradient(ellipse at center, transparent 42%, rgb(20 10 0 / 78%) 100%); }
    &.vintage .previewStage { filter: sepia(0.28) contrast(0.92); }
    &.macro::before { inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / 40%) 100%); }
    &.tiltShift::before,
    &.tiltShift::after { right: 0; left: 0; height: 34%; backdrop-filter: blur(5px); }
    &.tiltShift::before { top: 0; mask-image: linear-gradient(to bottom, #000 40%, transparent); }
    &.tiltShift::after { bottom: 0; mask-image: linear-gradient(to top, #000 40%, transparent); }
    &.fisheye .previewTone { inset: 0 21.9%; overflow: hidden; border-radius: 50%; }
    &.fisheye .previewStage { inset: 0 -39%; }
    &.fisheye::before { inset: 0 21.9%; border-radius: 50%; box-shadow: inset 0 0 40px 14px rgb(0 0 0 / 70%); }
    &.softFocus .previewStage { filter: blur(0.7px) brightness(1.08); }
    &.softFocus::before { inset: 0; background: radial-gradient(circle at 22% 22%, rgb(255 244 214 / 46%), transparent 58%); mix-blend-mode: screen; }

    .previewHud {
      position: absolute;
      right: 5%;
      bottom: 12px;
      left: 5%;
      z-index: 2;
      display: flex;
      justify-content: space-around;
      padding: 7px 12px;
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 999px;
      background: rgb(8 14 30 / 46%);
      backdrop-filter: blur(8px);
      color: #fff;
      font: 600 12px/1.2 ui-monospace, monospace;

      small { margin-right: 6px; color: rgb(255 255 255 / 62%); font: inherit; font-weight: 400; }
    }
  }

  .cameraFields {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-top: 22px;

    .cameraField {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      & + .cameraField { border-left: 1px solid var(--el-border-color-lighter); }

      .stepButton { width: 44px; height: 24px; margin: 0; padding: 0; border-radius: 999px; background: var(--el-fill-color-light); }

      .fieldValue {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        min-width: 150px;
        height: 104px;
        border: 1px solid var(--el-border-color);
        border-radius: 999px;
        background: var(--el-fill-color-light);
        color: var(--el-text-color-primary);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;

        &:hover { border-color: var(--el-color-primary-light-3); }
        svg { color: var(--el-text-color-secondary); }
      }

      .fieldLabel { margin-top: 4px; color: var(--el-text-color-secondary); font-size: 14px; font-weight: 600; }
    }
  }
}

.cameraOptionMenu .currentOption { color: var(--el-color-primary); font-weight: 600; }

@media (max-width: 760px) {
  .cameraDialog .cameraFields { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 18px; }
}
</style>
