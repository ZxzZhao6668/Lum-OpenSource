<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="previewVisible = true"
    :bottomWidth="660"
    :style="{ width: (previewUrl || inpaintGuideUrl) && imageWidth ? `${imageWidth + 18}px` : undefined }">
    <template v-if="editor?.mode" #top><div ref="paintToolbar" /></template>
    <template #topActions>
      <el-button text title="图像工具" aria-label="图像工具" :disabled="workbenchUnavailable" @click.stop="openWorkbench">图像工具</el-button>
      <el-button class="panoramaButton" :icon="IconPanoramaHorizontal" :disabled="generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting || panorama?.busy || !previewUrl" text title="全景图" aria-label="全景图" @click.stop="panorama?.open($event)">全景图<icon-chevron-down class="menuChevron" :size="14" /></el-button>
      <el-button :icon="IconBrush" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="局部重绘" aria-label="局部重绘" @click.stop="startEditor('inpaint')">局部重绘</el-button>
      <el-button :icon="IconSun" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="打光" aria-label="打光" @click.stop="openLighting">打光</el-button>
      <el-button :icon="IconCameraRotate" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="多角度" aria-label="多角度" @click.stop="openMultiAngle">多角度</el-button>
      <el-button :icon="IconLayoutGrid" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl" :loading="gridSplit?.splitting" text title="宫格切分" aria-label="宫格切分" @click.stop="gridSplit?.open($event)">宫格切分</el-button>
      <mediaHistory mediaType="image" :current="outputFile" :disabled="workbenchPanel?.busy || generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy" @select="selectHistoryImage" />
      <el-button :icon="IconTransfer" :loading="uploading" :disabled="workbenchPanel?.busy || generating || deleting || lighting?.generating || multiAngle?.generating || panorama?.busy" text title="替换图片" aria-label="替换图片" @click.stop="fileInput?.click()">替换图片</el-button>
      <input ref="fileInput" type="file" accept="image/*" hidden aria-label="选择替换图片" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy" @change="replaceOutput" />
    </template>
    <template #topRightActions>
      <el-button :icon="IconPencil" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="标记" aria-label="标记" @click.stop="startEditor('mark')" />
    </template>
    <div v-loading="generating || uploading" class="imageContent nopan" :aria-busy="generating || uploading" :data-lum-activity="uploading ? 'uploading' : generating ? 'generating' : undefined" :aria-label="uploading ? '正在上传图片' : generating ? '正在生成图片' : '图片预览'">
      <imageEditor
        v-if="previewUrl"
        ref="editor"
        :src="previewUrl"
        :toolbarTarget="paintToolbar"
        :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy"
        alt="生成图片"
        @preview="previewVisible = true"
        @load="resizeImage"
        @error="showNodeError('无法预览该图片', '图片预览失败')" />
      <div v-else-if="inpaintGuideUrl" class="inpaintGuide">
        <img :src="inpaintGuideUrl" alt="局部重绘标注图" draggable="false" @load="resizeImage" @error="showNodeError('无法读取重绘标注图', '重绘标注读取失败')" />
        <span>红色标注为重绘区域</span>
      </div>
      <div v-else class="imageEmpty" role="img" aria-label="暂无生成图片">
        <icon-photo-ai :size="48" stroke="1.25" aria-hidden="true" />
      </div>
    </div>
    <template v-if="editor?.mode !== 'mark'" #bottom>
      <div v-if="lightingVisible" ref="lightingTarget" />
      <div v-else-if="multiAngleVisible" ref="multiAngleTarget" />
      <el-card v-else class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <el-button v-if="inpaintGuideUrl && editor?.mode !== 'inpaint'" class="inpaintInfo" text :icon="IconBrush" @click="inpaintPreviewVisible = true">查看重绘标注</el-button>
        <referenceItem
          v-if="refList.length"
          v-model="refList"
          @preview="setReferencePreview"
          @remove="removeReference" />
        <p v-if="writingSetupStyle(data.writingProduction).label">{{ writingSetupStyle(data.writingProduction).label }}</p>
        <el-button v-if="canReadProjectSetup() && !data.inpaint" text :disabled="generating || choosingStyle" @click="adoptProjectStyle">采用最新项目设定</el-button>
        <details v-if="blockingText" class="shotBlocking nodrag nopan">
          <summary>本镜走位 · 分镜构图</summary>
          <p>{{ blockingText }}</p>
        </details>
        <promptInput v-if="editor?.mode === 'inpaint'" v-model="data.inpaintPromptModel" v-model:text="data.inpaintPrompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" expandable />
        <promptInput v-else v-model="data.promptModel" v-model:text="data.prompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" expandable />
        <mediaPromptEditor v-if="editor?.mode !== 'inpaint'" v-model="data.promptAnalysis" kind="image" :input="analysisContext.input" :error="analysisContext.error" :disabled="generating || deleting || uploading" @apply="applyAnalyzedPrompt" />
        <label class="defaultModelFollow"><input type="checkbox" :checked="data.followDefaultModel !== false" :disabled="generating || deleting" @change="data.followDefaultModel = ($event.target as HTMLInputElement).checked" />使用全局默认模型</label>
        <div class="promptFooter">
          <el-select
            v-if="editor?.mode !== 'inpaint'"
            :modelValue="selectedModel ? data.model : ''"
            class="modelSelect"
            filterable
            :loading="modelsLoading"
            :disabled="generating || deleting"
            placeholder="选择模型"
            aria-label="生成模型"
            noDataText="请先在设置中添加图片模型"
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
            v-if="editor?.mode !== 'inpaint'"
            v-model:size="data.size"
            v-model:ratio="data.ratio"
            v-model:other="data.other"
            :model="selectedModel"
            :sizes="sizeOptions"
            :ratios="ratioOptions"
            :disabled="generating || deleting || !selectedModel" />
          <el-button v-if="editor?.mode === 'inpaint'" class="confirmButton" type="primary" :icon="IconCheck" :loading="editor.busy" :disabled="deleting || uploading || !generationPrompt" @click="confirmInpaint().catch(error => showNodeError(error, '重绘节点创建失败'))">确认</el-button>
          <div v-else class="generationActions">
            <mediaPrice v-if="priceInput" :input="{ ...priceInput, mediaType: 'image' }" :supported="selectedModel?.supportsPrice === true" />
            <el-button v-if="pendingRecovery" class="sendButton" :icon="IconPlayerStop" :loading="cancelling" :disabled="deleting || uploading" title="放弃任务" aria-label="放弃任务" @click="generationState.cancel().catch(error => showNodeError(error, '停止生成失败'))" />
            <el-button
              class="sendButton"
              :icon="generating ? IconPlayerStop : IconArrowUp"
              :disabled="cancelling || deleting || uploading || (!generating && (editor?.busy || (!pendingRecovery && (!generationPrompt || !selectedModel))))"
              :title="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成图片'"
              :aria-label="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成图片'"
              @click="generating ? generationState.cancel().catch(error => showNodeError(error, '停止生成失败')) : startGeneration().catch((error) => showNodeError(error, '图片生成失败'))" />
          </div>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <imageLighting v-if="lightingVisible" ref="lighting" :src="imagePreviewUrl" :source="outputFile" :target="lightingTarget" :disabled="generating || deleting || uploading || gridSplit?.splitting" @close="lightingVisible = false" />
  <imageMultiAngle v-if="multiAngleVisible" ref="multiAngle" :src="imagePreviewUrl" :source="outputFile" :target="multiAngleTarget" :disabled="generating || deleting || uploading || gridSplit?.splitting" @close="multiAngleVisible = false" />
  <imagePanorama ref="panorama" :src="imagePreviewUrl" :source="outputFile" :disabled="workbenchVisible || generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting" @open="openPanorama" />
  <imageGridSplit ref="gridSplit" :src="imagePreviewUrl" :disabled="workbenchVisible || generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy" :active="node.selected" />
  <el-image-viewer v-if="inpaintPreviewVisible && inpaintGuideUrl" :urlList="[inpaintGuideUrl]" teleported @close="inpaintPreviewVisible = false" />
  <imageWorkbench v-if="workbenchVisible" ref="workbenchPanel" :source="workbenchSource" @close="workbenchVisible = false" />
  <el-image-viewer
    v-if="previewVisible && previewUrl"
    :urlList="[imagePreviewUrl]"
    teleported
    @close="previewVisible = false" />
</template>

<script setup lang="ts">
import { toRaw, computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ElButton, ElCard, ElSelect, ElOption, ElOptionGroup, ElLoading, ElImageViewer } from "element-plus";
import { IconCheck, IconPhotoAi, IconSparkles, IconArrowUp, IconPlayerStop, IconTransfer, IconLayoutGrid, IconBrush, IconPencil, IconSun, IconCameraRotate, IconPanoramaHorizontal, IconChevronDown } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, type NodeMediaModel, type NodeImageRequest, type NodeHandle } from "@lum/nodes-scaffold/runtime";
import { groupNodeModels } from "@lum/node-shared/groupNodeModels";
import { getMediaMimeType } from "@lum/node-shared/mediaTypes";
import modelLabel from "@lum/node-shared/modelLabel";
import { showNodeError } from "@lum/node-shared/showNodeError";
import { useDefaultModel } from "@lum/node-shared/useDefaultModel";
import mediaPromptEditor from "@lum/node-shared/mediaPromptEditor";
import type {MediaPromptAnalysisState,MediaPromptContext} from "@lum/node-shared/mediaPromptEditing";
import { canReadProjectSetup, previewProjectStyle, type NodeProjectAppearance } from "@lum/node-shared/projectSetupBridge";
import { applyWritingSetupStyle, removeWritingSetupStyle, writingSetupStyle, type WritingSetupSnapshot } from "@lum/node-shared/writingSetup";
import {getPromptText,referencePromptModel} from "@lum/node-shared/promptText";
import {useVueFlow} from "@vue-flow/core";
import { useNodeGeneration, type NodeGenerationTask } from "@lum/node-shared/useNodeGeneration";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";
import { isNodeOutput } from "@lum/nodes-scaffold/values";
import { useNodeReferences } from "@lum/node-shared/useNodeReferences";
import { useModelForm } from "@lum/node-shared/useModelForm";
import promptInput from "@lum/node-shared/promptInput";
import referenceItem from "@lum/node-shared/referenceItem";
import mediaHistory from "@lum/node-shared/mediaHistory";
import mediaPrice from "@lum/node-shared/mediaPrice";
import imageGridSplit from "@lum/node-image/imageGridSplit";
import imageEditor from "@lum/node-image/imageEditor";
import { buildInpaintRequest, useImageInpaint, type ImageInpaint } from "@lum/node-image/imageInpaint";
import imageLighting from "@lum/node-image/imageLighting";
import imagePanorama from "@lum/node-image/imagePanorama";
import imageMultiAngle from "@lum/node-image/imageMultiAngle";
import imageWorkbench from "@lum/node-image/imageWorkbench";
import generationSettings from "./components/generationSettings.vue";

defineOptions({
  inheritAttrs: false,
  icon: IconPhotoAi,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "STRING"], label: "图片、文本输入" },
    { id: "image", type: "source", dataType: "IMAGE", label: "图片输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({
  label: "图片生成",
});
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { shotBlocking?: { image?: unknown }; prompt: string; promptModel: PromptModel; promptAnalysis: MediaPromptAnalysisState; promptReferenceSelection?: boolean; inpaintPrompt: string; inpaintPromptModel: PromptModel; model: string; followDefaultModel?: boolean; size: string; ratio: string; other: Record<string, unknown>; inpaint?: ImageInpaint; writingProduction?: Partial<NodeProjectAppearance> & {setupSnapshots?: WritingSetupSnapshot[]; styleOverride?: string} });
const taskData = computed(() => node.data as {
  mediaTask?: NodeGenerationTask;
  imageWorkbenchAttempt?: { sourceNodeId: string; candidateId: string };
  imageWorkbenchResult?: { taskId: string; handleId: string; path: string; mimeType: string };
});
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.promptAnalysis ??= {model:""};
data.value.inpaintPrompt ??= "";
data.value.inpaintPromptModel ??= [];
data.value.model ??= "";
data.value.size ??= "";
data.value.ratio ??= "16:9";
data.value.other ??= {};
const { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference } = useNodeReferences();
const referenceFlow=useVueFlow();
const getPersistence = useNodePersistence();
const projectAppearance = () => data.value.writingProduction as Partial<NodeProjectAppearance> | undefined;
const choosingStyle = ref(false);
async function adoptProjectStyle() {
  if (choosingStyle.value || generating.value || data.value.inpaint) return;
  choosingStyle.value = true;
  try {
    const context = getPersistence?.();
    const appearance = await previewProjectStyle(writingSetupStyle(data.value.writingProduction));
    if (!appearance.projectStyle) return;
    if (!context || getPersistence?.()?.canvasPath !== context.canvasPath || referenceFlow.findNode(id) !== node || generating.value) throw Error('画布或节点已变化，请重试');
    const nextId = crypto.randomUUID();
    const {prompt, promptModel, model, ratio, size, other, promptReferenceSelection} = data.value;
    const cleaned = removeWritingSetupStyle(prompt, writingSetupStyle(data.value.writingProduction).text);
    const {styleOverride: _styleOverride, ...production} = data.value.writingProduction ?? {};
    referenceFlow.addNodes({id:nextId,type:node.type,position:{x:node.position.x+440,y:node.position.y},data:{
      label:`${node.data.label || '图片生成'} · 新画风`,prompt:cleaned,promptModel:cleaned===prompt ? structuredClone(toRaw(promptModel)) : referencePromptModel(cleaned,referenceMentions.value),model,ratio,size,other:structuredClone(toRaw(other)),
      promptReferenceSelection,writingProduction:{...toRaw(production),...appearance},
    }});
    referenceFlow.addEdges(referenceFlow.getEdges.value.filter(edge=>edge.target===id && !referenceFlow.findNode(edge.source)?.data.writingSource?.sourceKey?.startsWith('styleRef:'))
      .map(edge=>({id:crypto.randomUUID(),source:edge.source,sourceHandle:edge.sourceHandle,target:nextId,targetHandle:edge.targetHandle})));
    await context.save();
  } catch(error) {showNodeError(error,'采用项目画风失败');} finally {choosingStyle.value=false;}
}
function readImagePrompt(){const prompt=data.value.promptModel.length?getPromptText(data.value.promptModel,id=>{const ref=referenceMentions.value.find(item=>item.id===id);if(!ref)throw Error("提示词引用已失效，请重新 @ 选择素材");return ref.value;}):data.value.prompt;return applyWritingSetupStyle(prompt,data.value.writingProduction);}
const analysisContext=computed<{input?:MediaPromptContext;error:string}>(()=>{
  try{return {error:"",input:{prompt:readImagePrompt(),storyboard:[],warnings:[],settings:{ratio:data.value.ratio,model:data.value.model},references:refList.value.map((input,index)=>{
    const source=referenceFlow.findNode(input.source),text=input.dataType==="STRING"?String(input.value??""):String(source?.data.writingSource?.content??"");
    return {id:referenceMentions.value[index]?.id??input.source,token:`{{ref ${index+1}}}`,name:String(source?.data.label??input.source),type:String(input.dataType),role:"候选参考",description:text||"未提供外观文字描述",available:input.value!==undefined};
  })}};}catch(error){return {error:error instanceof Error?error.message:"图片提示词读取失败"};}
});
function applyAnalyzedPrompt(prompt:string){if(generating.value||deleting.value||uploading.value)return;data.value.promptModel=referencePromptModel(prompt,referenceMentions.value);data.value.prompt=prompt;data.value.promptReferenceSelection=true;}
function selectedImageReferences(){
  if(!data.value.promptReferenceSelection||editor.value?.mode==="inpaint")return refList.value;
  const indexes=new Set([...readImagePrompt().matchAll(/\{\{ref\s+(\d+)\}\}/g)].map(match=>Number(match[1])-1));
  if([...indexes].some(index=>!refList.value[index]))throw Error("提示词引用已失效，请重新选择素材");
  return refList.value.filter((item,index)=>indexes.has(index)||!Object.hasOwn(data.value.writingProduction??{},'projectStyle')&&referenceFlow.findNode(item.source)?.data.writingSource?.sourceKey?.startsWith('styleRef:'));
}
const models = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
const gridSplit = ref<InstanceType<typeof imageGridSplit>>();
const editor = ref<InstanceType<typeof imageEditor>>();
const blockingText = computed(() => {
  const text = data.value.shotBlocking?.image;
  if (data.value.inpaint || editor.value?.mode === "inpaint" || taskData.value.imageWorkbenchAttempt || typeof text !== "string") return "";
  return text.slice(0, 8000).replaceAll("{", "｛").replaceAll("}", "｝").trim();
});
const generateInpaint = useImageInpaint((input, signal, recoveryData) => generationState.generate("image", input, signal, recoveryData));
const paintToolbar = ref<HTMLElement>();
const lighting = ref<InstanceType<typeof imageLighting>>();
const lightingTarget = ref<HTMLElement>();
const lightingVisible = ref(false);
const multiAngle = ref<InstanceType<typeof imageMultiAngle>>();
const multiAngleTarget = ref<HTMLElement>();
const multiAngleVisible = ref(false);
const panorama = ref<InstanceType<typeof imagePanorama>>();
const workbenchPanel = ref<InstanceType<typeof imageWorkbench>>();
const workbenchVisible = ref(false);
let disposed = false;
const deleting = ref(false);
const previewVisible = ref(false);
const inpaintPreviewVisible = ref(false);
const imageWidth = ref(0);
let generationController: AbortController | undefined;
const generationState = useNodeGeneration(outputs, () => generationController?.abort(), {
  ai,
  stageOutput(task) {
    if (taskData.value.imageWorkbenchAttempt?.candidateId !== task.taskId || task.state !== "succeeded") return;
    const previous = taskData.value.imageWorkbenchResult;
    if (previous?.taskId === task.taskId) return;
    const output = outputs.value.image;
    if (output?.dataType !== "IMAGE") throw new Error("工作台子节点缺少已完成的图片输出");
    taskData.value.imageWorkbenchResult = { taskId: task.taskId, handleId: "image", path: output.value.url, mimeType: output.value.mimeType };
    return () => { taskData.value.imageWorkbenchResult = previous; };
  },
  async recover(results, task, signal) {
    if (!task.recoveryData) return results;
    const recovery = task.recoveryData as { input: NodeImageRequest; inpaint: ImageInpaint };
    if (!recovery.input || !recovery.inpaint) throw new Error("局部重绘任务缺少恢复素材");
    return generateInpaint(recovery.input, recovery.inpaint, signal, results.filter(result => result.mediaType === "image"));
  },
});
const { generating, pendingRecovery, cancelling } = generationState;
useDefaultModel(data, models, generating);
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
watch(generating, value => { if (!value && !disposed && !deleting.value && !models.value.length) void loadModels().catch(error => showNodeError(error, "模型读取失败")); });
const selectedModel = computed(() => models.value.find((item) => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
useModelForm(data, selectedModel);
const sizeOptions = computed(() => (selectedModel.value?.imageSizes?.length ? selectedModel.value.imageSizes : ["2K"]));
const ratioOptions = computed(() => (selectedModel.value?.imageRatios?.length ? selectedModel.value.imageRatios : ["16:9"]));
watch(
  selectedModel,
  (choice) => {
    if (!choice) return;
    // ACT: 现有分辨率使用 K 单位；出现其他单位时再统一换算，未知名称排在数值选项之后。
    if (!sizeOptions.value.includes(data.value.size)) data.value.size = sizeOptions.value.toSorted((left, right) =>
      (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity)
    )[0]!;
    if (!ratioOptions.value.includes(data.value.ratio)) data.value.ratio = ratioOptions.value.includes("16:9") ? "16:9" : ratioOptions.value[0]!;
  },
  { flush: "sync" }
);
const modelGroups = computed(() => groupNodeModels(models.value));
const generationPrompt = computed(() => {
  if(data.value.promptReferenceSelection&&editor.value?.mode!=="inpaint"){
    try{
      const selected=selectedImageReferences(),images=selected.filter(item=>item.dataType==="IMAGE");
      const prompt=readImagePrompt().replace(/\{\{ref\s+(\d+)\}\}/g,(token,number)=>{const item=refList.value[Number(number)-1];return item?.dataType==="STRING"?String(item.value??""):item&&images.includes(item)?`{{ref ${images.indexOf(item)+1}}}`:token;}).trim();
      return styleReferencePrompt(prompt,images);
    }catch{return "";}
  }
  return [
    (editor.value?.mode === "inpaint" ? data.value.inpaintPrompt : data.value.prompt).trim(),
    ...refList.value.flatMap((item, index) => (item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])),
  ]
    .filter(Boolean)
    .join("\n\n")
});
function styleReferencePrompt(prompt:string, images:typeof refList.value) {
  if (!prompt) return prompt;
  const styleImages=images.flatMap((image,index)=>referenceFlow.findNode(image.source)?.data.writingSource?.sourceKey?.startsWith('styleRef:') ? [index+1] : []);
  if (projectAppearance()?.projectStyleImage) styleImages.push(images.length+1);
  return [prompt,...styleImages.map(index=>`参考图 ${index} 仅约束光线、色彩、构图和材质；不得带入其中的人物、物件或场景。`)].join('\n\n');
}
const generationInput = computed<Omit<NodeImageRequest, "directory"> | undefined>(() => {
  const choice = selectedModel.value;
  if (!choice) return;
  const inpaint = data.value.inpaint;
  let references:typeof refList.value;try{references=selectedImageReferences().filter(item => !inpaint || item.dataType !== "IMAGE" || item.value?.url !== inpaint.source);}catch{return;}
  const input = {
    providerId: choice.providerId,
    modelId: choice.modelId,
    prompt: data.value.promptReferenceSelection ? generationPrompt.value : styleReferencePrompt(applyWritingSetupStyle(generationPrompt.value,data.value.writingProduction),references.filter(item=>item.dataType==='IMAGE')),
    size: data.value.size,
    ratio: data.value.ratio,
    other: Object.keys(data.value.other).length ? { ...data.value.other } : undefined,
    outputDirectory: `assets/${id}`,
    images: [...references.flatMap(item => item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []), ...(!inpaint && projectAppearance()?.projectStyleImage ? [projectAppearance()!.projectStyleImage!] : [])],
  };
  if (input.prompt && blockingText.value) input.prompt += `\n\n本镜走位要求\n${blockingText.value}`;
  if (inpaint) {
    let imageIndex = 3 + (inpaint.images?.length ?? 0);
    const mapping = refList.value.flatMap((item, index) => item.dataType === "IMAGE" && item.value
      ? [`参考 ${index + 1} / {{ref ${index + 1}}} 对应第 ${item.value.url === inpaint.source ? 1 : imageIndex++} 张图`] : []);
    if (mapping.length) input.prompt += `\n当前节点参考编号对应关系：${mapping.join("；")}。`;
  }
  return input;
});
const priceInput = computed(() => {
  const input = generationInput.value;
  const inpaint = data.value.inpaint;
  if (!input || inpaint && !Array.isArray(inpaint.images)) return;
  return inpaint ? buildInpaintRequest(input, inpaint) : input;
});
const outputFile = computed(() => outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined);
const workbenchSource = computed(() => {
  const image = outputFile.value;
  return image && { nodeId: node.id, handleId: "image", path: image.url, mimeType: image.mimeType };
});
const workbenchUnavailable = computed(() => !workbenchSource.value || generating.value || deleting.value || cancelling.value || uploading.value
  || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.visible
  || panorama.value?.busy || gridSplit.value?.splitting);
const inpaintGuideUrl = files.useFileUrl(
  () => data.value.inpaint?.guide ? { url: data.value.inpaint.guide, mimeType: "image/png" } : undefined,
  error => showNodeError(error, "重绘标注读取失败")
);
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showNodeError(error, "图片读取失败")
);
const imagePreviewUrl = computed(() => editor.value?.previewSrc || previewUrl.value);

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

function selectHistoryImage(image: NonNullable<typeof outputFile.value>) {
  if (!workbenchPanel.value?.busy) outputs.value.image = { dataType: "IMAGE", value: image };
}

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || workbenchPanel.value?.busy || generating.value || deleting.value || uploading.value || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || disposed) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("image/")) return void showNodeError("请选择图片文件", "图片替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("图片不能为空且不能超过 100 MB", "图片替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.image = { dataType: "IMAGE", value: { url, mimeType } };
  } catch (error) {
    showNodeError(error, "图片替换失败");
  } finally {
    uploading.value = false;
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    if (disposed || generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "image");
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

async function confirmInpaint() {
  const inpaintEditor = editor.value;
  if (!inpaintEditor || inpaintEditor.mode !== "inpaint") throw new Error("请先进入局部重绘");
  if (inpaintEditor.busy || generating.value || deleting.value || uploading.value) return;
  if (!generationPrompt.value) throw new Error("请输入重绘提示词");
  if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  let prompt = generationPrompt.value.replace(/\{\{ref (\d+)\}\}/g, "重绘参考 $1").replace(/^参考 (\d+)：/gm, "重绘参考 $1：");
  const images = refList.value.flatMap(item => item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []);
  const imageReferences = refList.value.flatMap((item, index) => item.dataType === "IMAGE" && item.value ? [index + 1] : []);
  if (imageReferences.length) prompt += `\n重绘参考编号对应关系（前两张为原图和区域引导图）：${imageReferences.map((reference, index) => `重绘参考 ${reference} 对应第 ${index + 3} 张图`).join("；")}。`;
  await inpaintEditor.createInpaint({ prompt, images }, new AbortController().signal);
}

const workbenchImageSchema = z.strictObject({ nodeId: z.string(), handleId: z.string(), path: z.string(), mimeType: z.string() });
const workbenchSubmissionSchema = z.strictObject({
  taskId: z.uuid(),
  directory: z.string(),
  canvasPath: z.string(),
  source: workbenchImageSchema,
  references: z.array(workbenchImageSchema).max(33),
  prompt: z.string().min(1).max(100000),
  providerId: z.string(),
  modelId: z.string(),
  size: z.string().min(1).optional(),
  ratio: z.string().min(1).optional(),
});
type WorkbenchSubmission = z.infer<typeof workbenchSubmissionSchema>;

function captureWorkbenchSubmission(expected: WorkbenchSubmission) {
  const { source, references } = expected;
  const bindings = [source, ...references].map(binding => {
    const sourceNode = referenceFlow.findNode(binding.nodeId);
    if (!sourceNode) throw new Error("工作台的原图或参考节点已移除");
    return { binding, sourceNode, output: sourceNode.data.outputs?.[binding.handleId] };
  });
  const check = () => {
    const context = getPersistence?.();
    if (context?.directory !== expected.directory || context.canvasPath !== expected.canvasPath || referenceFlow.findNode(id) !== node
      || taskData.value.imageWorkbenchAttempt?.candidateId !== expected.taskId || taskData.value.imageWorkbenchAttempt?.sourceNodeId !== source.nodeId) {
      throw new Error("工作台画布或子节点已变化，已停止提交");
    }
    for (const { binding, sourceNode, output } of bindings) {
      if (referenceFlow.findNode(binding.nodeId) !== sourceNode || sourceNode.data.outputs?.[binding.handleId] !== output
        || !isNodeOutput(output) || output.dataType !== "IMAGE" || output.value.url !== binding.path || output.value.mimeType !== binding.mimeType) {
        throw new Error("工作台的原图或参考图片已变化，已停止提交");
      }
    }
    const input = generationInput.value;
    const model = selectedModel.value;
    if (!input || input.providerId !== expected.providerId || input.modelId !== expected.modelId || input.prompt !== expected.prompt
      || (expected.size !== undefined && (input.size !== expected.size || !model?.imageSizes?.includes(expected.size)))
      || (expected.ratio !== undefined && (input.ratio !== expected.ratio || !model?.imageRatios?.includes(expected.ratio)))
      || data.value.inpaint
      || refList.value.length !== references.length || refList.value.some((value, index) =>
        value.source !== references[index]?.nodeId || value.sourceHandle !== references[index]?.handleId
        || value.dataType !== "IMAGE" || value.value?.url !== references[index]?.path || value.value?.mimeType !== references[index]?.mimeType)) {
      throw new Error("工作台子节点的参数或参考连线已变化");
    }
  };
  check();
  return check;
}

async function startGeneration(expectedTaskId?: string, workbench?: WorkbenchSubmission) {
  if (workbenchPanel.value?.busy) throw new Error("图像工作台处理中，请稍后生成");
  if (cancelling.value) throw new Error("任务正在取消，请稍后重试");
  if (generating.value) throw new Error("图片正在生成，请等待完成");
  if (panorama.value?.visible) throw new Error("请先关闭全景图，再启动图片生成");
  if (uploading.value) throw new Error("图片正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (lightingVisible.value) throw new Error("请先退出打光，再启动图片生成");
  if (multiAngleVisible.value) throw new Error("请先退出多角度，再启动图片生成");
  if (editor.value?.busy || editor.value?.mode === "mark") throw new Error("请先完成图片标记");
  if (editor.value?.mode === "inpaint") throw new Error("请先确认局部重绘，再到子节点生成");
  if (expectedTaskId && (!pendingRecovery.value || taskData.value.mediaTask?.taskId !== expectedTaskId)) {
    throw new Error("待复查的图片任务已变化，请重新核对状态");
  }
  if (workbench && (taskData.value.mediaTask || pendingRecovery.value)) throw new Error("工作台子节点已关联图片任务，请先核对状态");
  if (pendingRecovery.value) {
    generation = generationState.resume().catch(error => showNodeError(error, "图片任务复查失败"));
    return { status: "generating" };
  }
  if (!workbench && !data.value.inpaint && canReadProjectSetup() && !data.value.writingProduction?.setupSnapshots && !Object.hasOwn(data.value.writingProduction ?? {},'projectStyle')) {
    if (!generationPrompt.value || !selectedModel.value) throw Error('请先填写提示词并选择图片模型');
    if (choosingStyle.value) throw Error('请先完成画风确认');
    choosingStyle.value=true;
    try {
      const context=getPersistence?.(), appearance=await previewProjectStyle();
      if (disposed || !context || getPersistence?.()?.canvasPath!==context.canvasPath || referenceFlow.findNode(id)!==node) throw Error('画布或节点已变化');
      data.value.writingProduction={...data.value.writingProduction,...appearance};await context.save();
    } finally {choosingStyle.value=false;}
  }
  let input = generationInput.value;
  if (!generationPrompt.value) throw new Error("请输入生成提示词");
  const references = selectedImageReferences().filter(item => !data.value.inpaint || item.dataType !== "IMAGE" || item.value?.url !== data.value.inpaint.source);
  if (references.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  if (!input) throw new Error("请先选择图片模型");
  const beforeSubmit = workbench && captureWorkbenchSubmission(workbench);
  if (workbench) {
    // The ordinary node editor has its own UI defaults. The workbench sends only explicitly requested options.
    const { size, ratio, ...request } = input;
    input = { ...request, ...(workbench.size !== undefined ? { size: workbench.size } : {}),
      ...(workbench.ratio !== undefined ? { ratio: workbench.ratio } : {}) };
  }
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  const inpaintData = data.value.inpaint;
  generationController = controller;
  // ACT: 工具立即返回；任务身份先保存，卸载只停止等待，重新打开后复查。
  generation = generationState.run(() => workspace.list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      beforeSubmit?.();
      return inpaintData
        ? generateInpaint({ ...input, directory }, inpaintData, controller.signal)
        : generationState.generate("image", { ...input, directory }, controller.signal, undefined,
          workbench && beforeSubmit ? { taskId: workbench.taskId, beforeSubmit } : undefined);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回图片");
      outputs.value.image = { dataType: "IMAGE", value: { url: result.path, mimeType: result.mimeType } };
    }))
    .catch((error) => showNodeError(error, "图片生成失败"))
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating" };
}

nodeEvent.on("save", (reason) => {
  if (reason === "reload" && workbenchPanel.value?.busy) throw new Error("图像工作台处理中，请稍后刷新节点");
  if (reason === "reload" && (generating.value || uploading.value || deleting.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy)) throw new Error("图片处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (workbenchPanel.value?.busy) throw new Error("图像工作台处理中，请稍后删除节点");
  if (uploading.value || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || (editor.value?.busy && !generating.value)) throw new Error("图片处理中，请稍后删除节点");
  deleting.value = true;
  try {
    await generationState.cancel(false);
    await generation;
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

async function resizeImage(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  imageWidth.value = (240 * image.naturalWidth) / image.naturalHeight;
  await nextTick();
  updateNodeInternals();
}

function openPanorama() {
  editor.value?.cancel();
  lightingVisible.value = false;
  multiAngleVisible.value = false;
}

function openWorkbench() {
  if (workbenchUnavailable.value) return;
  editor.value?.cancel();
  lightingVisible.value = false;
  multiAngleVisible.value = false;
  workbenchVisible.value = true;
}

function openLighting() {
  if (workbenchVisible.value) return;
  if (generating.value || deleting.value || uploading.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting || !previewUrl.value) return;
  editor.value?.cancel();
  multiAngleVisible.value = false;
  lightingVisible.value = true;
}

function openMultiAngle() {
  if (workbenchVisible.value) return;
  if (generating.value || deleting.value || uploading.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting || !previewUrl.value) return;
  editor.value?.cancel();
  lightingVisible.value = false;
  multiAngleVisible.value = true;
}

function startEditor(mode: "inpaint" | "mark") {
  if (workbenchVisible.value) return;
  if (generating.value || deleting.value || uploading.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting) return;
  lightingVisible.value = false;
  multiAngleVisible.value = false;
  editor.value?.start(mode);
}

function getConfig() {
  return {
    config: {
      providerId: selectedModel.value?.providerId ?? "",
      modelId: selectedModel.value?.modelId ?? "",
      size: data.value.size,
      ratio: data.value.ratio,
      other: { ...data.value.other },
    },
    models: models.value,
  };
}

nodeTools.register({
  name: "getConfig",
  description: "读取此图片生成节点的当前模型、分辨率、比例及可选图片模型能力，不含密钥；未声明分辨率或比例时分别使用 2K、16:9",
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
  description: "修改此图片生成节点的模型、分辨率或比例；先用 getConfig 查询可选能力，providerId 与 modelId 必须同时提供；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    size: z.string().min(1).optional(),
    ratio: z.string().min(1).optional(),
  }).refine((args) => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value
      : models.value.find((item) => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error("请选择 getConfig 返回的有效图片模型");
    const sizes = choice.imageSizes?.length ? choice.imageSizes : ["2K"];
    const ratios = choice.imageRatios?.length ? choice.imageRatios : ["16:9"];
    if (args.size !== undefined && !sizes.includes(args.size)) throw new Error(`当前模型不支持分辨率 ${args.size}，可选：${sizes.join("、")}`);
    if (args.ratio !== undefined && !ratios.includes(args.ratio)) throw new Error(`当前模型不支持比例 ${args.ratio}，可选：${ratios.join("、")}`);
    data.value.model = JSON.stringify([choice.providerId, choice.modelId]);
    if (args.size !== undefined) data.value.size = args.size;
    if (args.ratio !== undefined) data.value.ratio = args.ratio;
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的普通图片生成提示词，仅接收 prompt，支持 {{ref 1}} 等参考标记；分辨率 size、比例 ratio 等配置须先用 node:getConfig 查询能力，再单独调用 node:setConfig；不修改局部重绘提示词，不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt: value }) {
    if (deleting.value) throw new Error("节点正在删除，请稍后修改");
    data.value.prompt = value;
    data.value.promptModel = value.split("\n").map((text) => [{ type: "Write", text }]);
    return { prompt: value };
  },
});

nodeTools.register({
  name: "generateImage",
  description: "启动此节点的后台普通图片生成，使用普通生成提示词、模型、分辨率、比例和参考图片；局部重绘模式下须先退出；立即返回已开始，用 getGenerationStatus 查询完成结果，cancelGeneration 停止生成",
  parameters: z.strictObject({ expectedTaskId: z.uuid().optional(), workbench: workbenchSubmissionSchema.optional() })
    .refine(args => !args.expectedTaskId || !args.workbench, "复查现有任务与提交新任务必须分别进行"),
  execute({ expectedTaskId, workbench }, { signal }) {
    signal?.throwIfAborted();
    return startGeneration(expectedTaskId, workbench);
  },
});
</script>

<style scoped lang="scss">
.defaultModelFollow{display:flex;align-items:center;gap:6px;margin:10px 0;font-size:12px;color:var(--el-text-color-secondary)}
.panoramaButton {
  &[aria-expanded="true"] .menuChevron { transform: rotate(180deg); }
}

.imageContent {
  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);

    .inpaintGuide,
    .imageEmpty {
      height: 100%;
      min-height: 0;
    }

    .inpaintGuide img { height: 100%; object-fit: contain; }
  }

  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .inpaintGuide {
    position: relative;
    width: 100%;
    img { display: block; width: 100%; }
    span { position: absolute; bottom: 8px; left: 8px; padding: 4px 8px; border-radius: 4px; background: #0009; color: #fff; font-size: 12px; }
  }

  .imageEmpty {
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
  .shotBlocking {
    margin: 8px 0;
    font-size: 12px;
    summary { cursor: pointer; }
    p { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 140px; overflow: auto; }
  }
  .inpaintInfo { margin-bottom: 8px; }
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

    .confirmButton { margin-left: auto; }

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
