<template>
  <nodeSkeleton v-bind="nodeProps">
    <div class="recoveryPanel nodrag nopan nowheel" @pointerdown.stop @dblclick.stop>
      <el-select v-model="selection" placeholder="选择要取回的生成任务" aria-label="选择要取回的生成任务"
        :disabled="busy || !choices.length" @change="message = ''">
        <el-option v-for="item in choices" :key="item.task.taskId" :value="item.task.taskId" :label="item.label" />
      </el-select>
      <el-button type="primary" :loading="busy" :disabled="!selected || busy" @click="retrieve">
        重新取回结果
      </el-button>
      <span role="status" aria-live="polite">{{ message || (!choices.length ? '当前画布没有待取回的图片或视频任务' : '') }}</span>
    </div>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { IconDownload } from "@tabler/icons-vue";
import { nodeSkeleton, useNode, useNodeToolsContext } from "@lum/nodes-scaffold/runtime";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";

defineOptions({ inheritAttrs: false, icon: IconDownload, handles: [] });

type SourceTask = {
  taskId: string; nodeId: string; mediaType: "image" | "video"; modelId: string;
  state: string; applied?: boolean; directory: string; canvasPath: string;
  providerData?: { kind?: string };
};
type GenerationStatus = { status: string; error?: string; task?: { taskId: string; state: string } };

const { nodeProps } = useNode({ label: "重新取回结果" });
const flow = useVueFlow();
const persistence = useNodePersistence();
const tools = useNodeToolsContext();
const selection = ref("");
const message = ref("");
const busy = ref(false);
const lifetime = new AbortController();
onScopeDispose(() => lifetime.abort());

const choices = computed(() => flow.getNodes.value.flatMap(source => {
  const task = source.data?.mediaTask as SourceTask | undefined;
  const context = persistence?.();
  if (!task || !context || task.directory !== context.directory || source.id !== task.nodeId
    || !["image", "video"].includes(task.mediaType) || source.type !== `remote-${task.mediaType}GenerationNode`
    || typeof task.taskId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(task.taskId)
    || task.state === "failed" || task.state === "cancelled" || (task.state === "succeeded" && task.applied)) return [];
  const name = source.data.label || (task.mediaType === "image" ? "图片生成" : "视频生成");
  return [{ source, task, label: `${name} · ${task.modelId} · ${task.taskId.slice(-8)}` }];
}));
const selected = computed(() => choices.value.find(item => item.task.taskId === selection.value));
watch(choices, items => {
  if (!busy.value && !items.some(item => item.task.taskId === selection.value)) {
    selection.value = items.length === 1 ? items[0]!.task.taskId : "";
  }
}, { immediate: true });

async function retrieve() {
  const item = selected.value;
  if (!item || busy.value) return;
  busy.value = true;
  message.value = "正在查询原任务…";
  const { source, task } = item;
  const taskId = task.taskId;
  const canvas = persistence?.()?.canvasPath;
  const context = tools();
  const signal = lifetime.signal;
  const name = task.mediaType === "image" ? "node:generateImage" : "node:generateVideo";
  const status = () => context.call({ nodeId: source.id, name: "node:getGenerationStatus", args: {} }, signal) as Promise<GenerationStatus>;
  function checkSource() {
    signal.throwIfAborted();
    if (!canvas || persistence?.()?.canvasPath !== canvas || persistence?.()?.directory !== task.directory
      || flow.findNode(source.id) !== source || source.data.mediaTask?.taskId !== taskId) {
      throw Error("画布或原任务已更换，请重新选择。");
    }
  }
  try {
    checkSource();
    const method = [...context.list([source.id], [name])][0];
    const params = method?.parameters.properties;
    if (!params || typeof params !== "object" || !Object.hasOwn(params, "expectedTaskId")) {
      throw Error("请先在插件市场更新原图片或视频生成节点，再取回结果。");
    }
    const before = await status();
    checkSource();
    if (before.task?.taskId !== taskId) throw Error("原节点的任务已更换，请重新选择。");
    if (task.applied && task.state !== "succeeded") throw Error("原节点的输出已被替换，无法将该任务的结果写回。");
    if (task.providerData?.kind === "review" || task.providerData?.kind === "submitting") {
      throw Error("当前记录处于素材审核或提交阶段，请先到供应商平台核对生成任务。");
    }
    // 原节点校验 expectedTaskId，并负责局部重绘、片段重拍和画布持久化。
    if (before.status !== "running" && !(task.state === "succeeded" && task.applied)) {
      await context.call({ nodeId: source.id, name, args: { expectedTaskId: taskId } }, signal);
    }
    while (true) {
      checkSource();
      const current = await status();
      checkSource();
      if (current.task?.taskId !== taskId) throw Error("原节点的任务已更换，请重新选择。");
      if (current.status === "running") {
        await new Promise(resolve => setTimeout(resolve, 750));
        continue;
      }
      if (current.status === "failed") throw Error(current.error || "取回失败，请检查网络后再试。");
      if (current.task.state !== "succeeded" || !source.data.mediaTask?.applied) {
        throw Error("原节点尚未保存结果，请查看原任务状态。");
      }
      message.value = `已取回，结果在「${source.data.label || (task.mediaType === "image" ? "图片生成" : "视频生成")}」中。`;
      return;
    }
  } catch (error) {
    if (!signal.aborted) message.value = error instanceof Error ? error.message : "取回原任务失败，请再试一次。";
  } finally {
    busy.value = false;
    if (!selected.value) selection.value = choices.value.length === 1 ? choices.value[0]!.task.taskId : "";
  }
}
</script>

<style scoped>
.recoveryPanel { display: grid; gap: 10px; padding: 14px; width: 308px; box-sizing: border-box; }
.recoveryPanel :deep(.el-select) { width: 100%; }
.recoveryPanel span[role="status"] { font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; white-space: pre-line; }
.recoveryPanel span[role="status"]:empty { display: none; }
</style>
