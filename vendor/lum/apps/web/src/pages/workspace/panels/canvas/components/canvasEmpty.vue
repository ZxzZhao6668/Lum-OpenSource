<template>
  <div class="canvasEmpty">
    <div class="emptyHint">
      <icon-click :size="24" aria-hidden="true" />
      <span>双击画布 自由生成节点</span>
    </div>
    <div class="emptyActions">
      <button
        v-for="(item, index) in actions"
        :key="item.type"
        class="emptyAction"
        type="button"
        :style="{ '--enterOrder': index }"
        :disabled="!availableNodes.some(node => node.type === (item.nodeType ?? item.type))"
        @pointerdown.stop
        @dblclick.stop
        @click.stop="emit('create', item.type)">
        <span class="actionIcon"><component :is="getNodeIcon(item.nodeType ?? item.type) ?? IconBox" :size="22" aria-hidden="true" /></span>
        <span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconBox, IconClick } from "@tabler/icons-vue";
import { getNodeIcon } from "../loadNodeComponent";

defineProps<{ availableNodes: { type: string }[] }>();
const emit = defineEmits<{ create: [type: string] }>();
// scriptSetup 打开剧本设定器，确认后创建剧本节点。
const actions: { type: string; label: string; nodeType?: string }[] = [
  { type: "scriptSetup", label: "剧本生成", nodeType: "remote-scriptNode" },
  { type: "remote-imageGenerationNode", label: "图片生成" },
  { type: "remote-videoGenerationNode", label: "视频生成" },
  { type: "remote-audioGenerationNode", label: "音频生成" },
  { type: "remote-trumanMap", label: "白模预演" },
];
</script>

<style scoped lang="scss">
.canvasEmpty {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  padding: 24px;
  pointer-events: none;
  user-select: none;

  .emptyHint {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--el-text-color-secondary);
    font-size: 14px;
    font-weight: 500;
    animation: emptyEnter 0.32s var(--lum-ease, ease-out) backwards;
  }

  .emptyActions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    max-width: 100%;

    .emptyAction {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 200px;
      max-width: 100%;
      min-height: 56px;
      padding: 6px 8px;
      border: 1px solid var(--el-border-color-light);
      border-radius: 16px;
      background: var(--el-fill-color-light);
      color: var(--el-text-color-primary);
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      pointer-events: auto;
      // 入场按顺序错开；位移用 translate、scale 独立属性，不和入场动画抢 transform。
      animation: emptyEnter 0.36s var(--lum-ease, ease-out) backwards;
      animation-delay: calc(60ms + var(--enterOrder, 0) * 45ms);
      transition: background-color 0.18s, border-color 0.18s, box-shadow 0.22s, translate 0.22s var(--lum-ease, ease-out), scale 0.14s var(--lum-ease, ease-out);

      &:hover:not(:disabled) {
        background: var(--el-fill-color);
        border-color: var(--el-border-color-darker);
        box-shadow: var(--lum-float-shadow, 0 8px 24px rgb(0 0 0 / 0.12));
        translate: 0 -2px;

        .actionIcon {
          background: color-mix(in srgb, var(--el-text-color-primary) 14%, var(--el-fill-color-darker));
          scale: 1.06;
        }
      }

      &:active:not(:disabled) {
        translate: 0 0;
        scale: 0.98;
        box-shadow: none;
      }

      &:focus-visible {
        outline: 2px solid var(--el-color-primary);
        outline-offset: 3px;
      }

      &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .actionIcon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 40px;
        height: 40px;
        border-radius: 12px;
        background: var(--el-fill-color-darker);
        transition: background-color 0.18s, scale 0.22s var(--lum-ease, ease-out);
      }
    }
  }
}

// 只写起点：终点取元素自身的样式，禁用项的半透明不会被动画盖掉。
@keyframes emptyEnter {
  from { opacity: 0; transform: translateY(8px); }
}
</style>
