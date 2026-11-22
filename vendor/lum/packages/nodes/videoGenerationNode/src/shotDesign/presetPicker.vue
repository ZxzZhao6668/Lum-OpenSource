<template>
  <el-dialog v-model="visible" class="shotDesignDialog" width="min(1180px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose :showClose="false" @open="draft = modelValue ?? ''; query = ''">
    <template #header>
      <div class="pickerHeader">
        <strong>{{ group.title }}</strong>
        <el-input v-model="query" class="pickerSearch" :prefixIcon="IconSearch" :placeholder="`搜索${group.label}`" :aria-label="`搜索${group.label}`" clearable />
        <el-button text :icon="IconX" aria-label="关闭" @click="visible = false" />
      </div>
    </template>
    <el-scrollbar class="pickerScroll" maxHeight="min(620px, calc(100dvh - 240px))">
      <div class="presetGrid" role="listbox" :aria-label="group.title">
        <button
          v-for="item in results"
          :key="item.id"
          type="button"
          class="presetCard"
          :class="{ active: draft === item.id }"
          role="option"
          :aria-selected="draft === item.id"
          :title="item.prompt"
          @click="draft = draft === item.id ? '' : item.id"
          @dblclick="confirm(item.id)"
          @mouseenter="hovered = item.id"
          @mouseleave="hovered = ''">
          <presetThumb class="cardThumb" :preset="item" :kind="kind" :playing="hovered === item.id || draft === item.id" />
          <span class="cardName">{{ item.label }}<icon-check v-if="draft === item.id" :size="15" aria-hidden="true" /></span>
        </button>
      </div>
      <p v-if="!results.length" class="pickerEmpty">没有匹配的{{ group.label }}</p>
    </el-scrollbar>
    <template #footer>
      <div class="pickerFooter">
        <p class="pickerPrompt">{{ group.items.find(item => item.id === draft)?.prompt ?? `选一种${group.label}，生成视频时会自动附加到提示词后面；再点一次已选的卡片可取消选择。` }}</p>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="draft === (modelValue ?? '')" @click="confirm(draft)">确定</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElDialog, ElInput, ElScrollbar } from "element-plus";
import { IconCheck, IconSearch, IconX } from "@tabler/icons-vue";
import presetThumb from "./presetThumb.vue";
import { presetKinds, type PresetKind } from "./catalog";

const props = defineProps<{ kind: PresetKind }>();
const visible = defineModel<boolean>("visible", { required: true });
const modelValue = defineModel<string>();
const group = computed(() => presetKinds.find(item => item.kind === props.kind)!);
const draft = ref("");
const query = ref("");
const hovered = ref("");
const results = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return group.value.items.filter(item => `${item.label} ${item.prompt}`.toLocaleLowerCase().includes(keyword));
});

function confirm(id: string) {
  modelValue.value = id || undefined;
  visible.value = false;
}
</script>

<style lang="scss">
.shotDesignDialog {
  --el-dialog-padding-primary: 20px;

  .pickerHeader {
    display: flex;
    align-items: center;
    gap: 16px;

    strong { font-size: 16px; }
    .pickerSearch { width: 280px; margin-right: auto; }
    .el-button { width: 32px; height: 32px; padding: 0; }
  }

  .presetGrid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px 16px;
    padding: 2px;

    .presetCard {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--el-text-color-primary);
      font: inherit;
      text-align: left;
      cursor: pointer;

      .cardThumb {
        border-radius: 12px;
        outline: 2px solid transparent;
        outline-offset: 2px;
        transition: outline-color 120ms ease, transform 120ms ease;
      }
      &:hover .cardThumb { transform: translateY(-2px); }
      &:focus-visible .cardThumb { outline-color: var(--el-color-primary-light-3); }
      &.active .cardThumb { outline-color: var(--el-color-primary); }

      .cardName {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 2px;
        font-size: 14px;
        font-weight: 600;

        svg { color: var(--el-color-primary); }
      }
    }
  }

  .pickerEmpty {
    margin: 48px 0;
    color: var(--el-text-color-secondary);
    text-align: center;
  }

  .pickerFooter {
    display: flex;
    align-items: center;
    gap: 12px;

    .pickerPrompt {
      flex: 1;
      min-width: 0;
      margin: 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      line-height: 1.6;
      text-align: left;
    }
    .el-button { flex-shrink: 0; margin-left: 0; }
  }
}

@media (max-width: 900px) {
  .shotDesignDialog .presetGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
