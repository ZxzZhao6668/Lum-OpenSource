<template>
  <section class="splitSettings" aria-label="裁剪校准">
    <slot :regions="regions" :layoutError="layoutError" />
    <el-radio-group v-model="kind" aria-label="裁剪方式" :disabled="disabled">
      <el-radio-button v-if="template.id !== 'characterSheet'" value="grid">规则网格</el-radio-button>
      <el-radio-button value="rectangles">逐格矩形</el-radio-button>
    </el-radio-group>
    <p class="splitHint">在原图上校准裁剪范围。左上角为 (0, 0)，横向与纵向坐标按原图宽高归一化为 0–1。</p>
    <div class="splitFields" v-if="kind === 'grid'">
      <label>列数<input v-model.number="columns" type="number" min="1" :max="template.cells.length" :disabled="disabled" /></label>
      <label>行数<input v-model.number="rows" type="number" min="1" :max="template.cells.length" :disabled="disabled" /></label>
    </div>
    <label v-else class="splitCell">
      校准格位
      <select v-model="cellId" :disabled="disabled">
        <option v-for="cell in template.cells" :key="cell.id" :value="cell.id">{{ cell.label }}</option>
      </select>
    </label>
    <div class="splitFields" v-if="rect">
      <label v-for="axis in axes" :key="axis.key">
        {{ axis.label }}
        <input v-model.number="rect[axis.key]" type="number" min="0" max="1" step="0.001" :disabled="disabled" />
      </label>
    </div>
    <details>
      <summary>裁剪图片命名</summary>
      <div class="splitFields splitNames">
        <label v-for="cell in template.cells" :key="cell.id">{{ cell.label }}<input v-model="names[cell.id]" maxlength="120" :disabled="disabled" /></label>
      </div>
    </details>
    <p v-if="layoutError" class="splitError" role="status">{{ layoutError }}</p>
    <label class="splitConfirm"><input v-model="confirmed" type="checkbox" :disabled="disabled || !previewReady || !!layoutError" />我已核对整张候选与所有裁剪区域</label>
    <el-button type="primary" :disabled="disabled || !previewReady || !confirmed || !!layoutError" @click="emit('split', layout, { ...names })">拆图并保存 {{ template.cells.length }} 张</el-button>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElButton, ElRadioButton, ElRadioGroup } from "element-plus";
import { getWorkbenchCropRectangles, type ImageNormalizedRect, type ImageWorkbenchSplitLayout } from "../imageComposition";
import type { ImageWorkbenchTemplate } from "../imageWorkbenchTemplates";

const props = defineProps<{ template: ImageWorkbenchTemplate; disabled: boolean; previewReady: boolean }>();
const emit = defineEmits<{ split: [layout: ImageWorkbenchSplitLayout, names: Record<string, string>] }>();
type EditableRect = { -readonly [Key in keyof ImageNormalizedRect]: ImageNormalizedRect[Key] };
const axes = [{ key: "x", label: "左侧 X" }, { key: "y", label: "顶部 Y" }, { key: "width", label: "宽度" }, { key: "height", label: "高度" }] as const;
const kind = ref<ImageWorkbenchSplitLayout["kind"]>(props.template.id === "characterSheet" ? "rectangles" : "grid");
const { columns: templateColumns, rows: templateRows } = props.template.grid;
const fixedGrid = { rows: templateRows, columns: templateColumns };
const columns = ref(templateColumns);
const rows = ref(templateRows);
const region = reactive<EditableRect>({ x: 0, y: 0, width: 1, height: 1 });
const cellIds = props.template.cells.map(cell => cell.id);
const rectangles = reactive<Record<string, EditableRect>>(
  Object.fromEntries(cellIds.map(id => [id, { x: 0, y: 0, width: 0, height: 0 }])),
);
const names = reactive(Object.fromEntries(props.template.cells.map(cell => [cell.id, cell.label])));
const confirmed = ref(false);
const cellId = ref(cellIds[0]);
const rect = computed(() => kind.value === "grid" ? region : rectangles[cellId.value]);
const layout = computed<ImageWorkbenchSplitLayout>(() => kind.value === "grid"
  ? { kind: "grid", rows: rows.value, columns: columns.value, confirmed: true, region: { ...region } }
  : { kind: "rectangles", ...fixedGrid, confirmed: true, rectangles: cellIds.map(cellId => ({ cellId, rect: { ...rectangles[cellId] } })) });
const layoutError = computed(() => {
  try {
    getWorkbenchCropRectangles(layout.value, cellIds, props.template.id === "characterSheet");
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});
const regions = computed(() => {
  if (kind.value === "grid") {
    if (layoutError.value) return [];
    return getWorkbenchCropRectangles(layout.value, cellIds, false);
  }
  // 即使其他格尚未填写，仍可核对当前格的矩形。
  return axes.every(({ key }) => Number.isFinite(rect.value[key])) ? [rect.value] : [];
});
watch([layout, () => props.previewReady], () => { confirmed.value = false; });
</script>

<style scoped lang="scss">
.splitSettings {
  display: grid;
  gap: 10px;
  justify-items: start;

  .splitHint,
  .splitError { margin: 0; }
  .splitHint { color: var(--el-text-color-secondary); }
  .splitError { color: var(--el-color-danger); }

  .splitFields {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 8px;
  }

  .splitFields label,
  .splitCell { display: grid; gap: 4px; min-width: 0; }
  .splitConfirm { display: flex; align-items: start; gap: 7px; }
  .splitConfirm input { margin: 3px 0 0; }
  .splitNames { margin-top: 8px; }
  details { width: 100%; }
  summary { cursor: pointer; }
  input:not([type="checkbox"]), select {
    min-width: 0;
    max-width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--el-border-color);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
  }
}
</style>
