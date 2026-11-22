<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="player?.enterFullscreen()"
    :bottomWidth="660"
    :style="{ width: previewUrl && videoWidth ? `${videoWidth + 18}px` : undefined }">
    <template #topActions>
      <videoEnhancementEntry :node="node" :file="outputFile" :disabled="generating || deleting || uploading || actions?.processing" />
      <el-button :icon="IconMusic" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('extractAudio')">提取音轨</el-button>
      <el-button :icon="IconLayersSubtract" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('separate')">分离音视频</el-button>
      <el-button :icon="IconScissors" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('trim')">截取片段</el-button>
      <el-button :icon="IconMovie" text :loading="retake?.loading" :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="retake?.open()">片段重拍</el-button>
      <el-button :icon="IconPlayerTrackNext" text :loading="continuation?.processing && !continuation?.composing" :disabled="!outputFile || generating || deleting || uploading || actions?.processing || continuation?.processing" @click.stop="continuation?.open()">视频续写</el-button>
      <el-button v-if="data.continuation" :icon="IconArrowsJoin" text :loading="continuation?.composing" :disabled="!outputFile || generating || deleting || uploading || actions?.processing || continuation?.processing" title="把原片和各段续写按顺序拼成一条视频" @click.stop="continuation?.compose()">拼接成片</el-button>
      <el-button :icon="IconMovie" text :loading="actions?.creatingAnalysis" :disabled="!outputFile || generating || deleting || uploading || actions?.processing || actions?.creatingAnalysis" @click.stop="actions?.createFrameAnalysis()">逐帧拉片</el-button>
      <mediaHistory mediaType="video" :current="outputFile" :disabled="generating || deleting || uploading" @select="outputs.video = { dataType: 'VIDEO', value: $event }" />
      <el-button :icon="IconTransfer" :loading="uploading" :disabled="generating || deleting" text title="替换视频" aria-label="替换视频" @click.stop="fileInput?.click()">替换视频</el-button>
      <input ref="fileInput" type="file" accept="video/*" hidden aria-label="选择替换视频" :disabled="generating || deleting || uploading" @change="replaceOutput" />
    </template>
    <template #topRightActions>
      <el-dropdown trigger="click" placement="bottom-end" :disabled="!player?.ready || player?.capturing || generating || deleting || uploading" @command="player?.captureFrame($event)">
        <el-button :icon="IconPhotoScan" :loading="player?.capturing" :disabled="!player?.ready || player?.capturing || generating || deleting || uploading" text title="截取视频帧" aria-label="截取视频帧" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="current" :icon="IconPhotoScan">截取当前帧</el-dropdown-item>
            <el-dropdown-item command="first" :icon="IconPlayerSkipBack">截取首帧</el-dropdown-item>
            <el-dropdown-item command="last" :icon="IconPlayerSkipForward">截取尾帧</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
    <div v-loading="generating || uploading" class="videoContent nopan" :aria-busy="generating || uploading" :data-lum-activity="uploading ? 'uploading' : generating ? 'generating' : undefined" :aria-label="uploading ? '正在上传视频' : generating ? '正在生成视频' : '视频预览'">
      <videoPlayer
        v-if="previewUrl"
        ref="player"
        :src="previewUrl"
        label="生成视频"
        @loadedmetadata="resizeVideo" />
      <div v-else class="videoEmpty" role="img" aria-label="暂无生成视频">
        <icon-camera-ai :size="48" stroke="1.25" aria-hidden="true" />
      </div>
    </div>
    <template #bottom>
      <el-card v-if="retakeSummary" class="promptCard nodrag nopan nowheel" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <div class="videoPromptHeading"><b>片段重拍 · 请求快照</b></div>
        <div class="referenceHint">
          <div>方式：{{ retakeSummary.method }} · 模式：{{ retakeSummary.mode }}</div>
          <div>原片选区：{{ retakeSummary.range }} · 请求时长：{{ retakeSummary.duration }}</div>
          <div>分辨率：{{ retakeSummary.resolution }} · 模型：{{ retakeSummary.model }}</div>
        </div>
        <div v-if="generating || pendingRecovery" class="promptFooter">
          <div class="generationActions">
            <el-button v-if="pendingRecovery" :loading="cancelling" :disabled="deleting || uploading" @click="generationState.cancel().catch(error => showNodeError(error, '停止生成失败'))">放弃任务</el-button>
            <el-button v-if="pendingRecovery" :disabled="cancelling || deleting || uploading" @click="startGeneration(retakeSummary.taskId).catch(error => showNodeError(error, '视频任务复查失败'))">复查任务</el-button>
            <el-button v-else :loading="cancelling" :disabled="deleting || uploading" @click="generationState.cancel().catch(error => showNodeError(error, '停止生成失败'))">停止生成</el-button>
          </div>
        </div>
      </el-card>
      <template v-else>
      <shotDesignBar v-model="data.shotDesign" :disabled="generating || deleting" />
      <el-card class="promptCard nodrag nopan nowheel" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <referenceItem
          v-if="refList.length"
          v-model="refList"
          @preview="setReferencePreview"
          @remove="removeReference" />
        <div v-if="candidateAssets.length" class="referenceHint">
          候选资产 {{ candidateAssets.length }} 张 · 本镜采用 {{ assetReferences.length }} 张。通过 @ 选择本镜资产；已固定的画风参考图随本次画风使用。
          <span v-if="assetReferences.length">本镜采用：{{ assetReferences.map(item => referenceFlow.findNode(item.source)?.data.label || '资产').join('、') }}</span>
        </div>
        <div v-else-if="frameMode" class="referenceHint">
          {{ continuationFirstFrame ? "续写：原片尾帧作为本段首帧提交；再连接一张图片时，它作为本段尾帧" : selectedMode === "startFrameOptional" ? "仅一张图片时作为尾帧；两张图片按顺序作为首帧、尾帧" : "图片引用按顺序作为首帧、尾帧" }}
        </div>
        <div v-if="data.continuation" class="referenceHint continuationHint">
          <div>续写自「{{ data.continuation.sourceLabel || '上一段视频' }}」 · {{ continuationSummary }}</div>
          <div v-if="continuationWarning" class="continuationWarning" role="status">{{ continuationWarning }}</div>
          <label><input type="checkbox" :checked="data.continuation.autoCompose" :disabled="generating || deleting" @change="data.continuation.autoCompose = ($event.target as HTMLInputElement).checked" />生成完成后自动拼接成片</label>
        </div>
        <div class="videoPromptHeading"><b>视频提示词</b><el-button text :disabled="generating || deleting || uploading" @click="addAssetPromptReference().catch(error => showNodeError(error, '引用资产失败'))">@ 引用资产</el-button></div>
        <p v-if="writingSetupStyle(data.writingProduction).label">{{ writingSetupStyle(data.writingProduction).label }}</p>
        <el-button v-if="canReadProjectSetup()" text :disabled="generating || choosingStyle" @click="adoptProjectStyle">采用最新项目设定</el-button>
        <promptInput v-model="data.promptModel" v-model:text="data.prompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" placeholder="描述本镜头的动作、运镜和衔接要求，输入 @ 选择人物、场景或道具资产" expandable />
        <p v-if="referenceSelection.error" class="referenceHint" role="status">{{ referenceSelection.error }}</p>
        <videoPromptAnalysis v-model="data.promptAnalysis" :input="analysisContext.input" :error="analysisContext.error" :disabled="generating || deleting || uploading" @apply="applyAnalyzedPrompt" />
        <label class="defaultModelFollow"><input type="checkbox" :checked="data.followDefaultModel !== false" :disabled="generating || deleting" @change="data.followDefaultModel = ($event.target as HTMLInputElement).checked" />使用全局默认模型</label>
        <div class="promptFooter">
          <el-select
            :modelValue="selectedModel ? data.model : ''"
            class="modelSelect"
            filterable
            :loading="modelsLoading"
            :disabled="generating || deleting"
            placeholder="选择模型"
            aria-label="生成模型"
            noDataText="请先在设置中添加视频模型"
            placement="top-start"
            @update:modelValue="data.followDefaultModel = false; data.model = $event"
            @visible-change="(visible) => visible && loadModels().catch((error) => showNodeError(error, '模型读取失败'))">
            <template v-if="!selectedModel" #prefix><icon-sparkles :size="17" /></template>
            <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option
                v-for="item in provider.models"
                :key="item.modelId"
                :label="item.label"
                :value="JSON.stringify([item.providerId, item.modelId])">
                <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
              </el-option>
            </el-option-group>
          </el-select>
          <generationSettings
            v-model:duration="data.duration"
            v-model:resolution="data.resolution"
            v-model:ratio="data.ratio"
            v-model:mode="data.mode"
            v-model:generateAudio="data.generateAudio"
            v-model:other="data.other"
            :ratios="ratioOptions"
            :model="selectedModel"
            :disabled="generating || deleting || !selectedModel" />
          <div class="generationActions">
            <mediaPrice v-if="generationInput" :input="{ ...generationInput, mediaType: 'video' }" :supported="selectedModel?.supportsPrice === true" />
            <el-button v-if="pendingRecovery" class="sendButton" :icon="IconPlayerStop" :loading="cancelling" :disabled="deleting || uploading" title="放弃任务" aria-label="放弃任务" @click="generationState.cancel().catch(error => showNodeError(error, '停止生成失败'))" />
            <el-button
              class="sendButton"
              :icon="generating ? IconPlayerStop : IconArrowUp"
              :disabled="cancelling || deleting || uploading || (!generating && !pendingRecovery && (!generationPrompt || !selectedModel))"
              :title="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成视频'"
              :aria-label="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成视频'"
              @click="generating ? generationState.cancel().catch(error => showNodeError(error, '停止生成失败')) : startGeneration().catch((error) => showNodeError(error, '视频生成失败'))" />
          </div>
        </div>
      </el-card>
      </template>
    </template>
  </nodeSkeleton>
  <videoActions ref="actions" :file="outputFile" :src="previewUrl" :disabled="generating || deleting || uploading" />
  <videoRetakeEntry ref="retake" :node="node" :file="outputFile" :disabled="generating || deleting || uploading || actions?.processing" />
  <videoContinuation ref="continuation" :file="outputFile" :disabled="generating || deleting || uploading" />
</template>

<script setup lang="ts">
import { toRaw, computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard, ElSelect, ElOption, ElOptionGroup, ElLoading, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { IconCameraAi, IconSparkles, IconArrowUp, IconPlayerStop, IconTransfer, IconMusic, IconLayersSubtract, IconScissors, IconMovie, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward, IconPlayerTrackNext, IconArrowsJoin } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, type NodeMediaModel, type NodeVideoRequest, type NodeHandle, type NodeInputValue } from "@lum/nodes-scaffold/runtime";
import { groupNodeModels } from "@lum/node-shared/groupNodeModels";
import modelLabel from "@lum/node-shared/modelLabel";
import { showNodeError } from "@lum/node-shared/showNodeError";
import { useDefaultModel } from "@lum/node-shared/useDefaultModel";
import { useNodeGeneration } from "@lum/node-shared/useNodeGeneration";
import { useModelForm } from "@lum/node-shared/useModelForm";
import { useNodeReferences } from "@lum/node-shared/useNodeReferences";
import { canReadProjectSetup, previewProjectStyle, type NodeProjectAppearance } from "@lum/node-shared/projectSetupBridge";
import { removeWritingSetupStyle, writingSetupStyle, type WritingSetupSnapshot } from "@lum/node-shared/writingSetup";
import { referencePromptModel } from "@lum/node-shared/promptText";
import promptInput from "@lum/node-shared/promptInput";
import videoPlayer from "@lum/node-video/videoPlayer";
import { getMediaMimeType } from "@lum/node-shared/mediaTypes";
import { videoRetakeSubmissionSchema, type VideoRetakeState, type VideoRetakeSubmission } from "@lum/node-video/videoRetakeState";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";
import videoActions from "@lum/node-video/videoActions";
import videoRetakeEntry from "@lum/node-video/videoRetakeEntry";
import videoContinuation from "@lum/node-video/videoContinuation";
import type { VideoContinuationLink } from "@lum/node-video/videoContinuationPlan";
import videoEnhancementEntry from "@lum/node-shared/videoEnhancementEntry";
import referenceItem from "@lum/node-shared/referenceItem";
import mediaHistory from "@lum/node-shared/mediaHistory";
import mediaPrice from "@lum/node-shared/mediaPrice";
import generationSettings from "./components/generationSettings.vue";
import videoPromptAnalysis from "@lum/node-shared/mediaPromptEditor";
import { readVideoPrompt, readVideoPromptContext, isVideoAssetReference, selectVideoReferences, type VideoPromptAnalysisState } from "./videoPromptContext";
import shotDesignBar from "./shotDesign/shotDesignBar.vue";
import { shotDesignPrompt, type ShotDesign } from "./shotDesign/catalog";

defineOptions({
  inheritAttrs: false,
  icon: IconCameraAi,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "VIDEO", "AUDIO", "STRING"], label: "图片、视频、音频、文本输入" },
    { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({
  label: "视频生成",
});
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { prompt: string; promptModel: PromptModel; model: string; followDefaultModel?: boolean; duration?: number; resolution: string; ratio: string; mode: string; generateAudio: boolean; other: Record<string, unknown>; identityReferences: string[]; promptReferenceSelection?: boolean; promptAnalysis: VideoPromptAnalysisState; shotDesign: ShotDesign; continuation?: VideoContinuationLink; writingProduction?: Partial<NodeProjectAppearance> & {clipId?: string; setupSnapshots?: WritingSetupSnapshot[]; styleOverride?: string; referenceEdges?: {source: string}[]; referenceNodeId?: string} });
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.model ??= "";
data.value.resolution ??= "";
data.value.mode ??= "";
data.value.generateAudio ??= true;
data.value.ratio ??= "9:16";
data.value.other ??= {};
data.value.identityReferences ??= [];
data.value.promptAnalysis ??= {model: ""};
data.value.shotDesign ??= {};
const { refList, referenceMentions, materialMentions, selectMaterialReference: connectMaterial, selectAssetReference: connectAsset, setReferencePreview, removeReference } = useNodeReferences();
const referenceFlow = useVueFlow();
const candidateAssets = computed(() => refList.value.filter(item => isVideoAssetReference(item, referenceFlow.getNodes.value, data.value.identityReferences)));
type GenerationReference = NodeInputValue & {projectStyle?: true};

function validatePromptReferences(prompt: string, references: readonly NodeInputValue[]) {
  for (const match of prompt.matchAll(/\{\{ref (\d+)\}\}/g)) {
    const reference = references[Number(match[1]) - 1];
    if (!reference) throw Error("提示词中的参考编号已失效，请重新 @ 选择对应资产");
    if (reference.dataType === "STRING" && !reference.value?.trim()) {
      throw Error(`参考 ${match[1]} 的文本为空，请补充内容或移除提示词中的引用`);
    }
  }
}

function readGenerationReferences() {
  const prompt = readVideoPrompt(node, referenceMentions.value);
  const selected = selectVideoReferences(prompt, refList.value, referenceFlow.getNodes.value, data.value.identityReferences, data.value.promptReferenceSelection);
  // 编辑器引用已重排，连接正文的编号仍指向现有请求中的真实引用。
  validatePromptReferences(selected.prompt, selected.references);
  for (const reference of selected.references) {
    if (reference.dataType === "STRING" && reference.value) validatePromptReferences(reference.value, selected.references);
  }
  const references: GenerationReference[] = [...selected.references];
  const image = data.value.writingProduction?.projectStyleImage;
  if (image) references.push({source: id, sourceHandle: "projectStyleImage", dataType: "IMAGE", value: {url: image.path, mimeType: image.mimeType}, projectStyle: true});
  return {prompt: selected.prompt, references};
}

const referenceSelection = computed(() => {
  try { return {selected: readGenerationReferences(), error: ""}; }
  catch (error) { return {selected: undefined, error: error instanceof Error ? error.message : "镜头引用读取失败"}; }
});
const selectedReferences = computed(() => referenceSelection.value.selected);
const assetReferences = computed(() => (selectedReferences.value?.references ?? []).filter(item => !item.projectStyle && isVideoAssetReference(item, referenceFlow.getNodes.value, data.value.identityReferences)));
const requiresImageReferenceMode = computed(() => assetReferences.value.length > 0 || selectedReferences.value?.references.some(item => item.projectStyle) === true);
const analysisContext = computed(() => {
  try {return {input: readVideoPromptContext(node, referenceFlow.getNodes.value, refList.value, referenceMentions.value, data.value.identityReferences), error: ""};}
  catch (error) {return {input: undefined, error: error instanceof Error ? error.message : "镜头资料读取失败"};}
});
function applyAnalyzedPrompt(prompt: string) {
  if (generating.value || deleting.value || uploading.value) return;
  data.value.promptModel = referencePromptModel(prompt, referenceMentions.value);
  data.value.prompt = prompt;
  data.value.promptReferenceSelection = true;
}
async function selectAssetReference() {
  const reference = await connectAsset();
  if (reference?.dataType === "IMAGE" && !data.value.identityReferences.includes(reference.id)) data.value.identityReferences.push(reference.id);
  return reference;
}
async function selectMaterialReference(referenceId: string) {
  const material = materialMentions.value.find(item => item.id === referenceId);
  const reference = await connectMaterial(referenceId);
  if (reference?.dataType === "IMAGE" && material && !referenceFlow.findNode(material.source)?.data.writingSource?.sourceKey?.startsWith("shot:") && !data.value.identityReferences.includes(reference.id)) data.value.identityReferences.push(reference.id);
  return reference;
}
async function addAssetPromptReference() {
  const reference = await selectAssetReference();
  if (!reference || disposed || generating.value || deleting.value) return;
  const context = analysisContext.value;
  if (context.error || !context.input) throw Error(context.error);
  applyAnalyzedPrompt(`${context.input.prompt}\n保持资产外观：${reference.value}（${reference.label || reference.name}）`);
}
watch(refList, values => {
  const production = data.value.writingProduction;
  if (!production || data.value.prompt.trim() !== "按连接的分镜制作说明和参考图完成本胶卷。") return;
  const brief = values.find(value => value.dataType === "STRING" && referenceFlow.findNode(value.source)?.data.writingSource?.sourceKey === `clip:${production.clipId}`);
  if (brief?.dataType !== "STRING" || !brief.value?.trim()) return;
  const prompt = brief.value;
  data.value.promptModel = referencePromptModel(prompt, referenceMentions.value); data.value.prompt = prompt;
});
const models = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
let disposed = false;
const deleting = ref(false);
const player = ref<InstanceType<typeof videoPlayer>>();
const actions = ref<InstanceType<typeof videoActions>>();
const retake = ref<InstanceType<typeof videoRetakeEntry>>();
const continuation = ref<InstanceType<typeof videoContinuation>>();
const videoWidth = ref(0);
let generationController: AbortController | undefined;
const retakeData = computed(() => node.data as typeof node.data & { videoRetakeEditor?: string; videoRetakeAttempt?: VideoRetakeSubmission; videoRetakeResult?: { taskId: string; path: string; mimeType: string }; mediaTask?: import("@lum/node-shared/useNodeGeneration").NodeGenerationTask });
const retakeModes: Record<string, string> = { singleImage: "选区首帧", startEndRequired: "选区首尾帧（必填）", endFrameOptional: "选区首尾帧", startFrameOptional: "选区首尾帧" };
const retakeSummary = computed(() => {
  const submission = retakeData.value.videoRetakeAttempt;
  if (!submission) return;
  const request = submission.request;
  const native = request.operation === "edit";
  const requestRange = request.sourceRange as { start?: unknown; end?: unknown } | undefined;
  let range = submission.sourceRange;
  if (!range && typeof requestRange?.start === "number" && typeof requestRange.end === "number") {
    range = { start: requestRange.start, end: requestRange.end };
  }
  if (!range) {
    const history = referenceFlow.findNode(submission.sourceNodeId)?.data.videoRetake as VideoRetakeState | undefined;
    range = history?.attempts?.find(item => item.id === submission.taskId && item.childNodeId === id
      && JSON.stringify(item.submission) === JSON.stringify(submission))?.range;
  }
  return {
    taskId: submission.taskId,
    method: native ? "原生视频编辑" : "参考帧再生成",
    mode: typeof request.mode === "string" ? retakeModes[request.mode] ?? request.mode : native ? "原生编辑" : "未记录",
    range: range ? `${range.start}–${range.end} 秒` : "未记录",
    duration: typeof request.duration === "number" ? `${request.duration} 秒` : "未记录",
    resolution: typeof request.resolution === "string" ? request.resolution : "供应商默认",
    model: [request.providerId, request.modelId].filter(value => typeof value === "string").join(" / "),
  };
});
const retakePersistence = useNodePersistence();
const choosingStyle = ref(false);
async function adoptProjectStyle() {
  if (choosingStyle.value || generating.value) return;
  choosingStyle.value = true;
  try {
    const context = retakePersistence?.();
    const appearance = await previewProjectStyle(writingSetupStyle(data.value.writingProduction));
    if (!appearance.projectStyle) return;
    if (!context || retakePersistence?.()?.canvasPath !== context.canvasPath || referenceFlow.findNode(id) !== node || generating.value) throw Error("画布或节点已变化，请重试");
    const nextId = crypto.randomUUID();
    const {prompt, promptModel, model, duration, resolution, ratio, mode, generateAudio, other, identityReferences, promptReferenceSelection, shotDesign} = data.value;
    const cleaned = removeWritingSetupStyle(prompt, writingSetupStyle(data.value.writingProduction).text);
    const current = data.value.writingProduction;
    referenceFlow.addNodes({id: nextId, type: node.type, position: {x:node.position.x+440, y:node.position.y}, data: {
      label: `${node.data.label || '视频生成'} · 新画风`,prompt:cleaned,promptModel:cleaned===prompt ? structuredClone(toRaw(promptModel)) : referencePromptModel(cleaned,referenceMentions.value),model,duration,resolution,ratio,mode,generateAudio,
      other:structuredClone(toRaw(other)),identityReferences:[...identityReferences],promptReferenceSelection,shotDesign:structuredClone(toRaw(shotDesign)),
      writingProduction:{setupSnapshots:current?.setupSnapshots ? structuredClone(toRaw(current.setupSnapshots)) : undefined,...appearance},
    }});
    referenceFlow.addEdges(referenceFlow.getEdges.value.filter(edge => edge.target===id && !referenceFlow.findNode(edge.source)?.data.writingSource?.sourceKey?.startsWith("styleRef:"))
      .map(edge => ({id:crypto.randomUUID(), source:edge.source, sourceHandle:edge.sourceHandle, target:nextId, targetHandle:edge.targetHandle})));
    await context.save();
  } catch (error) {showNodeError(error,"采用项目画风失败");} finally {choosingStyle.value=false;}
}
const generationState = useNodeGeneration(outputs, () => generationController?.abort(), { ai,
  assertTask(task) {
    const saved = task.recoveryData as { videoRetake?: VideoRetakeSubmission } | undefined;
    if (!saved?.videoRetake) return;
    if (task.taskId !== saved.videoRetake.taskId || JSON.stringify(retakeData.value.videoRetakeAttempt) !== JSON.stringify(saved.videoRetake)
      || retakeData.value.videoRetakeEditor !== retakeEditorIdentity()) throw Error("重拍子节点已被改作其他用途，原任务仍保留，请恢复原配置后查询");
  },
  stageOutput(task) {
    if (retakeData.value.videoRetakeAttempt?.taskId !== task.taskId || task.state !== "succeeded") return;
    const output = outputs.value.video;
    if (output?.dataType !== "VIDEO") return;
    const previous = retakeData.value.videoRetakeResult;
    retakeData.value.videoRetakeResult = { taskId: task.taskId, path: output.value.url, mimeType: output.value.mimeType };
    return () => { retakeData.value.videoRetakeResult = previous; };
  },
});
const { generating, pendingRecovery, cancelling } = generationState;
useDefaultModel(data, models, generating);
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
watch(generating, value => { if (!value && !disposed && !deleting.value && !models.value.length) void loadModels().catch(error => showNodeError(error, "模型读取失败")); });
// ACT: 供应商未声明视频比例范围，沿用界面的通用比例，具体支持范围由供应商校验。
const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const selectedModel = computed(() => models.value.find((item) => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
useModelForm(data, selectedModel);
const selectedMode = computed(() => selectedModel.value?.mode?.find((item) => JSON.stringify(item) === data.value.mode) as NodeVideoRequest["mode"]);
const frameMode = computed(() => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(String(selectedMode.value)));
const mediaCounts = computed(() => ({
  image: selectedReferences.value?.references.filter((item) => item.dataType === "IMAGE").length ?? 0,
  video: selectedReferences.value?.references.filter((item) => item.dataType === "VIDEO").length ?? 0,
  audio: selectedReferences.value?.references.filter((item) => item.dataType === "AUDIO").length ?? 0,
}));
const matchingModes = computed(() => getMatchingModes(selectedModel.value));

function getMatchingModes(choice?: NodeMediaModel) {
  return (choice?.mode ?? []).filter((mode) => {
    const { image, video, audio } = mediaCounts.value;
    if (Array.isArray(mode)) return image + video + audio > 0 && Object.entries(mediaCounts.value).every(([type, count]) =>
      count <= Number(mode.find((item) => item.startsWith(`${type}Reference:`))?.split(":")[1] ?? 0)
    );
    // 资产外观和画风图必须使用参考模式，不能作为首尾帧。
    if (requiresImageReferenceMode.value) return false;
    if (mode === "text") return image + video + audio === 0;
    if (video || audio) return false;
    if (mode === "singleImage") return image === 1;
    if (mode === "startEndRequired") return image === 2;
    return ["endFrameOptional", "startFrameOptional"].includes(mode) && image >= 1 && image <= 2;
  });
}

function getDurations(choice: NodeMediaModel) {
  return [...new Set((choice.durationResolutionMap ?? []).flatMap((item) => item.duration))].sort((a, b) => a - b);
}

function getResolutions(choice: NodeMediaModel, duration?: number) {
  // ACT: 当前视频分辨率使用 p 单位；出现其他单位时再统一换算。
  return [...new Set((choice.durationResolutionMap ?? []).filter((item) => item.duration.includes(duration!)).flatMap((item) => item.resolution))]
    .sort((left, right) => (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity));
}
// ACT: 引用改变时只替换不适用的模式；普通媒体优先作为参考，避免自动变成首尾帧。
watch([selectedModel, matchingModes, selectedReferences, () => data.value.mode], ([choice, matches, selected]) => {
  // 引用校验出错时无法推断可用模式。保留用户选择，修正引用后再重新判断。
  if (!choice || !selected || matches.some((item) => JSON.stringify(item) === data.value.mode)) return;
  const modes = choice.mode ?? [];
  // 续写的尾帧要当首帧用：优先选首尾帧模式（供应商按 first_frame 提交），其次单图，最后才是参考模式；
  // 单图在部分供应商那里只是参考图。尾帧连线还没送达时也先按首帧模式预选，
  // 否则会先落到参考模式，连线到达后因为参考模式同样适用而不再改回来。
  const continuing = data.value.continuation?.method === "frame";
  const firstFrameMode = (items: typeof modes) => continuing
    ? items.find((item) => item === "endFrameOptional") ?? items.find((item) => item === "startFrameOptional") ?? items.find((item) => item === "singleImage") : undefined;
  const mode = firstFrameMode(matches) ?? matches.find(Array.isArray) ?? matches.find((item) => item === "singleImage")
    ?? matches.find((item) => item === "endFrameOptional") ?? matches[0]
    ?? modes.find((item) => JSON.stringify(item) === data.value.mode) ?? firstFrameMode(modes) ?? modes.find(Array.isArray) ?? modes[0];
  data.value.mode = mode === undefined ? "" : JSON.stringify(mode);
}, { flush: "sync" });
// ACT: 参数在节点内归一化，未选中、未挂载底部设置时也可由 Agent 直接生成。
watch([selectedModel, () => data.value.duration], ([choice]) => {
  if (!choice) return;
  const durations = getDurations(choice);
  if (!durations.includes(data.value.duration!)) data.value.duration = durations[0];
  const resolutions = getResolutions(choice, data.value.duration);
  if (!resolutions.includes(data.value.resolution)) data.value.resolution = resolutions[0] ?? "";
  if (!ratioOptions.includes(data.value.ratio)) data.value.ratio = "9:16";
  if (choice.audio !== "optional") data.value.generateAudio = choice.audio === true;
}, { flush: "sync" });
const modelGroups = computed(() => groupNodeModels(models.value));
/** 续写的尾帧在本次请求里是否真的作为首帧提交。 */
const continuationFirstFrame = computed(() => {
  const link = data.value.continuation;
  if (link?.method !== "frame") return false;
  const images = selectedReferences.value?.references.filter(item => item.dataType === "IMAGE") ?? [];
  // 首尾帧模式下尾帧排第一张就按首帧提交（见 getGenerationInput），包括「首帧可选」只有一张图的情况。
  return images[0]?.source === link.tailFrameNodeId && (selectedMode.value === "singleImage" || frameMode.value);
});
const continuationSummary = computed(() => {
  const link = data.value.continuation;
  if (!link) return "";
  if (link.method === "video") return "参考原视频";
  if (typeof link.tailTime !== "number") return "尾帧接首帧";
  return `尾帧接首帧（原片 ${link.tailTime.toFixed(2)} 秒处，${link.backFrames ? `已从最后一帧往前退 ${link.backFrames} 帧` : "最后一帧"}）`;
});
const continuationWarning = computed(() => {
  const link = data.value.continuation, references = selectedReferences.value?.references;
  if (!link || !selectedModel.value || !references) return "";
  if (link.method === "video") {
    return references.some(item => item.dataType === "VIDEO" && item.source === link.sourceNodeId) ? "" : "原片没有被本次生成采用（连线已断开，或提示词改成了只用 @ 点名的引用），模型看不到上一段视频。";
  }
  if (!references.some(item => item.dataType === "IMAGE" && item.source === link.tailFrameNodeId)) return "尾帧图片没有被本次生成采用（连线已断开，或提示词改成了只用 @ 点名的引用），这一段不会从原片结尾接着走。";
  return continuationFirstFrame.value ? "" : "当前模式下尾帧只作为参考图，不保证从同一帧开始。要画面接得上，请在生成设置里把模式改为「尾帧可选」「首帧可选」或「单图参考」，并让尾帧排在第一张。";
});
function getGenerationPrompt(prompt: string, references: GenerationReference[]) {
  const lines = [
    prompt.trim(),
    ...references.flatMap((item, index) => {
      if (item.projectStyle) return [];
      const source = referenceFlow.findNode(item.source)?.data.writingSource;
      if (item.dataType === "STRING" && item.value?.trim()) return [`参考 ${index + 1}：\n${item.value.trim()}`];
      if (item.dataType === "IMAGE" && source?.sourceKey?.startsWith("styleRef:")) return [`{{ref ${index + 1}}} 仅为光线、色彩、构图与材质的画风参考；不得带入参考图中的人物、物件或场景。`];
      if (isVideoAssetReference(item, referenceFlow.getNodes.value, data.value.identityReferences)) return [`{{ref ${index + 1}}} 为所选资产外观参考，仅约束当前提示词要求出镜的主体及可见部分；不添加参考图中的其他人物、背景或道具，不扩大景别，不作为首尾帧。`];
      if (item.dataType === "IMAGE" && source?.sourceKey?.startsWith("shot:")) return [`{{ref ${index + 1}}} 为分镜构图参考；以当前提示词的主体、景别和动作要求为准，不添加当前镜头以外的人物或动作。`];
      return [];
    }),
  ].filter(Boolean);
  const link = data.value.continuation;
  if (link) {
    // 续写说明随请求附加，续写内容留空时也能直接生成。
    const keep = "保持人物、场景、光线、画风和镜头运动方向一致，不切换场景，不重新起幅";
    const videoIndex = references.findIndex(item => item.dataType === "VIDEO" && item.source === link.sourceNodeId);
    const imageIndex = references.findIndex(item => item.dataType === "IMAGE" && item.source === link.tailFrameNodeId);
    if (link.method === "video" && videoIndex >= 0) lines.push(`{{ref ${videoIndex + 1}}} 是需要续写的上一段视频：新视频紧接它的最后一帧开始，不重复已有内容，${keep}。`);
    else if (link.method === "frame" && imageIndex >= 0) lines.push(continuationFirstFrame.value
      ? `本段是上一段视频的续写，首帧就是上一段的最后一帧：从这一画面自然接着往下演，${keep}。`
      : `{{ref ${imageIndex + 1}}} 是上一段视频的最后一帧：新视频从这一画面开始并自然接着往下演，${keep}。`);
  }
  if (!lines.length) return "";
  // 镜头设定紧跟在用户提示词之后，参考图说明排在后面。
  const design = shotDesignPrompt(data.value.shotDesign);
  if (design) lines.splice(prompt.trim() ? 1 : 0, 0, design);
  const styleIndex = references.findIndex(item => item.projectStyle);
  if (styleIndex >= 0) lines.push(`{{ref ${styleIndex + 1}}} 仅为光线、色彩、构图与材质的画风参考；不得带入参考图中的人物、物件或场景。`);
  return lines.join("\n\n");
}
const generationPrompt = computed(() => selectedReferences.value ? getGenerationPrompt(selectedReferences.value.prompt, selectedReferences.value.references) : "");
const generationInput = computed(() => {
  const selected = selectedReferences.value, choice = selectedModel.value;
  if (selected && choice && generationPrompt.value && !generationModeError(choice)) return getGenerationInput(selected, choice);
});

function generationModeError(choice: NodeMediaModel) {
  const mode = selectedMode.value;
  const matching = mode !== undefined && matchingModes.value.includes(mode);
  if (requiresImageReferenceMode.value && (!matching || !Array.isArray(mode))) {
    return "当前模型或模式不支持已选图片参考，请选择支持图片参考的模型。资产与画风图不会自动作为首尾帧提交。";
  }
  if (choice.mode?.length && !matching) return "当前模型没有适合这些参考素材的生成模式，请更换模型或调整引用";
}

function getGenerationInput({prompt, references}: ReturnType<typeof readGenerationReferences>, choice: NodeMediaModel): Omit<NodeVideoRequest, "directory"> {
  const images: NonNullable<NodeVideoRequest["images"]> = [];
  const videos: NonNullable<NodeVideoRequest["videos"]> = [];
  const audios: NonNullable<NodeVideoRequest["audios"]> = [];
  const referenceOrder: NonNullable<NodeVideoRequest["referenceOrder"]> = references.map(item => {
    if (item.dataType === "IMAGE" && item.value) {
      const index = images.push({ path: item.value.url, mimeType: item.value.mimeType }) - 1;
      return { type: "image", index };
    }
    if (item.dataType === "VIDEO" && item.value) {
      const index = videos.push({ path: item.value.url, mimeType: item.value.mimeType }) - 1;
      return { type: "video", index };
    }
    if (item.dataType === "AUDIO" && item.value) {
      const index = audios.push({ path: item.value.url, mimeType: item.value.mimeType }) - 1;
      return { type: "audio", index };
    }
    return { type: "text" };
  });
  // 续写：原片尾帧排在第一张时始终按首帧提交。「首帧可选」模式平时把唯一的一张图当尾帧，续写时那样会接反。
  const link = data.value.continuation;
  const tailFirst = link?.method === "frame" && references.find(item => item.dataType === "IMAGE" && item.value)?.source === link.tailFrameNodeId;
  const singleAsLast = selectedMode.value === "startFrameOptional" && images.length === 1 && !tailFirst;
  const firstFrame = frameMode.value && !singleAsLast ? images[0] : undefined;
  const lastFrame = frameMode.value ? images[singleAsLast ? 0 : 1] : undefined;
  return {
    providerId: choice.providerId,
    modelId: choice.modelId,
    prompt: getGenerationPrompt(prompt, references),
    mode: selectedMode.value,
    duration: data.value.duration,
    resolution: data.value.resolution || undefined,
    ratio: data.value.ratio,
    generateAudio: choice.audio === "optional" ? data.value.generateAudio : choice.audio,
    other: Object.keys(data.value.other).length ? { ...data.value.other } : undefined,
    outputDirectory: `assets/${id}`,
    images: frameMode.value ? undefined : images,
    firstFrame,
    lastFrame,
    videos,
    audios,
    referenceOrder: referenceOrder.map(reference => frameMode.value && reference.type === "image"
      ? { type: reference.index === 0 && firstFrame ? "firstFrame" : "lastFrame" } : reference),
  };
}
const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showNodeError(error, "视频读取失败")
);
// 续写片段生成出新视频后自动与原片拼接；手动替换视频或从历史里选择不触发。
let continuationBaseline: string | undefined;
watch(generating, (running, before) => {
  if (running) {
    continuationBaseline = outputFile.value?.url ?? "";
    return;
  }
  const url = outputFile.value?.url;
  if (!before || disposed || deleting.value || !data.value.continuation?.autoCompose || !url || url === continuationBaseline) return;
  void nextTick().then(() => {
    if (!disposed && outputFile.value?.url === url) continuation.value?.compose({ auto: true });
  });
});

onMounted(() => {
  window.addEventListener("lum:plugin-installed", refreshProviderModels);
  window.addEventListener("lum:provider-config-changed", refreshProviderModels);
  void loadModels().catch(error => { if (!disposed) showNodeError(error, "模型读取失败"); });
});
onScopeDispose(() => {
  disposed = true;
  window.removeEventListener("lum:plugin-installed", refreshProviderModels);
  window.removeEventListener("lum:provider-config-changed", refreshProviderModels);
  generationController?.abort();
});

async function refreshProviderModels(event: Event) {
  if (event.type === "lum:plugin-installed" && (event as CustomEvent<{ type?: string }>).detail?.type !== "provider") return;
  try {
    await generation;
    if (!disposed && !deleting.value) await loadModels();
  } catch (error) {
    if (!disposed) showNodeError(error, "模型读取失败");
  }
}

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || deleting.value || uploading.value || disposed) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("video/")) return void showNodeError("请选择视频文件", "视频替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("视频不能为空且不能超过 100 MB", "视频替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.video = { dataType: "VIDEO", value: { url, mimeType } };
  } catch (error) {
    showNodeError(error, "视频替换失败");
  } finally {
    uploading.value = false;
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    if (disposed || generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "video");
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择及其参数。
    if (!data.value.model) {
      const first = modelGroups.value[0]?.models[0];
      data.value.model = first ? JSON.stringify([first.providerId, first.modelId]) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

function retakeEditorIdentity() {
  return JSON.stringify([data.value.prompt, data.value.model, data.value.duration, data.value.resolution, data.value.ratio, data.value.mode, data.value.generateAudio, data.value.other]);
}
async function startRetake(expected: VideoRetakeSubmission, signal?: AbortSignal) {
  if (cancelling.value || uploading.value || deleting.value) throw Error("视频节点正在处理其他操作");
  await loadModels();
  signal?.throwIfAborted();
  const frozen = videoRetakeSubmissionSchema.parse(JSON.parse(JSON.stringify(expected)));
  const input = frozen.request as unknown as NodeVideoRequest;
  const savedPrompt = data.value.prompt, savedModel = data.value.model, editorIdentity = retakeEditorIdentity();
  const guard = () => {
    const current = retakePersistence?.();
    const source = referenceFlow.findNode(frozen.sourceNodeId);
    const attempt = (source?.data as { videoRetake?: { attempts?: { id: string; childNodeId: string; submission: VideoRetakeSubmission }[] } })?.videoRetake?.attempts?.find(item => item.id === frozen.taskId);
    if (disposed || deleting.value || referenceFlow.findNode(id) !== node || current?.directory !== frozen.directory || current.canvasPath !== frozen.canvasPath
      || !attempt || attempt.childNodeId !== id || JSON.stringify(attempt.submission) !== JSON.stringify(frozen) || retakeEditorIdentity() !== editorIdentity
      || JSON.stringify(retakeData.value.videoRetakeAttempt) !== JSON.stringify(frozen) || data.value.prompt !== savedPrompt || data.value.model !== savedModel
      || source?.data.outputs?.[frozen.sourceHandleId]?.value?.url !== frozen.sourcePath
      || retakeData.value.mediaTask && retakeData.value.mediaTask.taskId !== frozen.taskId) throw Error("重拍源、候选归属或节点设置已变化");
  };
  guard();
  if (input.directory !== frozen.directory || input.prompt !== savedPrompt || JSON.stringify([input.providerId, input.modelId]) !== savedModel) throw Error("重拍请求与节点不一致");
  const workspace = files.getWorkspaceFiles();
  const identity = await workspace.inspectBinary(frozen.sourcePath, signal);
  signal?.throwIfAborted();
  guard();
  if (identity.sha256 !== frozen.sourceHash) throw Error("源视频版本已变化");
  retakeData.value.videoRetakeEditor = editorIdentity;
  const controller = new AbortController(); generationController = controller;
  generation = generationState.run(async () => {
    const beforeSubmit = () => {
      // 画布保存结束后、发送请求前再检查发起信号；发送后由子节点独立处理。
      signal?.throwIfAborted();
      guard();
    };
    beforeSubmit();
    const [result] = await generationState.generate("video", input, controller.signal, { videoRetake: frozen }, { taskId: frozen.taskId, beforeSubmit });
    guard(); controller.signal.throwIfAborted();
    if (!result) throw Error("供应商未返回视频");
    outputs.value.video = { dataType: "VIDEO", value: { url: result.path, mimeType: result.mimeType } };
  }).catch(error => showNodeError(error, "片段重拍失败")).finally(() => { generationController = undefined; });
  return { status: "generating", taskId: frozen.taskId };
}

async function startGeneration(expectedTaskId?: string, retake?: VideoRetakeSubmission, signal?: AbortSignal) {
  if (expectedTaskId && retakeData.value.videoRetakeEditor && retakeData.value.videoRetakeEditor !== retakeEditorIdentity()) throw Error("候选节点设置已被修改，不能从重拍面板控制");
  if (expectedTaskId && retakeData.value.mediaTask?.taskId !== expectedTaskId) throw Error("候选任务已变化或尚未提交，不能创建另一任务");
  if (retake && (retakeData.value.mediaTask || generating.value || pendingRecovery.value)) throw Error("候选子节点已有关联任务，请查询同一任务");
  if (retake) return startRetake(retake, signal);
  if (expectedTaskId && !pendingRecovery.value) return { status: generating.value ? "generating" : "settled", taskId: expectedTaskId };
  if (cancelling.value) throw new Error("任务正在取消，请稍后重试");
  if (generating.value) throw new Error("视频正在生成，请等待完成");
  if (uploading.value) throw new Error("视频正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (pendingRecovery.value) {
    generation = generationState.resume().catch(error => showNodeError(error, "视频任务复查失败"));
    return { status: "generating" };
  }
  if (canReadProjectSetup() && !data.value.writingProduction?.setupSnapshots && !Object.hasOwn(data.value.writingProduction ?? {},'projectStyle')) {
    if (!readVideoPrompt(node, referenceMentions.value) || !selectedModel.value) throw Error('请先填写提示词并选择视频模型');
    if (choosingStyle.value) throw Error('请先完成画风确认');
    choosingStyle.value=true;
    try {
      const context=retakePersistence?.(), appearance=await previewProjectStyle();
      if (disposed || !context || retakePersistence?.()?.canvasPath!==context.canvasPath || referenceFlow.findNode(id)!==node) throw Error('画布或节点已变化');
      data.value.writingProduction={...data.value.writingProduction,...appearance};await context.save();
    } finally {choosingStyle.value=false;}
  }
  const choice = selectedModel.value;
  // ACT: 提交时按稳定 ID 解析，避免依赖编辑器挂载及异步重排同步。
  const selected = readGenerationReferences();
  const {references} = selected;
  if (!choice) throw new Error("请先选择视频模型");
  const modeError = generationModeError(choice);
  if (modeError) throw Error(modeError);
  const input = getGenerationInput(selected, choice);
  if (!input.prompt) throw new Error("请输入生成提示词");
  if (references.some(item => item.value === undefined)) throw new Error("本镜采用的引用暂无内容，请先补充引用内容");
  validatePromptReferences(input.prompt, references);
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  generationController = controller;
  // ACT: 工具立即返回；任务身份先保存，卸载只停止等待，重新打开后复查。
  generation = generationState.run(() => workspace
    .list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      return generationState.generate("video", { ...input, directory }, controller.signal);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回视频");
      outputs.value.video = { dataType: "VIDEO", value: { url: result.path, mimeType: result.mimeType } };
    }))
    .catch((error) => showNodeError(error, "视频生成失败"))
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating" };
}

nodeEvent.on("save", (reason) => {
  if (reason === "reload" && (generating.value || uploading.value || deleting.value)) throw new Error("视频处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("视频正在替换，请稍后删除节点");
  deleting.value = true;
  try {
    await generationState.cancel(false);
    await generation;
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoWidth.value = Math.max(180, (240 * video.videoWidth) / video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

function getConfig() {
  return {
    config: {
      providerId: selectedModel.value?.providerId ?? "",
      modelId: selectedModel.value?.modelId ?? "",
      duration: data.value.duration,
      resolution: data.value.resolution,
      ratio: data.value.ratio,
      mode: selectedMode.value,
      generateAudio: data.value.generateAudio,
      other: data.value.other,
      shotDesign: data.value.shotDesign,
    },
    models: models.value,
    ratios: ratioOptions,
    matchingModes: matchingModes.value,
  };
}

nodeTools.register({
  name: "getConfig",
  description: "读取此视频生成节点的当前配置（含用户在界面选的镜头设定 shotDesign，生成时自动附加到提示词）、可选视频模型能力、通用比例及适合当前引用的模式，不含密钥；时长与分辨率须符合 durationResolutionMap",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return getConfig();
  },
});

nodeTools.register({
  name: "setConfig",
  description: "修改此视频生成节点的模型、时长、分辨率、比例、模式或声音；先用 getConfig 查询能力，providerId 与 modelId 必须同时提供；mode 使用返回的原始字符串或数组，须匹配当前引用；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    duration: z.number().positive().optional(),
    resolution: z.string().min(1).optional(),
    ratio: z.enum(ratioOptions).optional(),
    mode: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    generateAudio: z.boolean().optional(),
  }).refine((args) => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value
      : models.value.find((item) => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error("请选择 getConfig 返回的有效视频模型");
    const durations = getDurations(choice);
    if (args.duration !== undefined && !durations.includes(args.duration)) throw new Error(`当前模型不支持时长 ${args.duration}，可选：${durations.join("、")}`);
    const duration = args.duration ?? (durations.includes(data.value.duration!) ? data.value.duration : durations[0]);
    const resolutions = getResolutions(choice, duration);
    if (args.resolution !== undefined && !resolutions.includes(args.resolution)) throw new Error(`当前时长不支持分辨率 ${args.resolution}，可选：${resolutions.join("、")}`);
    const resolution = args.resolution ?? (resolutions.includes(data.value.resolution) ? data.value.resolution : resolutions[0] ?? "");
    if (args.mode !== undefined && !getMatchingModes(choice).some((item) => JSON.stringify(item) === JSON.stringify(args.mode))) throw new Error("所选模式不受当前模型支持或不适用于当前引用，请根据模型能力及已连接素材选择");
    if (args.generateAudio !== undefined && choice.audio !== "optional" && args.generateAudio !== (choice.audio === true)) throw new Error("当前模型不支持切换声音，请查看 getConfig 返回的 audio 能力");
    data.value.model = JSON.stringify([choice.providerId, choice.modelId]);
    data.value.duration = duration;
    data.value.resolution = resolution;
    if (args.ratio !== undefined) data.value.ratio = args.ratio;
    if (args.mode !== undefined) data.value.mode = JSON.stringify(args.mode);
    if (args.generateAudio !== undefined) data.value.generateAudio = args.generateAudio;
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的视频生成提示词，仅接收 prompt，支持 {{ref 1}} 等参考标记；时长 duration、分辨率等配置须先用 node:getConfig 查询能力，再单独调用 node:setConfig；不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt: value }) {
    if (deleting.value) throw new Error("节点正在删除，请稍后修改");
    data.value.prompt = value;
    data.value.promptModel = referencePromptModel(value, referenceMentions.value);
    return { prompt: value };
  },
});

nodeTools.register({
  name: "generateVideo",
  description: "启动此节点的后台视频生成，使用当前提示词、模型、模式、时长、分辨率、比例和参考素材；立即返回已开始，用 getGenerationStatus 查询完成结果，cancelGeneration 停止生成",
  parameters: z.strictObject({ expectedTaskId: z.uuid().optional(), retake: videoRetakeSubmissionSchema.optional() }).refine(args => !args.expectedTaskId || !args.retake, "查询和提交不能同时进行"),
  execute({ expectedTaskId, retake }, { signal }) {
    signal?.throwIfAborted();
    return startGeneration(expectedTaskId, retake, signal);
  },
});
</script>

<style scoped lang="scss">
.defaultModelFollow{display:flex;align-items:center;gap:6px;margin:10px 0;font-size:12px;color:var(--el-text-color-secondary)}
.videoContent {
  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    --nodeMediaHeight: 100%;

    .videoEmpty { min-height: 0; height: 100%; }
  }

  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .videoEmpty {
    display: grid;
    place-items: center;
    min-height: 144px;
    color: var(--el-text-color-placeholder);
  }

  :deep(.el-loading-mask) {
    pointer-events: none;
  }

}

.promptCard {
  max-height: min(560px, 54vh);
  overflow: auto;
  .videoPromptHeading { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 13px; }
  .referenceHint {
    margin: 8px 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
  .continuationHint {
    display: grid;
    gap: 4px;
    .continuationWarning { color: var(--el-color-warning); }
    label { display: flex; align-items: center; gap: 6px; }
  }

  .promptFooter {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;

    .modelSelect {
      width: 280px;
      min-width: 0;

      &:deep(.el-select__wrapper) {
        gap: 6px;
        padding: 0;
        box-shadow: none;
        background: transparent;
      }
    }

    .generationActions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;

      .sendButton {
        width: 32px;
        height: 32px;
        margin-left: 0;
        padding: 0;
        --el-button-bg-color: var(--el-text-color-primary);
        --el-button-border-color: transparent;
        --el-button-text-color: var(--el-bg-color);
        --el-button-hover-bg-color: var(--el-text-color-regular);
        --el-button-hover-border-color: transparent;
        --el-button-hover-text-color: var(--el-bg-color);
      }
    }
  }
}
</style>
