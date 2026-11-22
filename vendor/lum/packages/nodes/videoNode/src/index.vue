<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="exporting ? '' : previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    :fullscreenVisible="!enhancementAttempt"
    :style="{ width: previewUrl && videoWidth && !enhancementAttempt ? `${videoWidth + 18}px` : undefined }"
    @fullscreen="player?.enterFullscreen()">
    <template #topActions>
      <videoEnhancementEntry :node="node" :file="outputFile" :disabled="uploading || exporting || actions?.processing || !!enhancementAttempt && !enhancementReady" />
      <el-button :icon="IconMusic" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="actions?.open('extractAudio')">提取音轨</el-button>
      <el-button :icon="IconLayersSubtract" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="actions?.open('separate')">分离音视频</el-button>
      <el-button :icon="IconScissors" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="actions?.open('trim')">截取片段</el-button>
      <el-button :icon="IconMovie" text :loading="retake?.loading" :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="retake?.open()">片段重拍</el-button>
      <el-button :icon="IconPlayerTrackNext" text :loading="continuation?.processing" :disabled="!outputFile || uploading || exporting || actions?.processing || !!enhancementAttempt" @click.stop="continuation?.open()">视频续写</el-button>
      <el-button :icon="IconMovie" text :loading="actions?.creatingAnalysis" :disabled="!outputFile || uploading || exporting || actions?.processing || actions?.creatingAnalysis" @click.stop="actions?.createFrameAnalysis()">逐帧拉片</el-button>
      <el-button
        v-if="!enhancementAttempt"
        :icon="IconTransfer"
        :loading="uploading"
        :disabled="exporting"
        text
        title="替换视频"
        aria-label="替换视频"
        @click.stop="fileInput?.click()">替换视频</el-button>
    </template>
    <template #topRightActions>
      <el-dropdown v-if="!enhancementAttempt" trigger="click" placement="bottom-end" :disabled="!player?.ready || player?.capturing || uploading || exporting" @command="player?.captureFrame($event)">
        <el-button :icon="IconPhotoScan" :loading="player?.capturing" :disabled="!player?.ready || player?.capturing || uploading || exporting" text title="截取视频帧" aria-label="截取视频帧" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="current" :icon="IconPhotoScan">截取当前帧</el-dropdown-item>
            <el-dropdown-item command="first" :icon="IconPlayerSkipBack">截取首帧</el-dropdown-item>
            <el-dropdown-item command="last" :icon="IconPlayerSkipForward">截取尾帧</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
    <div class="videoContent nopan">
      <div v-if="exporting" class="exportLoading" role="status" aria-label="视频导出中">
        <el-progress type="circle" :percentage="exportProgress" :width="64" :strokeWidth="3" />
        <span>正在导出视频</span>
      </div>
      <videoPlayer
        v-else-if="previewUrl && !enhancementAttempt"
        ref="player"
        :src="previewUrl"
        @loadedmetadata="resizeVideo" />
      <input v-if="!enhancementAttempt" ref="fileInput" class="fileInput" type="file" accept="video/*" aria-label="选择视频" :disabled="uploading || exporting" @change="uploadVideo" />
      <el-button
        v-if="!enhancementAttempt && !exporting && !outputs.video"
        class="nodrag nopan"
        :icon="IconUpload"
        text
        :loading="uploading"
        title="上传视频"
        aria-label="上传视频"
        @dblclick.stop
        @click.stop="fileInput?.click()">上传</el-button>
      <div v-if="enhancementAttempt" class="enhancementCard nodrag nopan" @pointerdown.stop @keydown.stop>
        <p>{{ enhancementAttempt.modelLabel }} · {{ sizeKey(enhancementAttempt.request.enhancement.options) }}</p>
        <p role="status">{{ !enhancementOwned && !enhancementReady ? '此节点不拥有原超分任务' : enhancementStatus(node) }}</p>
        <p v-if="enhancementMessage" class="enhancementError" role="status">{{ enhancementMessage }}</p>
        <progress v-if="enhancementView.progress?.percent !== undefined && enhancementSnapshot?.state === 'running'" :value="enhancementView.progress.percent" max="100" aria-label="供应商超分进度" />
        <div v-if="enhancementReady" class="enhancementButtons">
          <el-button v-if="!previewUrl" size="small" :loading="previewLoading" @click="openEnhancementPreview">预览结果</el-button>
          <el-button v-else size="small" @click="closeEnhancementPreview">关闭预览</el-button>
          <el-button size="small" text @click="revealEnhancementResult">打开所在文件夹查看</el-button>
        </div>
        <video v-if="previewUrl" :key="previewUrl" :src="previewUrl" controls preload="metadata" playsinline aria-label="已保存的超分视频" @error="decodeError = '当前浏览器不能播放该视频，可在本地播放器查看。'" />
        <div v-if="enhancementOwned && !enhancementReady" class="enhancementButtons">
          <el-button size="small" :disabled="!getCanvasActive() || enhancementView.busy || enhancementView.saving" @click="runEnhancementAction('read')">查询原任务</el-button>
          <el-button v-if="enhancementSnapshot?.state === 'interrupted' && enhancementSnapshot.resumable" size="small" :disabled="!getCanvasActive() || enhancementView.busy" @click="runEnhancementAction('resume')">恢复原任务</el-button>
          <el-button v-if="!['failed', 'succeeded', 'cancelled'].includes(enhancementSnapshot?.state ?? '')" size="small" text :disabled="!getCanvasActive() || enhancementView.busy" @click="runEnhancementAction('abandon')">放弃任务</el-button>
        </div>
      </div>
    </div>
  </nodeSkeleton>
  <videoActions ref="actions" :file="outputFile" :src="previewUrl" :disabled="uploading || exporting" />
  <videoRetakeEntry ref="retake" :node="node" :file="outputFile" :disabled="uploading || exporting || actions?.processing" />
  <videoContinuation ref="continuation" :file="outputFile" :disabled="uploading || exporting || !!enhancementAttempt" />
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, toRaw, watch } from "vue";
import { useVueFlow, type Edge } from "@vue-flow/core";
import { IconVideo, IconUpload, IconTransfer, IconMusic, IconLayersSubtract, IconScissors, IconMovie, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward, IconPlayerTrackNext } from "@tabler/icons-vue";
import { ElButton, ElMessage, ElMessageBox, ElProgress, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@lum/nodes-scaffold/runtime";
import videoPlayer from "./components/videoPlayer.vue";
import videoActions from "./components/videoActions.vue";
import videoRetakeEntry from "./components/videoRetakeEntry.vue";
import videoContinuation from "./components/videoContinuation.vue";
import { getMediaMimeType } from "@lum/node-shared/mediaTypes";
import videoEnhancementEntry from "@lum/node-shared/videoEnhancementEntry";
import { useVideoEnhancementChild } from "@lum/node-shared/useVideoEnhancement";
import { useEnhancementPreview } from "@lum/node-shared/useEnhancementPreview";
import { enhancementStatus, sizeKey, type VideoEnhancementData } from "@lum/node-shared/videoEnhancement";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";

defineOptions({
  inheritAttrs: false,
  icon: IconVideo,
  handles: [
    { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" },
    { id: "derivedFrom", type: "target", dataType: "VIDEO", label: "来源视频（重拍、超分、续写，仅记录关系）" },
  ] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, nodeEvent, files, updateNodeInternals } = useNode({
  label: "视频",
});
// 重拍、超分、续写原来各占一个来源端口，现在合并成一个。旧画布里连在旧端口上的线改接到新端口，
// 否则端口不存在，线画不出来，节点改名时还会被当作无效连线清掉。
const relationFlow = useVueFlow();
const legacySourceHandles = ["retakeSource", "enhancementSource", "continuationSource"];
const edgeRuntimeFields = new Set(["selected", "sourceNode", "targetNode", "sourceX", "sourceY", "targetX", "targetY", "events", "initialized"]);
watch(() => relationFlow.getEdges.value.filter(edge => edge.target === node.id && legacySourceHandles.includes(edge.targetHandle ?? "")), legacy => {
  if (!legacy.length) return;
  const moved = legacy.map(edge => ({
    ...Object.fromEntries(Object.entries(toRaw(edge)).filter(([key, value]) => !edgeRuntimeFields.has(key) && typeof value !== "function")),
    targetHandle: "derivedFrom",
  }) as Edge);
  relationFlow.removeEdges(legacy.map(edge => edge.id));
  relationFlow.addEdges(moved);
}, { immediate: true });
const fileInput = ref<HTMLInputElement>();
const uploading = ref(false);
const player = ref<InstanceType<typeof videoPlayer>>();
const actions = ref<InstanceType<typeof videoActions>>();
const retake = ref<InstanceType<typeof videoRetakeEntry>>();
const continuation = ref<InstanceType<typeof videoContinuation>>();
const exportProgress = computed(() => (node.data as typeof node.data & { exportProgress?: number }).exportProgress);
const exporting = computed(() => typeof exportProgress.value === "number");
const videoWidth = ref(0);

const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const enhancementData = computed(() => node.data as VideoEnhancementData);
const enhancementSnapshot = computed(() => enhancementData.value.videoEnhancementSnapshot);
const { attempt: enhancementAttempt, ready: enhancementReady, owned: enhancementOwned, view: enhancementView, action: enhancementAction } = useVideoEnhancementChild(node, output => {
  outputs.value.video = output ? { dataType: "VIDEO", value: output } : undefined;
});
const regularPreview = files.useFileUrl(
  () => enhancementAttempt.value ? undefined : outputFile.value,
  (error) => showError(error, "视频读取失败")
);
const getCanvasActive = inject("nodeCanvasActive", () => true);
const getPersistence = useNodePersistence();
const enhancementPreviewFile = computed(() => {
  const result = enhancementData.value.videoEnhancementResult;
  return enhancementReady.value && result ? { path: result.path, mimeType: result.mimeType } : undefined;
});
const { url: enhancementUrl, open: openEnhancementPreview, clear: closeEnhancementPreview, reveal: revealEnhancementResult,
  loading: previewLoading, error: previewError } = useEnhancementPreview(enhancementPreviewFile, files.getWorkspaceFiles);
const previewUrl = computed(() => enhancementAttempt.value ? enhancementUrl.value : regularPreview.value);
const decodeError = ref("");
const enhancementMessage = computed(() => previewError.value || decodeError.value || enhancementView.error
  || enhancementSnapshot.value?.result?.message || enhancementData.value.videoEnhancementIssue);
watch([getCanvasActive, () => getPersistence?.()?.directory, () => getPersistence?.()?.canvasPath, enhancementUrl], ([active, directory, canvasPath], previous) => {
  decodeError.value = "";
  if (!active || directory !== previous[1] || canvasPath !== previous[2]) closeEnhancementPreview();
}, { flush: "sync" });

async function runEnhancementAction(action: "read" | "resume" | "abandon") {
  if (!getCanvasActive()) return;
  try {
    if (action === "abandon") {
      const context = getPersistence?.(), attempt = enhancementAttempt.value;
      await ElMessageBox.confirm("放弃后停止本地追踪并释放该任务占用的本地并发名额。供应商的处理可能继续，也不会自动退还额度。", "放弃原超分任务？", { confirmButtonText: "放弃任务", cancelButtonText: "返回" });
      const current = getPersistence?.();
      if (!getCanvasActive() || context?.directory !== current?.directory || context?.canvasPath !== current?.canvasPath || attempt !== enhancementAttempt.value) return;
    }
    await enhancementAction(action, () => {
      if (!getCanvasActive()) throw Error("画布已关闭，未发出任务操作");
    });
  } catch (error) { if (error !== "cancel" && error !== "close") showError(error, "超分任务操作失败"); }
}

nodeEvent.on("save", (reason) => {
  if (uploading.value) throw new Error("视频处理中，请完成后再切换或刷新节点");
  if (reason === "reload" && exporting.value) throw new Error("视频正在导出，请完成后再刷新节点");
});
nodeEvent.on("delete", () => {
  if (enhancementAttempt.value) return;
  if (uploading.value) throw new Error("视频上传中，请稍后删除节点");
  uploading.value = true;
  return files.removeNodeFiles().finally(() => {
    uploading.value = false;
  });
});

nodeTools.register({
  name: "setVideo",
  description: "选择工作区内已有的视频文件作为此节点的输出，path 使用工作区相对路径",
  parameters: z.strictObject({
    path: z.string().min(1).max(4096),
    mimeType: z.string().regex(/^video\/[a-zA-Z0-9.+-]+$/),
  }),
  async execute({ path, mimeType }, { signal }) {
    signal?.throwIfAborted();
    if (enhancementAttempt.value) throw new Error("超分结果节点保留绑定的原任务输出");
    if (uploading.value || exporting.value) throw new Error("视频处理中，请稍后重试");
    uploading.value = true;
    try {
      const content = await files.getWorkspaceFiles().read(path);
      signal?.throwIfAborted();
      if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("视频不能为空且不能超过 100 MB");
      outputs.value.video = { dataType: "VIDEO", value: { url: path, mimeType } };
      return outputs.value.video;
    } finally {
      uploading.value = false;
    }
  },
});

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoWidth.value = Math.max(180, (240 * video.videoWidth) / video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

async function uploadVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || uploading.value || exporting.value || enhancementAttempt.value) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("video/")) return void ElMessage.error("请选择视频文件");
  if (!file.size || file.size > 100 * 1024 * 1024) return void ElMessage.error("视频不能为空且不能超过 100 MB");
  uploading.value = true;
  try {
    const url = await files.uploadFile(file);
    // ACT: 复制节点可能仍引用旧视频，替换输出不删除共享文件。
    outputs.value.video = { dataType: "VIDEO", value: { url, mimeType } };
  } catch (error) {
    showError(error, "视频替换失败");
  } finally {
    uploading.value = false;
  }
}

function showError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  ElMessage.error(message || (error instanceof Error ? error.message : fallback));
}
</script>

<style scoped lang="scss">
.videoContent {
  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    --nodeMediaHeight: 100%;

    .exportLoading { max-height: 100%; box-sizing: border-box; overflow: auto; }
  }

  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .exportLoading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    color: var(--el-text-color-secondary);
  }

  .fileInput {
    display: none;
  }

  .enhancementCard {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    display: grid;
    gap: 8px;
    padding: 10px;
    overflow-wrap: anywhere;
    p { margin: 0; }
    video { width: 100%; max-height: 240px; background: #000; }
    progress { width: 100%; accent-color: var(--el-color-primary); }
    .enhancementButtons { display: flex; gap: 4px; flex-wrap: wrap; }
    .enhancementButtons .el-button { margin-left: 0; }
    .enhancementError { color: var(--el-color-danger); }
  }
}
</style>
