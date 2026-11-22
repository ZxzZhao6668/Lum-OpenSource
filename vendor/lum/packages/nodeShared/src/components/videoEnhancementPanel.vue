<template>
  <el-dialog :modelValue="true" title="视频超分" width="min(980px, calc(100vw - 24px))" top="min(5vh, 40px)"
    appendToBody :closeOnClickModal="false" :beforeClose="close">
    <div class="enhancementPanel" @pointerdown.stop @keydown.stop @keydown.esc="close">
      <div class="panelHeader">
        <p>保留原片，超分结果会保存为画布上的子节点。</p>
        <el-button text :disabled="loadingModels || editingLocked" @click="loadModels">刷新模型</el-button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="quiet" role="status">{{ notice }}</p>
      <div class="modeRow" role="group" aria-label="超分模式">
        <el-button :type="mode === 'single' ? 'primary' : 'default'" :aria-pressed="mode === 'single'" :disabled="editingLocked" @click="changeMode('single')">当前视频</el-button>
        <el-button :type="mode === 'batch' ? 'primary' : 'default'" :aria-pressed="mode === 'batch'" :disabled="editingLocked" @click="changeMode('batch')">批量超分</el-button>
        <label v-if="batches.length">
          已保存的报价
          <select v-model="batchId" :disabled="editingLocked" @change="restoreBatch">
            <option value="">新建报价</option>
            <option v-for="batch in batches" :key="batch.id" :value="batch.id">{{ batch.label }}</option>
          </select>
        </label>
      </div>

      <section v-if="!batchId" class="setupPane" aria-label="超分设置">
        <div v-if="loadingModels" class="quiet" role="status">正在读取视频超分模型…</div>
        <p v-else-if="!models.length" class="quiet">没有可用的视频超分模型。请先在媒体模型设置中安装并配置视频超分供应商。</p>
        <fieldset v-else class="settings" :disabled="editingLocked">
          <legend>输出设置</legend>
          <label>视频超分模型
            <select v-model="selectedModel" @change="setModelOptions">
              <option v-for="item in models" :key="modelKey(item)" :value="modelKey(item)">
                {{ item.providerLabel }} · {{ item.label }}{{ item.isDefault ? '（默认）' : '' }}{{ item.enhancementConfigured === false ? ' · 未配置 API Key' : '' }}
              </option>
            </select>
          </label>
          <label v-if="model?.enhancementCapabilities?.audio.includes('mute')">音轨
            <select v-model="audio">
              <option value="preserve" :disabled="!model.enhancementCapabilities.audio.includes('preserve')">保留原声（默认）</option>
              <option value="mute">静音</option>
            </select>
          </label>
          <label v-if="model?.enhancementCapabilities?.interpolation.includes('apollo')">补帧
            <select v-model="interpolation">
              <option value="none" :disabled="!model.enhancementCapabilities.interpolation.includes('none')">不补帧（默认）</option>
              <option value="apollo">Apollo</option>
            </select>
          </label>
          <label v-if="interpolation !== 'none'">输出帧率
            <input v-model.number="fps" type="number" :min="model?.enhancementCapabilities?.minFps" :max="model?.enhancementCapabilities?.maxFps" step="any" placeholder="原帧率" />
          </label>
          <label v-if="interpolation !== 'none' && model?.enhancementCapabilities?.slowMotion.some(item => item > 1)">慢放倍率
            <select v-model.number="slowMotion">
              <option v-for="item in model.enhancementCapabilities.slowMotion" :key="item" :value="item">{{ item === 1 ? '原速（默认）' : `${item}× 慢放` }}</option>
            </select>
          </label>
          <label v-if="mode === 'batch'">同时运行数
            <input v-model.number="concurrency" type="number" min="1" max="8" step="1" />
          </label>
        </fieldset>
        <p v-if="model?.enhancementConfigured === false" class="error">此模型缺少 API Key，请在媒体模型设置中配置后刷新。</p>
        <p v-else-if="model" class="quiet">保留原始画面比例。供应商以所选实际宽 × 高处理视频。</p>
        <div class="sampleRow">
          <el-button disabled>短样</el-button>
          <span class="quiet">当前视频超分接口不支持独立短样和报价，仅可准备所选完整视频。</span>
        </div>
        <div class="rowList">
          <article v-for="row in sourceRows" :key="row.node.id" class="taskRow">
            <div class="rowHeading">
              <label v-if="mode === 'batch'" class="checkLine">
                <input v-model="row.selected" type="checkbox" :disabled="editingLocked" @change="loadSources(false)" />
                <strong>{{ row.label }}</strong>
              </label>
              <strong v-else>{{ row.label }}</strong>
              <el-button size="small" text :disabled="!row.metadata || loadingPreview" @click="openPreview(row.metadata!, '原片')">预览原片</el-button>
            </div>
            <p v-if="row.metadata" class="quiet">
              {{ sizeKey(row.metadata.metadata) }} · {{ row.metadata.metadata.fps?.toFixed(3) }} fps · {{ row.metadata.metadata.duration?.toFixed(2) }} 秒
              · {{ row.metadata.metadata.frameCount }} 帧 · {{ fileSize(row.metadata.metadata.size) }} · {{ row.metadata.metadata.hasAudio ? '有音轨' : '无音轨' }}
            </p>
            <p v-else-if="row.error" class="error">{{ row.error }}</p>
            <p v-else class="quiet" role="status">{{ row.selected ? '正在探测原始视频…' : '勾选后读取尺寸、帧率和时长。' }}</p>
            <label v-if="rowSizes(row).length" class="dimensionControl">
              实际输出尺寸
              <select v-model="row.size" :disabled="editingLocked">
                  <option v-for="size in row.choices" :key="sizeKey(size)" :value="sizeKey(size)">{{ sizeKey(size) }}</option>
              </select>
            </label>
            <p v-if="rowIssue(row)" class="error">{{ rowIssue(row) }}</p>
          </article>
        </div>
        <div class="buttonRow">
          <el-button text :disabled="probing || editingLocked" @click="loadSources(true)">重新读取源视频</el-button>
          <el-button type="primary" :disabled="!canPrepare" :loading="preparing" @click="prepare">准备报价（免费）</el-button>
        </div>
      </section>

      <section v-else aria-label="已保存的超分报价">
        <p class="quiet">
          仅确认后才提交所选完整视频，可能消耗供应商额度。关闭面板或停止派发会暂停待处理项，已提交任务仍在子节点继续。
        </p>
        <p v-if="!jobRows.length" class="quiet" role="status">这组报价节点已不在当前画布，请返回并重新选择。</p>
        <div class="rowList" :aria-busy="preparing">
          <article v-for="job in jobRows" :key="job.id" class="taskRow">
            <div class="rowHeading">
              <label class="checkLine">
                <input v-model="selectedQuotes" type="checkbox" :value="job.id" :disabled="editingLocked || !!plan?.selected || !canSubmit(job)" />
                <strong>{{ job.attempt.label }}</strong>
              </label>
              <span role="status">{{ enhancementStatus(job.node) }}</span>
            </div>
            <p class="quiet">{{ job.attempt.modelLabel }} · {{ sizeKey(job.attempt.request.enhancement.options) }}
              · {{ job.attempt.request.enhancement.options.audio === 'preserve' ? '保留原声' : '静音' }}
              · {{ job.attempt.request.enhancement.options.interpolation === 'none' ? '原帧率、原速' : `${job.attempt.request.enhancement.options.fps ?? job.attempt.source.metadata.fps} fps · ${job.attempt.request.enhancement.options.slowMotion}× 慢放` }}
            </p>
            <p v-if="job.snapshot?.preparation?.cost && job.snapshot.preparation.seconds" class="quote">
              {{ quoteText(job.snapshot.preparation) }}
              <span v-if="job.snapshot.preparation.validUntil"> · 提交期限 {{ new Date(job.snapshot.preparation.validUntil).toLocaleTimeString() }}</span>
            </p>
            <progress v-if="job.snapshot?.state === 'running' && job.view.progress?.percent !== undefined" :value="job.view.progress.percent" max="100" :aria-label="`${job.attempt.label} 供应商进度`" />
            <p v-if="jobIssue(job)" class="error" role="status">{{ jobIssue(job) }}</p>
            <div class="buttonRow">
              <el-button text size="small" :disabled="loadingPreview" @click="openPreview(job.attempt.source, '原片')">预览原片</el-button>
              <el-button v-if="enhancementReady(job.node)" text size="small" :disabled="loadingPreview" @click="openResult(job)">预览结果</el-button>
              <el-button v-if="enhancementReady(job.node)" text size="small" @click="selectResult(job)">定位结果节点</el-button>
              <el-button v-if="!enhancementReady(job.node)" text size="small" :disabled="job.view.busy" @click="jobAction(job, 'read')">查询原任务</el-button>
              <el-button v-if="job.snapshot?.state === 'interrupted' && job.snapshot.resumable" text size="small" :disabled="editingLocked || job.view.busy" @click="jobAction(job, 'resume')">恢复原任务</el-button>
              <el-button v-if="canAbandon(job)" text size="small" :disabled="editingLocked || job.view.busy" @click="jobAction(job, 'abandon')">放弃任务</el-button>
            </div>
          </article>
        </div>
        <p v-if="!plan" class="error" role="status">此批次的计划与确认记录已缺失，无法提交。请撤销移除计划节点的操作以恢复；无法恢复时，请明确放弃剩余待处理任务后新建报价。已有任务仍可查询或恢复。</p>
        <div class="buttonRow">
          <el-button v-if="runningQueue" @click="stopDispatch">停止派发</el-button>
          <el-button v-else-if="plan?.selected" type="primary" :disabled="preparing || !confirmable.length" @click="confirmQueue">继续待处理</el-button>
          <el-button v-else type="primary" :disabled="preparing || !confirmable.length" @click="confirmQueue">
            {{ confirmable.length > 1 ? `确认提交所选 ${confirmable.length} 条` : '确认提交所选视频' }}
          </el-button>
          <el-button text :disabled="editingLocked" @click="changeMode(mode)">新建报价</el-button>
          <span v-if="plan" class="quiet" role="status">并发上限 {{ plan.concurrency }} · {{ usedSlots }} 项运行或待核对</span>
        </div>
      </section>

      <section v-if="previewFile" class="previewPane" aria-label="所选视频预览">
        <div class="rowHeading">
          <strong>{{ previewLabel }}{{ previewSize ? ` · ${fileSize(previewSize)}` : '' }}</strong>
          <div class="buttonRow">
            <el-button size="small" text @click="revealPreview">打开所在文件夹查看</el-button>
            <el-button size="small" text @click="previewFile = undefined">关闭预览</el-button>
          </div>
        </div>
        <p v-if="loadingPreview" class="quiet" role="status">正在读取所选视频…</p>
        <p v-if="previewError || decodeError" class="error" role="alert">{{ previewError || decodeError }}</p>
        <video v-if="previewUrl" :key="previewUrl" :src="previewUrl" controls preload="metadata" playsinline :aria-label="previewLabel" @error="decodeError = '当前浏览器不能播放该视频，可在本地播放器查看。'" />
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, shallowReactive, shallowRef, watch } from "vue";
import { ElButton, ElDialog, ElMessageBox } from "element-plus";
import type { GraphNode } from "@vue-flow/core";
import type { NodeMediaValue } from "@lum/nodes-scaffold/runtime";
import type { EnhancementTaskSnapshot, EnhancementVideoSource, NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import { useNodeFiles } from "@lum/nodes-scaffold/workspaceFiles";
import { enhancementError, enhancementOccupiesSlot, enhancementOptionsIssue, enhancementReady, enhancementSizes, enhancementStatus, enhancementView, fileSize, modelKey,
  sameSource, sizeKey, videoEnhancementNodeType, videoSource, type VideoEnhancementAttempt, type VideoEnhancementData, type VideoEnhancementOptions } from "../videoEnhancement";
import { useVideoEnhancement } from "../useVideoEnhancement";
import { useEnhancementPreview, type EnhancementPreviewFile } from "../useEnhancementPreview";

const props = defineProps<{ node: GraphNode; file: NodeMediaValue }>();
const emit = defineEmits<{ close: [] }>();
const tasks = useVideoEnhancement();
const { ai, flow, getPersistence } = tasks;
const getCanvasActive = inject("nodeCanvasActive", () => true);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const { getWorkspaceFiles } = useNodeFiles();
const opened = getPersistence?.();
const fixedFiles = opened && getWorkspaceFiles();
const local = new AbortController();
let probeController: AbortController | undefined;
let dispatchController: AbortController | undefined;
let confirmEpoch = 0;
let confirmationOpen = false;
const sourceFile = props.file;
const mode = ref<"single" | "batch">("single"), batchId = ref("");
const error = ref(""), notice = ref("");
const models = shallowRef<NodeMediaModel[]>([]), selectedModel = ref(""), loadingModels = ref(false);
const audio = ref<VideoEnhancementOptions["audio"]>("preserve"), interpolation = ref<VideoEnhancementOptions["interpolation"]>("none");
const fps = ref<number>(), slowMotion = ref(1), concurrency = ref(4);
const preparing = ref(false), runningQueue = ref(false), probing = ref(false), confirming = ref(false);
const selectedQuotes = ref<string[]>([]), now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
const editingLocked = computed(() => preparing.value || runningQueue.value || confirming.value);
const model = computed(() => models.value.find(item => modelKey(item) === selectedModel.value));
type SourceRow = { node: GraphNode; source: { path: string; mimeType: string }; label: string; selected: boolean; size: string; choices: { width: number; height: number }[]; metadata?: EnhancementVideoSource; error?: string };
const sourceRows = shallowRef<SourceRow[]>([]);
const previewFile = ref<EnhancementPreviewFile>();
const previewLabel = ref(""), decodeError = ref("");
const { url: previewUrl, error: previewError, size: previewSize, loading: loadingPreview, clear: clearPreview, open: preview, reveal: revealPreview } = useEnhancementPreview(previewFile, () => {
  checkPanel();
  if (!fixedFiles) throw Error("工作区不可用");
  return fixedFiles;
});

function checkPanel() {
  local.signal.throwIfAborted();
  const current = getPersistence?.();
  if (!opened || current?.directory !== opened.directory || current.canvasPath !== opened.canvasPath
    || !getCanvasActive() || flow.findNode(props.node.id) !== props.node || props.file !== sourceFile) throw Error("原片、画布或工作区已切换");
  return current;
}

function stopDispatch() {
  dispatchController?.abort();
  confirmEpoch++;
  notice.value = "已停止派发；已提交的视频继续处理，未派发的报价仍可查看。";
}

function cleanup() {
  local.abort(); probeController?.abort(); dispatchController?.abort(); clearInterval(clock); clearPreview();
  if (confirmationOpen) ElMessageBox.close();
}
function close() { cleanup(); emit("close"); }
onScopeDispose(cleanup);
watch(getCanvasActive, active => { if (!active) close(); }, { flush: "sync" });

async function loadModels() {
  loadingModels.value = true;
  error.value = "";
  try {
    checkPanel();
    const catalog = await ai.getMediaModels(local.signal, "upscale");
    checkPanel();
    models.value = catalog.filter(item => item.type === "video" && item.operation === "upscale" && item.supportsEnhancementPreparation && item.enhancementCapabilities);
    if (!model.value) {
      const picked = models.value.find(item => item.isDefault) ?? models.value.find(item => item.enhancementConfigured) ?? models.value[0];
      selectedModel.value = picked ? modelKey(picked) : "";
      setModelOptions();
    } else for (const row of sourceRows.value) setSizes(row);
  } catch (cause) { if (!local.signal.aborted) error.value = enhancementError(cause); }
  finally { loadingModels.value = false; }
}

function setSizes(row: SourceRow) {
  const cap = model.value?.enhancementCapabilities;
  row.choices = row.metadata && cap ? enhancementSizes(row.metadata, cap) : [];
  if (!row.choices.some(size => sizeKey(size) === row.size)) row.size = row.choices[0] ? sizeKey(row.choices[0]) : "";
}
function setModelOptions() {
  audio.value = "preserve"; interpolation.value = "none"; slowMotion.value = 1; fps.value = undefined;
  sourceRows.value.forEach(setSizes);
}
function rowSizes(row: SourceRow) { return row.choices; }
function optionsFor(row: SourceRow): VideoEnhancementOptions | undefined {
  const size = rowSizes(row).find(item => sizeKey(item) === row.size);
  if (!size) return;
  return { ...size, ...(interpolation.value !== "none" && typeof fps.value === "number" ? { fps: fps.value } : {}),
    audio: audio.value, interpolation: interpolation.value, slowMotion: interpolation.value === "none" ? 1 : slowMotion.value };
}
function rowIssue(row: SourceRow) {
  const cap = model.value?.enhancementCapabilities;
  if (!row.metadata || !cap) return "";
  const options = optionsFor(row);
  return options ? enhancementOptionsIssue(row.metadata, options, cap) : "没有符合模型限制和原始比例的放大尺寸";
}

async function loadSources(refresh?: boolean) {
  probeController?.abort();
  const controller = probeController = new AbortController();
  probing.value = true;
  try {
    const current = checkPanel();
    if (refresh !== false) {
      const previous = sourceRows.value;
      const nodes = mode.value === "single" ? [props.node] : [props.node, ...flow.getNodes.value.filter(node => node !== props.node)];
      sourceRows.value = nodes.flatMap(node => {
        const source = videoSource(node);
        if (!source || (node.data as VideoEnhancementData).videoEnhancementAttempt && !enhancementReady(node)) return [];
        const before = previous.find(row => row.node === node);
        return [shallowReactive<SourceRow>({ node, source, label: String(node.data.label || (node === props.node ? "当前视频" : "视频")),
          selected: before?.selected ?? node === props.node, size: before?.size ?? "", choices: [] })];
      });
    }
    if (!sourceRows.value.length) notice.value = "当前画布没有符合条件的视频输出。";
    const queue = sourceRows.value.filter(row => row.selected && !row.metadata);
    for (const row of queue) row.error = undefined;
    const probe = async () => {
      while (!controller.signal.aborted && queue.length) {
        const row = queue.shift()!;
        try {
          const metadata = await ai.inspectEnhancement(current.directory, row.source.path, controller.signal);
          controller.signal.throwIfAborted(); checkPanel();
          if (flow.findNode(row.node.id) !== row.node || !sameSource(row.node, row.source.path, row.source.mimeType)) throw Error("源视频节点已变化，请重新读取");
          if (metadata.path !== row.source.path) throw Error("探测文件与画布输出路径不一致");
          row.metadata = metadata;
          setSizes(row);
        } catch (cause) { if (!controller.signal.aborted && !local.signal.aborted) row.error = enhancementError(cause); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, probe));
  } catch (cause) { if (!local.signal.aborted) error.value = enhancementError(cause); }
  finally { if (probeController === controller) probing.value = false; }
}

const checkedSources = computed(() => sourceRows.value.filter(row => mode.value === "single" || row.selected));
const canPrepare = computed(() => !editingLocked.value && !probing.value && model.value?.enhancementConfigured === true
  && checkedSources.value.length > 0 && checkedSources.value.every(row => row.metadata && optionsFor(row) && !rowIssue(row))
  && Number.isInteger(concurrency.value) && concurrency.value >= 1 && concurrency.value <= 8);

function ownBatchNodes() {
  return flow.getNodes.value.filter(node => {
    const data: VideoEnhancementData = node.data, attempt = data.videoEnhancementAttempt;
    return data.videoEnhancementBatch?.parentId === props.node.id && attempt?.owner.nodeId === node.id
      && attempt.owner.canvasPath === opened?.canvasPath && attempt.request.directory === opened?.directory;
  });
}
const batches = computed(() => {
  const items = new Map<string, { id: string; label: string }>();
  for (const node of ownBatchNodes()) {
    const batch = (node.data as VideoEnhancementData).videoEnhancementBatch!;
    if (!items.has(batch.id)) items.set(batch.id, { id: batch.id, label: `${(node.data as VideoEnhancementData).videoEnhancementAttempt!.label} · ${items.size + 1} 组` });
  }
  return [...items.values()].reverse();
});
const batchNodes = computed(() => ownBatchNodes().filter(node => (node.data as VideoEnhancementData).videoEnhancementBatch?.id === batchId.value)
  .sort((a, b) => a.data.videoEnhancementBatch.order - b.data.videoEnhancementBatch.order));
const anchor = computed(() => batchNodes.value.find(node => (node.data as VideoEnhancementData).videoEnhancementPlan));
const plan = computed(() => (anchor.value?.data as VideoEnhancementData | undefined)?.videoEnhancementPlan);
const jobRows = computed(() => batchNodes.value.map(node => {
  const data: VideoEnhancementData = node.data, attempt = data.videoEnhancementAttempt!;
  return { node, id: attempt.owner.taskId, data, attempt, snapshot: data.videoEnhancementSnapshot, view: enhancementView(node) };
}));
type Job = typeof jobRows.value[number];
const confirmable = computed(() => plan.value ? jobRows.value.filter(job => (plan.value!.selected ?? selectedQuotes.value).includes(job.id) && canSubmit(job)) : []);
watch(jobRows, (jobs, previous) => {
  if (plan.value?.selected) return;
  const previouslyPrepared = new Set(previous?.filter(job => job.snapshot?.state === "prepared").map(job => job.id));
  const newQuotes = jobs.filter(job => job.snapshot?.state === "prepared" && !previouslyPrepared.has(job.id)).map(job => job.id);
  if (newQuotes.length) selectedQuotes.value = [...new Set([...selectedQuotes.value, ...newQuotes])];
});

function assertSource(attempt: VideoEnhancementAttempt, sourceNode?: GraphNode) {
  const { sourceNodeId, source } = attempt.request.enhancement;
  const node = flow.findNode(sourceNodeId);
  if (sourceNode && node !== sourceNode || !sameSource(node, attempt.source.path, source.mimeType)) throw Error("源视频已变化，原报价不能提交");
}

function restoreBatch() {
  probeController?.abort();
  previewFile.value = undefined;
  selectedQuotes.value = plan.value?.selected ?? jobRows.value.filter(job => job.snapshot?.state === "prepared").map(job => job.id);
  if (!batchId.value) void loadSources();
}
function changeMode(value: typeof mode.value) { error.value = notice.value = ""; mode.value = value; batchId.value = ""; sourceRows.value = []; restoreBatch(); }

async function prepare() {
  if (!canPrepare.value || !model.value) return;
  preparing.value = true;
  error.value = notice.value = "";
  try {
    const context = checkPanel(), chosenModel = model.value, id = crypto.randomUUID();
    if (!flow.nodeTypes?.value?.[videoEnhancementNodeType]) throw Error("请先启用视频节点插件");
    const frozen = checkedSources.value.map((row, order) => {
      const nodeId = crypto.randomUUID();
      const source = JSON.parse(JSON.stringify(row.metadata)) as EnhancementVideoSource;
      const attempt: VideoEnhancementAttempt = { owner: { taskId: crypto.randomUUID(), nodeId, canvasPath: context.canvasPath }, source,
        label: row.label, modelLabel: `${chosenModel.providerLabel} · ${chosenModel.label}`, request: { directory: context.directory, outputDirectory: `assets/${nodeId}`,
          operation: "upscale", providerId: chosenModel.providerId, modelId: chosenModel.modelId, prompt: "视频超分",
          enhancement: { source: row.source, sourceNodeId: row.node.id, sourceHandleId: "video", sourceSha256: source.metadata.sha256, options: optionsFor(row)! } } };
      assertSource(attempt, row.node);
      return { row, order, nodeId, attempt };
    });
    const batchPlan = { taskIds: frozen.map(item => item.attempt.owner.taskId), concurrency: mode.value === "single" ? 1 : concurrency.value };
    await batchHistory(async () => {
      checkPanel();
      const positions = flow.getNodes.value.map(node => ({ x: node.computedPosition.x, y: node.computedPosition.y, width: node.dimensions.width || 320, height: node.dimensions.height || 280 }));
      for (const { row, order, nodeId, attempt } of frozen) {
        const x = row.node.computedPosition.x + (row.node.dimensions.width || 320) + 80;
        let y = row.node.computedPosition.y;
        for (const other of [...positions].sort((a, b) => a.y - b.y)) {
          if (other.x < x + 340 && other.x + other.width > x && other.y < y + 300 && other.y + other.height > y) y = other.y + other.height + 40;
        }
        positions.push({ x, y, width: 340, height: 300 });
        flow.addNodes({ id: nodeId, type: videoEnhancementNodeType, position: { x, y },
          data: { label: `${row.label} · 视频超分`, videoEnhancementAttempt: attempt,
            videoEnhancementBatch: { id, parentId: props.node.id, order }, ...(order === 0 ? { videoEnhancementPlan: batchPlan } : {}) } });
        flow.addEdges({ id: crypto.randomUUID(), source: row.node.id, sourceHandle: "video", target: nodeId, targetHandle: "derivedFrom" });
      }
    });
    checkPanel();
    batchId.value = id;
    selectedQuotes.value = [];
    await context.save(local.signal);
    checkPanel();
    const queue = [...frozen];
    const prepareNext = async () => {
      while (!local.signal.aborted && queue.length) {
        const { row, nodeId, attempt } = queue.shift()!;
        const node = flow.findNode(nodeId);
        if (!node) continue;
        try {
          while (enhancementView(node).busy && !local.signal.aborted) await new Promise<void>(resolve => setTimeout(resolve, 100));
          await tasks.act(node, "prepare", local.signal, () => { checkPanel(); assertSource(attempt, row.node); });
        }
        catch (cause) { if (!local.signal.aborted) error.value = enhancementError(cause); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(batchPlan.concurrency, queue.length) }, prepareNext));
  } catch (cause) { if (!local.signal.aborted) error.value = enhancementError(cause); }
  finally { preparing.value = false; }
}

function submitIssue(job: Job, timestamp: number) {
  const snapshot = job.data.videoEnhancementSnapshot, quote = snapshot?.preparation;
  if (job.data.videoEnhancementIntent) return "原任务操作结果待核对";
  if (job.view.missing) return "未找到原任务记录";
  if (job.view.error) return job.view.error;
  if (!job.view.queried) return "原任务状态待核对";
  if (snapshot?.state !== "prepared" || !quote?.cost || !quote.seconds || !quote.validUntil) return "原报价已不可提交";
  if (quote.validUntil <= timestamp) return "原报价已过期";
  try { tasks.capture(job.node); assertSource(job.attempt); } catch (cause) { return enhancementError(cause); }
  return "";
}
function canSubmit(job: Job) {
  return !job.view.busy && !submitIssue(job, now.value);
}
function canAbandon(job: Job) {
  return !["failed", "succeeded", "cancelled"].includes(job.snapshot?.state ?? "");
}
function jobIssue(job: Job) {
  const reason = job.view.error || job.snapshot?.result?.message || job.data.videoEnhancementIssue;
  if (reason) return reason;
  if (job.snapshot?.state === "prepared") {
    if ((job.snapshot.preparation?.validUntil ?? 0) <= now.value) return "报价已过期，请放弃后重新准备。";
    try { assertSource(job.attempt); } catch (cause) { return enhancementError(cause); }
    if (job.data.videoEnhancementIntent) return "请核对这条原任务，或明确放弃；不会自动再次提交。";
  }
  if (job.view.missing && !job.data.videoEnhancementPreparing) return "该视频尚未发出准备请求，可放弃此条后新建报价。";
  if (job.view.missing) return "尚未找到同一任务记录。可再查询原任务，或明确放弃。";
  return "";
}
function quoteText(quote: NonNullable<EnhancementTaskSnapshot["preparation"]>) {
  const range = (item: { min: number; max: number }) => item.min === item.max ? String(item.min) : `${item.min}–${item.max}`;
  return quote.cost && quote.seconds ? `预计 ${range(quote.cost)} ${quote.cost.unit} · ${range(quote.seconds)} 秒` : "";
}
const usedSlots = computed(() => flow.getNodes.value.filter(node => enhancementOccupiesSlot(node, opened)).length);

function confirmedQuote(job: Job) {
  return JSON.stringify([job.attempt, job.data.videoEnhancementSnapshot?.preparation]);
}

async function confirmQueue() {
  if (!plan.value || !anchor.value) {
    error.value = "批次计划已缺失，请撤销移除计划节点的操作，或明确放弃剩余待处理任务后新建报价。";
    return;
  }
  if (!confirmable.value.length || editingLocked.value) return;
  const context = checkPanel(), frozen = plan.value, parent = anchor.value;
  const chosen = confirmable.value.map(job => ({ job, quote: confirmedQuote(job) }));
  const existing = frozen.selected;
  const id = batchId.value;
  const title = existing ? "继续派发已确认的超分任务？" : "确认按这些报价提交？";
  const message = chosen.map(({ job }) => `${job.attempt.label} · ${sizeKey(job.attempt.request.enhancement.options)} · ${quoteText(job.snapshot!.preparation!)}`).join("\n");
  const epoch = ++confirmEpoch;
  let controller: AbortController | undefined;
  confirming.value = true;
  error.value = notice.value = "";
  try {
    await confirm(message, title, "确认提交");
    function checkBatch() {
      checkPanel();
      if (epoch !== confirmEpoch || id !== batchId.value || parent !== anchor.value) throw Error("已确认批次发生变化");
    }
    function currentJob({ job: original }: typeof chosen[number]) {
      return jobRows.value.find(job => job.id === original.id && job.node === original.node);
    }
    function revalidate(confirmed: typeof chosen[number], job: Job) {
      return submitIssue(job, Date.now()) || (confirmedQuote(job) === confirmed.quote ? "" : "原报价或准备请求已变化");
    }
    checkBatch();
    if (frozen !== plan.value) throw Error("所选批次已变化，请重新确认");
    let confirmedPlan = frozen;
    if (!existing) {
      const data: VideoEnhancementData = parent.data;
      const selected = chosen.map(({ job }) => job.id);
      data.videoEnhancementPlan = { ...frozen, selected };
      confirmedPlan = data.videoEnhancementPlan;
      try { await context.save(local.signal); }
      catch (cause) {
        const active = getPersistence?.();
        if (flow.findNode(parent.id) === parent && active?.directory === context.directory && active.canvasPath === context.canvasPath && data.videoEnhancementPlan?.selected?.join() === selected.join()) {
          data.videoEnhancementPlan = frozen;
        }
        throw cause;
      }
    }
    checkBatch();
    controller = dispatchController = new AbortController();
    const signal = controller.signal;
    runningQueue.value = true;
    confirming.value = false;
    const queue = [...chosen];
    const skipped: string[] = [];
    while (queue.length) {
      checkBatch(); signal.throwIfAborted();
      if (plan.value !== confirmedPlan) throw Error("已确认批次发生变化");
      const confirmed = queue[0]!;
      const job = currentJob(confirmed);
      if (job?.view.busy) {
        await new Promise<void>(resolve => setTimeout(resolve, 100));
        continue;
      }
      const issue = job ? revalidate(confirmed, job) : "结果节点已移除或替换";
      if (!job || issue) {
        skipped.push(`${confirmed.job.attempt.label}（${issue}）`);
        notice.value = `本轮暂未派发 ${skipped.join("；")}`;
        queue.shift();
        continue;
      }
      if (usedSlots.value >= frozen.concurrency) {
        await new Promise<void>(resolve => setTimeout(resolve, 650));
        continue;
      }
      queue.shift();
      const taskId = job.id;
      const sourceNode = flow.findNode(job.attempt.request.enhancement.sourceNodeId);
      // act claims the slot synchronously before its first await; the observed task, not this promise, releases it.
      void tasks.act(job.node, "submit", signal, () => {
        checkBatch(); signal.throwIfAborted();
        if (plan.value !== confirmedPlan || !confirmedPlan.selected?.includes(taskId) || !currentJob(confirmed)) throw Error("已确认批次发生变化");
        if (confirmedQuote(job) !== confirmed.quote) throw Error("原报价或准备请求已变化");
        assertSource(job.attempt, sourceNode);
      }).catch(cause => { if (!signal.aborted && !local.signal.aborted) error.value = enhancementError(cause); });
    }
    // Do not block panel cleanup on a response from an already invoked submit.
    while (!signal.aborted && chosen.some(({ job }) => job.view.busy && job.data.videoEnhancementIntent === "submit")) {
      await new Promise<void>(resolve => setTimeout(resolve, 200));
    }
    if (!signal.aborted && !skipped.length) notice.value = "本轮派发结束，可在结果节点查看各条任务状态。";
  } catch (cause) {
    if (!local.signal.aborted && !controller?.signal.aborted && cause !== "cancel" && cause !== "close") error.value = enhancementError(cause);
  } finally { confirming.value = runningQueue.value = false; }
}

async function confirm(message: string, title: string, confirmButtonText: string) {
  if (confirmationOpen) throw Error("请先处理现有确认框");
  confirmationOpen = true;
  try { await ElMessageBox.confirm(message, title, { confirmButtonText, cancelButtonText: "返回", customStyle: { whiteSpace: "pre-line" } }); }
  finally { confirmationOpen = false; }
}

async function jobAction(job: Job, action: "read" | "resume" | "abandon") {
  try {
    checkPanel();
    if (action === "abandon") {
      await confirm("放弃后停止本地追踪并释放该任务占用的本地并发名额。供应商的处理可能继续，也不会自动退还额度。", "放弃原超分任务？", "放弃任务");
      checkPanel();
    }
    await tasks.act(job.node, action, local.signal, checkPanel);
  } catch (cause) { if (!local.signal.aborted && cause !== "cancel" && cause !== "close") error.value = enhancementError(cause); }
}
function openPreview(source: EnhancementVideoSource, label: string) {
  decodeError.value = "";
  previewLabel.value = label;
  previewFile.value = { path: source.path, mimeType: source.metadata.mimeType, sha256: source.metadata.sha256 };
  void preview();
}
function openResult(job: Job) {
  checkPanel();
  const result = job.data.videoEnhancementResult;
  if (!result || !enhancementReady(job.node)) return;
  decodeError.value = "";
  previewLabel.value = "已保存结果";
  previewFile.value = { path: result.path, mimeType: result.mimeType };
  void preview();
}
function selectResult(job: Job) {
  checkPanel();
  if (flow.findNode(job.node.id) !== job.node || !enhancementReady(job.node)) return;
  flow.removeSelectedElements(); flow.addSelectedNodes([job.node]);
  void flow.fitView({ nodes: [job.node.id], padding: 0.25, maxZoom: 1, duration: 180 });
  close();
}

if (batches.value.length) { batchId.value = batches.value[0]!.id; restoreBatch(); }
else void loadSources();
void loadModels();
</script>

<style scoped lang="scss">
.enhancementPanel { display: grid; gap: 14px; max-height: 72vh; overflow: auto; padding: 2px; color: var(--el-text-color-primary); }
.enhancementPanel p { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.panelHeader, .modeRow, .buttonRow, .rowHeading, .sampleRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.panelHeader, .rowHeading { justify-content: space-between; }
.modeRow .el-button, .buttonRow .el-button, .rowHeading .el-button { margin-left: 0; }
.quiet { color: var(--el-text-color-secondary); }
.error { color: var(--el-color-danger); }
.setupPane, section, .rowList { display: grid; min-width: 0; gap: 10px; }
.settings { min-width: 0; margin: 0; border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; }
.settings label, .dimensionControl { display: grid; gap: 5px; min-width: 0; }
.dimensionControl { max-width: 240px; }
.modeRow label { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.enhancementPanel select, .enhancementPanel input:not([type="checkbox"]) {
  min-width: 0; max-width: 100%; border: 1px solid var(--el-border-color); background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary); border-radius: var(--el-border-radius-base); padding: 6px 8px;
}
.enhancementPanel select:focus-visible, .enhancementPanel input:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.taskRow, .previewPane { min-width: 0; display: grid; gap: 6px; padding: 10px; border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); }
.checkLine { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.rowHeading strong { overflow-wrap: anywhere; }
.quote { color: var(--el-color-primary); }
.previewPane video { display: block; width: 100%; max-height: 32vh; background: #000; }
progress { width: min(100%, 200px); accent-color: var(--el-color-primary); }
</style>
