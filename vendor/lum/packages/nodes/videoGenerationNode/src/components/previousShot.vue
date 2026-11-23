<template>
  <el-dialog v-model="visible" title="承接上一镜" width="520px" appendToBody destroyOnClose>
    <div class="previousShotPanel nodrag nopan nowheel" @pointerdown.stop @keydown.stop>
      <label>上一镜视频
        <select v-model="sourceKey" :disabled="busy">
          <option v-if="!sources.length" value="">画布中暂无可用的上一镜</option>
          <option v-for="item in sources" :key="item.key" :value="item.key">{{ item.connected ? '已连入 · ' : '' }}{{ item.label }}</option>
        </select>
      </label>
      <p v-if="!sources.length">先在画布上导入或生成一段视频，再选择它作为上一镜。</p>
      <template v-if="source">
        <label>衔接方式
          <select v-model="method" :disabled="busy">
            <option value="video" :disabled="!!model && !videoSupported">参考末段动作</option>
            <option value="frame" :disabled="!!model && !frameSupported">尾帧接首帧</option>
          </select>
        </label>
        <p v-if="model && !videoSupported">当前模型没有视频参考模式。尾帧可以传递构图和姿势。</p>
        <p v-if="model && !frameSupported && !videoSupported">请先在节点中选择支持视频参考或首帧输入的模型。</p>
        <p v-if="probeError" role="alert">{{ probeError }}</p>
        <p v-else-if="!info" role="status">正在读取视频时长…</p>
        <template v-else>
          <template v-if="method === 'video'">
            <label class="rangeField">
              <span>参考末尾几秒 <strong>{{ secondsText(seconds) }} 秒</strong></span>
              <input v-model.number="sliderSeconds" type="range" :min="minSeconds" :max="maxSeconds" step="0.1" :disabled="busy"
                :aria-valuetext="`末尾 ${secondsText(seconds)} 秒`" />
            </label>
            <p>原片选区 {{ secondsText(info.duration - seconds) }} – {{ secondsText(info.duration) }} 秒</p>
            <label v-if="mixedSupported" class="check"><input v-model="includeFrame" type="checkbox" :disabled="busy" />同时提供最后一帧作为参考图</label>
          </template>
          <label v-else>衔接帧
            <select v-model.number="backFrames" :disabled="busy">
              <option :value="0">最后一帧</option>
              <option v-for="n in [2, 4, 8]" :key="n" :value="n" :disabled="info.duration <= n * info.frameDuration">往前 {{ n }} 帧</option>
            </select>
          </label>
          <video v-if="sourceUrl" ref="player" :src="sourceUrl" muted playsinline preload="auto" @loadedmetadata="seekPreview" />
          <el-button v-if="sourceUrl && method === 'video'" text @click="playSelection">播放所选末段</el-button>
          <label class="check"><input v-model="matchRatio" type="checkbox" :disabled="busy" />使用接近上一镜的画面比例（{{ nearestVideoRatio(info.width, info.height) }}）</label>
          <p v-if="link && !link.previousShot">应用后会替换本镜原有的续写引用。</p>
        </template>
      </template>
      <p v-if="busy" role="status">{{ method === 'video' ? '正在截取所选末段…' : '正在提取衔接帧…' }}</p>
    </div>
    <template #footer>
      <el-button v-if="link?.previousShot" :disabled="busy || disabled" @click="detach">解除承接</el-button>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="busy" :disabled="disabled || !info || !supported" @click="apply">用于本镜</el-button>
    </template>
  </el-dialog>
  <el-dialog v-model="seamVisible" title="接缝预览" width="560px" appendToBody destroyOnClose>
    <p v-if="!seamUrl" role="status">正在拼接接缝前后各约一秒的画面…</p>
    <video v-else class="seamPlayer" :src="seamUrl" autoplay loop muted controls playsinline />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDialog, ElMessage } from "element-plus";
import { useNodeFfmpeg, useNodeFiles, type NodeMediaModel, type NodeMediaValue, type WorkspaceFiles } from "@lum/nodes-scaffold/runtime";
import { concatVideoClips, extractVideoTailClip, extractVideoTailFrame, nearestVideoRatio, readVideoClip, type VideoClipInfo, type VideoContinuationLink } from "@lum/node-video/videoContinuationPlan";
import { probeMedia } from "@lum/node-video/videoProcessing";
import { showNodeError } from "@lum/node-shared/showNodeError";

const props = defineProps<{ link?: VideoContinuationLink; model?: NodeMediaModel; disabled: boolean; output?: NodeMediaValue }>();
const emit = defineEmits<{ apply: [link: VideoContinuationLink | undefined, ratio?: string] }>();
const { node } = useNode();
const flow = useVueFlow();
const files = useNodeFiles();
const loadFfmpeg = useNodeFfmpeg();
const visible = ref(false);
const seamVisible = ref(false);
const busy = ref(false);
const sourceKey = ref("");
const method = ref<"frame" | "video">("video");
const sliderSeconds = ref(2);
const backFrames = ref(0);
const includeFrame = ref(false);
const matchRatio = ref(true);
const info = shallowRef<VideoClipInfo>();
const probeError = ref("");
const player = ref<HTMLVideoElement>();
const seamUrl = ref("");
const videoSupported = computed(() => props.model?.mode?.some(mode => Array.isArray(mode) && mode.some(item => /^videoReference:[1-9]/.test(item))));
const frameSupported = computed(() => props.model?.mode?.some(mode => ["singleImage", "startFrameOptional", "endFrameOptional", "startEndRequired"].includes(String(mode))));
const mixedSupported = computed(() => props.model?.mode?.some(mode => Array.isArray(mode)
  && mode.some(item => /^videoReference:[1-9]/.test(item)) && mode.some(item => /^imageReference:[1-9]/.test(item))));
const supported = computed(() => !props.model || (method.value === "video" ? videoSupported.value : frameSupported.value));

const sources = computed(() => {
  if (!visible.value) return [];
  const blocked = new Set([node.id]);
  // 排除本镜的下游及用本镜续写出来的节点，以免拼接链回到自身。
  const children = new Map<string, string[]>();
  const add = (from: string, to: string) => { const items = children.get(from) ?? []; items.push(to); children.set(from, items); };
  for (const edge of flow.getEdges.value) add(edge.source, edge.target);
  for (const other of flow.getNodes.value) if (other.data.continuation?.sourceNodeId) add(other.data.continuation.sourceNodeId, other.id);
  for (const id of blocked) for (const child of children.get(id) ?? []) blocked.add(child);
  const connected = new Set(flow.getEdges.value.filter(edge => edge.target === node.id).map(edge => JSON.stringify([edge.source, edge.sourceHandle])));
  return flow.getNodes.value.filter(other => !blocked.has(other.id)).flatMap(other =>
    Object.entries(other.data.outputs ?? {}).flatMap(([handle, raw]) => {
      const port = raw as {dataType?: string; value?: NodeMediaValue};
      if (port?.dataType !== "VIDEO" || !port.value?.url) return [];
      const key = JSON.stringify([other.id, handle]);
      return [{ key, id: other.id, handle, file: port.value, label: String(other.data.label || "视频") + " · " + other.id.slice(0, 6), connected: connected.has(key) }];
    })).sort((left, right) => Number(right.connected) - Number(left.connected));
});
const source = computed(() => sources.value.find(item => item.key === sourceKey.value));
const sourceUrl = files.useFileUrl(() => source.value?.file, error => showNodeError(error, "上一镜预览失败"));
const maxSeconds = computed(() => Math.ceil((info.value?.duration ?? 2) * 10) / 10);
const minSeconds = computed(() => Math.min(maxSeconds.value, Math.max(0.1, Math.ceil((info.value?.frameDuration ?? 0.1) * 10) / 10)));
const seconds = computed(() => Math.min(info.value?.duration ?? 0, sliderSeconds.value));
const secondsText = (value: number) => Number(value.toFixed(3)).toString();
let applyController: AbortController | undefined;
let seamController: AbortController | undefined;
function open() {
  if (props.disabled || busy.value) return;
  visible.value = true;
  const link = props.link;
  sourceKey.value = sources.value.find(item => item.id === link?.sourceNodeId && item.handle === link.sourceHandleId)?.key ?? sources.value[0]?.key ?? "";
  method.value = link?.previousShot ? link.method : videoSupported.value || !props.model ? "video" : "frame";
  backFrames.value = link?.backFrames ?? 0;
  matchRatio.value = !link?.previousShot;
  includeFrame.value = link?.previousShot && link.method === "video" ? !!link.tailFramePath : !!mixedSupported.value;
  sliderSeconds.value = link?.previousShot && link.method === "video" ? Math.ceil((link.previousShot.end - link.previousShot.start) * 10 - 1e-7) / 10 : 2;
}
watch([sourceKey, () => source.value?.file.url], async ([, path], _, onCleanup) => {
  info.value = undefined;
  probeError.value = "";
  if (!path || !visible.value) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  try {
    const ffmpeg = await loadFfmpeg(controller.signal);
    const clip = readVideoClip(await probeMedia(ffmpeg, path, controller.signal));
    controller.signal.throwIfAborted();
    info.value = clip;
    sliderSeconds.value = Math.min(maxSeconds.value, Math.max(minSeconds.value, sliderSeconds.value));
    if (clip.duration <= backFrames.value * clip.frameDuration) backFrames.value = 0;
  } catch (error) { if (!controller.signal.aborted) probeError.value = error instanceof Error ? error.message : "原片读取失败"; }
});
function seekPreview() {
  if (!player.value || !info.value) return;
  player.value.pause();
  player.value.currentTime = Math.max(0, info.value.duration - (method.value === "video" ? seconds.value : (backFrames.value + 0.5) * info.value.frameDuration));
}
watch([seconds, backFrames, method, info], seekPreview, { flush: "post" });
function playSelection() { seekPreview(); player.value?.play().catch(error => showNodeError(error, "无法播放所选末段")); }
async function makeDirectory(workspace: WorkspaceFiles, path: string) {
  await workspace.mkdir(path).catch(error => { if (error?.response?.data?.data?.code !== "EEXIST") throw error; });
}
async function createAssetDirectory(workspace: WorkspaceFiles) {
  if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw Error("无效的节点 ID");
  await makeDirectory(workspace, "assets");
  const directory = `assets/${node.id}`;
  await makeDirectory(workspace, directory);
  return directory;
}
function detach() { emit("apply", undefined); visible.value = false; }
async function apply() {
  const item = source.value, clip = info.value, selectedMethod = method.value, length = seconds.value;
  if (!item || !clip || !supported.value || props.disabled || busy.value) return;
  const controller = applyController = new AbortController();
  const sourcePath = item.file.url;
  busy.value = true;
  let workspace: WorkspaceFiles | undefined, path = "", framePath = "";
  try {
    workspace = files.getWorkspaceFiles();
    const directory = await createAssetDirectory(workspace);
    const ffmpeg = await loadFfmpeg(controller.signal);
    path = `${directory}/previousShot-${crypto.randomUUID()}.${selectedMethod === "frame" ? "png" : "mp4"}`;
    const link: VideoContinuationLink = {
      version: 1, method: selectedMethod, sourceNodeId: item.id, sourceHandleId: item.handle, sourceLabel: item.label, sourcePath,
      autoCompose: props.link?.autoCompose ?? false, dropFirstFrame: false, backFrames: 0,
    };
    if (selectedMethod === "video") {
      const range = await extractVideoTailClip(ffmpeg, sourcePath, path, clip, length, controller.signal);
      link.previousShot = {referencePath: path, start: range.start, end: range.end, frameDuration: clip.frameDuration};
      if (includeFrame.value && mixedSupported.value) {
        framePath = path.slice(0, -4) + ".png";
        const tail = await extractVideoTailFrame(ffmpeg, sourcePath, framePath, {signal: controller.signal});
        link.tailFramePath = tail.path;
      }
    } else {
      const tail = await extractVideoTailFrame(ffmpeg, sourcePath, path, {backFrames: backFrames.value, signal: controller.signal});
      Object.assign(link, {tailFrameNodeId: item.id, tailFramePath: path, tailPts: tail.pts, tailTime: tail.time, backFrames: tail.backFrames});
      link.previousShot = {referencePath: path, start: tail.time, end: Math.min(clip.duration, tail.time + clip.frameDuration), frameDuration: clip.frameDuration};
    }
    controller.signal.throwIfAborted();
    if (props.disabled || source.value?.key !== item.key || source.value?.file.url !== sourcePath || !supported.value || flow.findNode(node.id) !== node) throw Error("原片或节点设置已变化，请重新选择");
    emit("apply", link, matchRatio.value ? nearestVideoRatio(clip.width, clip.height) : undefined);
    path = "";
    framePath = "";
    visible.value = false;
    ElMessage.success("已将衔接素材用于本镜");
  } catch (error) { if (!controller.signal.aborted) showNodeError(error, "准备衔接素材失败"); }
  finally {
    if (path) await workspace?.remove(path).catch(() => {});
    if (framePath) await workspace?.remove(framePath).catch(() => {});
    busy.value = false;
    applyController = undefined;
  }
}

async function previewSeam() {
  const link = props.link, shot = link?.previousShot, output = props.output?.url;
  if (!shot || !link || !output || shot.resultPath !== output || seamVisible.value) return;
  seamVisible.value = true;
  const controller = seamController = new AbortController();
  let workspace: WorkspaceFiles | undefined, path = "";
  try {
    workspace = files.getWorkspaceFiles();
    const directory = await createAssetDirectory(workspace);
    const ffmpeg = await loadFfmpeg(controller.signal);
    const next = readVideoClip(await probeMedia(ffmpeg, output, controller.signal));
    const end = Math.min(next.duration, 1 + (link.dropFirstFrame ? next.frameDuration : 0));
    path = `${directory}/seam-${crypto.randomUUID()}.mp4`;
    await concatVideoClips(ffmpeg, [
      { path: link.sourcePath, startTime: Math.max(0, shot.end - 1), endPts: link.method === "frame" ? link.tailPts : undefined },
      { path: output, dropFirstFrame: link.dropFirstFrame, endTime: end },
    ], path, controller.signal);
    const bytes = await workspace.read(path);
    controller.signal.throwIfAborted();
    seamUrl.value = URL.createObjectURL(new Blob([bytes], {type: "video/mp4"}));
  } catch (error) {
    if (!controller.signal.aborted) { seamVisible.value = false; showNodeError(error, "接缝预览失败"); }
  } finally { if (path) await workspace?.remove(path).catch(() => {}); }
}
function closeSeam() {
  seamController?.abort();
  if (seamUrl.value) URL.revokeObjectURL(seamUrl.value);
  seamUrl.value = "";
}
watch(visible, open => { if (!open) applyController?.abort(); }, { flush: "sync" });
watch(seamVisible, open => { if (!open) closeSeam(); }, { flush: "sync" });
watch(() => props.disabled, disabled => { if (disabled) { visible.value = false; seamVisible.value = false; } });
onScopeDispose(() => { applyController?.abort(); closeSeam(); });
defineExpose({ open, previewSeam, busy });
</script>

<style scoped lang="scss">
.previousShotPanel {
  display: grid; gap: 12px;
  label { display: grid; gap: 6px; }
  .check { display: flex; align-items: center; }
  select { min-height: 32px; border-radius: 4px; border: 1px solid var(--el-border-color); padding: 4px 8px; color: inherit; background: var(--el-bg-color); }
  p { margin: 0; color: var(--el-text-color-secondary); }
  .rangeField span { display: flex; justify-content: space-between; }
  input[type="range"] { width: 100%; margin: 4px 0; accent-color: var(--el-color-primary); }
  video { max-height: 210px; }
}
.previousShotPanel video, .seamPlayer { width: 100%; object-fit: contain; background: #151515; border-radius: 4px; }
</style>
