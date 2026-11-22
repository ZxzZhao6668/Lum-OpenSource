<template>
  <el-dialog v-model="visible" title="FFmpeg" width="min(680px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
    <el-alert class="installationHint" title="安装完成后，请重新发起刚才的操作。" type="info" :closable="false" showIcon />
    <ffmpeg v-if="visible" :downloadOnOpen="true" />
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { actualPlatform } from "@/lib/platform";
import ffmpeg from "./panels/pluginMarket/ffmpeg.vue";
import http from "@/lib/http";

const visible = ref(false);
let pending = false;
let disposed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let request: AbortController | undefined;
let cursor: { epoch: string; revision: number } | undefined;
let retryDelay = 3000;

async function notifyRequired() {
  if (disposed || pending || visible.value) return;
  if (actualPlatform.isLocalMobile) {
    ElMessage.warning("未检测到可用的 FFmpeg，无法继续这项音视频处理。当前移动端版本暂不支持在应用内安装 FFmpeg。");
    return;
  }
  pending = true;
  try {
    await ElMessageBox.confirm("这项音视频处理需要 FFmpeg，但尚未检测到可用版本。现在下载并安装吗？", "需要 FFmpeg", {
      confirmButtonText: "下载并安装", cancelButtonText: "暂不下载", closeOnClickModal: false,
    });
    if (!disposed) visible.value = true;
  } catch {
    // 用户取消后保留当前操作的失败结果，不自动重新生成媒体。
  } finally {
    pending = false;
  }
}

async function poll() {
  if (disposed || document.visibilityState === "hidden" || request) return;
  const controller = new AbortController();
  request = controller;
  try {
    const next = await http<{ epoch: string; revision: number }>({
      method: "GET", url: "/api/ffmpeg/events", params: { snapshot: true }, signal: controller.signal, timeout: 10000,
    });
    if (controller.signal.aborted) return;
    if (typeof next.epoch !== "string" || !Number.isSafeInteger(next.revision) || next.revision < 0) throw new Error("FFmpeg 通知快照无效");
    // A new subscription/server epoch establishes a baseline, never replays an old install prompt.
    const changed = cursor?.epoch === next.epoch && next.revision > cursor.revision;
    cursor = next;
    retryDelay = 3000;
    if (changed) void notifyRequired();
  } catch {
    if (!controller.signal.aborted) retryDelay = Math.min(retryDelay * 2, 30000);
  } finally {
    if (request === controller) request = undefined;
    if (!disposed && !controller.signal.aborted && !document.hidden) timer = setTimeout(() => void poll(), retryDelay);
  }
}
function syncVisibility() {
  clearTimeout(timer);
  if (document.visibilityState === "hidden") {
    request?.abort();
    request = undefined;
  } else void poll();
}
document.addEventListener("visibilitychange", syncVisibility);
void poll();
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
  request?.abort();
  document.removeEventListener("visibilitychange", syncVisibility);
});
</script>

<style scoped>
.installationHint { margin-bottom: 12px; }
</style>
