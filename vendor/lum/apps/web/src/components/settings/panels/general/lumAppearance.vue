<template>
  <section class="lumAppearance" aria-labelledby="lumAppearanceTitle">
    <h3 id="lumAppearanceTitle">Lum 界面风格</h3>
    <p>写作、资产和画布同步切换，保留当前工作内容。</p>
    <div class="lumPresets" role="group" aria-label="Lum 界面风格">
      <button v-for="preset in presets" :key="preset.id" type="button" class="lumPreset" :class="preset.id" :aria-pressed="selected === preset.id" @click="selectPreset(preset.id)">
        <span class="lumPresetPreview" aria-hidden="true"><i /><span><b /><b /><b /></span><em /></span>
        <strong>{{ preset.label }}</strong><small>{{ preset.description }}</small>
      </button>
    </div>
    <div class="lumPreference">
      <div><strong>交互动效</strong><p>按钮按压、面板开合、节点反馈与连线流动。</p></div>
      <el-radio-group :modelValue="uiSettings.lumMotion" aria-label="交互动效强度" @change="value => updateUiSettings({ lumMotion: String(value) })">
        <el-radio-button value="gentle">轻柔</el-radio-button><el-radio-button value="full">明显</el-radio-button><el-radio-button value="off">关闭</el-radio-button>
      </el-radio-group>
    </div>
    <div class="lumPreference">
      <div><strong>局部毛玻璃</strong><p>应用于悬浮工具栏、Agent 与弹窗，正文和图片保持清晰。</p></div>
      <el-switch :modelValue="uiSettings.lumGlass" aria-label="局部毛玻璃" @change="value => updateUiSettings({ lumGlass: Boolean(value) })" />
    </div>
    <div class="lumPreference">
      <div><strong>Lum 启动封面</strong><p>以品牌流光进入工作区，每次启动只播放一次。</p></div>
      <div class="lumStartupActions"><el-button @click="previewStartup">预览动画</el-button><el-switch :modelValue="uiSettings.startupAnimation" aria-label="Lum 启动封面" @change="value => updateUiSettings({ startupAnimation: Boolean(value) })" /></div>
    </div>
    <small class="lumMotionHint">开启系统“减少动态效果”时，自动减弱动画。</small>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { uiSettings, updateUiSettings } from "@/stores/settings";
import { requestLumStartupPreview } from "@/lib/lumAppearance";

const presets = [
  { id: "lime", label: "雾灰青柠", description: "柔白卡片 · 青柠重点" },
  { id: "white", label: "纯白", description: "干净明亮 · 黑白对比" },
  { id: "black", label: "曜黑", description: "沉静深灰 · 银白控件" },
];
const selected = computed(() => uiSettings.value.theme === "dark" ? "black" : uiSettings.value.theme === "system" ? "" : uiSettings.value.lumPalette === "mono" ? "white" : "lime");
function selectPreset(id: string) {
  updateUiSettings({ theme: id === "black" ? "dark" : "light", lumPalette: id === "lime" ? "lime" : "mono", primaryColor: id === "lime" ? "#b7f45a" : id === "white" ? "#202020" : "#e9e9e7" });
}
function previewStartup() { requestLumStartupPreview(); }
</script>

<style lang="scss" scoped>
.lumAppearance {
  display: grid; gap: 16px; min-width: 0;
  h3 { margin: 0; font-size: 15px; }
  p { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
  .lumPresets { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
  .lumPreset {
    min-width: 0; display: grid; gap: 8px; text-align: left; border: 1px solid var(--el-border-color); border-radius: 14px; background: var(--el-bg-color); padding: 10px; color: var(--el-text-color-primary); cursor: pointer;
    &[aria-pressed="true"] { outline: 2px solid var(--lum-strong); outline-offset: 2px; }
    strong { font-size: 13px; } small { color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.5; }
    .lumPresetPreview {
      display: flex; align-items: stretch; height: 65px; gap: 7px; padding: 8px; background: #eceeec; border-radius: 8px; overflow: hidden;
      > i { width: 6px; border-radius: 3px; background: #151715; }
      > span { display: flex; gap: 5px; flex: 1; align-items: center; b { height: 35px; flex: 1; border-radius: 5px; background: #fff; box-shadow: 0 1px 4px #0001; } }
      > em { align-self: flex-end; width: 15px; height: 10px; border-radius: 5px; background: #b7f45a; }
    }
    &.white .lumPresetPreview { background: #f1f2f3; > em { background: #202020; } }
    &.black .lumPresetPreview { background: #181818; > i, > em { background: #eeeeec; } > span b { background: #353535; } }
  }
  .lumPreference { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 14px; border-top: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; > div:first-child { flex: 1; min-width: 180px; } strong { display: block; font-size: 13px; margin-bottom: 5px; } }
  .lumStartupActions { display: flex; align-items: center; gap: 12px; }
  .lumMotionHint { color: var(--el-text-color-secondary); font-size: 11px; }
}
</style>
