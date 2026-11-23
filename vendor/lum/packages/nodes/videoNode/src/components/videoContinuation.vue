<template>
  <el-dialog
    v-model="visible"
    title="视频续写"
    width="560px"
    top="10vh"
    appendToBody
    destroyOnClose
    :closeOnClickModal="!creating"
    :closeOnPressEscape="!creating"
    :showClose="!creating"
    :style="{ maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(94vh - 12px)', overflow: 'auto' }">
    <div class="continuationPanel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <p class="sourceLine">对 <b>{{ sourceLabel }}</b><template v-if="info"> 的 00:00–{{ formatTime(info.duration) }} 片段</template>进行续写</p>
      <p class="hint" role="status">{{ probing ? '正在读取原片…' : info ? `${info.width} × ${info.height} · ${frameRate} fps · ${info.audioIndex === undefined ? '无声音' : '有声音'}` : '' }}</p>
      <fieldset :disabled="creating || probing">
        <legend>续写方式</legend>
        <label class="option">
          <input v-model="method" type="radio" value="frame" />
          <span><b>尾帧接首帧</b>（推荐）<br />取原片真正的最后一帧，作为下一段的首帧，画面从同一帧接着往下走。</span>
        </label>
        <label class="option" :class="{ unavailable: !referenceModels.length }">
          <input v-model="method" type="radio" value="video" :disabled="!referenceModels.length" />
          <span><b>参考原视频</b><br />把整段原片交给模型参考，动作和运镜的惯性更连贯；需要模型支持视频参考。</span>
        </label>
        <p v-if="modelHint" class="hint">{{ modelHint }}</p>
        <label v-if="method === 'frame'" class="field">尾帧位置
          <select v-model.number="backFrames" aria-label="尾帧位置">
            <option :value="0">最后一帧</option>
            <option v-for="value in [2, 4, 8]" :key="value" :value="value">往前 {{ value }} 帧</option>
          </select>
          <span class="hint">原片最后几帧发糊或变形时往前取；拼接时会把原片多出来的这几帧裁掉。</span>
        </label>
        <label class="field">续写内容
          <textarea v-model="prompt" rows="4" maxlength="20000" aria-label="续写内容" placeholder="接下来发生什么：动作、运镜、情绪。可以先留空，稍后在续写节点里填写"></textarea>
        </label>
        <label class="check"><input v-model="autoCompose" type="checkbox" />生成完成后自动拼接成片{{ method === 'frame' ? '（去掉重复的首帧）' : '' }}</label>
      </fieldset>
      <div v-if="creating" class="processingStatus" role="status" aria-live="polite">
        <el-progress :percentage="100" :indeterminate="true" :showText="false" />
        <span>{{ status }}</span>
      </div>
      <div class="panelActions">
        <el-button @click="creating ? cancel() : visible = false">{{ creating ? '取消' : '关闭' }}</el-button>
        <el-button type="primary" :loading="creating" :disabled="disabled || probing || !info || !file" @click="startCreate">创建续写节点</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useNode, useVueFlow, type Node } from "@vue-flow/core";
import { ElButton, ElDialog, ElMessage, ElProgress } from "element-plus";
import { nodeTools, useNodeAi, useNodeEvent, useNodeFfmpeg, useNodeFiles, z, type NodeMediaModel, type NodeMediaValue, type WorkspaceFiles } from "@lum/nodes-scaffold/runtime";
import { useNodeToolsContext } from "@lum/nodes-scaffold/nodeTools";
import { showNodeError } from "@lum/node-shared/showNodeError";
import { probeMedia } from "../videoProcessing";
import { concatVideoClips, extractVideoTailFrame, nearestVideoRatio, planVideoContinuation, readVideoClip, type VideoClipInfo, type VideoContinuationLink } from "../videoContinuation";

const props = defineProps<{ file?: NodeMediaValue; disabled?: boolean }>();
const { node } = useNode();
const flow = useVueFlow();
const files = useNodeFiles();
const loadFfmpeg = useNodeFfmpeg();
const ai = useNodeAi();
const nodeEvent = useNodeEvent();
const callTools = useNodeToolsContext();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const generationType = "remote-videoGenerationNode", imageType = "remote-imageNode", videoType = "remote-videoNode";

const visible = ref(false);
const probing = ref(false);
const creating = ref(false);
const composing = ref(false);
const status = ref("");
const method = ref<VideoContinuationLink["method"]>("frame");
const backFrames = ref(0);
const prompt = ref("");
const autoCompose = ref(true);
const info = shallowRef<VideoClipInfo>();
const models = shallowRef<NodeMediaModel[]>([]);
const processing = computed(() => probing.value || creating.value || composing.value);
const link = computed(() => (node.data as { continuation?: VideoContinuationLink }).continuation);
const sourceLabel = computed(() => String(node.data.label || "视频"));
const frameRate = computed(() => info.value ? Number((1 / info.value.frameDuration).toFixed(3)) : "");
// 模型用 mode 声明能力：数组里的 videoReference:N 表示可带 N 段参考视频；singleImage、endFrameOptional 能把一张图当首帧。
const referenceModels = computed(() => models.value.filter(model => model.mode?.some(mode => Array.isArray(mode) && mode.some(item => /^videoReference:[1-9]/.test(item)))));
const frameModels = computed(() => models.value.filter(model => model.mode?.some(mode => mode === "singleImage" || mode === "endFrameOptional")));
const modelHint = computed(() => {
  if (probing.value) return "";
  if (!models.value.length) return "还没有配置视频模型：可以先创建续写节点，生成前到设置里添加视频模型。";
  if (method.value === "video") {
    const names = [...new Set(referenceModels.value.map(model => model.label))];
    return `支持视频参考的模型：${names.slice(0, 5).join("、")}${names.length > 5 ? ` 等 ${names.length} 个` : ""}。续写节点里请选其中一个。`;
  }
  if (!frameModels.value.length) return "已配置的视频模型都没有声明首帧模式（单图参考、尾帧可选），尾帧可能只被当作参考图，衔接会差一些。";
  return referenceModels.value.length ? "" : "已配置的视频模型都不支持视频参考，只能用尾帧接首帧。";
});
let controller: AbortController | undefined;
let job: Promise<unknown> | undefined;

function cancel() {
  controller?.abort(new DOMException("已取消", "AbortError"));
}
function reset() {
  cancel();
  visible.value = false;
}
watch(() => props.file?.url, reset, { flush: "sync" });
watch(() => props.disabled, disabled => { if (disabled) reset(); }, { flush: "sync" });
watch(() => getCanvas?.()?.id, reset, { flush: "sync" });
onBeforeUnmount(cancel);
nodeEvent.on("save", reason => {
  if (reason === "reload" && (creating.value || composing.value)) throw new Error("视频续写处理中，请完成或取消后再刷新节点");
});
nodeEvent.on("delete", async () => { cancel(); await job?.catch(() => {}); });

function formatTime(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
const referenceKey = (source: string, handle: string) => encodeURIComponent(JSON.stringify([source, handle]));

async function makeDirectory(workspace: WorkspaceFiles, path: string) {
  await workspace.mkdir(path).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
    if (error.response?.data?.data?.code !== "EEXIST") throw error;
  });
}

/** 在来源节点右侧找一块不压住其他节点的空位。 */
function findSlot(width: number, height: number) {
  const x = node.computedPosition.x + (node.dimensions.width || 320) + 80;
  let y = node.computedPosition.y;
  for (const other of [...flow.getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
    const position = other.computedPosition;
    if (position.x < x + width && position.x + (other.dimensions.width || 320) > x
      && position.y < y + height && position.y + (other.dimensions.height || 300) > y) y = position.y + (other.dimensions.height || 300) + 40;
  }
  return { x, y };
}

async function focusNode(nodeId: string, canvasId?: string, related: string[] = []) {
  const created = flow.findNode(nodeId);
  if (!created || getCanvas?.()?.id !== canvasId) return;
  flow.removeSelectedElements();
  flow.addSelectedNodes([created]);
  flow.nodesSelectionActive.value = false;
  // 新节点量出尺寸后再定位，否则视图会按零尺寸计算而偏到一边；留出选中后下方面板的位置。
  for (let attempt = 0; attempt < 20 && !created.dimensions.width; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  if (flow.findNode(nodeId) === created && getCanvas?.()?.id === canvasId) await flow.fitView({ nodes: [...related, nodeId], padding: 0.6, maxZoom: 1, duration: 200 });
}

async function open() {
  if (processing.value || props.disabled || !props.file) return;
  const source = props.file.url;
  method.value = "frame";
  backFrames.value = 0;
  prompt.value = "";
  autoCompose.value = true;
  info.value = undefined;
  visible.value = true;
  probing.value = true;
  const current = controller = new AbortController();
  try {
    const [ffmpeg, mediaModels] = await Promise.all([loadFfmpeg(current.signal), ai.getMediaModels(current.signal).catch(() => [] as NodeMediaModel[])]);
    const clip = readVideoClip(await probeMedia(ffmpeg, source, current.signal));
    current.signal.throwIfAborted();
    if (props.file?.url !== source) return;
    models.value = mediaModels.filter(model => model.type === "video");
    info.value = clip;
  } catch (error) {
    if (!current.signal.aborted) showNodeError(error, "无法读取原片");
    visible.value = false;
  } finally {
    probing.value = false;
    if (controller === current) controller = undefined;
  }
}

function startCreate() {
  if (processing.value || props.disabled || !props.file) return;
  job = create({ method: method.value, backFrames: backFrames.value, prompt: prompt.value, autoCompose: autoCompose.value })
    .catch(error => showNodeError(error, "创建续写节点失败"));
}

async function create(options: { method: VideoContinuationLink["method"]; backFrames: number; prompt: string; autoCompose: boolean }) {
  const frame = options.method === "frame";
  if (!props.file) throw new Error("节点还没有视频");
  if (!flow.nodeTypes?.value?.[generationType]) throw new Error("请先启用视频生成节点插件");
  if (frame && !flow.nodeTypes?.value?.[imageType]) throw new Error("请先启用图片节点插件");
  const source = props.file.url, canvasId = getCanvas?.()?.id, label = sourceLabel.value;
  const generationId = crypto.randomUUID(), imageId = crypto.randomUUID();
  const current = controller = new AbortController();
  creating.value = true;
  status.value = frame ? "正在提取原片尾帧…" : "正在读取原片…";
  let workspace: WorkspaceFiles | undefined;
  let directory = "";
  let committed = false;
  try {
    workspace = files.getWorkspaceFiles();
    const ffmpeg = await loadFfmpeg(current.signal);
    current.signal.throwIfAborted();
    let clip: VideoClipInfo;
    let tail: Awaited<ReturnType<typeof extractVideoTailFrame>> | undefined;
    if (frame) {
      await makeDirectory(workspace, "assets");
      await workspace.mkdir(`assets/${imageId}`);
      directory = `assets/${imageId}`;
      tail = await extractVideoTailFrame(ffmpeg, source, `${directory}/tailFrame.png`, { backFrames: options.backFrames, signal: current.signal });
      clip = tail.clip;
    } else clip = readVideoClip(await probeMedia(ffmpeg, source, current.signal));
    current.signal.throwIfAborted();
    status.value = "正在创建续写节点…";
    const continuation: VideoContinuationLink = {
      version: 1, method: options.method, sourceNodeId: node.id, sourceHandleId: "video", sourcePath: source, sourceLabel: label,
      ...(tail ? { tailFrameNodeId: imageId, tailFramePath: tail.path, tailPts: tail.pts, tailTime: tail.time } : {}),
      backFrames: tail?.backFrames ?? 0, dropFirstFrame: frame, autoCompose: options.autoCompose,
    };
    const imageWidth = Math.max(180, 240 * clip.width / clip.height) + 18;
    const slot = findSlot(frame ? imageWidth + 80 + 380 : 380, 320);
    const text = options.prompt.trim();
    // 接着续写节点再续写时不叠「续写 续写」，改成带序号的「续写2」「续写3」。
    const previous = link.value ? /^续写(\d*)\s+(.*)$/s.exec(label) : null;
    const nodes: Node[] = [{
      id: generationId, type: generationType, position: { x: slot.x + (frame ? imageWidth + 80 : 0), y: slot.y },
      data: {
        label: previous ? `续写${Number(previous[1] || 1) + 1} ${previous[2]}` : `续写 ${label}`, prompt: text, promptModel: text ? text.split("\n").map(line => [{ type: "Write", text: line }]) : [],
        ratio: nearestVideoRatio(clip.width, clip.height), continuation,
        referenceOrder: { in: [frame ? referenceKey(imageId, "image") : referenceKey(node.id, "video")] },
      },
    }];
    if (tail) nodes.unshift({
      id: imageId, type: imageType, position: slot,
      data: { label: `${label} · 尾帧`, outputs: { image: { dataType: "IMAGE", value: { url: tail.path, mimeType: "image/png" } } } },
    });
    await batchHistory(async () => {
      current.signal.throwIfAborted();
      if (getCanvas?.()?.id !== canvasId || flow.findNode(node.id) !== node || props.file?.url !== source
        || !flow.nodeTypes?.value?.[generationType] || (frame && !flow.nodeTypes?.value?.[imageType])) throw new Error("画布或原片已变化，请重新操作");
      const ids = nodes.map(item => item.id);
      try {
        flow.addNodes(nodes);
        await nextTick();
        if (ids.some(id => !flow.findNode(id))) throw new Error("续写节点没有创建成功");
        flow.addEdges(frame
          ? { id: crypto.randomUUID(), source: imageId, sourceHandle: "image", target: generationId, targetHandle: "in" }
          : { id: crypto.randomUUID(), source: node.id, sourceHandle: "video", target: generationId, targetHandle: "in" });
        committed = true;
      } catch (error) {
        flow.removeNodes(ids, true, false);
        throw error;
      }
    });
    visible.value = false;
    ElMessage.success(frame ? `已取出尾帧（原片 ${tail!.time.toFixed(2)} 秒处）并创建续写节点` : "已创建续写节点");
    await focusNode(generationId, canvasId, tail ? [imageId] : [node.id]);
    return { nodeId: generationId, ...(tail ? { tailFrameNodeId: imageId, tailFramePath: tail.path, tailTime: tail.time } : {}) };
  } finally {
    if (!committed && workspace && directory) {
      await workspace.remove(directory, true).catch(error => {
        if (error?.response?.data?.data?.code !== "ENOENT") ElMessage.error("尾帧临时文件清理失败");
      });
    }
    creating.value = false;
    status.value = "";
    if (controller === current) controller = undefined;
  }
}

/** 把原片和各段续写按顺序拼成一条，放进新的视频节点；重新拼接时更新上一次的成片节点。 */
async function compose(options: { auto?: boolean } = {}) {
  const current = link.value;
  if (!current) throw new Error("这个节点不是续写节点");
  if (!props.file) throw new Error("续写片段还没有生成");
  if (current.previousShot && current.previousShot.resultPath !== props.file.url) throw new Error("请先用当前衔接设置生成本镜，再拼接成片");
  if (processing.value || props.disabled) throw new Error("节点正在处理其他操作，请稍后再拼接");
  if (!flow.nodeTypes?.value?.[videoType]) throw new Error("请先启用视频节点插件");
  const source = props.file.url, canvasId = getCanvas?.()?.id;
  const plan = planVideoContinuation({ id: node.id, path: source, label: sourceLabel.value, link: current }, nodeId => {
    const parent = flow.findNode(nodeId);
    return parent ? { link: (parent.data as { continuation?: VideoContinuationLink }).continuation, label: parent.data.label } : undefined;
  });
  const signalController = controller = new AbortController();
  composing.value = true;
  const previous = current.composedNodeId ? flow.findNode(current.composedNodeId) : undefined;
  const reuse = previous?.type === videoType ? previous : undefined;
  const targetId = reuse?.id ?? crypto.randomUUID();
  const directory = `assets/${targetId}`;
  const outputPath = `${directory}/continuation-${crypto.randomUUID()}.mp4`;
  let workspace: WorkspaceFiles | undefined;
  let written = false;
  let committed = false;
  try {
    workspace = files.getWorkspaceFiles();
    const ffmpeg = await loadFfmpeg(signalController.signal);
    signalController.signal.throwIfAborted();
    await makeDirectory(workspace, "assets");
    await makeDirectory(workspace, directory);
    written = true;
    const result = await concatVideoClips(ffmpeg, plan.clips, outputPath, signalController.signal);
    signalController.signal.throwIfAborted();
    const check = () => {
      if (getCanvas?.()?.id !== canvasId || flow.findNode(node.id) !== node || props.file?.url !== source || link.value !== current) throw new Error("画布或续写片段已变化，请重新拼接");
    };
    check();
    let updated = false;
    if (reuse && flow.findNode(reuse.id) === reuse) {
      // 成片节点已在画布上：通过它自己的节点函数换成新文件，旧文件保留。
      updated = await callTools().call({ nodeId: reuse.id, name: "node:setVideo", args: { path: result.path, mimeType: "video/mp4" } }, signalController.signal).then(() => true, () => false);
      check();
    }
    let path = result.path;
    if (!updated) {
      const nodeId = reuse ? crypto.randomUUID() : targetId;
      if (reuse) {
        // 旧成片节点没换成（已删除或文件过大）：把文件移到新节点自己的目录，不留在旧节点名下。
        await makeDirectory(workspace, `assets/${nodeId}`);
        await workspace.rename(path, `assets/${nodeId}/continuation.mp4`);
        path = `assets/${nodeId}/continuation.mp4`;
      }
      const slot = findSlot(Math.max(320, 240 * result.width / result.height + 18), 320);
      await batchHistory(async () => {
        check();
        flow.addNodes({
          id: nodeId, type: videoType, position: slot,
          data: {
            label: `${plan.rootLabel || "视频"} · 续写成片`,
            outputs: { video: { dataType: "VIDEO", value: { url: path, mimeType: "video/mp4" } } },
            videoContinuationResult: { clips: plan.clips.map(clip => clip.path), nodeIds: plan.nodeIds, duration: result.duration },
          },
        });
        await nextTick();
        // 连线只记录来源关系；旧版视频节点没有这个端口时不影响成片。
        try { flow.addEdges({ id: crypto.randomUUID(), source: node.id, sourceHandle: "video", target: nodeId, targetHandle: "derivedFrom" }); } catch { /* 仅缺少关系连线 */ }
      });
      current.composedNodeId = nodeId;
    }
    committed = true;
    ElMessage.success(`${options.auto ? "已自动拼接" : "拼接完成"}：${plan.clips.length} 段，共 ${result.duration.toFixed(2)} 秒${updated ? "，成片节点已更新" : ""}`);
    return { nodeId: current.composedNodeId, path, duration: result.duration, clips: plan.clips.length };
  } finally {
    if (!committed && written && workspace) {
      await (reuse ? workspace.remove(outputPath) : workspace.remove(directory, true)).catch(() => {});
    }
    composing.value = false;
    if (controller === signalController) controller = undefined;
  }
}

function startCompose(options: { auto?: boolean } = {}) {
  job = compose(options).catch(error => showNodeError(error, options.auto ? "自动拼接失败，可稍后点「拼接成片」重试" : "拼接成片失败"));
}

nodeTools.register({
  name: "continueVideo",
  description: "视频续写：以此节点的视频为上一段，创建一个「续写」视频生成节点。method=frame 用 FFmpeg 取真正的最后一帧作为下一段首帧（backFrames 可往前退几帧避开模糊的末帧）；method=video 把整段原片作为视频参考（需要模型在 mode 中声明 videoReference）。只创建节点，不启动生成；返回新节点 ID，之后用该节点的 node:setPrompt、node:setConfig、node:generateVideo 继续。autoCompose 为 true 时续写生成完成后自动与原片拼接成片",
  parameters: z.strictObject({
    method: z.enum(["frame", "video"]).optional(),
    backFrames: z.number().int().min(0).max(48).optional(),
    prompt: z.string().max(20000).optional(),
    autoCompose: z.boolean().optional(),
  }),
  execute(args, { signal }) {
    signal?.throwIfAborted();
    if (processing.value || props.disabled) throw new Error("节点正在处理其他操作，请稍后重试");
    return job = create({ method: args.method ?? "frame", backFrames: args.backFrames ?? 0, prompt: args.prompt ?? "", autoCompose: args.autoCompose ?? true });
  },
});
nodeTools.register({
  name: "composeContinuation",
  description: "仅续写节点可用：把原片和各段续写按顺序拼成一条视频（去掉续写片段重复的首帧、统一尺寸与帧率），结果放进新的视频节点，返回成片节点 ID、文件路径和时长",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return job = compose();
  },
});

defineExpose({ open, compose: startCompose, processing, composing });
</script>

<style scoped lang="scss">
.continuationPanel {
  display: grid;
  gap: 10px;
  color: var(--el-text-color-primary);
  p { margin: 0; overflow-wrap: anywhere; }
  .sourceLine { font-size: 14px; }
  .hint { color: var(--el-text-color-secondary); font-size: 12px; font-weight: normal; }
  fieldset {
    display: grid;
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    legend { margin-bottom: 6px; padding: 0; font-size: 13px; font-weight: 600; }
  }
  .option {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
    cursor: pointer;
    b { font-size: 13px; color: var(--el-text-color-primary); }
    input { flex: 0 0 auto; margin-top: 4px; }
    &:has(input:checked) { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
    &.unavailable { opacity: 0.55; cursor: not-allowed; }
  }
  .field {
    display: grid;
    gap: 5px;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    select, textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 32px;
      padding: 6px 8px;
      border: 1px solid var(--el-border-color);
      border-radius: var(--el-border-radius-base);
      background: var(--el-fill-color-blank);
      color: var(--el-text-color-primary);
      font: inherit;
      font-weight: normal;
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -1px; }
    }
    textarea { resize: vertical; }
  }
  .check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .processingStatus {
    display: grid;
    gap: 8px;
    span { color: var(--el-text-color-secondary); font-size: 13px; }
  }
  .panelActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
}
</style>
