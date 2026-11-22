<template>
  <el-dialog
    :modelValue="true"
    title="图像工具"
    width="min(1240px, calc(100vw - 24px))"
    top="4vh"
    appendToBody
    class="imageWorkbenchDialog"
    :closeOnClickModal="false"
    :beforeClose="beforeClose"
    @close="closeWorkbench"
    @update:modelValue="value => { if (!value) emit('close'); }">
    <div class="workbenchBody nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop @keydown.delete.stop @keydown.backspace.stop>
      <nav class="workbenchSections" aria-label="工作台分区">
        <el-button v-for="section in sections" :key="section.id" :type="visibleSection === section.id ? 'primary' : 'default'" :disabled="!state && section.id !== 'templates'" :aria-pressed="visibleSection === section.id" @click="visibleSection = section.id">{{ section.label }}</el-button>
      </nav>
      <div class="workbenchColumns">
        <aside class="workbenchTemplates" :class="{ mobileVisible: visibleSection === 'templates' }" aria-label="工作台模板">
          <h3>模板</h3>
          <section v-for="group in templateGroups" :key="group.label">
            <h4>{{ group.label }}</h4>
            <button v-for="item in group.templates" :key="item.id" type="button" :aria-pressed="state?.templateId === item.id" :disabled="templateDisabled" @click="applyTemplate(item.id)">
              {{ item.name }}<span>{{ item.id === "storyTwentyFiveGrid" ? "自选 1–100 格" : item.cells.length + " 格" }}</span>
            </button>
          </section>
          <p v-if="!sourceMatches && source">点击模板可为当前原图建立计划，现有尝试将保留在历史计划中。</p>
        </aside>
        <main v-if="state && template" class="workbenchPlan" :class="{ mobileVisible: visibleSection === 'plan' }">
          <header class="planHeader">
            <div><h2>{{ template.name }}</h2><p>{{ template.description }}</p></div>
            <el-tag effect="plain">{{ template.grid.columns }} × {{ template.grid.rows }} · {{ template.cells.length }} 格</el-tag>
          </header>
          <section v-if="state.templateId === 'storyTwentyFiveGrid'" class="storyCountControls" aria-label="剧情格数">
            <label>剧情格数 <input v-model="storyCount" type="number" min="1" max="100" step="1" :disabled="layoutDisabled" aria-label="剧情格数" /></label>
            <el-button :disabled="layoutDisabled" @click="resizeStory(Number(storyCount))">应用格数</el-button>
            <el-button :disabled="layoutDisabled || state.cells.length >= 100" @click="resizeStory(state.cells.length + 1)">添加一格</el-button>
            <el-button :disabled="layoutDisabled || state.cells.length <= 1" @click="resizeStory(state.cells.length - 1)">移除末格</el-button>
            <p>每个计划限 1–100 格，以控制内存和输出规模。移除的 {{ state.dormantCells?.length ?? 0 }} 格已保留，增加格数可恢复。调整后旧整张候选保留在历史计划中。</p>
            <p v-if="activeCount" role="status">存在运行中或状态未知的任务，完成核对后才能调整格数。</p>
            <p v-if="template.cells.length >= 25" class="planNotice">格数较多时，每格清晰度受输出像素限制，请核对分辨率和整张拆图效果。</p>
          </section>
          <div v-if="!sourceMatches" class="planNotice" role="status">原图已变化。请在模板区点击模板，为当前原图建立计划。已有尝试可继续核对。</div>
          <imageWorkbenchStorySources v-if="isStoryGridTemplate(state.templateId)" :key="state.templateId"
            :context="context" :workspace="previewWorkspace" :selection="state.storySources" :cellCount="state.cells.length"
            :references="references" :sourceReferenceId="sourceReferenceId" :previews="storyPreviews" :disabled="editDisabled"
            @select="selectStorySources" @prepare="prepareStorySources" />
          <div class="cellNavigation" aria-label="计划格位">
            <button v-for="(item, index) in template.cells" :key="item.id" type="button" :aria-pressed="item.id === cellId" @click="cellId = item.id">
              <span>{{ index + 1 }}</span> {{ item.label }}<small v-if="state.cells[index].selectedCandidateId">已选</small>
            </button>
          </div>
          <section v-if="cell" class="cellEditor" :aria-label="cellLabel">
            <h3>{{ cellLabel }}</h3>
            <p v-if="sourceShot" class="planNotice" :title="sourceShot.shotId">来源分镜 {{ sourceShot.label }} · {{ sourceShot.scene }}<br>{{ sourceShot.summary }}</p>
            <label class="workbenchField">本格提示词
              <el-input v-model="cell.prompt" type="textarea" :rows="3" :maxlength="imageWorkbenchLimits.cellPrompt" :disabled="editDisabled" aria-label="本格提示词" />
            </label>
            <label class="workbenchField">本格参考图
              <el-select
                v-model="cell.referenceIds"
                multiple
                filterable
                fitInputWidth
                :multipleLimit="imageWorkbenchLimits.referenceIds"
                :disabled="editDisabled"
                aria-label="本格参考图"
                placeholder="从画布选择实际图片，可留空">
                <el-option v-for="id in unavailableReferences" :key="id" :label="'已失效 · ' + id" :value="id" />
                <el-option v-for="item in references" :key="item.id" :label="referenceLabel(item)" :value="item.id">
                  <span :title="item.path">{{ referenceLabel(item) }} · {{ item.path }}</span>
                </el-option>
              </el-select>
            </label>
            <label class="workbenchField">引用理由
              <el-input v-model="cell.reason" type="textarea" :rows="2" :maxlength="imageWorkbenchLimits.reason" :disabled="editDisabled" aria-label="引用理由" />
            </label>
          </section>
          <section class="workbenchResults" aria-label="工作台结果">
            <h3>{{ state.mode === "sheet" ? "整张候选" : "本格候选" }}</h3>
            <div class="comparison" v-if="state.mode === 'quality'">
              <imageWorkbenchPreview label="当前原图" :media="source" :workspace="previewWorkspace" />
              <imageWorkbenchPreview label="选定候选" :media="selected?.output" :workspace="previewWorkspace" :empty="selectedId ? '选中候选的子节点或输出已变化' : '尚未选定候选'" />
              <imageWorkbenchPreview v-if="comparisonId && comparisonId !== selectedId" label="对比候选" :media="comparison?.output" :workspace="previewWorkspace" empty="该候选的子节点或输出已变化" />
            </div>
            <imageWorkbenchPreview v-if="state.mode === 'sheet' && comparisonId && comparisonId !== selectedId" label="对比整张候选" :media="comparison?.output" :workspace="previewWorkspace" empty="该候选的子节点或输出已变化" />
            <imageWorkbenchCandidates :candidates="candidates" :selectedId="selectedId" :disabled="busy || dispatching" :canPreview="sourceMatches" @preview="comparisonId = $event" @select="selectCandidate" @query="query" @abandon="abandon" />
            <el-button v-if="comparisonId && comparisonId !== selectedId" text @click="comparisonId = ''">关闭对比</el-button>
            <el-button v-if="canRetry" :disabled="editDisabled || !!retryErrors.length" @click="run(() => workbench.retryCell(resultCellId))">新尝试 · 1 次图片请求</el-button>
            <p v-if="canRetry && retryErrors.length" class="workbenchError" role="status">{{ retryErrors[0] }}</p>
          </section>
          <section class="workbenchResults" aria-label="保存派生图片">
            <template v-if="state.mode === 'quality'">
              <h3>合成拼版</h3>
              <p>已选定 {{ pickedCount }} / {{ template.cells.length }} 个可用输出。输出最大边长 {{ imageCompositionLimits.side }} 像素，总面积最多 {{ imageCompositionLimits.pixels.toLocaleString() }} 像素。</p>
              <div class="compositionFields">
                <label>宽度<el-input-number v-model="composeWidth" :min="template.grid.columns" :max="imageCompositionLimits.side" :stepStrictly="true" :disabled="editDisabled" aria-label="拼版宽度" /></label>
                <label>高度<el-input-number v-model="composeHeight" :min="template.grid.rows" :max="imageCompositionLimits.side" :stepStrictly="true" :disabled="editDisabled" aria-label="拼版高度" /></label>
                <label>装入方式
                  <el-select v-model="composeFit" :disabled="editDisabled" aria-label="拼版装入方式">
                    <el-option value="contain" label="保留比例与透明留白" />
                    <el-option value="cover" label="等比填满并居中裁剪" />
                  </el-select>
                </label>
              </div>
              <label class="workbenchField">拼版名称<el-input v-model="composeName" maxlength="120" placeholder="使用模板默认名称" :disabled="editDisabled" aria-label="拼版名称" /></label>
              <p v-if="composeSizeError" class="workbenchError" role="status">{{ composeSizeError }}</p>
              <el-button :disabled="editDisabled || pickedCount !== template.cells.length || !!composeSizeError" @click="compose">合成并保存拼版</el-button>
            </template>
            <template v-else>
              <h3>整张裁剪</h3>
              <imageWorkbenchSplit v-if="selected" :key="selected.candidateId" :template="template" :disabled="editDisabled" :previewReady="sheetPreviewReady" @split="split">
                <template #default="{ regions }">
                  <imageWorkbenchPreview label="选定整张候选" :media="selected.output" :workspace="previewWorkspace" :regions="regions" @ready="sheetPreviewReady = $event" />
                </template>
              </imageWorkbenchSplit>
              <p v-else>{{ selectedId ? "选中候选的子节点或输出已变化。" : "选定一张已完成的整张候选后可校准裁剪。" }}</p>
            </template>
            <p v-if="localProgress" role="status">{{ localProgress }}</p>
          </section>
          <imageWorkbenchAdopt :plan="state" :context="context" :disabled="editDisabled && !adoptionBusy" :buildAdoption="results.buildAdoption" @busy="adoptionBusy = $event" />
          <details v-if="state.dormantCells?.some(item => item.candidates.length)" class="previousPlans" @toggle="showDormantCells = ($event.currentTarget as HTMLDetailsElement).open">
            <summary>已移除格位的保留候选 · 增加格数可恢复</summary>
            <template v-for="(item, index) in showDormantCells ? state.dormantCells : []" :key="item.id">
              <template v-if="item.candidates.length">
                <h4>第 {{ state.cells.length + index + 1 }} 格</h4>
                <imageWorkbenchCandidates :candidates="item.candidates" :selectedId="item.selectedCandidateId" :disabled="busy || dispatching" @select="selectCandidate" @query="query" @abandon="abandon" />
              </template>
            </template>
          </details>
          <details v-if="state.previousPlans?.length" class="previousPlans" @toggle="showPreviousPlans = ($event.currentTarget as HTMLDetailsElement).open">
            <summary>历史计划 · {{ state.previousPlans.length }}</summary>
            <details v-for="(plan, index) in showPreviousPlans ? state.previousPlans : []" :key="index" @toggle="toggleHistoricalPlan(index, $event)">
              <summary>{{ getImageWorkbenchTemplate(plan.templateId, plan.cells.length).name }} · {{ plan.cells.length }} 格 · {{ plan.source.path }}</summary>
              <template v-for="group in expandedPlans.has(index) ? historicalGroups(plan) : []" :key="group.label">
                <h4>{{ group.label }}</h4>
                <imageWorkbenchCandidates :candidates="group.candidates" :selectedId="group.selectedId" :disabled="busy || dispatching" @select="selectCandidate" @query="query" @abandon="abandon" />
              </template>
            </details>
          </details>
        </main>
        <div v-if="state && template" class="workbenchOptions" :class="{ mobileVisible: visibleSection === 'settings' }">
          <imageWorkbenchSettings
            :plan="state" :template="template" :disabled="editDisabled"
            :modelsLoading="modelsLoading" :modelError="modelError" :languageModels="languageModels" :imageModels="imageModels"
            :languageModel="languageModel" :imageModel="selectedImageModel"
            :skills="skills" :skillsLoading="skillsLoading" :skillError="skillError"
            @loadModels="loadModels" @loadSkills="loadSkills" />
          <label v-if="references.length > 120 && !isStoryGridTemplate(state.templateId)" class="workbenchField plannerReferenceScope">
            策划参考图范围 · 最多 120 项
            <el-select v-model="plannerReferenceIds" multiple filterable fitInputWidth collapseTags :multipleLimit="120" :disabled="editDisabled" aria-label="策划参考图范围">
              <el-option v-for="item in references" :key="item.id" :label="referenceLabel(item)" :value="item.id" />
            </el-select>
          </label>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="workbenchFooter">
        <p v-if="!state" class="workbenchError" role="alert">{{ error || "此节点没有可用的图片计划。" }}</p>
        <p v-else role="status">当前模式 · 已完成 {{ counts.succeeded }} · 失败 {{ counts.failed }} · 待处理 {{ counts.pending }} · 占用并发 {{ activeCount }} / {{ state.concurrency }}</p>
        <p v-if="layoutSaving" role="status">正在保存格数，尚未确认完成。本次操作没有发起图片生成请求。</p>
        <p v-if="displayError && state" class="workbenchError" role="alert">{{ displayError }}</p>
        <div v-if="state" class="footerControls">
          <div class="footerInfo">
            <span>开始生成 {{ requestCount }} 次 · 已排队 {{ queuedCount }} 次</span>
            <span>停止派发只会暂停后续提交，已接单任务继续运行。</span>
            <span v-if="tooManyStoryShots" class="workbenchError">所选分镜多于格数，请增加格数或减少所选分镜。</span>
            <span v-else-if="dispatchErrors.length && sourceMatches && !modelsLoading" class="workbenchError">{{ dispatchErrors[0] }}</span>
            <details v-if="dispatchErrors.length > 1 && sourceMatches && !modelsLoading">
              <summary>查看另外 {{ dispatchErrors.length - 1 }} 项派发问题</summary>
              <ul><li v-for="item in dispatchErrors.slice(1)" :key="item">{{ item }}</li></ul>
            </details>
          </div>
          <div class="footerActions">
            <el-button :disabled="busy" @click="save">保存计划</el-button>
            <el-button :loading="planning" :disabled="editDisabled || modelsLoading || !languageModel || !context || tooManyStoryShots" @click="planWithAi">AI 规划</el-button>
            <el-button v-if="dispatching || preparing" @click="workbench.stopDispatch">停止派发</el-button>
            <el-button :disabled="editDisabled || !queuedCount || modelsLoading || !!resumeErrors.length" @click="run(workbench.resume)">继续待处理</el-button>
            <el-button type="primary" :disabled="editDisabled || !requestCount || modelsLoading || !!startErrors.length" @click="run(() => workbench.start())">开始生成</el-button>
          </div>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowReactive, shallowRef, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElInputNumber, ElMessageBox, ElOption, ElSelect, ElTag } from "element-plus";
import { useNodeAi, type NodeAiModel } from "@lum/nodes-scaffold/nodeAi";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";
import { useNodeFiles } from "@lum/nodes-scaffold/workspaceFiles";
import { useDefaultModel } from "@lum/node-shared/useDefaultModel";
import type { MediaPromptSkill } from "@lum/node-shared/mediaPromptEditing";
import type { StoryGridAsset, StoryGridShot } from "@lum/node-shared/storyGridSources";
import imageWorkbenchAdopt from "./imageWorkbenchAdopt.vue";
import imageWorkbenchSettings from "./imageWorkbenchSettings.vue";
import imageWorkbenchPreview from "./imageWorkbenchPreview.vue";
import imageWorkbenchSplit from "./imageWorkbenchSplit.vue";
import imageWorkbenchCandidates from "./imageWorkbenchCandidates.vue";
import imageWorkbenchStorySources from "./imageWorkbenchStorySources.vue";
import { imageCompositionLimits, type ImageCompositionFit, type ImageWorkbenchSplitLayout } from "../imageComposition";
import { imageWorkbenchLimits, isStoryGridTemplate, type ImageWorkbenchSource, type ImageWorkbenchStoredPlan } from "../imageWorkbench";
import { loadImageWorkbenchSkillCatalog, planImageWorkbench } from "../imageWorkbenchPlanning";
import { getImageWorkbenchTemplate, imageWorkbenchTemplates, type ImageWorkbenchTemplateId } from "../imageWorkbenchTemplates";
import { useImageWorkbench } from "../useImageWorkbench";
import type { ImageWorkbenchAdoptionSelection } from "../useImageWorkbenchResults";
import type { ImageWorkbenchNamedReference } from "../imageWorkbenchChildren";

const props = defineProps<{ source?: ImageWorkbenchSource & { mimeType: string }; sourceRevision?: string }>();
const emit = defineEmits<{ close: [] }>();
const workbench = useImageWorkbench({ source: () => props.source, sourceRevision: () => props.sourceRevision });
const { storySources } = workbench;
const storyPreviews = storySources.previews;
const { state, references, sourceReferenceId, sourceMatches, imageModels, selectedImageModel, activeCount, requestCount, queuedCount, submittingCount, dispatching, preparing, layoutSaving, error, results } = workbench;
const ai = useNodeAi();
const files = useNodeFiles();
const getPersistence = useNodePersistence();
const lifetime = new AbortController();
const context = getPersistence?.();
const localError = ref("");
const displayError = computed(() => localError.value || error.value);
const localProgress = ref("");
const actionBusy = ref(false);
const planning = ref(false);
const preparingStorySources = ref(false);
const confirming = ref(false);
const adoptionBusy = ref(false);
const busy = computed(() => adoptionBusy.value || layoutSaving.value || preparing.value || submittingCount.value > 0 || results.busy.value || actionBusy.value || planning.value || confirming.value);
const editDisabled = computed(() => busy.value || dispatching.value || !sourceMatches.value);
const layoutDisabled = computed(() => editDisabled.value || activeCount.value > 0);
const storyCount = ref(4);
const templateDisabled = computed(() => busy.value || dispatching.value || !props.source);
const previewWorkspace = computed(() => {
  if (getPersistence?.()?.directory !== context?.directory || getPersistence?.()?.canvasPath !== context?.canvasPath) return;
  try { return files.getWorkspaceFiles(); }
  catch { return undefined; }
});
const sections = [{ id: "templates", label: "模板" }, { id: "plan", label: "计划与结果" }, { id: "settings", label: "设置" }] as const;
const visibleSection = ref<(typeof sections)[number]["id"]>(state.value ? "plan" : "templates");
const templateCategories: { label: string; ids: ImageWorkbenchTemplateId[] }[] = [
  { label: "镜头与剧情", ids: ["multiCamera9", "storyFourGrid", "storyTwentyFiveGrid", "afterThreeSeconds", "beforeFiveSeconds"] },
  { label: "角色与资产", ids: ["characterThreeViews", "characterSheet", "faceThreeViews", "sceneFourGrid", "propSheet"] },
  { label: "画面调整", ids: ["lightingCorrection"] },
];
const templateGroups = templateCategories.map(({ label, ids }) => ({ label, templates: imageWorkbenchTemplates.filter(item => ids.includes(item.id)) }));
const template = computed(() => state.value && getImageWorkbenchTemplate(state.value.templateId, state.value.cells.length));
const cellId = ref("");
const cell = computed(() => state.value?.cells.find(item => item.id === cellId.value));
const sourceShot = computed(() => state.value?.storyPlanning?.shots.find(shot => shot.id === cell.value?.sourceShotId));
const tooManyStoryShots = computed(() => !!state.value && (state.value.storySources?.shots.length ?? 0) > state.value.cells.length);
const cellLabel = computed(() => template.value?.cells.find(item => item.id === cellId.value)?.label ?? "");
const resultCellId = computed(() => state.value?.mode === "quality" ? cellId.value : undefined);
const candidates = computed(() => state.value?.mode === "sheet" ? state.value.sheetCandidates : cell.value?.candidates ?? []);
const selectedId = computed(() => state.value?.mode === "sheet" ? state.value.selectedSheetCandidateId : cell.value?.selectedCandidateId);
const selected = computed(() => results.getSelectedCandidate(resultCellId.value));
const comparisonId = ref("");
const comparison = computed(() => comparisonId.value ? results.getCandidatePreview(comparisonId.value, resultCellId.value) : undefined);
const pickedCount = computed(() => template.value?.cells.filter(item => results.getSelectedCandidate(item.id)).length ?? 0);
const sheetPreviewReady = ref(false);
const composeWidth = ref<number | undefined>(2048);
const composeHeight = ref<number | undefined>(2048);
const composeName = ref("");
const composeFit = ref<ImageCompositionFit>("contain");
const showPreviousPlans = ref(false);
const showDormantCells = ref(false);
const expandedPlans = shallowReactive(new Set<number>());
const composeSizeError = computed(() => {
  const { grid } = template.value ?? { grid: { columns: 1, rows: 1 } };
  const width = composeWidth.value ?? 0;
  const height = composeHeight.value ?? 0;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < grid.columns || height < grid.rows
    || Math.max(width, height) > imageCompositionLimits.side || width * height > imageCompositionLimits.pixels) {
    return "请在允许的边长和总像素范围内设置拼版宽高。";
  }
  return "";
});
const plannerReferenceIds = ref<string[]>([]);

watch(state, plan => {
  if (plan) { cellId.value = plan.cells[0].id; storyCount.value = plan.cells.length; }
  localProgress.value = "";
  expandedPlans.clear();
}, { immediate: true });
watch([state, cellId, () => state.value?.mode], () => { comparisonId.value = ""; });
watch([selectedId, () => selected.value?.output.path, () => selected.value?.output.mimeType], () => { sheetPreviewReady.value = false; }, { flush: "sync" });
watch(() => [getPersistence?.()?.directory, getPersistence?.()?.canvasPath], ([directory, canvasPath]) => {
  if (directory !== context?.directory || canvasPath !== context?.canvasPath) lifetime.abort();
}, { flush: "sync" });
onScopeDispose(() => lifetime.abort());

const languageModels = shallowRef<NodeAiModel[]>([]);
const modelsLoading = ref(false);
const modelError = ref("");
const languageSettings = computed(() => state.value?.languageModel ?? { model: "", followDefaultModel: false });
useDefaultModel(languageSettings, languageModels, busy);
const languageModel = computed(() => languageSettings.value.followDefaultModel
  ? languageModels.value.find(model => model.isDefault)
    ?? languageModels.value[0]
  : languageModels.value.find(model => modelKey(model) === languageSettings.value.model));
const skills = shallowRef<MediaPromptSkill[]>([]);
const skillsLoading = ref(false);
const skillError = ref("");
const modelKey = (model: { providerId: string; modelId: string }) => JSON.stringify([model.providerId, model.modelId]);
const unavailableReferences = computed(() => cell.value?.referenceIds.filter(id => !references.value.some(item => item.id === id)) ?? []);
const isTerminal = (status: string) => status === "succeeded" || status === "failed" || status === "cancelled";
const canRetry = computed(() => {
  const latest = candidates.value.at(-1);
  return !!latest && isTerminal(latest.status);
});
const startErrors = computed(() => requestCount.value ? workbench.preflight("start") : []);
const resumeErrors = computed(() => queuedCount.value ? workbench.preflight("resume") : []);
const retryErrors = computed(() => canRetry.value ? workbench.preflight("retry", resultCellId.value) : []);
const dispatchErrors = computed(() => [...new Set([...startErrors.value, ...resumeErrors.value])]);
const counts = computed(() => {
  const plan = state.value;
  const latest = plan?.mode === "sheet" ? [plan.sheetCandidates.at(-1)] : plan?.cells.map(item => item.candidates.at(-1)) ?? [];
  return {
    succeeded: latest.filter(item => item?.status === "succeeded").length,
    failed: latest.filter(item => item?.status === "failed").length,
    pending: latest.filter(item => !item || !isTerminal(item.status)).length,
  };
});
let catalogChanged = false;
function refreshProviderModels() {
  if (!state.value) return;
  if (busy.value || dispatching.value || modelsLoading.value) catalogChanged = true;
  else void loadModels();
}
watch([busy, dispatching, modelsLoading], ([locked, dispatching, loading]) => {
  if (catalogChanged && !locked && !dispatching && !loading) {
    catalogChanged = false;
    void loadModels();
  }
});
onMounted(() => {
  if (state.value) void loadModels();
  window.addEventListener("lum:provider-config-changed", refreshProviderModels);
});
onScopeDispose(() => window.removeEventListener("lum:provider-config-changed", refreshProviderModels));

function message(failure: unknown) {
  return (failure as { response?: { data?: { message?: string } } })?.response?.data?.message
    || (failure instanceof Error ? failure.message : String(failure));
}
function referenceLabel(item: ImageWorkbenchNamedReference) {
  return (item.id === sourceReferenceId.value ? "当前原图 · " : "") + item.name + " · " + item.handleId;
}
function historicalGroups(plan: ImageWorkbenchStoredPlan) {
  const allCells = [...plan.cells, ...plan.dormantCells ?? []];
  const labels = getImageWorkbenchTemplate(plan.templateId, allCells.length).cells;
  return [
    ...allCells.map((item, index) => ({ label: labels[index].label, candidates: item.candidates, selectedId: item.selectedCandidateId })),
    { label: "整张", candidates: plan.sheetCandidates, selectedId: plan.selectedSheetCandidateId },
  ].filter(group => group.candidates.length);
}
function toggleHistoricalPlan(index: number, event: Event) {
  if ((event.currentTarget as HTMLDetailsElement).open) expandedPlans.add(index);
  else expandedPlans.delete(index);
}
function beforeClose(done: () => void) {
  if (adoptionBusy.value || actionBusy.value || layoutSaving.value || preparing.value || preparingStorySources.value || results.busy.value || confirming.value) {
    localError.value = "工作台正在保存或处理结果，请完成后关闭。";
    return;
  }
  done();
}
function closeWorkbench() {
  workbench.stopDispatch();
  lifetime.abort();
}
async function loadModels() {
  if (modelsLoading.value || lifetime.signal.aborted) return;
  modelsLoading.value = true;
  modelError.value = "";
  const [language, images] = await Promise.allSettled([ai.getModels(lifetime.signal), workbench.loadImageModels()]);
  if (!lifetime.signal.aborted) {
    if (language.status === "fulfilled") languageModels.value = language.value;
    const failures = [language, images].flatMap(item => item.status === "rejected" ? [message(item.reason)] : []);
    modelError.value = failures.join(" · ");
  }
  modelsLoading.value = false;
}
async function loadSkills() {
  if (skillsLoading.value || lifetime.signal.aborted) return;
  skillsLoading.value = true;
  skillError.value = "";
  try {
    skills.value = await loadImageWorkbenchSkillCatalog(lifetime.signal);
  } catch (failure) {
    if (!lifetime.signal.aborted) skillError.value = message(failure);
  } finally {
    skillsLoading.value = false;
  }
}
async function run(action: () => Promise<unknown>) {
  if (busy.value || lifetime.signal.aborted) return;
  actionBusy.value = true;
  localError.value = "";
  try { await action(); }
  catch (failure) { if (!lifetime.signal.aborted) localError.value = message(failure); }
  finally { actionBusy.value = false; }
}
function applyTemplate(templateId: ImageWorkbenchTemplateId) {
  if (templateDisabled.value || (sourceMatches.value && state.value?.templateId === templateId)) return;
  void run(async () => {
    await workbench.replacePlan(templateId);
    visibleSection.value = "plan";
    if (!imageModels.value.length && !languageModels.value.length) void loadModels();
  });
}
function resizeStory(count: number) {
  if (layoutDisabled.value) return;
  void run(() => workbench.resizeStory(count));
}
function save() {
  void run(async () => {
    await workbench.save();
    localProgress.value = "计划已保存";
  });
}
function selectStorySources(assets: StoryGridAsset[], shots: StoryGridShot[]) {
  void run(() => storySources.setSelection(assets, shots));
}
function prepareStorySources() {
  void run(async () => {
    await storySources.prepare(workbench.bindPlanning());
    localProgress.value = "所选原图已准备，可预览或交给 AI 规划";
  });
}
async function planWithAi() {
  const plan = state.value;
  const source = props.source;
  const model = languageModel.value;
  const live = getPersistence?.();
  if (!plan || !source || !model || !live || editDisabled.value || lifetime.signal.aborted) return;
  planning.value = true;
  localError.value = "";
  localProgress.value = "";
  const fingerprint = () => JSON.stringify([
    plan.sourceFingerprint, plan.templateId, plan.mode, plan.requirements, plan.skill, plan.languageModel,
    plan.storySources, plan.cells.map(item => [item.id, item.prompt, item.referenceIds, item.reason, item.sourceShotId]),
  ]);
  const snapshot = fingerprint();
  const catalog = references.value.length > 120
    ? references.value.filter(item => plannerReferenceIds.value.includes(item.id))
    : references.value;
  try {
    const binding = workbench.bindPlanning();
    const check = () => {
      binding.check();
      lifetime.signal.throwIfAborted();
      if (!sourceMatches.value || state.value !== plan || props.source !== source || snapshot !== fingerprint()) {
        throw new Error("原图或计划已变化，请重新策划");
      }
    };
    if (tooManyStoryShots.value) throw new Error("所选分镜多于格数，请增加格数或减少所选分镜");
    preparingStorySources.value = isStoryGridTemplate(plan.templateId);
    const prepared = preparingStorySources.value
      ? await storySources.prepare(binding).finally(() => { preparingStorySources.value = false; })
      : undefined;
    check();
    const actualReferences = new Map((prepared
      ? references.value.filter(item => prepared.story.attachments.some(attachment => attachment.id === item.id))
      : catalog).map(item => [item.id, item]));
    const result = await planImageWorkbench({
      ai, model, state: plan, directory: live.directory,
      sourceReferenceId: sourceReferenceId.value && actualReferences.has(sourceReferenceId.value) ? sourceReferenceId.value : undefined,
      sourceImage: { url: plan.source.path, mimeType: source.mimeType },
      references: prepared ? prepared.story.attachments.flatMap(({ id, name, category }) => id ? [{ id, name, role: category }] : [])
        : [...actualReferences.values()].map(item => ({ id: item.id, name: referenceLabel(item), description: item.path })),
      story: prepared?.story,
      validateBeforeRequest: prepared && (async () => { await prepared.assertInputs(); check(); }),
      signal: lifetime.signal,
    });
    await prepared?.assertInputs();
    check();
    const liveReferences = new Map(references.value.map(item => [item.id, item]));
    for (const id of new Set(result.cells.flatMap(item => item.referenceIds))) {
      const current = liveReferences.get(id);
      const original = actualReferences.get(id);
      if (!current || current.path !== original?.path || current.mimeType !== original.mimeType) throw new Error("策划期间参考图已变化，请重新策划");
    }
    for (const [index, item] of result.cells.entries()) {
      delete plan.cells[index].sourceShotId;
      Object.assign(plan.cells[index], item);
    }
    if (prepared) {
      plan.storySources = prepared.selected;
      plan.storyPlanning = prepared.snapshot;
    }
    plan.skill = result.skill;
    localProgress.value = "提示词已更新，可逐格修改并保存。";
  } catch (failure) {
    if (!lifetime.signal.aborted) localError.value = message(failure);
  } finally {
    planning.value = false;
  }
}
function selectCandidate(id: string) {
  void run(async () => {
    await workbench.selectCandidate(id);
    comparisonId.value = "";
    localProgress.value = "";
  });
}
function query(id: string) {
  void run(() => workbench.query(id));
}
async function abandon(id: string) {
  if (busy.value || dispatching.value) return;
  confirming.value = true;
  try {
    await ElMessageBox.confirm("放弃后可另开一次尝试。已在供应商接单的任务可能继续运行并计费。", "放弃此尝试", {
      type: "warning", confirmButtonText: "放弃此尝试", cancelButtonText: "保留尝试",
    });
  } catch {
    return;
  } finally {
    confirming.value = false;
  }
  await run(() => workbench.abandon(id));
}
function compose() {
  void run(async () => {
    localProgress.value = "";
    const result = await results.compose({
      size: { width: composeWidth.value ?? 0, height: composeHeight.value ?? 0 }, fit: composeFit.value, name: composeName.value.trim() || undefined,
      progress: (completed, total) => { localProgress.value = "拼版已绘制 " + completed + " / " + total + " 格"; },
    });
    localProgress.value = "已保存拼版「" + result.name + "」· " + result.width + " × " + result.height;
  });
}
function split(layout: ImageWorkbenchSplitLayout, names: Record<string, string>) {
  const sheet = selected.value;
  if (!sheet || !sheetPreviewReady.value) return;
  void run(async () => {
    localProgress.value = "";
    const saved = await results.split({
      candidateId: sheet.candidateId, layout, names,
      progress: (completed, total) => { localProgress.value = "已写入 " + completed + " / " + total + " 张裁剪图片"; },
    });
    localProgress.value = "已保存 " + saved.length + " 个裁剪图片节点";
  });
}
async function buildAdoption(selections: readonly ImageWorkbenchAdoptionSelection[], signal?: AbortSignal) {
  if (busy.value || dispatching.value) throw new Error("请等待工作台操作结束");
  return results.buildAdoption(selections, signal);
}
defineExpose({ busy, buildAdoption });
</script>

<style scoped lang="scss">
:global(.imageWorkbenchDialog) {
  display: flex;
  flex-direction: column;
  max-height: 92vh;
  padding: 0;
}
:global(.imageWorkbenchDialog > .el-dialog__header) { padding: 16px 20px; border-bottom: 1px solid var(--el-border-color-lighter); }
:global(.imageWorkbenchDialog > .el-dialog__body) { min-height: 0; overflow: auto; padding: 0; }
:global(.imageWorkbenchDialog > .el-dialog__footer) { padding: 12px 20px; border-top: 1px solid var(--el-border-color-lighter); text-align: start; }
.workbenchBody {
  .workbenchSections { display: none; }
  .workbenchColumns {
    display: grid;
    grid-template-columns: minmax(170px, .65fr) minmax(0, 2.4fr) minmax(240px, 1fr);
    align-items: stretch;
  }
  .workbenchTemplates, .workbenchPlan, .workbenchOptions { min-width: 0; padding: 16px; }
  .workbenchTemplates {
    background: var(--el-fill-color-lighter);
    border-right: 1px solid var(--el-border-color-lighter);
    display: grid;
    align-content: start;
    gap: 12px;
    section { display: grid; gap: 4px; }
    h4 { color: var(--el-text-color-secondary); font-size: 12px; }
    p { margin: 0; overflow-wrap: anywhere; }
    button { justify-content: space-between; }
  }
  .workbenchOptions { border-left: 1px solid var(--el-border-color-lighter); }
  .plannerReferenceScope { margin-top: 16px; }
  .workbenchPlan { display: grid; align-content: start; gap: 14px; }
  .planHeader {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    p { margin: 5px 0 0; color: var(--el-text-color-regular); }
  }
  h2, h3, h4 { margin: 0; }
  h2 { font-size: 18px; }
  h3 { font-size: 14px; }
  .planNotice {
    background: var(--el-color-warning-light-9);
    border: 1px solid var(--el-color-warning-light-7);
    padding: 8px;
  }
  .storyCountControls {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    input { width: 80px; }
    p { width: 100%; margin: 0; }
    .el-button { margin: 0; }
  }
  .cellNavigation {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 132px), 1fr));
    gap: 5px;
    small, span { color: var(--el-text-color-secondary); }
  }
  .cellNavigation button, .workbenchTemplates button {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
    padding: 7px 8px;
    text-align: start;
    font: inherit;
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-blank);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    cursor: pointer;
    span { flex: none; }
    &[aria-pressed="true"] { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
    &:disabled { color: var(--el-text-color-disabled); cursor: not-allowed; }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
  }
  .cellEditor, .workbenchResults { display: grid; gap: 9px; justify-items: start; min-width: 0; }
  .workbenchResults { border-top: 1px solid var(--el-border-color-lighter); padding-top: 12px; }
  .workbenchResults > p { margin: 0; }
  .workbenchField { display: grid; gap: 5px; width: 100%; font-weight: 600; }
  .workbenchField :deep(.el-input), .workbenchField :deep(.el-textarea), .workbenchField :deep(.el-select) { font-weight: normal; }
  .comparison, .compositionFields {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr));
    gap: 8px;
  }
  .compositionFields label { display: grid; gap: 4px; min-width: 0; }
  .compositionFields :deep(.el-input-number) { max-width: 100%; }
  .workbenchResults :deep(.candidateHistory), .workbenchResults :deep(.splitSettings) { width: 100%; }
  .previousPlans { overflow-wrap: anywhere; }
  .previousPlans details { margin-top: 8px; }
  .previousPlans summary { cursor: pointer; }
  .previousPlans h4 { margin-top: 8px; }
}
.workbenchFooter {
  display: grid;
  gap: 8px;
  p { margin: 0; }
  .footerControls { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
  .footerInfo { display: grid; flex: 1 1 270px; min-width: 0; gap: 4px; font-size: 12px; color: var(--el-text-color-secondary); }
  .footerInfo summary { cursor: pointer; }
  .footerInfo ul { margin: 4px 0 0; padding-inline-start: 18px; max-height: 64px; overflow: auto; }
  .footerActions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    .el-button { margin: 0; }
  }
}
.workbenchError { color: var(--el-color-danger); overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .workbenchBody {
    .workbenchSections { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
    .workbenchSections .el-button { margin: 0; }
    .workbenchColumns { display: block; }
    .workbenchTemplates, .workbenchPlan, .workbenchOptions { display: none; border: 0; }
    .workbenchTemplates.mobileVisible, .workbenchPlan.mobileVisible, .workbenchOptions.mobileVisible { display: grid; }
  }
}
@media (max-width: 500px) {
  :global(.imageWorkbenchDialog > .el-dialog__footer) { padding: 8px 12px; }
  .workbenchBody .workbenchTemplates, .workbenchBody .workbenchPlan, .workbenchBody .workbenchOptions { padding: 12px; }
  .workbenchFooter .footerControls { gap: 5px; }
}
</style>
