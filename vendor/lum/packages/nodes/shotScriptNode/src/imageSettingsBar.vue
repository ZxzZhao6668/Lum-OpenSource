<template>
  <div class="imageSettingsBar">
    <label>
      <span>生图模型</span>
      <el-select v-model="settings.model" size="small" class="modelSelect" filterable :loading="loading" aria-label="生图模型" noDataText="请先在设置中添加图片模型">
        <el-option value="auto" :label="fallback ? `默认模型（${fallback.label}）` : '默认模型'" />
        <el-option-group v-for="provider in groups" :key="provider.id" :label="provider.label">
          <el-option v-for="item in provider.models" :key="modelKey(item)" :label="item.label" :value="modelKey(item)" />
        </el-option-group>
      </el-select>
    </label>
    <label>
      <span>比例</span>
      <el-select v-model="settings.ratio" size="small" class="ratioSelect" aria-label="比例">
        <el-option value="auto" label="自动" title="道具 1:1，角色和场景 16:9" />
        <el-option v-for="item in ratios" :key="item" :label="item" :value="item" />
      </el-select>
    </label>
    <label>
      <span>分辨率</span>
      <el-select v-model="settings.size" size="small" class="sizeSelect" aria-label="分辨率">
        <el-option value="auto" :label="`默认（${sizes[0]}）`" />
        <el-option v-for="item in sizes" :key="item" :label="item" :value="item" />
      </el-select>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { ElOption, ElOptionGroup, ElSelect } from "element-plus";
import type { NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import { groupNodeModels } from "@lum/node-shared/groupNodeModels";
import { modelKey } from "@lum/node-shared/useMediaModels";
import { pickedImageModel, ratiosOf, sizesOf, type ImageSettings } from "./imageSettings";

const props = defineProps<{ settings: ImageSettings; models: NodeMediaModel[]; fallback?: NodeMediaModel; loading?: boolean }>();
const groups = computed(() => groupNodeModels(props.models));
const model = computed(() => pickedImageModel(props.settings, props.models) ?? props.fallback);
const ratios = computed(() => ratiosOf(model.value));
const sizes = computed(() => sizesOf(model.value));
// 换模型后，原来选的比例或分辨率不在新模型的可选项里就回到自动。模型清单还没读到时不动。
watch([model, () => props.models.length], () => {
  if (!props.models.length) return;
  if (props.settings.model !== "auto" && !pickedImageModel(props.settings, props.models)) props.settings.model = "auto";
  if (props.settings.ratio !== "auto" && !ratios.value.includes(props.settings.ratio)) props.settings.ratio = "auto";
  if (props.settings.size !== "auto" && !sizes.value.includes(props.settings.size)) props.settings.size = "auto";
}, { immediate: true });
</script>

<style lang="scss" scoped>
.imageSettingsBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;

  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    white-space: nowrap;
  }

  .modelSelect { width: 210px; }
  .ratioSelect { width: 92px; }
  .sizeSelect { width: 112px; }
}
</style>
