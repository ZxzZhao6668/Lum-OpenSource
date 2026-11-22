<template>
  <div class="promptPackage">
    <button class="packageButton" type="button" :disabled="disabled" aria-label="编辑提示词包" aria-haspopup="dialog" @click="openEditor">
      <icon-file-text :size="16" aria-hidden="true" />
      <strong>提示词包</strong>
      <span class="packagePreview">{{ preview }}</span>
      <icon-pencil :size="14" aria-hidden="true" />
    </button>
    <el-button text circle size="small" :disabled="disabled" aria-label="移除提示词包" title="移除提示词包" @click="text = ''"><icon-x :size="14" /></el-button>
    <el-dialog v-model="visible" title="编辑提示词包" width="min(620px, 92vw)" alignCenter appendToBody destroyOnClose>
      <el-input v-model="edited" type="textarea" :autosize="{ minRows: 6, maxRows: 15 }" resize="none" aria-label="提示词原文" />
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="disabled" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconFileText, IconPencil, IconX } from "@tabler/icons-vue";

const props = defineProps<{ disabled: boolean; active: boolean }>();
const text = defineModel<string>({ required: true });
const preview = computed(() => text.value.slice(0, 100).replace(/^\s*\/skill:\S+\s*/, "").split("\n")[0]);
const visible = ref(false);
const edited = ref("");

function openEditor() {
  edited.value = text.value;
  visible.value = true;
}

function save() {
  text.value = edited.value;
  visible.value = false;
}

watch([text, () => props.active], () => { visible.value = false; });
</script>

<style scoped lang="scss">
.promptPackage {
  display: flex;
  align-items: center;
  margin: 10px 12px 0;
  padding-right: 3px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);

  .packageButton {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 7px 9px;
    border: 0;
    background: transparent;
    color: var(--el-text-color-primary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    strong, svg { flex-shrink: 0; }
    svg { color: var(--el-text-color-secondary); }
    &:disabled { cursor: default; opacity: .65; }
    &:focus-visible { outline: 2px solid var(--el-color-primary); }

    .packagePreview {
      flex: 1;
      overflow: hidden;
      color: var(--el-text-color-secondary);
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
</style>
