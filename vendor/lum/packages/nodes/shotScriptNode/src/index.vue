<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :bottomWidth="560"
    :style="{ width: '300px' }">
    <template #top>
      <el-card class="shotToolbar" shadow="never" :bodyStyle="{ padding: '6px' }">
        <el-button text :icon="IconRefresh" :disabled="!canGenerate || generating" @click="resetToChoose">重新生成</el-button>
        <el-button text :icon="IconLayoutGrid" :disabled="!stepsDone || !!batching" :loading="batching === 'image'" @click="batchImages">批量生成分镜</el-button>
        <el-button text :icon="IconPlayerPlay" :disabled="!stepsDone || !!batching" :loading="batching === 'video'" @click="batchVideos">批量生成视频</el-button>
        <el-dropdown trigger="click" :disabled="!hasBatch" @command="runGroup">
          <el-button text :icon="IconPlayerTrackNext" :disabled="!hasBatch">整组执行<icon-chevron-down :size="14" /></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="assets" :disabled="!shots.batch.assetGroupId">生成资产组</el-dropdown-item>
              <el-dropdown-item command="images" :disabled="!Object.keys(shots.batch.imageNodes).length">生成分镜图组</el-dropdown-item>
              <el-dropdown-item command="videos" :disabled="!Object.keys(shots.batch.videoNodes).length">生成视频组</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-divider direction="vertical" />
        <el-button :tag="downloadUrl ? 'a' : 'button'" :href="downloadUrl || undefined" :download="`${nodeProps.label || '分镜脚本'}.md`" text :icon="IconDownload" title="下载镜头表" aria-label="下载" :disabled="!downloadUrl" @click.stop />
      </el-card>
    </template>
    <div class="shotCard">
      <el-alert v-if="file.state.error" :title="file.state.error" type="error" :closable="false" showIcon />
      <template v-if="generating">
        <div class="cardIcon"><icon-list-details :size="36" stroke="1.25" /></div>
        <div class="skeletonRows"><s v-for="n in 9" :key="n" /></div>
        <div class="progress">生成中 {{ progress }}%… <el-button text size="small" @click="cancelGeneration">取消</el-button></div>
      </template>
      <template v-else-if="!shots.shots.length">
        <div class="cardIcon"><icon-list-details :size="36" stroke="1.25" /></div>
        <p class="tryLabel">尝试：</p>
        <button type="button" class="modeOption nodrag" :disabled="!sourceScript" @pointerdown.stop @click.stop="startMode('script')"><icon-file-text :size="16" />剧本生成分镜脚本</button>
        <button type="button" class="modeOption nodrag" :disabled="!sourceScript" @pointerdown.stop @click.stop="startMode('character')"><icon-user :size="16" />角色生成分镜脚本</button>
        <button type="button" class="modeOption nodrag" @pointerdown.stop @click.stop="startMode('manual')"><icon-pencil :size="16" />自己编写分镜脚本</button>
        <p v-if="!sourceScript" class="hint">从剧本节点右侧拉线连到这里，就能按集生成</p>
      </template>
      <template v-else>
        <div class="cardIcon"><icon-list-details :size="36" stroke="1.25" /></div>
        <ol class="steps">
          <li v-for="step in stepItems" :key="step.index" :class="{ done: step.done }"><span>{{ step.done ? "✓" : step.index }}</span>{{ step.label }}</li>
        </ol>
        <p class="cardMeta">{{ shots.episodeTitle || "自编脚本" }} · {{ shots.shots.length }} 镜 · {{ totalDuration(shots.shots) }} 秒</p>
        <el-button class="openButton nodrag" @dblclick.stop @click.stop="openWorkbench()">打开脚本节点 →</el-button>
      </template>
    </div>
    <template #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '10px 12px' }">
        <el-input v-model="request" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" resize="none" placeholder="描述剧情片段、故事，为你生成分镜脚本（可留空，直接按所选集生成）" aria-label="分镜要求" />
        <div class="promptFooter">
          <el-select :modelValue="textModel.selected.value ? data.model : ''" size="small" class="modelSelect" filterable placeholder="文本模型" :loading="textModel.loading.value" @update:modelValue="textModel.choose($event)">
            <el-option-group v-for="provider in textModel.groups.value" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <el-select v-if="textModel.reasoningLevels.value.length" :modelValue="textModel.thinkingLevel.value || 'auto'" size="small" class="thinkingSelect" aria-label="推理挡位" @update:modelValue="textModel.chooseThinking($event === 'auto' ? '' : $event)">
            <el-option value="auto" label="推理：默认" />
            <el-option v-for="level in textModel.reasoningLevels.value" :key="level" :label="`推理：${thinkingLevelLabels[level] ?? level}`" :value="level" />
          </el-select>
          <el-select v-if="sourceScript?.episodes.length" v-model="episodeIndex" size="small" class="episodeSelect" aria-label="选择集">
            <el-option v-for="(episode, index) in sourceScript.episodes" :key="episode.id" :label="episode.title" :value="index" />
          </el-select>
          <el-select v-if="pendingMode === 'character'" v-model="characters" size="small" multiple collapseTags placeholder="选择角色" class="episodeSelect">
            <el-option v-for="item in sourceCharacters" :key="item" :label="item" :value="item" />
          </el-select>
          <span class="spacer" />
          <el-button class="sendButton" :icon="IconArrowUp" :loading="generating" :disabled="generating || !file.ready.value || (!sourceScript && !request.trim())" title="生成分镜脚本" aria-label="生成分镜脚本" @click="generateShots(pendingMode === 'character' ? 'character' : 'script')" />
        </div>
      </el-card>
    </template>
  </nodeSkeleton>

  <el-dialog v-model="workbench" fullscreen appendToBody class="shotWorkbench" :showClose="false" @closed="file.touch(true).catch(() => {})">
    <template #header>
      <div class="workbenchHeader">
        <strong class="title">{{ nodeProps.label }}</strong>
        <ol class="stepTabs">
          <li v-for="step in stepItems" :key="step.index" :class="{ active: shots.step === step.index, done: step.done }" @click="setStep(step.index)">
            <span class="dot">{{ step.done && shots.step !== step.index ? "✓" : step.index }}</span>
            <span><b>{{ step.label }}</b><small>{{ step.detail }}</small></span>
          </li>
        </ol>
        <span class="batchHint">{{ doneCount }}/3 完成后可批量生视频</span>
        <el-button text :icon="IconX" aria-label="关闭" @click="workbench = false" />
      </div>
    </template>
    <div class="workbenchBody">
      <shotTable v-if="shots.step === 1" :document="shots" @change="changed" @viewPrompt="viewPrompt" />
      <assetBoard v-else-if="shots.step === 2" :document="shots" :busy="assetBusy" :canvasImages="canvasImages" :assetPrompt="assetPrompt"
        :imageSettings="imageSettings" :imageModels="media.imageModels.value" :defaultImageModel="media.defaultImageModel.value"
        @change="changed" @generateAll="openGenerateAll" @generate="generateAsset" @upload="uploadAsset" @jump="jumpToAsset" @library="assetToLibrary" @remove="removeAsset" />
      <promptBoard v-else :document="shots" :busy="promptBusy" :running="synthesizing" :focusShot="focusShot" :textModel="textModel" @change="changed" @synthesize="synthesize" />
    </div>
    <footer class="workbenchFooter">
      <el-button v-if="shots.step > 1" @click="setStep((shots.step - 1) as 1 | 2)">← 上一步</el-button>
      <span class="spacer" />
      <el-button v-if="shots.step < 3" type="primary" @click="setStep((shots.step + 1) as 2 | 3)">下一步：{{ shots.step === 1 ? "准备资产" : "合成提示词" }} →</el-button>
      <template v-else>
        <el-button :disabled="!stepsDone || !!batching" @click="workbench = false; batchImages()">批量生成分镜</el-button>
        <el-button type="primary" :disabled="!stepsDone || !!batching" @click="workbench = false; batchVideos()">批量生成视频</el-button>
      </template>
    </footer>
  </el-dialog>

  <el-dialog v-model="generateAll.visible" title="一键生成所有资产" width="min(960px, calc(100vw - 32px))" appendToBody>
    <div class="generateList">
      <label v-for="item in generateAll.items" :key="item.asset.id" class="generateItem">
        <el-checkbox v-model="item.checked" />
        <div>
          <strong>{{ item.asset.name }} <el-tag size="small">{{ assetKindLabels[item.asset.kind] }}</el-tag></strong>
          <el-input v-model="item.prompt" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" size="small" />
        </div>
      </label>
    </div>
    <template #footer>
      <span class="generateFooter">
        <el-checkbox :modelValue="generateAll.items.every(item => item.checked)" @change="(value: unknown) => generateAll.items.forEach(item => item.checked = !!value)">已选 {{ generateAll.items.filter(item => item.checked).length }}/{{ generateAll.items.length }}</el-checkbox>
        <span class="spacer" />
        <imageSettingsBar :settings="imageSettings" :models="media.imageModels.value" :fallback="media.defaultImageModel.value" />
        <el-button @click="generateAll.visible = false">取消</el-button>
        <el-button type="primary" :loading="generateAll.busy" :disabled="!generateAll.items.some(item => item.checked)" @click="confirmGenerateAll">生成 ({{ generateAll.items.filter(item => item.checked).length }})</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElAlert, ElButton, ElCard, ElCheckbox, ElDialog, ElDivider, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElMessage, ElMessageBox, ElOption, ElOptionGroup, ElSelect, ElTag } from "element-plus";
import { IconArrowUp, IconChevronDown, IconDownload, IconFileText, IconLayoutGrid, IconListDetails, IconPencil, IconPlayerPlay, IconPlayerTrackNext, IconRefresh, IconUser, IconX } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, useNodeInputs, z, type NodeHandle } from "@lum/nodes-scaffold/runtime";
import { useNodeJsonFile } from "@lum/node-shared/useNodeJsonFile";
import { thinkingLevelLabels, useTextModel } from "@lum/node-shared/useTextModel";
import { maxImageReferences, useMediaModels } from "@lum/node-shared/useMediaModels";
import { addGroupedNodes, useNodeCaller } from "@lum/node-shared/canvasBatch";
import { normalizeScriptDocument, parseEntities, scriptEntities, type ScriptDocument } from "@lum/node-shared/scriptDocument";
import shotTable from "./shotTable.vue";
import assetBoard from "./assetBoard.vue";
import promptBoard from "./promptBoard.vue";
import imageSettingsBar from "./imageSettingsBar.vue";
import { createImageSettings, imageNodeSettings, type ImageSettings } from "./imageSettings";
import { assetKindLabels, concatImagePrompt, concatVideoPrompt, createShotDocument, mentionedAssets, normalizeShotDocument, shotsMarkdown, totalDuration, type AssetKind, type ShotAsset, type ShotDocument } from "./shotData";
import { applyPromptReply, applyShotReply, buildPromptRequest, buildShotPrompt, entityAssets, manualShots, promptSystemPrompt, shotSystemPrompt } from "./generation";

defineOptions({
  inheritAttrs: false,
  icon: IconListDetails,
  handles: [
    { id: "in", type: "target", dataType: "STRING", label: "剧本输入" },
    { id: "text", type: "source", dataType: "STRING", label: "镜头表输出" },
  ] satisfies NodeHandle[],
});

const { id, node, nodeProps, outputs, files } = useNode({ label: "脚本", outputs: { text: { dataType: "STRING", value: "" } } });
const data = computed(() => node.data as typeof node.data & { model?: string; followDefaultModel?: boolean; thinkingLevel?: string; imageSettings?: ImageSettings });
data.value.imageSettings ??= createImageSettings();
const imageSettings = computed(() => data.value.imageSettings!);
const file = useNodeJsonFile<ShotDocument>("shots.json", { create: createShotDocument, normalize: normalizeShotDocument });
const shots = computed(() => file.value.value);
const busy = ref(false);
const textModel = useTextModel(data, busy);
const media = useMediaModels();
const flow = useVueFlow();
const inputs = useNodeInputs(flow);
const callNode = useNodeCaller();
const request = ref("");
const episodeIndex = ref(0);
const characters = ref<string[]>([]);
const pendingMode = ref<"script" | "character">("script");
const generating = ref(false);
const progress = ref(0);
const workbench = ref(false);
const focusShot = ref<string>();
const assetBusy = reactive(new Set<string>());
const promptBusy = reactive(new Set<string>());
const synthesizing = ref(false);
const batching = ref<"" | "image" | "video">("");
let controller: AbortController | undefined;

if (!Object.hasOwn(outputs.value, "toJSON")) Object.defineProperty(outputs.value, "toJSON", { value: () => ({}) });
watch(() => file.ready.value && shots.value.shots.length ? shotsMarkdown(shots.value) : "", value => { outputs.value.text = { dataType: "STRING", value }; }, { immediate: true });

// —— 来源剧本节点 ——
const sourceNodeId = computed(() => inputs.getTargetSources(id, "in").find(item => item.node.type === "remote-scriptNode")?.node.id);
const sourceScript = ref<ScriptDocument>();
async function loadSource() {
  const sourceId = sourceNodeId.value;
  if (!sourceId) { sourceScript.value = undefined; return; }
  try {
    const path = (flow.findNode(sourceId)?.data as { filePath?: string } | undefined)?.filePath ?? `assets/${sourceId}/script.json`;
    sourceScript.value = normalizeScriptDocument(await files.getWorkspaceFiles().readJson(path));
    if (episodeIndex.value >= sourceScript.value.episodes.length) episodeIndex.value = 0;
    const matched = shots.value.episodeId ? sourceScript.value.episodes.findIndex(item => item.id === shots.value.episodeId) : -1;
    if (matched >= 0) episodeIndex.value = matched;
  } catch { sourceScript.value = undefined; }
}
watch(sourceNodeId, loadSource, { immediate: true });
// 剧本节点的输出变化（Agent 写完新的一集）时重新读取。
watch(() => sourceNodeId.value && inputs.getSourceValue(sourceNodeId.value, "text")?.value, () => { void loadSource(); });
const sourceCharacters = computed(() => sourceScript.value ? parseEntities(sourceScript.value.sections.characters, "character").map(item => item.name) : []);

// —— 状态 ——
const canGenerate = computed(() => file.ready.value);
const step1Done = computed(() => shots.value.shots.length > 0 && shots.value.shots.every(shot => shot.description.trim()));
const step2Done = computed(() => step1Done.value && shots.value.assets.every(asset => !!asset.image));
const step3Done = computed(() => step1Done.value && shots.value.shots.every(shot => shot.imagePrompt.trim() && shot.videoPrompt.trim()));
const stepsDone = computed(() => step1Done.value && step3Done.value);
const doneCount = computed(() => [step1Done.value, step2Done.value, step3Done.value].filter(Boolean).length);
const stepItems = computed(() => [
  { index: 1 as const, label: "确认镜头", done: step1Done.value, detail: `${shots.value.shots.length} 个镜头${step1Done.value ? "已就绪" : ""}` },
  { index: 2 as const, label: "准备资产", done: step2Done.value, detail: `${shots.value.assets.filter(item => item.image).length}/${shots.value.assets.length} 已生成` },
  { index: 3 as const, label: "合成提示词", done: step3Done.value, detail: `${shots.value.shots.filter(shot => shot.imagePrompt && shot.videoPrompt).length}/${shots.value.shots.length} 已合成` },
]);
const hasBatch = computed(() => !!(shots.value.batch.assetGroupId || Object.keys(shots.value.batch.imageNodes).length || Object.keys(shots.value.batch.videoNodes).length));
const downloadUrl = ref("");
watch([() => outputs.value.text?.value ?? "", () => node.selected], ([text, visible], _old, onCleanup) => {
  downloadUrl.value = "";
  if (!visible || !text) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  downloadUrl.value = url;
  onCleanup(() => URL.revokeObjectURL(url));
}, { immediate: true });

function changed() { void file.touch().catch(error => ElMessage.error(error instanceof Error ? error.message : "脚本保存失败")); }
function openWorkbench(step?: 1 | 2 | 3) { if (step) shots.value.step = step; workbench.value = true; }
function setStep(step: 1 | 2 | 3) { shots.value.step = step; if (step === 2) syncAssetsFromShots(); changed(); }
function viewPrompt(shotId: string) { focusShot.value = shotId; setStep(3); }

// —— 生成镜头表 ——
function startMode(mode: "script" | "character" | "manual") {
  if (mode === "manual") {
    shots.value.mode = "manual";
    shots.value.shots = manualShots();
    if (sourceScript.value) seedAssetsFromScript();
    changed();
    openWorkbench(1);
    return;
  }
  pendingMode.value = mode;
  if (mode === "character" && !characters.value.length) characters.value = sourceCharacters.value.slice(0, 1);
  node.selected = true;
  if (!request.value) void generateShots(mode);
}
function seedAssetsFromScript() {
  if (!sourceScript.value) return;
  const style = sourceScript.value.setup?.style.prompt || sourceScript.value.setup?.style.label || "";
  if (!shots.value.style) shots.value.style = style;
  shots.value.sourceNodeId = sourceNodeId.value ?? null;
}
async function generateShots(mode: "script" | "character") {
  if (generating.value || !file.ready.value) return;
  if (shots.value.shots.length) {
    const confirmed = await ElMessageBox.confirm("重新生成会替换当前镜头表（资产与已绑定的图片保留）。", "重新生成分镜脚本", { type: "warning", confirmButtonText: "替换", cancelButtonText: "取消" }).then(() => true, () => false);
    if (!confirmed) return;
  }
  generating.value = true;
  busy.value = true;
  progress.value = 0;
  controller = new AbortController();
  try {
    await loadSource();
    const script = sourceScript.value;
    let prompt: string;
    let known: ReturnType<typeof entityAssets> = [];
    if (script) {
      prompt = buildShotPrompt(script, { mode, episodeIndex: episodeIndex.value, characters: characters.value, request: request.value.trim(), seconds: undefined });
      known = entityAssets(scriptEntities(script));
    } else prompt = `把下面的剧情拆成镜头表：\n${request.value.trim()}`;
    const target = script?.setup ? script.setup.episodeMinutes * 60 : 180;
    const expected = Math.max(1500, target / 6 * 260);
    const document = shots.value;
    const reply = await textModel.generate(prompt, shotSystemPrompt, text => { progress.value = Math.min(95, Math.round(text.length / expected * 100)); }, controller.signal);
    seedAssetsFromScript();
    applyShotReply(document, reply, known);
    document.mode = mode;
    document.step = 1;
    const episode = script?.episodes[episodeIndex.value];
    document.episodeId = mode === "script" ? episode?.id ?? null : null;
    document.episodeTitle = mode === "script" ? episode?.title ?? "" : `角色展示 · ${characters.value.join("、")}`;
    if (episode && mode === "script") node.data.label = `脚本 · ${episode.title.split(/[：:]/)[0]}`;
    progress.value = 100;
    await file.touch(true);
    request.value = "";
    ElMessage.success(`已生成 ${document.shots.length} 个镜头`);
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) ElMessage.error(error instanceof Error ? error.message : "分镜脚本生成失败");
  } finally {
    generating.value = false;
    busy.value = false;
    controller = undefined;
  }
}
function cancelGeneration() { controller?.abort(); }
async function resetToChoose() {
  if (!shots.value.shots.length) return;
  pendingMode.value = shots.value.mode === "character" ? "character" : "script";
  node.selected = true;
  await generateShots(pendingMode.value);
}

// —— 资产 ——
function syncAssetsFromShots() {
  const script = sourceScript.value;
  if (!script) return;
  const known = entityAssets(scriptEntities(script));
  for (const shot of shots.value.shots) for (const item of known) {
    if (shot.description.includes(`@${item.name}`) && !shots.value.assets.some(asset => asset.name === item.name)) {
      shots.value.assets.push({ id: crypto.randomUUID(), ...item, image: null, nodeId: null });
    }
  }
}
type ImageValue = { path: string; mimeType: string };
function nodeImage(nodeId: string): ImageValue | undefined {
  const output = (flow.findNode(nodeId)?.data as { outputs?: Record<string, { dataType?: string; value?: { url?: string; mimeType?: string } }> } | undefined)?.outputs;
  const image = output && Object.values(output).find(item => item?.dataType === "IMAGE" && item.value?.url);
  return image?.value?.url ? { path: image.value.url, mimeType: image.value.mimeType || "image/png" } : undefined;
}
// 画布节点出图或换图后，同步到资产槽（双向同步的另一半：在这里换图会改 nodeId 指向）。
watch(() => shots.value.assets.map(asset => asset.nodeId ? `${asset.id}:${nodeImage(asset.nodeId)?.path ?? ""}` : "").join("|"), () => {
  let dirty = false;
  for (const asset of shots.value.assets) {
    if (!asset.nodeId) continue;
    const image = nodeImage(asset.nodeId);
    if (image && image.path !== asset.image?.path) { asset.image = image; dirty = true; assetBusy.delete(asset.id); }
  }
  if (dirty && file.ready.value) changed();
});
const canvasImages = computed(() => flow.getNodes.value.flatMap(item => {
  if (item.id === id) return [];
  const image = nodeImage(item.id);
  return image ? [{ nodeId: item.id, label: String(item.data?.label ?? "图片"), image }] : [];
}));
function assetPrompt(asset: ShotAsset) {
  const style = shots.value.style ? `${shots.value.style}。` : "";
  if (asset.kind === "character") return `${style}角色设定图：${asset.name}。${asset.description}。角色三视图（正面、侧面、背面）加面部特写，全身站姿，纯白背景，无文字。`;
  if (asset.kind === "scene") return `${style}场景概念图：${asset.name}。${asset.description}。不出现人物，广角全景，交代空间结构与光线，无文字。`;
  return `${style}道具设定图：${asset.name}。${asset.description}。单个道具多角度展示，纯白背景，材质细节清晰，无文字。`;
}
function imageNodeData(prompt: string, ratio: string, extra: Record<string, unknown> = {}) {
  return { prompt, promptModel: prompt.split("\n").map(text => [{ type: "Write", text }]), ratio, ...extra };
}
// 资产图按「准备资产」里选的生图模型、比例和分辨率建节点；比例选自动时道具 1:1，其余 16:9。
function assetNodeData(asset: ShotAsset, prompt: string) {
  return imageNodeData(prompt, "", { ...imageNodeSettings(imageSettings.value, media.imageModels.value, media.defaultImageModel.value, asset.kind === "prop" ? "1:1" : "16:9"), shotAsset: { ownerId: id, assetId: asset.id } });
}
async function generateAsset(asset: ShotAsset, prompt: string) {
  try {
    const self = flow.findNode(id);
    if (!self) throw new Error("脚本节点已不在画布上");
    const { ids } = addGroupedNodes(flow, self, `资产 · ${asset.name}`, [{ type: "remote-imageGenerationNode", label: `${assetKindLabels[asset.kind]} · ${asset.name}`, width: 360, height: 300, data: assetNodeData(asset, prompt) }], { columns: 1 });
    asset.nodeId = ids[0]!;
    assetBusy.add(asset.id);
    changed();
    await callNode(ids[0]!, "node:generateImage");
  } catch (error) {
    assetBusy.delete(asset.id);
    ElMessage.error(error instanceof Error ? error.message : "资产生成失败");
  }
}
async function uploadAsset(asset: ShotAsset, upload: File) {
  try {
    const path = await files.uploadFile(upload);
    asset.image = { path, mimeType: upload.type || "image/png" };
    asset.nodeId = null;
    changed();
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "上传失败"); }
}
function focusNodes(nodeIds: string[]) {
  const targets = nodeIds.flatMap(nodeId => flow.findNode(nodeId) ? [nodeId] : []);
  if (!targets.length) { ElMessage.warning("对应节点已不在画布上"); return; }
  workbench.value = false;
  flow.removeSelectedNodes(flow.getSelectedNodes.value);
  flow.addSelectedNodes(targets.map(nodeId => flow.findNode(nodeId)!));
  void flow.fitView({ nodes: targets, duration: 300, maxZoom: 1 });
}
function jumpToAsset(asset: ShotAsset) { if (asset.nodeId) focusNodes([asset.nodeId]); }
function assetToLibrary(asset: ShotAsset) {
  if (asset.nodeId && flow.findNode(asset.nodeId)) { jumpToAsset(asset); ElMessage.info("已跳到对应图片节点，在节点上方工具条点「添加到素材库」即可保存到共用资产库"); return; }
  ElMessage.info("请先用「批量生成分镜」或「AI 生成」把这张图放到画布上，再从图片节点保存到共用资产库");
}
function removeAsset(asset: ShotAsset, stripMentions: boolean) {
  shots.value.assets = shots.value.assets.filter(item => item.id !== asset.id);
  if (stripMentions) for (const shot of shots.value.shots) shot.description = shot.description.split(`@${asset.name}`).join(asset.name);
  changed();
}
const generateAll = reactive({ visible: false, busy: false, items: [] as { asset: ShotAsset; prompt: string; checked: boolean }[] });
function openGenerateAll() {
  generateAll.items = shots.value.assets.filter(asset => !asset.image).map(asset => ({ asset, prompt: assetPrompt(asset), checked: true }));
  generateAll.visible = true;
}
async function confirmGenerateAll() {
  const items = generateAll.items.filter(item => item.checked);
  if (!items.length || generateAll.busy) return;
  generateAll.busy = true;
  try {
    const self = flow.findNode(id);
    if (!self) throw new Error("脚本节点已不在画布上");
    const { groupId, ids } = addGroupedNodes(flow, self, `资产组 · ${shots.value.episodeTitle || nodeProps.value.label}`, items.map(item => ({
      type: "remote-imageGenerationNode", label: `${assetKindLabels[item.asset.kind]} · ${item.asset.name}`, width: 360, height: 300,
      data: assetNodeData(item.asset, item.prompt),
    })), { columns: 5 });
    items.forEach((item, index) => { item.asset.nodeId = ids[index]!; assetBusy.add(item.asset.id); });
    shots.value.batch.assetGroupId = groupId;
    changed();
    generateAll.visible = false;
    const failed = await startAll(ids, "node:generateImage");
    if (failed) ElMessage.warning(`${failed} 个资产未能开始生成，请检查图片模型设置后在节点上重试`);
    else ElMessage.success(`已开始生成 ${ids.length} 个资产`);
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "批量生成失败"); }
  finally { generateAll.busy = false; }
}
async function startAll(nodeIds: string[], name: `node:${string}`) {
  let failed = 0;
  for (const nodeId of nodeIds) await callNode(nodeId, name).catch(() => { failed++; });
  return failed;
}

// —— 合成提示词 ——
async function synthesize(shotIds: string[], mode: "smart" | "concat") {
  const targets = shots.value.shots.filter(shot => shotIds.includes(shot.id));
  if (!targets.length || synthesizing.value) return;
  if (mode === "concat") {
    for (const shot of targets) { shot.imagePrompt = concatImagePrompt(shot, shots.value); shot.videoPrompt = concatVideoPrompt(shot, shots.value); shot.promptMode = "concat"; }
    changed();
    ElMessage.success(`已拼接 ${targets.length} 镜提示词`);
    return;
  }
  synthesizing.value = true;
  busy.value = true;
  let failed = 0;
  try {
    const queue = [...targets];
    // 同时最多两镜，避免一次打满模型并发。
    await Promise.all([0, 1].map(async () => {
      for (let shot = queue.shift(); shot; shot = queue.shift()) {
        promptBusy.add(shot.id);
        try {
          const reply = await textModel.generate(buildPromptRequest(shot, shots.value, shots.value.shots.indexOf(shot)), promptSystemPrompt);
          applyPromptReply(shot, reply);
          shot.promptMode = "smart";
          changed();
        } catch { failed++; }
        finally { promptBusy.delete(shot.id); }
      }
    }));
    if (failed) ElMessage.warning(`${failed} 镜合成失败，可重试或改用「自动拼接」`);
    else ElMessage.success(`已合成 ${targets.length} 镜提示词`);
  } finally { synthesizing.value = false; busy.value = false; }
}

// —— 批量生成分镜 / 视频 ——
async function ensureAssetNodes() {
  // 上传的图片还没有画布节点：放进一个图片节点，便于连线引用。
  const loose = shots.value.assets.filter(asset => asset.image && (!asset.nodeId || !flow.findNode(asset.nodeId)));
  if (!loose.length) return;
  const self = flow.findNode(id)!;
  const { groupId, ids } = addGroupedNodes(flow, self, `资产组 · ${shots.value.episodeTitle || nodeProps.value.label}`, loose.map(asset => ({
    type: "remote-imageNode", label: `${assetKindLabels[asset.kind]} · ${asset.name}`, width: 300, height: 260,
    data: { outputs: { image: { dataType: "IMAGE", value: { url: asset.image!.path, mimeType: asset.image!.mimeType } } }, shotAsset: { ownerId: id, assetId: asset.id } },
  })), { columns: 5 });
  loose.forEach((asset, index) => { asset.nodeId = ids[index]!; });
  shots.value.batch.assetGroupId ??= groupId;
}
function sourceHandle(nodeId: string) {
  const handles = (flow.findNode(nodeId)?.data as { handles?: { id: string; type: string; dataType: unknown }[] } | undefined)?.handles;
  return handles?.find(item => item.type === "source" && (item.dataType === "IMAGE" || (Array.isArray(item.dataType) && item.dataType.includes("IMAGE"))))?.id ?? "image";
}
async function batchImages() {
  if (!stepsDone.value || batching.value) return;
  const existing = Object.values(shots.value.batch.imageNodes).filter(nodeId => flow.findNode(nodeId));
  if (existing.length) {
    const confirmed = await ElMessageBox.confirm(`已经有 ${existing.length} 个分镜图节点。再次批量会新建一组，旧节点保留。`, "批量生成分镜", { confirmButtonText: "新建一组", cancelButtonText: "取消" }).then(() => true, () => false);
    if (!confirmed) return;
  }
  const generate = await ElMessageBox.confirm(`将为 ${shots.value.shots.length} 个镜头各建一个图片生成节点，自动引用资产图。现在就开始生成吗？（会调用图片模型 ${shots.value.shots.length} 次）`, "批量生成分镜", {
    distinguishCancelAndClose: true, confirmButtonText: "创建并生成", cancelButtonText: "只创建节点",
  }).then(() => true, action => action === "cancel" ? false : undefined);
  if (generate === undefined) return;
  batching.value = "image";
  try {
    await ensureAssetNodes();
    const self = flow.findNode(id)!;
    const { groupId, ids } = addGroupedNodes(flow, self, `分镜图组 · ${shots.value.episodeTitle || nodeProps.value.label} · ${shots.value.shots.length} 张`, shots.value.shots.map((shot, index) => {
      const used = mentionedAssets(shot.description, shots.value.assets).filter(asset => asset.nodeId);
      const prompt = [shot.imagePrompt, used.length ? `参考图依次为：${used.map(asset => `${asset.name}（${assetKindLabels[asset.kind]}）`).join("、")}。角色参考图只参考形象，场景参考图只参考空间与光线。` : ""].filter(Boolean).join("\n\n");
      return { type: "remote-imageGenerationNode", label: `分镜 ${String(index + 1).padStart(2, "0")}`, width: 360, height: 300, data: imageNodeData(prompt, "16:9", { shotSource: { ownerId: id, shotId: shot.id } }) };
    }), { columns: 6, offsetY: 420 });
    const edges = shots.value.shots.flatMap((shot, index) => mentionedAssets(shot.description, shots.value.assets).flatMap(asset => asset.nodeId && flow.findNode(asset.nodeId)
      ? [{ id: crypto.randomUUID(), source: asset.nodeId, sourceHandle: sourceHandle(asset.nodeId), target: ids[index]!, targetHandle: "in" }] : []));
    if (edges.length) flow.addEdges(edges);
    shots.value.batch.imageGroupId = groupId;
    shots.value.batch.imageNodes = Object.fromEntries(shots.value.shots.map((shot, index) => [shot.id, ids[index]!]));
    await file.touch(true);
    if (generate) {
      const failed = await startAll(ids, "node:generateImage");
      if (failed) ElMessage.warning(`${failed} 张分镜未能开始生成，请检查图片模型设置后在节点上重试`);
      else ElMessage.success(`已开始生成 ${ids.length} 张分镜`);
    } else ElMessage.success(`已创建 ${ids.length} 个分镜图节点，可用「整组执行」统一生成`);
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "批量生成分镜失败"); }
  finally { batching.value = ""; }
}
const referenceKey = (source: string, handle: string) => encodeURIComponent(JSON.stringify([source, handle]));
const kindOrder: Record<AssetKind, number> = { character: 0, scene: 1, prop: 2 };
const assetRole: Record<AssetKind, string> = { character: "，只参考形象", scene: "，只参考空间结构与光线", prop: "，只参考外形与材质" };
async function batchVideos() {
  if (!stepsDone.value || batching.value) return;
  if (!media.models.value.length) await media.load();
  // 视频节点建好后用默认视频模型；它的参考生视频模式能接几张图，决定每镜最多带几张资产图。模型清单读不到时按常见的 9 张处理。
  const videoModel = media.defaultVideoModel.value;
  const limit = videoModel ? maxImageReferences(videoModel) : 9;
  const mentioned = shots.value.shots.map(shot => mentionedAssets(shot.description, shots.value.assets).sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]));
  const waiting = new Set(mentioned.flat().filter(asset => !asset.image)).size;
  const notes = [
    waiting ? `有 ${waiting} 个出场资产还没有图片，这次不会被引用，建议先到「准备资产」生成。` : "",
    limit === 0 ? `当前默认视频模型「${videoModel!.label}」不支持多图参考，只会引用分镜图；要引用资产请先把默认视频模型换成支持图片参考的模型。` : "",
  ].filter(Boolean).join("");
  const generate = await ElMessageBox.confirm(`将为 ${shots.value.shots.length} 个镜头各建一个视频生成节点，引用对应分镜图、本镜出场的角色、场景、道具资产图和视频运动提示词。${notes}现在就开始生成吗？（会调用视频模型 ${shots.value.shots.length} 次，费用较高）`, "批量生成视频", {
    distinguishCancelAndClose: true, confirmButtonText: "创建并生成", cancelButtonText: "只创建节点",
  }).then(() => true, action => action === "cancel" ? false : undefined);
  if (generate === undefined) return;
  batching.value = "video";
  try {
    await ensureAssetNodes();
    const self = flow.findNode(id)!;
    let trimmed = 0, assetCount = 0;
    const plans = shots.value.shots.map((shot, index) => {
      const imageNode = shots.value.batch.imageNodes[shot.id];
      const references: { source: string; handle: string; text: string; asset: boolean }[] = [];
      if (imageNode && flow.findNode(imageNode)) references.push({ source: imageNode, handle: "image", text: "为本镜分镜图，决定构图与起始画面", asset: false });
      const ready = limit ? mentioned[index]!.filter(asset => asset.image && asset.nodeId && flow.findNode(asset.nodeId)) : [];
      const used = ready.slice(0, Math.max(0, limit - references.length));
      if (used.length < ready.length) trimmed++;
      assetCount += used.length;
      for (const asset of used) references.push({ source: asset.nodeId!, handle: sourceHandle(asset.nodeId!), text: `为${assetKindLabels[asset.kind]}「${asset.name}」${assetRole[asset.kind]}`, asset: true });
      // 资产图在视频节点里必须被提示词点名才会提交；只有分镜图时保持原来的首帧用法，不加说明。
      const prompt = used.length ? `${shot.videoPrompt}\n\n参考图：${references.map((item, order) => `{{ref ${order + 1}}} ${item.text}`).join("；")}。` : shot.videoPrompt;
      return { shot, references, prompt };
    });
    const { groupId, ids } = addGroupedNodes(flow, self, `视频组 · ${shots.value.episodeTitle || nodeProps.value.label} · ${shots.value.shots.length} 段`, plans.map(({ shot, references, prompt }, index) => ({
      type: "remote-videoGenerationNode", label: `镜头 ${String(index + 1).padStart(2, "0")} · ${shot.duration}s`, width: 360, height: 300,
      data: {
        prompt, promptModel: prompt.split("\n").map(text => [{ type: "Write", text }]), duration: Math.max(2, Math.round(shot.duration)), ratio: "16:9", shotSource: { ownerId: id, shotId: shot.id },
        // 资产图标为外观参考：走参考生视频，不会被当成首尾帧；顺序固定为分镜图在前。
        identityReferences: references.filter(item => item.asset).map(item => referenceKey(item.source, item.handle)),
        referenceOrder: { in: references.map(item => referenceKey(item.source, item.handle)) },
      },
    })), { columns: 6, offsetY: 840 });
    const edges = plans.flatMap(({ references }, index) => references.map(item => ({ id: crypto.randomUUID(), source: item.source, sourceHandle: item.handle, target: ids[index]!, targetHandle: "in" })));
    if (edges.length) flow.addEdges(edges);
    shots.value.batch.videoGroupId = groupId;
    shots.value.batch.videoNodes = Object.fromEntries(shots.value.shots.map((shot, index) => [shot.id, ids[index]!]));
    await file.touch(true);
    if (!plans.some(plan => plan.references.some(item => !item.asset))) ElMessage.info("还没有分镜图节点，视频节点不带分镜图；建议先「批量生成分镜」");
    if (trimmed) ElMessage.warning(`${trimmed} 个镜头的出场资产超过视频模型的参考图上限（${limit} 张），已按角色、场景、道具的顺序取前几张`);
    const summary = `，共引用 ${assetCount} 张资产图`;
    if (generate) {
      const failed = await startAll(ids, "node:generateVideo");
      if (failed) ElMessage.warning(`${failed} 段视频未能开始生成（分镜图或资产图未完成，或视频模型不支持图片参考），可稍后用「整组执行」重试`);
      else ElMessage.success(`已开始生成 ${ids.length} 段视频${summary}`);
    } else ElMessage.success(`已创建 ${ids.length} 个视频节点${summary}，可用「整组执行」统一生成`);
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "批量生成视频失败"); }
  finally { batching.value = ""; }
}
async function runGroup(kind: "assets" | "images" | "videos") {
  const nodeIds = kind === "assets" ? shots.value.assets.flatMap(asset => asset.nodeId && flow.findNode(asset.nodeId)?.type === "remote-imageGenerationNode" && !asset.image ? [asset.nodeId] : [])
    : Object.values(kind === "images" ? shots.value.batch.imageNodes : shots.value.batch.videoNodes).filter(nodeId => flow.findNode(nodeId));
  if (!nodeIds.length) { ElMessage.info(kind === "assets" ? "资产都已有图片" : "没有可执行的节点"); return; }
  const confirmed = await ElMessageBox.confirm(`将依次启动 ${nodeIds.length} 个节点的生成。`, "整组执行", { confirmButtonText: "开始", cancelButtonText: "取消" }).then(() => true, () => false);
  if (!confirmed) return;
  const failed = await startAll(nodeIds, kind === "videos" ? "node:generateVideo" : "node:generateImage");
  if (failed) ElMessage.warning(`${failed} 个节点未能开始生成`);
  else ElMessage.success(`已启动 ${nodeIds.length} 个节点`);
}

// —— 给 Agent 的节点函数 ——
nodeTools.register({
  name: "getShots",
  description: "读取此脚本节点的镜头表、资产与提示词状态",
  parameters: z.strictObject({}),
  execute() {
    if (!file.ready.value) throw new Error("脚本尚未加载");
    return { episodeTitle: shots.value.episodeTitle, style: shots.value.style, steps: stepItems.value.map(({ label, done, detail }) => ({ label, done, detail })), shots: shots.value.shots.map((shot, index) => ({ index: index + 1, ...shot, id: undefined })), assets: shots.value.assets.map(({ kind, name, description, image }) => ({ kind, name, description, hasImage: !!image })) };
  },
});
nodeTools.register({
  name: "updateShot",
  description: "修改某一镜（index 从 1 开始）的字段；description 中用 @资产名 引用角色、场景、道具",
  parameters: z.strictObject({
    index: z.number().int().positive(),
    duration: z.number().positive().max(60).optional(), description: z.string().optional(), shotSize: z.string().optional(), lighting: z.string().optional(),
    sound: z.string().optional(), camera: z.string().optional(), imagePrompt: z.string().optional(), videoPrompt: z.string().optional(),
  }),
  async execute({ index, ...fields }) {
    const shot = shots.value.shots[index - 1];
    if (!shot) throw new Error(`第 ${index} 镜不存在`);
    Object.assign(shot, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
    await file.touch(true);
    return { index, updated: Object.keys(fields) };
  },
});
nodeTools.register({
  name: "generateShots",
  description: "按连接的剧本节点生成镜头表（会替换现有镜头）。episodeIndex 从 1 开始，request 为补充要求",
  parameters: z.strictObject({ episodeIndex: z.number().int().positive().optional(), request: z.string().optional() }),
  async execute({ episodeIndex: index, request: extra }) {
    if (index) episodeIndex.value = index - 1;
    if (extra) request.value = extra;
    const before = shots.value.shots.length;
    shots.value.shots = before ? [] : shots.value.shots;
    await generateShots("script");
    return { shots: shots.value.shots.length, episodeTitle: shots.value.episodeTitle };
  },
});
</script>

<style lang="scss" scoped>
.shotCard {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-height: 220px;

  .cardIcon { display: grid; place-items: center; margin: 12px 0 4px; color: var(--el-text-color-secondary); }
  .tryLabel { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; }

  .modeOption {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-primary);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;

    &:hover:not(:disabled) { background: var(--el-fill-color-light); }
    &:disabled { color: var(--el-text-color-placeholder); cursor: not-allowed; }
  }

  .hint { margin: 4px 0 0; color: var(--el-text-color-placeholder); font-size: 11px; }

  .skeletonRows { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; s { height: 12px; border-radius: 3px; background: var(--el-fill-color); } }
  .progress { align-self: center; padding: 2px 10px; border: 1px solid var(--el-border-color); border-radius: 6px; font-size: 12px; }

  .steps {
    display: flex;
    justify-content: space-between;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      color: var(--el-text-color-secondary);
      font-size: 11px;

      span { display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid var(--el-border-color); border-radius: 50%; font-size: 11px; }
      &.done { color: var(--el-text-color-primary); span { border-color: var(--el-color-primary); background: var(--el-color-primary); color: var(--el-color-white); } }
    }
  }

  .cardMeta { margin: 0; color: var(--el-text-color-secondary); font-size: 11px; text-align: center; }
  .openButton { width: 100%; margin: 0; font-weight: 600; }
}

.shotToolbar :deep(.el-card__body) { display: flex; align-items: center; gap: 2px; }
.shotToolbar .el-button { margin: 0; }

.promptCard {
  .promptFooter {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;

    .modelSelect { width: 170px; }
    .thinkingSelect { width: 104px; }
    .episodeSelect { width: 130px; }
    .spacer { flex: 1; }
    .sendButton { width: 32px; height: 32px; margin: 0; padding: 0; --el-button-bg-color: var(--el-text-color-primary); --el-button-border-color: transparent; --el-button-text-color: var(--el-bg-color); }
  }
}

.workbenchHeader {
  display: flex;
  align-items: center;
  gap: 16px;

  .title { min-width: 120px; }

  .stepTabs {
    display: flex;
    flex: 1;
    justify-content: center;
    gap: 32px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-radius: 8px;
      cursor: pointer;

      .dot { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--el-border-color); border-radius: 50%; font-size: 12px; }
      b { display: block; font-size: 13px; }
      small { color: var(--el-text-color-secondary); font-size: 11px; }
      &.done .dot { border-color: var(--el-color-primary); color: var(--el-color-primary); }
      &.active { background: var(--el-fill-color-light); .dot { background: var(--el-color-primary); border-color: var(--el-color-primary); color: var(--el-color-white); } }
    }
  }

  .batchHint { color: var(--el-text-color-secondary); font-size: 12px; }
}

.generateList {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow: auto;

  .generateItem { display: flex; align-items: flex-start; gap: 10px; > div { flex: 1; display: flex; flex-direction: column; gap: 4px; } }
}
.generateFooter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; .spacer { flex: 1; } }
</style>

<style lang="scss">
.shotWorkbench {
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color) !important;
  backdrop-filter: none !important;

  .el-dialog__body { display: flex; flex: 1; flex-direction: column; min-height: 0; padding-top: 0; }
  .workbenchBody { flex: 1; min-height: 0; overflow: auto; }
  .workbenchFooter { display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--el-border-color-lighter); .spacer { flex: 1; } }
}
</style>
