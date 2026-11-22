<template>
  <el-dialog :modelValue="true" title="片段重拍" width="min(1120px, calc(100vw - 24px))" top="min(5vh, 40px)" appendToBody :closeOnClickModal="false" :beforeClose="close">
    <div class="retakePanel" @keydown.stop @pointerdown.stop>
      <div v-if="notice" class="notice" role="status">{{ notice }}</div>
      <div v-if="error" class="error" role="alert">{{ error }}</div>
      <div class="workGrid">
        <section ref="sourcePane" class="sourcePane" aria-label="原片与选区">
          <div class="paneHeading"><strong>{{ node.data.label || '原片' }}</strong><span v-if="source">原片保留 · {{ seconds(source.media.duration) }} 秒</span></div>
          <div v-if="source" class="quiet">{{ source.media.video.displayWidth }} × {{ source.media.video.displayHeight }} · {{ frameRate }} fps（探测平均值） · {{ source.media.audio ? '有音轨' : '无音轨' }}</div>
          <p v-if="sourceError" class="error" role="alert">{{ sourceError }}</p>
          <videoRetakePreview v-if="source && !sourceError" ref="comparison" :sourceSrc="sourceSrc" :sourceDuration="source.media.video.end" :selection="range"
            :candidateSrc="boundaryPreview ? undefined : preview?.src" :candidateStart="preview?.candidate.range.start" :playbackRange="boundaryPreview ?? preview?.attempt.range" />
          <div v-if="preview" class="buttonRow">
            <el-button v-if="preview.attempt.range.start > minimum" size="small" :disabled="!!busy" @click="listenBoundary('start')">试听原片入点</el-button>
            <el-button v-if="preview.attempt.range.end < maximum" size="small" :disabled="!!busy" @click="listenBoundary('end')">试听原片出点</el-button>
            <el-button v-if="boundaryPreview" size="small" :disabled="!!busy" @click="boundaryPreview = undefined">返回同步对比</el-button>
          </div>
          <p v-if="boundaryPreview" class="quiet">原片交界预览：{{ seconds(boundaryPreview.start) }}–{{ seconds(boundaryPreview.end) }} 秒。按播放键试听。</p>
          <el-button v-if="preview" size="small" @click="clearPreview">返回原片选区</el-button>
          <fieldset class="rangeFields" :disabled="!!busy || !source || !!sourceError">
            <legend>原片选区（秒）</legend>
            <label>开始
              <input v-model.number="start" type="number" step="0.001" :min="minimum" :max="maximum" aria-label="选区开始秒数" @change="seekBoundary('start')" />
              <input :value="start" type="range" :min="minimum" :max="maximum" :step="sliderStep" aria-label="拖动选区开始" @input="moveBoundary('start', $event)" />
            </label>
            <label>结束
              <input v-model.number="end" type="number" step="0.001" :min="minimum" :max="maximum" aria-label="选区结束秒数" @change="seekBoundary('end')" />
              <input :value="end" type="range" :min="minimum" :max="maximum" :step="sliderStep" aria-label="拖动选区结束" @input="moveBoundary('end', $event)" />
            </label>
          </fieldset>
          <p v-if="source && !range" class="error">请选择 {{ seconds(minimum) }}–{{ seconds(maximum) }} 秒内的连续区间。</p>
          <p v-if="range" class="quiet">替换 {{ seconds(range.start) }}–{{ seconds(range.end) }} 秒（{{ seconds(range.duration) }} 秒）。按时间戳切分，校验容差 {{ seconds(range.toleranceSeconds) }} 秒；最终视频会统一编码。</p>
        </section>

        <section class="requestPane" aria-label="重拍要求和模型">
          <div class="paneHeading"><strong>重拍要求</strong><el-button size="small" text :disabled="!!busy" @click="reload()">刷新源片与模型</el-button></div>
          <div v-if="sourceChanged" class="notice">原片内容与上次草稿不同。请为当前版本新建草稿，旧尝试仍可查看。</div>
          <el-button v-if="sourceChanged" :disabled="!!busy" @click="beginNewDraft">为当前原片新建草稿</el-button>
          <fieldset class="requestFields" :disabled="!!busy || !source || !!sourceError || (sourceChanged && !newSourceDraft)">
            <legend class="srOnly">重拍参数</legend>
            <label class="field">重拍方式
              <select v-model="method" aria-label="重拍方式" @change="changeMethod">
                <option value="">选择重拍方式</option>
                <option value="native">原生视频编辑</option>
                <option value="frames">参考帧再生成</option>
              </select>
            </label>
            <p v-if="method === 'frames'" class="notice">使用所选片段内的实际参考帧生成新片段，人物、动作和接续需在候选中检查。</p>
            <p v-if="catalogError" class="error" role="alert">{{ catalogError }}</p>
            <p v-else-if="method === 'native' && catalogs?.nativeUnavailableReason" class="notice">{{ catalogs.nativeUnavailableReason }}</p>
            <p v-else-if="method === 'frames' && catalogs && !choices.length" class="notice">没有同时声明参考帧模式及有效时长和分辨率的视频模型。请在媒体模型设置中检查配置。</p>
            <template v-if="method && choices.length">
              <label class="field">视频模型
                <select v-model="modelKey" aria-label="重拍视频模型" @change="chooseModel">
                  <option value="">选择视频模型</option>
                  <option v-for="item in choices" :key="keyFor(item)" :value="keyFor(item)">{{ item.providerLabel }} · {{ item.label }}{{ item.isDefault ? '（全局默认）' : '' }}</option>
                </select>
              </label>
              <p v-if="!model && modelKey" class="notice">上次所选模型已不可用，请重新选择。</p>
              <p v-if="model" class="quiet">若供应商要求 API Key，请先在媒体模型设置中配置；凭据是否有效由供应商校验。</p>
            </template>
            <div v-if="model && method === 'frames'" class="parameterGrid">
              <label class="field">参考模式
                <select v-model="mode" aria-label="参考帧模式">
                  <option v-for="value in modesFor(model)" :key="value" :value="value">{{ frameModes[value] }}</option>
                </select>
              </label>
              <label class="field">请求时长
                <select v-model.number="requestDuration" aria-label="模型请求时长">
                  <option v-for="value in durations" :key="value" :value="value">{{ value }} 秒</option>
                </select>
              </label>
            </div>
            <p v-if="model?.editCapabilities && method === 'native'" class="quiet">
              支持 {{ model.editCapabilities.minDuration }}–{{ model.editCapabilities.maxDuration }} 秒；额外引用上限：图 {{ model.editCapabilities.maxImages }}、视频 {{ model.editCapabilities.maxVideos }}、音频 {{ model.editCapabilities.maxAudios }}。
            </p>
            <label v-if="model && (resolutions.length || method === 'native')" class="field">分辨率
              <select v-model="resolution" aria-label="重拍分辨率">
                <option v-if="method === 'native'" value="">使用供应商默认（不提交分辨率）</option>
                <option v-for="value in resolutions" :key="value" :value="value">{{ value }}</option>
              </select>
            </label>
            <p v-if="model && range && requestedDuration" class="quiet">提交范围 {{ seconds(range.start) }}–{{ seconds(range.end) }} 秒；请求 {{ seconds(requestedDuration) }} 秒，最终替换 {{ seconds(range.duration) }} 秒。</p>
            <label v-if="model && range && requestedDuration && requestedDuration >= range.duration - 0.000001" class="checkLine">
              <input v-model="allowTrim" type="checkbox" />{{ trimNeeded ? '同意从候选首帧起裁去多出的时长' : '若返回视频超长，同意从候选首帧起取所需时长' }}
            </label>

            <label class="field">提示词
              <textarea v-model="prompt" rows="4" maxlength="100000" aria-label="片段重拍提示词" placeholder="写清要改的内容，以及要保留的角色、道具、运镜和入出动作"></textarea>
            </label>
            <div class="referenceGroup" aria-label="画布资产引用">
              <strong>已连接的资产</strong>
              <p class="quiet">{{ method === 'frames' ? '该路线只收原片参考帧。额外资产不能提交，可把需保留的外观写进提示词。' : '选择实际需要的图、视频或音频；来自角色库的引用保留该版本。' }}</p>
              <p v-if="!references.length" class="quiet">源节点没有已连接的媒体引用。</p>
              <label v-for="item in referenceRows" :key="item.id" class="checkLine">
                <input type="checkbox" :checked="isSelected(item.id)" :disabled="!isSelected(item.id) && (method !== 'native' || !referenceFits(item))" @change="toggleReference(item)" />
                {{ item.name || item.path }} · {{ mediaLabel(item.mimeType) }}<span v-if="item.pin"> · 固定版本 {{ item.pin.revision }}</span>
                <span v-if="referenceStale(item.id)"> · 已变化，请取消旧引用</span>
              </label>
            </div>

            <details>
              <summary>AI 文案分析与 Skill</summary>
              <div class="analysisSettings">
                <p class="quiet">按选区、连接的分镜文字及相邻镜头整理提示词；这一步不看视频画面，也不会提交重拍。</p>
                <label class="field">语言模型
                  <select v-model="languageKey" aria-label="分析语言模型">
                    <option value="">{{ catalogs?.language.length ? '选择语言模型' : '未配置语言模型' }}</option>
                    <option v-for="item in catalogs?.language ?? []" :key="keyFor(item)" :value="keyFor(item)">{{ item.providerLabel }} · {{ item.label }}{{ item.isDefault ? '（全局默认）' : '' }}</option>
                  </select>
                </label>
                <label class="field">Skill
                  <select v-model="skillMode" aria-label="分析 Skill 模式" @change="skillMode === 'manual' && loadSkills()">
                    <option value="none">不使用 Skill</option>
                    <option value="auto">自动选择视频 Skill</option>
                    <option value="manual">手动指定 Skill</option>
                  </select>
                </label>
                <label v-if="skillMode === 'manual'" class="field">指定 Skill
                  <select v-model="skillId" aria-label="指定分析 Skill"><option value="">{{ skillsLoading ? '正在读取' : '选择 Skill' }}</option><option v-for="item in skills" :key="item.id" :value="item.id">{{ item.name }}</option></select>
                  <el-button v-if="skillError" size="small" text @click="loadSkills">重读 Skill</el-button>
                </label>
                <p v-if="skillError && skillMode === 'manual'" class="error" role="alert">{{ skillError }}</p>
                <label class="field">补充分析要求 <input v-model="requirements" maxlength="8000" aria-label="补充分析要求" /></label>
                <el-button :disabled="!draft || !languageKey || !!busy" @click="analyze">AI 分析</el-button>
                <div v-if="analysis" class="analysisResult">
                  <p>{{ analysis.reason }}</p><p>{{ analysis.prompt }}</p>
                  <p v-if="analysis.referenceIds.length">建议引用：{{ analysis.referenceIds.map(id => references.find(item => item.id === id)?.name || '已失效的引用').join('、') }}</p>
                  <el-button size="small" @click="prompt = analysis.prompt">采用提示词</el-button>
                  <el-button v-if="method === 'native' && analysis.referenceIds.length" size="small" @click="applyAnalyzedReferences">采用建议引用</el-button>
                </div>
              </div>
            </details>
          </fieldset>
          <p v-if="draftIssue && method" class="quiet">{{ draftIssue }}</p>
        </section>
      </div>

      <section v-if="preview" class="adoptionPane" aria-label="候选采用">
        <div class="paneHeading"><strong>采用当前候选</strong><span>等长替换 · 生成新视频</span></div>
        <p class="quiet">候选使用 {{ seconds(preview.candidate.range.start) }}–{{ seconds(preview.candidate.range.end) }} 秒{{ preview.candidate.requiresTrim ? '（已同意裁取）' : '' }}。请核对原片两侧与候选首尾。</p>
        <label class="field">合成音轨
          <select v-model="audioPolicy" aria-label="合成音轨策略" :disabled="!!busy">
            <option value="preserve">保留整条原声（默认）</option>
            <option value="candidate" :disabled="!preview.candidate.media.audio">仅用候选音轨替换选区{{ preview.candidate.media.audio ? '' : '（候选无音轨）' }}</option>
            <option value="muteRange">仅将选区静音</option>
          </select>
        </label>
        <p class="quiet">{{ audioDescription }}</p>
        <p class="quiet">请核对台词、口型、节奏和音效是否仍同步。合成不会添加音乐。</p>
        <div class="buttonRow"><el-button type="primary" :disabled="!!busy || !!unsavedResult" @click="adopt">确认采用并合成新视频</el-button></div>
      </section>
      <div v-if="unsavedResult" class="error" role="alert">新节点尚未确认保存，合成文件已保留。<el-button text :disabled="!!busy" @click="retryResultSave">重新保存结果节点</el-button></div>

      <section class="candidatePane" aria-label="候选记录">
        <div class="paneHeading"><strong>候选记录</strong><span>{{ attempts.length }} 个尝试</span></div>
        <p v-if="!attempts.length" class="quiet">生成后可同步比较原片与候选，再决定是否合成。</p>
        <div v-for="(attempt, index) in attempts" :key="attempt.id" class="attempt">
          <div class="attemptTitle"><strong>候选 {{ index + 1 }}</strong><span :class="{ quiet: !attempt.abandoned }">{{ attemptStatus(attempt) }}</span><span v-if="!sourceMatches(attempt.source)" class="quiet">历史源版本</span></div>
          <p class="quiet">{{ methodLabel(attempt.draft.method) }} · {{ attempt.draft.model.modelId }} · {{ seconds(attempt.range.start) }}–{{ seconds(attempt.range.end) }} 秒 · 请求 {{ seconds(attempt.draft.model.duration) }} 秒</p>
          <p v-if="observations[attempt.id]?.error" class="error" role="alert">{{ observations[attempt.id]?.error }}</p>
          <details><summary>尝试参数与任务 ID</summary>
            <dl class="attemptDetails">
              <dt>任务</dt><dd><code>{{ attempt.id }}</code></dd>
              <dt>原片</dt><dd>{{ attempt.source.path }} · {{ attempt.source.sha256 }}</dd>
              <dt>实际源帧</dt><dd>{{ seconds(attempt.prepared.firstFrameTime) }}–{{ seconds(attempt.prepared.lastFrameTime) }} 秒</dd>
              <dt>提示词</dt><dd>{{ attempt.draft.prompt }}</dd>
              <dt>额外引用</dt><dd>{{ attempt.draft.references.map(item => item.name || item.path).join('、') || '无' }}</dd>
              <template v-if="attempt.result"><dt>候选文件</dt><dd>{{ attempt.result.path }}</dd></template>
              <template v-for="item in compositionsFor(attempt.id)" :key="item.path"><dt>合成记录</dt><dd>{{ item.path }}</dd></template>
            </dl>
          </details>
          <div class="buttonRow">
            <el-button v-if="!attempt.abandoned && taskFor(attempt) && (!terminal(taskFor(attempt)?.state) || (taskFor(attempt)?.state === 'succeeded' && !hasResult(attempt)))" size="small" :disabled="!!busy" @click="query(attempt)">按原 ID 复查</el-button>
            <el-button v-if="!attempt.abandoned && !terminal(taskFor(attempt)?.state)" size="small" text :disabled="!!busy" @click="confirmAbandon(attempt)">{{ childFor(attempt) ? '明确放弃' : '仅放弃本地记录' }}</el-button>
            <el-button v-if="hasResult(attempt) && !attempt.abandoned" size="small" :type="preview?.attempt.id === attempt.id ? 'primary' : 'default'" :disabled="!!busy || !sourceMatches(attempt.source)" @click="openCandidate(attempt)">同步对比</el-button>
          </div>
        </div>
      </section>

    </div>
    <el-dialog v-if="confirmation" :modelValue="true" :title="confirmation.title" width="min(450px, calc(100vw - 28px))" appendToBody :closeOnClickModal="false" @update:modelValue="value => !value && finishConfirmation(false)">
      <p>{{ confirmation.message }}</p>
      <template #footer>
        <el-button @click="finishConfirmation(false)">返回</el-button>
        <el-button type="primary" @click="finishConfirmation(true)">{{ confirmation.action }}</el-button>
      </template>
    </el-dialog>
    <template #footer>
      <div class="dialogFooter" @keydown.stop>
        <span role="status">{{ busy || (blockedAttempt ? '存在待核对任务，请先复查或明确放弃。' : '') }}</span>
        <div class="buttonRow">
          <el-button @click="close()">关闭</el-button>
          <el-button :disabled="!!busy || !draft" @click="saveDraft">保存重拍计划</el-button>
          <el-button type="primary" :disabled="!!busy || !draft || blockedAttempt" @click="generate">{{ attempts.length ? '生成新候选' : '检查参数并生成候选' }}</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useVueFlow, type GraphNode } from "@vue-flow/core";
import { ElButton, ElDialog } from "element-plus";
import { useNodeFiles, type BrowserFfmpegFactory, type NodeMediaValue } from "@lum/nodes-scaffold/runtime";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";
import type { NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import type { NodeGenerationTask } from "@lum/node-shared/useNodeGeneration";
import { requestMediaPromptSkill, type MediaPromptSkill } from "@lum/node-shared/mediaPromptEditing";
import { parseVideoContinuity } from "@lum/node-shared/videoContinuity";
import { planVideoRetakeRange, type VideoRetakeAudioPolicy, type VideoRetakeCandidate, type VideoRetakeSource, type VideoRetakeSourceIdentity, type VideoRetakeResult, type VideoRetakeTimes } from "../videoRetake";
import { useVideoRetakeState, validateVideoRetakeRequest, type VideoRetakeAttempt, type VideoRetakeDraft } from "../videoRetakeState";
import videoRetakePreview from "./videoRetakePreview.vue";

const props = defineProps<{ node: GraphNode; file: NodeMediaValue; ffmpeg: BrowserFfmpegFactory; signal: AbortSignal }>();
const emit = defineEmits<{ close: [] }>();
function close(done?: () => void) {
  emit("close");
  done?.();
}
const flow = useVueFlow();
const getPersistence = useNodePersistence();
const getCanvasActive = inject("nodeCanvasActive", () => true);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const persistence = getPersistence?.();
const files = useNodeFiles().getWorkspaceFiles();
const node = props.node;
const output = node.data.outputs?.video;
const originalFile = { ...props.file };
const lifetime = new AbortController();
const signal = AbortSignal.any([props.signal, lifetime.signal]);
const retake = useVideoRetakeState(node, "video", { ffmpeg: props.ffmpeg, signal });

function assertCurrent() {
  signal.throwIfAborted();
  const active = getPersistence?.();
  if (!persistence || !getCanvasActive() || active?.directory !== persistence.directory || active.canvasPath !== persistence.canvasPath
    || flow.findNode(node.id) !== node || node.data.outputs?.video !== output || output?.value?.url !== originalFile.url || output?.value?.mimeType !== originalFile.mimeType) {
    throw Error("来源视频、画布或工作区已切换");
  }
  return persistence;
}

const source = shallowRef<VideoRetakeSource>();
const sourceError = ref("");
const sourceSrc = ref("");
const catalogError = ref("");
const catalogs = shallowRef<Awaited<ReturnType<typeof retake.loadCatalogs>>>();
const skills = shallowRef<MediaPromptSkill[]>([]);
const skillsLoading = ref(false);
const skillError = ref("");
const start = ref<number | string>(0);
const end = ref<number | string>(0);
const method = ref<VideoRetakeDraft["method"] | "">("");
const modelKey = ref("");
const frameModes = { singleImage: "选区首帧", startEndRequired: "选区首帧和尾帧（必填）", endFrameOptional: "选区首帧和尾帧", startFrameOptional: "选区首帧和尾帧" };
type FrameMode = keyof typeof frameModes;
const mode = ref<FrameMode>();
const requestDuration = ref<number>();
const resolution = ref("");
const prompt = ref("");
const selectedReferences = ref<VideoRetakeDraft["references"]>([]);
const allowTrim = ref(false);
const skillMode = ref<VideoRetakeDraft["skill"]["mode"]>("none");
const skillId = ref("");
const requirements = ref("");
const languageKey = ref("");
const audioPolicy = ref<VideoRetakeAudioPolicy>("preserve");
const newSourceDraft = ref(false);
const error = ref("");
const notice = ref("");
const busy = ref("");
const confirmation = shallowRef<{ title: string; message: string; action: string; resolve: (value: boolean) => void }>();
const comparison = ref<InstanceType<typeof videoRetakePreview>>();
const sourcePane = ref<HTMLElement>();
const preview = shallowRef<{ src: string; candidate: VideoRetakeCandidate; attempt: VideoRetakeAttempt; sha256: string }>();
const boundaryPreview = shallowRef<VideoRetakeTimes>();
const unsavedResult = shallowRef<{ nodeId: string; path: string }>();
const observations = ref<Record<string, { status: string; error?: string }>>({});
const attempts = computed(() => Array.isArray(retake.state.value?.attempts) ? retake.state.value.attempts : []);
const analysis = computed(() => !sourceChanged.value ? retake.state.value?.analysis : undefined);
const sourceChanged = computed(() => !!source.value && !!retake.state.value?.source && !sourceMatches(retake.state.value.source));
const minimum = computed(() => Math.max(0, source.value?.media.video.start ?? 0));
const maximum = computed(() => source.value?.media.video.end ?? 0);
const sliderStep = computed(() => Math.max(0.001, (maximum.value - minimum.value) / 2000));
const range = computed(() => {
  if (!source.value || typeof start.value !== "number" || typeof end.value !== "number") return;
  try { return planVideoRetakeRange(source.value, { start: start.value, end: end.value }); }
  catch { return; }
});
const frameRate = computed(() => {
  const value = source.value?.media.video.frameRate;
  return value ? Number((value.numerator / value.denominator).toFixed(3)) : "";
});
const audioDescription = computed(() => audioPolicy.value === "preserve"
  ? source.value?.media.audio ? "原片完整音轨随原时间线保留。" : "原片无音轨，结果保持无声。"
  : audioPolicy.value === "candidate" ? "只替换选区音轨，选区之外保留原声；如果原片无声，选区之外保持静音。"
  : "只静音选区，选区之外保留原声；如果原片无声，结果保持无声。");

const keyFor = (item: { providerId: string; modelId: string }) => JSON.stringify([item.providerId, item.modelId]);
function modesFor(item: NodeMediaModel): FrameMode[] {
  return (item.mode ?? []).filter((value): value is FrameMode => typeof value === "string" && Object.hasOwn(frameModes, value));
}
function pairsFor(item?: NodeMediaModel) {
  return item?.durationResolutionMap?.filter(pair => pair.resolution.some(Boolean) && pair.duration.some(value => Number.isFinite(value) && value > 0 && value <= 3600)) ?? [];
}
const choices = computed(() => method.value === "native" ? catalogs.value?.edit ?? [] : method.value === "frames"
  ? (catalogs.value?.ordinary ?? []).filter(item => modesFor(item).length && pairsFor(item).length) : []);
const model = computed(() => choices.value.find(item => keyFor(item) === modelKey.value));
const durations = computed(() => [...new Set(pairsFor(model.value).flatMap(item => item.duration).filter(value => Number.isFinite(value) && value > 0 && value <= 3600))].sort((a, b) => a - b));
const requestedDuration = computed(() => method.value === "native" ? range.value?.duration : requestDuration.value);
const resolutions = computed(() => [...new Set(pairsFor(model.value).filter(item => requestedDuration.value !== undefined && item.duration.includes(requestedDuration.value)).flatMap(item => item.resolution).filter(Boolean))]);
const trimNeeded = computed(() => !!range.value && (requestedDuration.value ?? 0) > range.value.duration + 0.000001);

const references = computed(() => retake.connectedReferences());
const referenceRows = computed(() => [...references.value, ...selectedReferences.value.filter(item => !references.value.some(live => live.id === item.id))]);
const isSelected = (id: string) => selectedReferences.value.some(item => item.id === id);
function referenceLive(item: VideoRetakeDraft["references"][number]) {
  const live = references.value.find(value => value.id === item.id);
  return live?.path === item.path && live.mimeType === item.mimeType && JSON.stringify(live.pin) === JSON.stringify(item.pin);
}
const referenceStale = (id: string) => selectedReferences.value.some(item => item.id === id && !referenceLive(item));
function referenceFits(item: VideoRetakeDraft["references"][number]) {
  const capability = model.value?.editCapabilities;
  const type = item.mimeType.split("/")[0];
  const max = type === "image" ? capability?.maxImages : type === "video" ? capability?.maxVideos : capability?.maxAudios;
  return !!max && selectedReferences.value.filter(value => value.mimeType.startsWith(type + "/")).length < max;
}
function toggleReference(item: VideoRetakeDraft["references"][number]) {
  selectedReferences.value = isSelected(item.id) ? selectedReferences.value.filter(value => value.id !== item.id) : [...selectedReferences.value, item];
}

const draftCheck = computed(() => {
  if (!range.value || !source.value || sourceError.value || sourceChanged.value && !newSourceDraft.value) return { issue: "" };
  if (!method.value || !model.value || !requestedDuration.value) return { issue: "请先选择支持此操作的模型与参数。" };
  if (!prompt.value.trim()) return { issue: "请输入重拍提示词。" };
  if (selectedReferences.value.some(item => !referenceLive(item))) return { issue: "已选引用的来源或固定版本已变化，请取消旧引用后重新选择。" };
  if (skillMode.value === "manual" && !skillId.value) return { issue: "请为手动模式选择 Skill。" };
  const draft: VideoRetakeDraft = {
    method: method.value, operation: method.value === "native" ? "edit" : "generate",
    start: range.value.requested.start, end: range.value.requested.end, prompt: prompt.value.trim(),
    model: { providerId: model.value.providerId, modelId: model.value.modelId, duration: requestedDuration.value, ...(resolution.value ? { resolution: resolution.value } : {}), ...(method.value === "frames" && mode.value ? { mode: mode.value } : {}) },
    references: selectedReferences.value, skill: { mode: skillMode.value, ...(skillMode.value === "manual" ? { id: skillId.value } : {}) }, audioPolicy: "preserve", allowTrim: allowTrim.value,
  };
  try {
    validateVideoRetakeRequest(draft, model.value, range.value.duration);
    return { draft, issue: "" };
  } catch (cause) { return { issue: failure(cause) }; }
});
const draft = computed(() => draftCheck.value.draft);
const draftIssue = computed(() => draftCheck.value.issue);

const childFor = (attempt: VideoRetakeAttempt) => retake.ownedChild(attempt);
function taskFor(attempt: VideoRetakeAttempt) {
  const task = childFor(attempt)?.data.mediaTask as NodeGenerationTask | undefined;
  return task?.taskId === attempt.id ? task : undefined;
}
const terminal = (state?: string) => state === "succeeded" || state === "failed" || state === "cancelled";
const blockedAttempt = computed(() => attempts.value.some(item => !item.abandoned && !terminal(taskFor(item)?.state)));
function hasResult(attempt: VideoRetakeAttempt) {
  return !!attempt.result || childFor(attempt)?.data.videoRetakeResult?.taskId === attempt.id;
}
function attemptStatus(attempt: VideoRetakeAttempt) {
  if (attempt.abandoned) return "已明确放弃";
  const child = childFor(attempt), task = taskFor(attempt);
  if (!child || child.data.videoRetakeAttempt?.taskId !== attempt.id) return "候选节点已移除或任务归属已变化";
  if (!task) return "已准备 · 未确认提交";
  if (task.state === "submitting") return "正在提交／待确认接单";
  if (task.state === "running") return "供应商处理中／下载保存结果";
  if (task.state === "interrupted") return task.resumable === false ? "结果未知 · 无可用供应商凭据" : "等待按原 ID 复查";
  if (task.state === "failed") return "生成失败";
  if (task.state === "cancelled") return "已取消";
  return hasResult(attempt) ? "候选已生成" : "任务成功 · 结果等待归档";
}
const compositionsFor = (id: string) => (retake.state.value?.compositions ?? []).filter(item => item.attemptId === id);
const sourceMatches = (identity: VideoRetakeSourceIdentity) => source.value?.path === identity.path && source.value.sha256 === identity.sha256;
const seconds = (value: number) => Number.isFinite(value) ? value.toFixed(3) : "—";
const mediaLabel = (mimeType: string) => mimeType.startsWith("image/") ? "图片" : mimeType.startsWith("audio/") ? "音频" : "视频";
const methodLabel = (value: VideoRetakeDraft["method"]) => value === "native" ? "原生视频编辑" : "参考帧再生成";

function failure(cause: unknown) {
  const message = (cause as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === "string" && message ? message : cause instanceof Error ? cause.message : String(cause);
}
function confirm(title: string, message: string, action: string) {
  return new Promise<boolean>(resolve => { confirmation.value = { title, message, action, resolve }; });
}
function finishConfirmation(accepted: boolean) {
  const previous = confirmation.value;
  confirmation.value = undefined;
  previous?.resolve(accepted);
}
async function perform(label: string, action: () => Promise<void>) {
  if (busy.value || signal.aborted) return;
  busy.value = label;
  error.value = notice.value = "";
  try { assertCurrent(); await action(); assertCurrent(); }
  catch (cause) { if (!signal.aborted) error.value = failure(cause); }
  finally { if (!signal.aborted) busy.value = ""; }
}
function setDurationDefaults() {
  if (method.value === "frames" && (requestDuration.value === undefined || !durations.value.includes(requestDuration.value))) {
    requestDuration.value = durations.value.find(value => value >= (range.value?.duration ?? 0) - 0.000001) ?? durations.value.at(-1);
  }
  if (!resolutions.value.includes(resolution.value)) resolution.value = method.value === "frames" ? resolutions.value[0] ?? "" : "";
}
function chooseModel() {
  mode.value = model.value && method.value === "frames" ? modesFor(model.value)[0] : undefined;
  requestDuration.value = undefined;
  resolution.value = "";
  allowTrim.value = false;
  setDurationDefaults();
}
function changeMethod() {
  modelKey.value = keyForDefault(choices.value);
  chooseModel();
}
function keyForDefault(items: { isDefault?: boolean; providerId: string; modelId: string }[]) {
  const item = items.find(value => value.isDefault) ?? (items.length === 1 ? items[0] : undefined);
  return item ? keyFor(item) : "";
}
function restoreDraft(saved: VideoRetakeDraft) {
  start.value = saved.start; end.value = saved.end;
  method.value = saved.method; modelKey.value = keyFor(saved.model);
  mode.value = saved.model.mode; requestDuration.value = saved.model.duration; resolution.value = saved.model.resolution ?? "";
  prompt.value = saved.prompt; selectedReferences.value = saved.references.map(item => ({ ...item, ...(item.pin ? { pin: { ...item.pin } } : {}) }));
  allowTrim.value = saved.allowTrim; skillMode.value = saved.skill.mode; skillId.value = saved.skill.id ?? "";
}
function setWholeRange() { start.value = minimum.value; end.value = maximum.value; }
function beginNewDraft() {
  if (!source.value) return;
  clearPreview();
  setWholeRange();
  method.value = ""; modelKey.value = ""; mode.value = undefined; requestDuration.value = undefined; resolution.value = "";
  prompt.value = ""; selectedReferences.value = []; allowTrim.value = false; skillMode.value = "none"; skillId.value = "";
  requirements.value = "";
  newSourceDraft.value = true;
  error.value = "";
}
function seekBoundary(side: "start" | "end") {
  clearPreview();
  const value = side === "start" ? start.value : end.value;
  if (typeof value === "number") void nextTick().then(() => { if (!signal.aborted) comparison.value?.jump(value); });
}
function moveBoundary(side: "start" | "end", event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  const gap = Math.min(0.001, (maximum.value - minimum.value) / 2);
  if (side === "start") start.value = Math.max(minimum.value, Math.min(value, Number(end.value) - gap));
  else end.value = Math.min(maximum.value, Math.max(value, Number(start.value) + gap));
  seekBoundary(side);
}
function listenBoundary(side: "start" | "end") {
  const time = preview.value?.attempt.range[side];
  if (time === undefined) return;
  boundaryPreview.value = { start: Math.max(minimum.value, time - 1), end: Math.min(maximum.value, time + 1) };
}
watch(requestDuration, () => {
  if (method.value === "frames" && !resolutions.value.includes(resolution.value)) resolution.value = resolutions.value[0] ?? "";
});
watch(() => range.value?.duration, () => {
  allowTrim.value = false;
  if (method.value === "native" && !resolutions.value.includes(resolution.value)) resolution.value = "";
}, { flush: "sync" });

let sourceLease: ReturnType<NonNullable<typeof files.acquireUrl>> | undefined;
let candidateLease: typeof sourceLease;
let previewRevision = 0;
function releaseSource() { sourceSrc.value = ""; sourceLease?.release(); sourceLease = undefined; }
function clearPreview() {
  previewRevision++;
  comparison.value?.pause();
  preview.value = undefined;
  boundaryPreview.value = undefined;
  candidateLease?.release(); candidateLease = undefined;
}
onScopeDispose(() => {
  lifetime.abort();
  finishConfirmation(false);
  clearPreview();
  releaseSource();
});

async function loadSource(restore: boolean) {
  const previous = source.value;
  sourceError.value = "";
  const inspected = await retake.inspectSource();
  assertCurrent();
  source.value = inspected;
  const saved = retake.state.value;
  if (restore || inspected.path !== previous?.path || inspected.sha256 !== previous.sha256) {
    clearPreview();
    newSourceDraft.value = false;
    if (saved?.draft && saved.source && sourceMatches(saved.source)) restoreDraft(saved.draft);
    else {
      setWholeRange();
      if (previous && !saved) beginNewDraft();
    }
  }
  if (sourceSrc.value && inspected.sha256 === previous?.sha256 && inspected.path === previous.path) return;
  releaseSource();
  const acquire = files.acquireUrl;
  if (!acquire) throw Error("当前画布未提供工作区媒体预览");
  const lease = sourceLease = acquire(inspected.path, originalFile.mimeType, inspected.sha256);
  try {
    const url = await lease.url;
    assertCurrent();
    const current = await files.inspectBinary(inspected.path, signal);
    assertCurrent();
    if (sourceLease !== lease || current.sha256 !== inspected.sha256) throw Error("读取期间原片内容已变化，请刷新并核对草稿");
    sourceSrc.value = url;
  } catch (cause) { if (sourceLease === lease) releaseSource(); throw cause; }
}
async function loadCatalogs() {
  try {
    const items = await retake.loadCatalogs();
    assertCurrent();
    catalogs.value = items;
    if (!languageKey.value || !items.language.some(item => keyFor(item) === languageKey.value)) languageKey.value = keyForDefault(items.language);
    if (method.value && !modelKey.value) changeMethod();
    catalogError.value = "";
  } catch (cause) { if (!signal.aborted) catalogError.value = failure(cause); }
}
function reload(initial = false) {
  return perform("正在探测源视频与读取模型…", async () => {
    await Promise.all([
      loadSource(initial).catch(cause => { if (!signal.aborted) { releaseSource(); sourceError.value = failure(cause); } }),
      loadCatalogs(),
    ]);
    assertCurrent();
    if (skillMode.value === "manual") void loadSkills();
  });
}
async function loadSkills() {
  if (skillsLoading.value || signal.aborted) return;
  skillsLoading.value = true;
  skillError.value = "";
  try {
    const catalog = await requestMediaPromptSkill<{ skills: MediaPromptSkill[] }>("mediaCatalog", "video", undefined, signal);
    assertCurrent();
    skills.value = catalog.skills;
  } catch (cause) { if (!signal.aborted) skillError.value = failure(cause); }
  finally { if (!signal.aborted) skillsLoading.value = false; }
}
async function persistDraft() {
  if (!draft.value || !source.value) throw Error(draftIssue.value || "重拍计划不完整");
  const current = draft.value, identity = source.value;
  if (sourceChanged.value && newSourceDraft.value) await retake.newDraft(current, identity);
  else await retake.saveDraft(current, identity);
  assertCurrent();
  newSourceDraft.value = false;
}
function saveDraft() {
  return perform("正在保存重拍计划…", async () => {
    await persistDraft();
    notice.value = "重拍计划已保存。";
  });
}
function analysisContext() {
  const continuity = parseVideoContinuity(node.data.writingProduction?.continuity);
  const storyboard = flow.getEdges.value.filter(edge => edge.target === node.id && edge.sourceHandle).flatMap(edge => {
    const connection = flow.findNode(edge.source);
    const item = connection?.data.outputs?.[edge.sourceHandle!];
    if (connection?.data.writingSource?.sourceKey?.startsWith("entity:") || item?.dataType !== "STRING" || typeof item.value !== "string" || !item.value.trim()) return [];
    return [{ name: connection?.data.label, text: item.value.slice(0, 8000) }];
  }).slice(0, 8);
  return JSON.stringify({ range: range.value, storyboard, previous: continuity?.previous, next: continuity?.next });
}
function analyze() {
  return perform("正在分析重拍文案…", async () => {
    const language = catalogs.value?.language.find(item => keyFor(item) === languageKey.value);
    if (!language) throw Error("未配置可用语言模型");
    await persistDraft();
    await retake.analyze({ providerId: language.providerId, modelId: language.modelId, requirements: requirements.value, references: references.value.slice(0, 64), context: analysisContext() });
    assertCurrent();
    notice.value = "分析已返回。请核对后选用提示词或引用。";
  });
}
function applyAnalyzedReferences() {
  if (!analysis.value || method.value !== "native") return;
  const selected = analysis.value.referenceIds.map(id => references.value.find(item => item.id === id));
  if (selected.some(item => !item)) { error.value = "分析建议包含已失效的引用，请重新分析或手动选择。"; return; }
  selectedReferences.value = [...new Map(selected.flatMap(item => item ? [[item.id, item] as const] : [])).values()];
}
function generate() {
  return perform("正在检查源片并保存请求…", async () => {
    if (blockedAttempt.value) throw Error("已有结果未知的尝试，请先复查或明确放弃");
    comparison.value?.pause();
    await persistDraft();
    busy.value = "正在准备片段／提交候选…";
    if (attempts.value.length) await retake.retry(); else await retake.submit();
    assertCurrent();
    notice.value = "已启动候选任务。可关闭此窗口，稍后回来查看同一个任务。";
  });
}
function query(attempt: VideoRetakeAttempt) {
  return perform("正在按原任务 ID 复查…", async () => {
    await retake.query(attempt.id);
    assertCurrent();
    notice.value = "已复查同一任务。候选列表随画布中的任务状态更新。";
  });
}
function confirmAbandon(attempt: VideoRetakeAttempt) {
  return perform("等待确认放弃…", async () => {
    const localOnly = !childFor(attempt);
    const confirmed = await confirm(localOnly ? "仅放弃本地记录" : "明确放弃该候选任务",
      "放弃后可生成新候选。供应商可能已经接单，放弃不保证取消供应商任务或费用。", "确认放弃");
    assertCurrent();
    if (!confirmed) return;
    const result = await retake.abandon(attempt.id, localOnly);
    assertCurrent();
    notice.value = result.localOnly ? "已放弃本地记录；未请求取消供应商任务，旧记录仍保留。" : "此尝试已标记为放弃，旧记录仍保留。";
  });
}
watch(() => attempts.value.map(attempt => [attempt.id, taskFor(attempt)?.state, hasResult(attempt)] as const), async (items, previous = [], onCleanup) => {
  let current = true;
  const refreshes: number[] = [];
  onCleanup(() => { current = false; refreshes.forEach(clearTimeout); });
  for (const [id, status, available] of items) {
    if (!status || previous.some(before => before[0] === id && before[1] === status && before[2] === available) || !current) continue;
    try {
      const observed = await retake.readStatus(id);
      assertCurrent();
      if (current) observations.value[id] = observed;
      if (terminal(status) || status === "interrupted") {
        // 任务事件先保存，节点的本地错误随后更新。只做一次只读刷新，不触发恢复。
        const refresh = window.setTimeout(() => {
          if (current) void retake.readStatus(id).then(value => { if (current) observations.value[id] = value; }).catch(() => {});
        }, 600);
        refreshes.push(refresh);
      }
    } catch { /* 历史子节点不在当前画布或未挂载时保留可见快照。 */ }
  }
}, { immediate: true });
async function showCandidate(attempt: VideoRetakeAttempt) {
  if (!sourceMatches(attempt.source)) throw Error("候选不属于当前原片版本");
  clearPreview();
  const revision = previewRevision;
  if (!attempt.result) { await retake.query(attempt.id); assertCurrent(); }
  const selected = await retake.select(attempt.id);
  assertCurrent();
  if (previewRevision !== revision) return;
  const acquire = files.acquireUrl;
  if (!acquire) throw Error("当前画布未提供候选媒体预览");
  const lease = candidateLease = acquire(selected.candidate.path, selected.attempt.result!.mimeType, selected.identity.sha256);
  try {
    const url = await lease.url;
    assertCurrent();
    await selected.local.assertCurrent();
    assertCurrent();
    if (candidateLease !== lease || previewRevision !== revision) return;
    preview.value = { src: url, candidate: selected.candidate, attempt: selected.attempt, sha256: selected.identity.sha256 };
    audioPolicy.value = "preserve";
    await nextTick();
    assertCurrent();
    if (previewRevision === revision) sourcePane.value?.scrollIntoView({ block: "nearest" });
  } catch (cause) { if (candidateLease === lease) clearPreview(); throw cause; }
}
function openCandidate(attempt: VideoRetakeAttempt) {
  return perform("正在核验并读取候选预览…", () => showCandidate(attempt));
}

async function saveResultNode(result: VideoRetakeResult, attempt: VideoRetakeAttempt) {
  const current = assertCurrent(), type = "remote-videoNode";
  if (!flow.nodeTypes?.value?.[type]) throw Error(`合成文件已生成（${result.path}），请启用视频节点插件再加入画布`);
  const nodeId = crypto.randomUUID(), edgeId = crypto.randomUUID();
  const x = node.computedPosition.x + Math.max(node.dimensions.width, 320) + 100;
  let y = node.computedPosition.y;
  for (const item of [...flow.getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
    const position = item.computedPosition;
    if (position.x < x + 320 && position.x + (item.dimensions.width || 320) > x && position.y < y + 280 && position.y + (item.dimensions.height || 280) > y) y = position.y + (item.dimensions.height || 280) + 40;
  }
  await batchHistory(async () => {
    assertCurrent();
    flow.addNodes({ id: nodeId, type, position: { x, y }, data: {
      label: `${node.data.label || "视频"} · 重拍合成`,
      outputs: { video: { dataType: "VIDEO", value: { url: result.path, mimeType: "video/mp4" } } },
      videoRetakeDerivative: { sourceNodeId: node.id, sourceHandleId: "video", sourcePath: result.source.path, sourceHash: result.source.sha256, attemptId: attempt.id,
        range: result.range, replacementFrames: result.replacementFrames, audioPolicy: result.audioPolicy, candidatePath: result.candidate.path, candidateRange: result.candidate.range },
    } });
    unsavedResult.value = { nodeId, path: result.path };
    flow.addEdges({ id: edgeId, source: node.id, sourceHandle: "video", target: nodeId, targetHandle: "derivedFrom" });
    await current.save(signal);
    assertCurrent();
  });
  assertCurrent();
  unsavedResult.value = undefined;
  notice.value = `新视频节点已保存 · ${seconds(result.media.duration)} 秒。源视频与候选仍保留。`;
}
function adopt() {
  return perform("等待确认合成…", async () => {
    const selected = preview.value;
    if (!selected || unsavedResult.value) throw Error("请先保存当前结果节点或重新选择候选");
    if (!flow.nodeTypes?.value?.["remote-videoNode"]) throw Error("请先启用视频节点插件");
    const policy = audioPolicy.value;
    comparison.value?.pause();
    const confirmed = await confirm("采用重拍候选", `将选区等长替换并另存为新视频节点。${audioDescription.value}`, "采用并合成");
    assertCurrent();
    if (!confirmed || preview.value !== selected) return;
    busy.value = "正在本地验证、合成并保存新视频…";
    const result = await retake.compose(selected.attempt.id, policy, selected.sha256);
    assertCurrent();
    try { await saveResultNode(result, selected.attempt); }
    catch (cause) { throw Error(`合成文件已保留（${result.path}），结果节点未确认保存：${failure(cause)}`); }
  });
}
function retryResultSave() {
  return perform("正在重新保存结果节点…", async () => {
    const item = unsavedResult.value, current = assertCurrent();
    if (!item || flow.findNode(item.nodeId)?.data.outputs?.video?.value?.url !== item.path) throw Error("原结果节点已变化，请在候选记录中查看合成文件路径");
    await current.save(signal);
    assertCurrent();
    unsavedResult.value = undefined;
    notice.value = "新视频节点已保存。";
  });
}
onMounted(() => reload(true));
</script>

<style scoped>
.retakePanel {
  display: grid;
  gap: 14px;
  max-height: min(74vh, calc(100dvh - 150px));
  overflow: auto;
  padding: 0 6px 6px 0;
  overscroll-behavior: contain;
  color: var(--el-text-color-primary);
}
.workGrid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.sourcePane, .requestPane, .candidatePane, .adoptionPane {
  min-width: 0;
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
}
.paneHeading, .attemptTitle, .dialogFooter, .buttonRow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.paneHeading, .dialogFooter { justify-content: space-between; }
.paneHeading strong { font-size: 15px; }
.paneHeading span, .dialogFooter > span, .quiet { font-size: 12px; color: var(--el-text-color-secondary); }
.paneHeading span { min-width: 0; }
.buttonRow > .el-button + .el-button { margin-left: 0; }
.rangeFields, .requestFields { min-width: 0; margin: 0; padding: 0; border: 0; }
.rangeFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.rangeFields > legend { margin-bottom: 5px; font-weight: 600; }
.rangeFields label, .field, .requestFields, .analysisSettings { display: grid; gap: 5px; min-width: 0; }
.requestFields, .analysisSettings { gap: 10px; }
.parameterGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.field input, .field select, .field textarea, .rangeFields input[type="number"] {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  min-width: 0;
  padding: 6px 7px;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  font: inherit;
}
.field textarea { resize: vertical; }
.field input:focus-visible, .field textarea:focus-visible, .field select:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -1px; }
.checkLine { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px; }
.checkLine input { flex: 0 0 auto; }
.referenceGroup { display: grid; gap: 5px; max-height: 165px; overflow: auto; }
.attempt, .analysisResult { border-top: 1px solid var(--el-border-color-lighter); padding: 8px 0 0; display: grid; gap: 6px; }
.attemptDetails { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 8px; margin: 6px 0; font-size: 12px; }
.attemptDetails dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.retakePanel p { margin: 0; overflow-wrap: anywhere; }
.notice, .error { border-radius: var(--el-border-radius-base); padding: 7px 9px; word-break: break-word; }
.notice { background: var(--el-color-info-light-9); }
.error { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.analysisSettings { padding-top: 8px; }
.srOnly { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); white-space: nowrap; overflow: hidden; }
summary { cursor: pointer; color: var(--el-text-color-primary); }
@media (max-width: 730px) {
  .workGrid { grid-template-columns: minmax(0, 1fr); }
  .retakePanel { max-height: calc(100dvh - 178px); }
}
@media (max-width: 410px) {
  .sourcePane, .requestPane, .candidatePane, .adoptionPane { padding: 8px; }
  .dialogFooter { gap: 5px; }
  .dialogFooter .el-button { padding-inline: 8px; }
}
</style>
