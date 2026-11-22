<template>
  <section class="candidateHistory" aria-label="候选记录">
    <p v-if="!candidates.length">暂无生成尝试</p>
    <ol v-else>
      <li v-for="candidate in candidates" :key="candidate.id">
        <div class="candidateRow">
          <span>尝试 {{ candidate.attempt }} · {{ statuses[candidate.status] }}</span>
          <el-tag v-if="candidate.id === selectedId" size="small" type="success">已选</el-tag>
          <div class="candidateActions">
            <el-button v-if="canPreview && candidate.status === 'succeeded' && candidate.output" size="small" text :disabled="disabled" @click="emit('preview', candidate.id)">预览</el-button>
            <el-button v-if="candidate.status === 'succeeded' && candidate.output" size="small" text :disabled="disabled || candidate.id === selectedId" @click="emit('select', candidate.id)">选定</el-button>
            <el-button v-if="candidate.status === 'unknown' || candidate.status === 'running' || candidate.status === 'submitting'" size="small" text :disabled="disabled" @click="emit('query', candidate.id)">复查</el-button>
            <el-button v-if="candidate.status === 'unknown' || candidate.status === 'queued'" size="small" text type="danger" :disabled="disabled" @click="emit('abandon', candidate.id)">放弃此尝试</el-button>
          </div>
        </div>
        <p v-if="candidate.error" class="candidateError">{{ candidate.error }}</p>
        <details>
          <summary>提交参数</summary>
          <p v-if="candidate.taskId">任务 ID {{ candidate.taskId }}</p>
          <p>{{ candidate.snapshot.imageModel.providerId }} / {{ candidate.snapshot.imageModel.modelId }} · {{ candidate.snapshot.imageModel.ratio ?? "默认比例" }} · {{ candidate.snapshot.imageModel.size ?? "默认分辨率" }}</p>
          <p>{{ candidate.snapshot.prompt }}</p>
          <ul v-if="candidate.snapshot.references.length">
            <li v-for="reference in candidate.snapshot.references" :key="reference.id">{{ reference.path }}</li>
          </ul>
        </details>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { ElButton, ElTag } from "element-plus";
import type { ImageWorkbenchCandidate, ImageWorkbenchCandidateStatus } from "../imageWorkbench";

defineProps<{ candidates: readonly ImageWorkbenchCandidate[]; selectedId?: string; disabled: boolean; canPreview?: boolean }>();
const emit = defineEmits<{ select: [id: string]; query: [id: string]; abandon: [id: string]; preview: [id: string] }>();
const statuses: Record<ImageWorkbenchCandidateStatus, string> = {
  queued: "待派发", submitting: "提交中", running: "运行中", succeeded: "已完成", failed: "已失败", cancelled: "已放弃", unknown: "结果待确认",
};
</script>

<style scoped lang="scss">
.candidateHistory {
  overflow-wrap: anywhere;
  > p { color: var(--el-text-color-secondary); margin: 4px 0; }
  ol { list-style: none; margin: 0; padding: 0; }
  ol > li { padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
  .candidateRow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .candidateActions { display: flex; flex-wrap: wrap; margin-inline-start: auto; }
  .candidateActions :deep(.el-button + .el-button) { margin-left: 0; }
  .candidateError { color: var(--el-color-danger); }
  details { color: var(--el-text-color-secondary); white-space: pre-wrap; }
  summary { cursor: pointer; }
  p { margin: 4px 0; }
}
</style>
