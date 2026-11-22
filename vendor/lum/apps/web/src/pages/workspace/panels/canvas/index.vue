<template>
  <div
    ref="canvasElement"
    class="canvas"
    :class="{ canvasUnselected: !canvasId, edgesHidden: !showEdges, handMode, multiSelectionMode: flow.multiSelectionActive.value, compositingEnabled: generalSettings.canvasCompositingEnabled }"
    :style="{ '--canvasEdgeColor': generalSettings.canvasEdgeColorMode === 'custom' ? generalSettings.canvasEdgeColor : 'var(--el-color-primary)' }"
    @dblclick="openNodeMenu"
    @wheel.capture="zoomCanvas"
    @gesturestart.capture="zoomCanvas"
    @gesturechange.capture="zoomCanvas"
    @gestureend.capture="zoomCanvas"
    @pointerdown.capture="updateCanvasSelection"
    @click.capture="updateCanvasSelection"
    @auxclick.capture="preventMiddleClick"
    @pointermove="pointerPosition = { x: $event.clientX, y: $event.clientY }; if (!$event.buttons) updateCanvasSelection($event)"
    @pointerleave="pointerPosition = undefined"
    @dragover="dragFilesOver"
    @drop="dropFiles">
    <vue-flow
      :id="runtimeKey"
      :only-render-visible-elements="false"
      :nodes-draggable="true"
      :node-types="nodeTypes"
      :snap-to-grid="snapEnabled"
      :snap-grid="[16, 16]"
      :min-zoom="0.2"
      :max-zoom="8"
      :nodes-connectable="true"
      :connection-mode="ConnectionMode.Strict"
      :nodes-focusable="false"
      :edges-focusable="false"
      :edges-updatable="false"
      :elevate-nodes-on-select="true"
      :elevate-edges-on-select="false"
      :disable-keyboard-a11y="true"
      :selectNodesOnDrag="false"
      :auto-pan-on-node-drag="false"
      :auto-pan-on-connect="false"
      :zoom-on-double-click="false"
      :zoomOnScroll="false"
      :zoomOnPinch="active && !settingsVisible"
      :panOnScroll="active && !settingsVisible && !defaultWheelZoom"
      :panOnScrollSpeed="1"
      :panOnDrag="handMode || isMobile ? true : defaultDragPan ? [0, 1] : [1]"
      :panOnScrollMode="PanOnScrollMode.Free"
      :delete-key-code="null"
      :selectionKeyCode="active && !settingsVisible && !handMode && !isMobile && selectionKeyPressed"
      :selectionMode="SelectionMode.Partial"
      :multi-selection-key-code="null"
      :zoomActivationKeyCode="zoomKeyPressed ? true : null"
      :pan-activation-key-code="null"
      v-model="flowData"
      @connect="addEdges"
      @edgeClick="showEdgeDisconnect"
      @paneClick="edgeDisconnect = undefined"
      @moveStart="edgeDisconnect = undefined"
      :default-edge-options="defaultEdgeOptions">
      <template v-for="type in remoteNodeTypes" :key="type" #[`node-${type}`]="nodeProps">
        <remoteNode
          v-bind="nodeProps"
          :component="nodeTypes[type]"
          :error="nodeErrors[type]"
          :loading="nodeLoads.has(type) || (nodeListLoading && !nodeTypes[type] && !nodeErrors[type])" />
      </template>
      <background v-if="canvasId" :gap="16" patternColor="var(--el-border-color)" />
      <div v-if="!canvasId" class="canvasOverlay" role="status" @contextmenu.prevent @dragover.prevent @drop.prevent>
        从左上角打开一个画布，就可以开始创作啦
      </div>
      <canvasEmpty
        v-if="active && !settingsVisible && project?.directory && canvasReady && !flow.getNodes.value.length"
        :availableNodes="availableNodes"
        @create="createEmptyNode" />
      <scriptSetupDialog v-model="scriptSetupVisible" @confirm="createScriptFromSetup" />
      <canvasViewportHint v-if="active && !settingsVisible && project?.directory && canvasReady" :key="canvasId" />
      <assetSidebar v-if="canvasId && sidebarVisible" v-model="sidebarVisible" :directory="project?.directory" :nodeOptions="nodeOptions" />
      <canvasMenu ref="canvasMenuRef" v-model:canvasId="canvasId" :directory="project?.directory" :initialCanvasId="initialCanvasId" :activateCanvas="activateCanvas" :flushSave="flushCanvases ?? flushCanvasSave">
        <assetLibrary ref="assetLibraryRef" v-model="assetsVisible" :directory="project?.directory" />
      </canvasMenu>
      <canvasControls
        v-if="canvasId"
        ref="canvasControlsRef"
        v-model:assetsVisible="assetsVisible"
        v-model:sidebarVisible="sidebarVisible"
        v-model:snapEnabled="snapEnabled"
        v-model:showEdges="showEdges"
        :canvasId="canvasId"
        :directory="project?.directory"
        :batchHistory="canvasHistory.batch"
        @update:showEdges="edgeDisconnect = undefined" />
      <nodeMenu
        :key="JSON.stringify(['nodeMenu', project?.directory, canvasId])"
        ref="nodeMenuRef"
        :remoteNodes="availableNodes"
        :disabled="!active || settingsVisible || !project?.directory || !canvasReady"
        :pasteNode="pasteClipboardNode"
        :uploadFiles="canvasId && project?.directory ? selectFiles : undefined"
        :canUndo="canUndo"
        :canRedo="canRedo"
        :selectionBusy="selectionToolbarRef?.busy"
        :batchHistory="canvasHistory.batch"
        @duplicateSelection="selectionToolbarRef?.operate('duplicate')"
        @history="canvasHistory.commit"
        @undo="changeHistory('undo')"
        @redo="changeHistory('redo')" />
      <selectionToolbar
        :key="JSON.stringify(['selectionToolbar', project?.directory, canvasId])"
        ref="selectionToolbarRef"
        :batchHistory="canvasHistory.batch"
        :getSignal="() => canvasController.signal"
        :disabled="!canvasId || !project?.directory" />
      <nodeSearch ref="nodeSearchRef" :disabled="!active || settingsVisible || !canvasId || !project?.directory" />
    </vue-flow>
    <el-dialog :modelValue="!!assetSelection" class="referenceAssetDialog" title="全局素材库" width="min(1200px, 88vw)" alignCenter appendToBody destroyOnClose @update:modelValue="finishAssetSelection()">
      <assetLibrary :modelValue="!!assetSelection" expanded :canSelect="canSelectAsset" :selecting="assetSelecting" @select="selectAsset" />
    </el-dialog>
    <teleport to="body">
      <el-button
        v-if="edgeDisconnect && findEdge(edgeDisconnect.id)"
        class="edgeDisconnect"
        type="danger"
        circle
        aria-label="断开连接"
        title="断开连接"
        :style="{ left: `${edgeDisconnect.x}px`, top: `${edgeDisconnect.y}px` }"
        @click.stop="
          removeEdges(edgeDisconnect.id);
          edgeDisconnect = undefined;
        "
        @mouseleave="edgeDisconnect = undefined">
        <icon-unlink :size="16" />
      </el-button>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { verifyWorkbenchAdoption } from "../../../../../../../packages/nodes/imageNode/src/imageWorkbenchAdoption";
import type { ImageWorkbenchAdoption } from "../../../../../../../packages/nodes/imageNode/src/useImageWorkbenchResults";
import { validateVirtualStageOutput, type VirtualStageOutput } from "@lum/node-shared/virtualStageOutput";
import { t, translate } from "@lum/i18n/vue";
import { computed, inject, markRaw, nextTick, onBeforeUnmount, onMounted, onScopeDispose, provide, ref, shallowReactive, shallowRef, watch } from "vue";
import axios from "axios";
import { debounce } from "lodash-es";
import { ElMessage } from "element-plus";
import { actualPlatform, isMobile } from "@/lib/platform";
import { parseWritingMaterials, materialNodeId, parseProductionSetup } from "./writingMaterials";
import { importStoryGridImages } from "./storyGridImport";
import { getPromptText } from "@lum/node-shared/promptText";
import { createPrevisSnapshot } from "./previsMaterials";
import { waitForControlValue } from "@/lib/mcpControl";
import { storeToRefs } from "pinia";
import { IconUnlink } from "@tabler/icons-vue";
import * as vueRuntime from "vue";
import * as vueFlowRuntime from "@vue-flow/core";
import * as elementPlusRuntime from "element-plus";
import * as threeRuntime from "three";
import * as modelIcons from "@lum/model-icons";
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import "element-plus/dist/index.css";
import {
  VueFlow,
  PanOnScrollMode,
  ConnectionMode,
  SelectionMode,
  useVueFlow,
  isNode,
  type Node,
  type Edge,
  type GraphEdge,
  type GraphNode,
  type EdgeMouseEvent,
  type NodeTypesObject,
  type XYPosition,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { removeWritingSetupStyle, writingSetupStyle } from "@lum/node-shared/writingSetup";
import { useCanvasTools } from "./useCanvasTools";
import type { CanvasContext } from "@lum/tool-canvas/runtime";
import { loadNodeComponent } from "./loadNodeComponent";
import { useCanvasHistory } from "./useCanvasHistory";
import { copyNodeToClipboard, copyNodesToClipboard, nodeClipboardCommand, readClipboardNodes } from "./nodeClipboard";
import { remapNodeReferences } from "./canvasFiles";
import { readClipboardFiles, readClipboardText, writeClipboardImage } from "@/lib/clipboard";
import nodeMenu from "./components/nodeMenu.vue";
import remoteNode from "./components/remoteNode.vue";
import canvasMenu from "./components/canvasMenu.vue";
import canvasControls from "./components/canvasControls.vue";
import canvasEmpty from "./components/canvasEmpty.vue";
import scriptSetupDialog from "./scriptSetup/scriptSetupDialog.vue";
import { setupTags } from "./scriptSetup/scriptSetupCatalog";
import canvasViewportHint from "./components/canvasViewportHint.vue";
import assetLibrary from "./components/assetLibrary.vue";
import assetSidebar from "./components/assetSidebar.vue";
import groupNode from "./components/groupNode.vue";
import selectionToolbar from "./components/selectionToolbar.vue";
import nodeSearch from "./components/nodeSearch.vue";
import { finishGroupDrag, fitGroupBounds, getSelectionTree } from "./selectionNodes";
import type { NodeOutput } from "@lum/nodes-scaffold/values";
import { validateConnection, type NodeConnectionFeedback, type NodeHandle } from "@lum/nodes-scaffold/connection";
import { assertNodesRemovable, setNodeRemovalGuard, useNodeEvent } from "@lum/nodes-scaffold/nodeEvent";
import { enhancementOccupiesSlot, enhancementPlanHasDependents } from "@lum/node-shared/videoEnhancement";
import type { NodeDocumentContext, NodeDocumentState } from "@lum/nodes-scaffold/nodeDocument";
import { useNodeToolsContext } from "@lum/nodes-scaffold/nodeTools";
import { useWorkspaceStore } from "@/stores/workspace";
import { generalSettings } from "@/stores/settings";
import { getShortcutBindings, shortcutLabel, shortcutMatches, shortcutPressed } from "@/lib/canvasShortcuts";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { createClipboardMediaFile, dropCanvasFiles, getCanvasFileType, getClipboardMediaFiles, importCanvasFiles, isCanvasFileDrag } from "./canvasDrop";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";

const props = withDefaults(defineProps<{
  active?: boolean;
  settingsVisible?: boolean;
  runtimeKey?: string;
  initialCanvasId?: string;
  activateCanvas?: (canvasId: string, signal?: AbortSignal) => Promise<void>;
  resolveCanvasContext?: (canvasId: string) => CanvasContext | undefined;
  flushCanvases?: (action?: () => Promise<void>) => Promise<void>;
}>(), { active: true, settingsVisible: false });
const { project } = storeToRefs(useWorkspaceStore());

const canvasElement = ref<HTMLElement>();
const flowData = ref<(Node | Edge)[]>([]);
const canvasId = ref("");
const nodeMenuRef = ref<InstanceType<typeof nodeMenu>>();
const canvasMenuRef = ref<InstanceType<typeof canvasMenu>>();
const canvasControlsRef = ref<InstanceType<typeof canvasControls>>();
const selectionToolbarRef = ref<InstanceType<typeof selectionToolbar>>();
const nodeSearchRef = ref<InstanceType<typeof nodeSearch>>();
const nodeTypes = shallowRef<NodeTypesObject>({ canvasGroup: markRaw(groupNode) });
const nodeConfigs = shallowRef<Record<string, Record<string, unknown>>>({});
const nodeOptions = ref<{ type: string; label: string }[]>([]);
const nodeLoads = shallowReactive(new Map<string, Promise<void>>());
const nodeReloads = new Set<string>();
const nodeErrors = ref<Record<string, string>>({});
const availableNodes = computed(() => nodeOptions.value.filter(node => nodeTypes.value[node.type] && !nodeErrors.value[node.type]));
const nodeListLoading = ref(true);
const remoteNodeTypes = computed(() => [
  ...new Set((flowData.value as { type?: string }[]).map((item) => item.type).filter((type): type is string => !!type?.startsWith("remote-"))),
]);
let loadRequest = 0;
const snapEnabled = ref(false);
const zoomKeyPressed = ref(false);
const panKeyPressed = ref(false);
const selectionKeyPressed = ref(false);
const defaultWheelZoom = computed(() => getShortcutBindings(generalSettings.value.canvasShortcuts.zoom).includes("None"));
const defaultDragPan = computed(() => getShortcutBindings(generalSettings.value.canvasShortcuts.pan).includes("None"));
const selectedTool = defineModel<"move" | "hand">("selectedTool", { default: "move" });
const handMode = computed(() => props.active && !props.settingsVisible && (selectedTool.value === "hand" || panKeyPressed.value));
let pointerPosition: XYPosition | undefined;
const pressedCodes = new Set<string>();
let gestureScale: number | undefined;
let copyingNodes = false;
const showEdges = ref(true);
const assetsVisible = ref(false);
const sidebarVisible = ref(false);
// 素材库浮层和资产管理侧边栏都在左上方，同一时间只开一个。
watch(assetsVisible, opened => { if (opened) sidebarVisible.value = false; });
watch(sidebarVisible, opened => { if (opened) assetsVisible.value = false; });
const assetLibraryRef = ref<InstanceType<typeof assetLibrary>>();
const edgeDisconnect = ref<{ id: string; x: number; y: number }>();
const flow = useVueFlow(props.runtimeKey);
setNodeRemovalGuard(flow, node => {
  const directory = project.value?.directory;
  if (directory && enhancementOccupiesSlot(node, { directory, canvasPath: canvasId.value })) {
    throw new Error("超分原任务仍占用本地并发，请等待任务结束，或在结果节点查询、恢复或明确放弃原任务。");
  }
  if (directory && enhancementPlanHasDependents(node, flow.getNodes.value, { directory, canvasPath: canvasId.value })) {
    throw new Error("此节点保存整批超分的计划与确认记录，其他子项仍需使用。整批删除或撤销也须先完成、明确放弃或逐项移除其他待处理子项，再移除此节点。");
  }
});
const nodeDocument: NodeDocumentContext = { targets: shallowReactive(new Map()), mounts: new Map(), states: shallowReactive(new Map()) };
const canvasDirty = ref(false);
const canvasSaveError = ref("");
const documentObservers = new Set<() => void>();
onScopeDispose(() => { for (const release of documentObservers) release(); });
provide("nodeDocument", nodeDocument);
let dragCopy: ReturnType<InstanceType<typeof selectionToolbar>["startDragCopy"]>;
flow.onNodeDragStart(({ event, nodes }) => {
  dragCopy = undefined;
  if (!props.active || props.settingsVisible) return;
  const shortcuts = generalSettings.value.canvasShortcuts;
  const withEdges = shortcutPressed(event, shortcuts.duplicateOnDrag, pressedCodes);
  if (withEdges || shortcutPressed(event, shortcuts.copyOnDrag, pressedCodes)) {
    dragCopy = selectionToolbarRef.value?.startDragCopy(nodes, withEdges);
  }
});
flow.onNodeDrag(() => dragCopy?.update());
flow.onNodeDragStop(({ nodes }) => {
  const copy = dragCopy;
  dragCopy = undefined;
  if (copy) copy.finish();
  else finishGroupDrag(flow.getNodes.value, nodes);
});
const canvasHistory = useCanvasHistory(flow, () =>
  project.value?.directory && canvasId.value ? JSON.stringify([project.value.directory, canvasId.value]) : ""
);
const { canUndo, canRedo } = canvasHistory;
provide("batchCanvasHistory", canvasHistory.batch);
const getNodeTools = useNodeToolsContext();
const { addNodes, addEdges, removeEdges, findEdge, findNode, toObject, viewport, screenToFlowCoordinate } = flow;
provide("copyNodeToClipboard", async (node: Parameters<typeof copyNodeToClipboard>[0]) => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  if (await copyImageNodeToClipboard(directory, node)) return;
  await copyNodeToClipboard(node, directory);
});
provide("retainNodeFiles", true);
provide("selectionConnection", shallowRef<NodeConnectionFeedback>());
provide("saveNodeToAssets", (label: string, outputs: { label: string; output: NodeOutput }[]) => assetLibraryRef.value?.openSave(label, outputs));
let canvasController = new AbortController();
let workspaceController = new AbortController();
type AssetReference = { source: string; sourceHandle: string };
type AssetSelection = { target: GraphNode; targetHandleId: string; directory: string; sourceId: string; controller: AbortController; signal: AbortSignal; resolve: (reference?: AssetReference) => void };
const assetSelection = shallowRef<AssetSelection>();
const assetSelecting = ref(false);
provide("selectNodeAsset", (targetId: string, targetHandleId: string) => {
  finishAssetSelection();
  const target = findNode(targetId);
  const directory = project.value?.directory;
  if (!target || !directory || !props.active || !canvasId.value) return Promise.resolve(undefined);
  return new Promise<AssetReference | undefined>(resolve => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, canvasController.signal, workspaceController.signal]);
    assetSelection.value = { target, targetHandleId, directory, sourceId: crypto.randomUUID(), controller, signal, resolve };
    signal.addEventListener("abort", () => {
      if (assetSelection.value?.signal === signal) finishAssetSelection();
    }, { once: true });
  });
});
function finishAssetSelection(reference?: AssetReference) {
  const selection = assetSelection.value;
  assetSelection.value = undefined;
  assetSelecting.value = false;
  selection?.controller.abort();
  selection?.resolve(reference);
}
watch(() => assetSelection.value && (!props.active || props.settingsVisible || assetSelection.value.directory !== project.value?.directory
  || findNode(assetSelection.value.target.id) !== assetSelection.value.target), invalid => {
  if (invalid) finishAssetSelection();
});
onScopeDispose(() => finishAssetSelection());

function assetConnection(type: string, selection: AssetSelection, source?: GraphNode) {
  const target = selection.target;
  if (selection.signal.aborted || findNode(target.id) !== target || !flow.nodesConnectable.value || target.connectable === false) return;
  const sourceNode = source ?? { ...target, id: selection.sourceId, type, data: { handles: (nodeTypes.value[type] as { handles?: NodeHandle[] })?.handles }, connectable: true };
  const nodes = source ? flow.getNodes.value : [...flow.getNodes.value, sourceNode];
  return (sourceNode.data.handles as NodeHandle[] | undefined)?.filter(handle => handle.type === "source")
    .map(handle => ({ source: sourceNode.id, sourceHandle: handle.id, target: target.id, targetHandle: selection.targetHandleId }))
    .find(connection => sourceNode.connectable !== false && validateConnection(connection, { sourceNode, targetNode: target, nodes, edges: flow.getEdges.value }));
}

function canSelectAsset(entry: { name: string; type: string }) {
  const selection = assetSelection.value;
  const { type } = getCanvasFileType({ name: entry.name, type: "" });
  return !!selection && entry.type === "file" && !!type && availableNodes.value.some(node => node.type === type) && !!assetConnection(type, selection);
}

async function selectAsset(entry: { name: string; path: string; type: string }) {
  const selection = assetSelection.value;
  if (!selection || assetSelecting.value || !canSelectAsset(entry)) return;
  assetSelecting.value = true;
  try {
    const { data } = await axios.get<Blob>("/api/assets/read", { params: { path: entry.path }, responseType: "blob", signal: selection.signal });
    selection.signal.throwIfAborted();
    await canvasHistory.batch(async () => {
      let importedId: string | undefined;
      let created: GraphNode | undefined;
      let connected = false;
      const target = selection.target;
      const position = { x: target.computedPosition.x - 440, y: target.computedPosition.y };
      try {
        [importedId] = await importCanvasFiles([new File([data], entry.name, { type: data.type })], position, {
          directory: selection.directory, availableNodes: availableNodes.value, signal: selection.signal, flow,
        });
        if (!importedId) return;
        created = findNode(importedId);
        await nextTick();
        if (!created || findNode(importedId) !== created) throw new Error("素材节点已移除，请重新选择");
        await useNodeEvent(importedId, flow).emit("save");
        selection.signal.throwIfAborted();
        const connection = assetConnection(created.type ?? "", selection, created);
        if (!connection) throw new Error("当前节点无法引用该素材");
        const width = created.dimensions.width || 360;
        created.position.x = target.computedPosition.x - width - 80;
        addEdges(connection);
        connected = true;
        finishAssetSelection({ source: importedId, sourceHandle: connection.sourceHandle });
      } finally {
        if (importedId && !connected) {
          if (created && findNode(importedId) === created) flow.removeNodes(importedId, true);
          await useWorkspaceFiles(selection.directory).remove(`assets/${importedId}`, true).catch(cleanupError => {
            if (cleanupError?.response?.data?.data?.code !== "ENOENT") ElMessage.error(cleanupError?.response?.data?.message || cleanupError.message);
          });
        }
      }
    });
  } catch (error) {
    if (!selection.signal.aborted) ElMessage.error(axios.isAxiosError<{ message: string }>(error) ? error.response?.data.message || error.message : (error as Error).message);
  } finally {
    if (assetSelection.value === selection) assetSelecting.value = false;
  }
}
const createCanvasContext = useCanvasTools({
  availableNodes,
  flushSave: flushCanvasSave,
  menu() {
    if (!canvasMenuRef.value) throw new Error("画布菜单尚未就绪");
    return canvasMenuRef.value;
  },
  getCanvasBinding: () => ({ id: canvasId.value, signal: canvasController.signal }),
  resolveCanvasContext: id => props.resolveCanvasContext?.(id),
});
function getCanvasContext() {
  return canvasId.value || canvasMenuRef.value?.initialized ? createCanvasContext(canvasId.value, canvasController.signal, workspaceController.signal) : undefined;
}
const canvasReady = computed(() => !!canvasId.value && !nodeListLoading.value && nodeLoads.size === 0);
let importingMaterials = false;
async function importWritingMaterials(value: unknown, productionValue?: unknown, imagesOnly = false) {
  if (importingMaterials || !canvasReady.value || savePaused) throw new Error("画布正在加载或保存，请稍后送入");
  const items = parseWritingMaterials(value);
  if (imagesOnly && items.some(item => item.kind !== "image")) throw new Error("剧情素材只能导入图片节点");
  const production = parseProductionSetup(productionValue, items);
  // Manuscripts stay independent text nodes even if a stage root was copied into this workflow.
  const stageItems = !production && !imagesOnly ? items.filter(item => !item.sourceKey.startsWith("clip:manuscript:")) : [];
  const stage = stageItems.length ? flow.getNodes.value.find(node => node.type === "remote-director3dNode" && (node.data as { virtualStage?: boolean }).virtualStage === true) : undefined;
  const updatedSources = new Set(stageItems.map(item => item.sourceKey));
  const stageSources = stage ? [...((stage.data.previsSources ?? []) as typeof items).filter(source => !updatedSources.has(source.sourceKey)), ...stageItems] : undefined;
  if (stageSources && (stageSources.length > 200 || stageSources.reduce((size, source) => size + (source.text?.length ?? 0), 0) > 2000000)) throw new Error("当前片场的参考素材已达容量上限（200 条或 200 万字），请新建片场后分组送入");
  const sharedImageKeys = new Set(items.filter(item => item.kind === "image" && (item.sourceKey.startsWith("styleRef:") ||
    production?.mode === "video" && (item.sourceKey.startsWith("entity:") || item.sourceKey.startsWith("assetView:")))).map(item => item.key));
  const nodeIds = new Map<string, string>();
  async function nodeIdFor(key: string) {
    const remembered = nodeIds.get(key);
    if (remembered) return remembered;
    const productionId = production ? await materialNodeId(`${production.clipId}:${key}`) : undefined;
    // 旧胶卷已连入的图片沿用原标识，避免让提示词里的 @ 引用失效。
    const sharedImage = sharedImageKeys.has(key);
    const existingId = productionId && (!sharedImage || findNode(productionId)) ? productionId
      : flow.getNodes.value.find(node => node.data.writingSource?.key === key
        && (!sharedImage || (node.type === "remote-imageNode" && !node.data.writingProduction)))?.id;
    const id = existingId ?? `writing-${crypto.randomUUID()}`;
    nodeIds.set(key, id);
    return id;
  }
  if (production && !availableNodes.value.some(node => node.type === (production.mode === "previs" ? "remote-director3dNode" : "remote-videoGenerationNode"))) throw new Error(production.mode === "previs" ? "请先启用 Lum 3D 导演台节点" : "请先启用 Lum 视频生成节点");
  for (const item of items) if (!availableNodes.value.some(node => node.type === `remote-${item.kind}Node`)) throw new Error("请先启用 Lum 基础文本与图片节点");
  const directory = project.value?.directory, target = canvasId.value, signal = canvasController.signal;
  const check = () => { signal.throwIfAborted(); if (!directory || project.value?.directory !== directory || target !== canvasId.value) throw new Error("画布已切换，请在目标画布重新送入"); };
  const report = { created: 0, updated: 0, unchanged: 0, conflicts: [] as string[], warnings: [] as string[], canvasId: target };
  const arrangeNewProduction = !!production && !production.batchId && flow.getNodes.value.length === 0;
  importingMaterials = true;
  try {
    await flushCanvasSave(); check();
    const startX = production?.batchId ? 0 : flow.getNodes.value.reduce((max, node) => Math.max(max, node.position.x + (node.dimensions?.width || 360)), -440) + 440;
    const startY = production?.batchId ? flow.getNodes.value.reduce((max, node) => Math.max(max, node.position.y + (node.dimensions?.height || 600)), -160) + 160 : 0;
    await canvasHistory.batch(async () => {
      let sharedImageCount = 0;
      for (const [index, item] of items.entries()) {
        const id = await nodeIdFor(item.key); check();
        const existing = findNode(id);
        const content = item.kind === "text" ? item.text! : JSON.stringify(item.image);
        const source = { setupSnapshot: item.setupSnapshot, imageSource: item.imageSource, key: item.key, sourceKey: item.sourceKey, episodeId: item.episodeId, entityKind: item.entityKind, content, label: item.label };
        if (existing) {
          const previous = existing.data.writingSource as typeof source | undefined;
          if (previous?.key !== item.key || existing.type !== `remote-${item.kind}Node`) { report.conflicts.push(item.label); continue; }
          if (imagesOnly && (previous.content !== content || existing.data.outputs?.image?.value?.url !== item.image?.path
            || existing.data.outputs?.image?.value?.mimeType !== item.image?.mimeType)) { report.conflicts.push(item.label); continue; }
          if (previous.content === content) {
            if (JSON.stringify(previous.setupSnapshot) !== JSON.stringify(item.setupSnapshot)) {
              existing.data.writingSource = source; report.updated++;
            } else report.unchanged++;
            continue;
          }
          const output = existing.data.outputs?.[item.kind];
          const current = item.kind === "text" ? output?.value : JSON.stringify(output?.value ? { path: output.value.url, mimeType: output.value.mimeType } : undefined);
          // File snapshots keep the UTF-8 signature in their encoding, outside the text output.
          const previousBody = item.kind === "text" ? previous.content.replace(/^\uFEFF/, "") : previous.content;
          if (current !== previousBody) { report.conflicts.push(item.label); continue; }
          if (item.kind === "text") await getNodeTools().call({ nodeId: id, name: "node:setText", args: { text: item.text!.replace(/^\uFEFF/, "") } }, signal);
          else existing.data.outputs.image = { dataType: "IMAGE", value: { url: item.image!.path, mimeType: item.image!.mimeType } };
          check(); if (existing.data.label === previous.label) existing.data.label = item.label;
          existing.data.writingSource = source; report.updated++; continue;
        }
        const sharedImage = sharedImageKeys.has(item.key);
        const position = sharedImage && production?.batchId
          ? { x: startX - 440, y: startY + sharedImageCount++ * 680 }
          : { x: startX + index % 2 * 440, y: startY + Math.floor(index / 2) * (production?.batchId ? 680 : 400) };
        addNodes({ id, type: `remote-${item.kind}Node`, position, data: { label: item.label, writingSource: source, ...(production && !sharedImage ? { writingProduction: { clipId: production.clipId, batchId: production.batchId } } : {}), ...(item.kind === "text" ? { textSnapshot: item.text } : { outputs: { image: { dataType: "IMAGE", value: { url: item.image!.path, mimeType: item.image!.mimeType } } } }) } });
        report.created++;
        if (item.kind === "text") {
          // Text nodes create their shared assets directory at mount. Let each
          // finish before mounting the next importer-owned text node.
          await nextTick();
          await waitForControlValue(() => canvasReady.value ? true : undefined, AbortSignal.any([signal, AbortSignal.timeout(60000)])); check();
          await waitForControlValue(() => nodeDocument.states.has(id) ? true : undefined, AbortSignal.any([signal, AbortSignal.timeout(60000)])); check();
          await useNodeEvent(id, flow).emit("save");
          check();
        }
      }
      await nextTick();
      await waitForControlValue(() => canvasReady.value ? true : undefined, AbortSignal.any([signal, AbortSignal.timeout(60000)])); check();
      if (stage && stageSources) {
        stage.data.previsSources = stageSources;
        const current = await getNodeTools().call({ nodeId: stage.id, name: "node:readPrevis", args: {} }, signal) as { revision: number };
        check();
        await getNodeTools().call({ nodeId: stage.id, name: "node:syncPrevisAssets", args: { expectedRevision: current.revision } }, signal);
        check();
        report.warnings.push("参考文案和图片已加入片场；新增人物与道具已生成简模草稿，请在片场中应用。地点图片可用于图片生成场地。");
      }
      if (production?.mode === "previs") {
        const directorId = await nodeIdFor(`clip:${production.clipId}:previs`);
        const promptId = await nodeIdFor(`clip:${production.clipId}:text`);
        check();
        let director = findNode(directorId);
        if (director && (director.type !== "remote-director3dNode" || director.data.writingProduction?.clipId !== production.clipId)) throw new Error("预演节点标识冲突，请核对画布");
        if (!director) {
          const modelSnapshot = createPrevisSnapshot(items, production.duration);
          addNodes({ id: directorId, type: "remote-director3dNode", position: { x: startX + 920, y: startY + 80 }, data: {
            label: "胶卷 · 白模预演", modelSnapshot, selectedPlanId: modelSnapshot.plans[0]!.id,
            previsSources: items, writingProduction: { clipId: production.clipId, batchId: production.batchId },
          } });
          report.created++;
        } else {
          director.data.previsSources = items;
          report.unchanged++;
          report.warnings.push("已更新场次参考，保留已有白模与运镜；新增资产可在预演中通过 Agent 同步到场景。");
        }
        await nextTick();
        await waitForControlValue(() => canvasReady.value ? true : undefined, AbortSignal.any([signal, AbortSignal.timeout(60000)])); check();
        director = findNode(directorId)!;
        const connection = { source: promptId, sourceHandle: "text", target: directorId, targetHandle: "in" };
        if (!flow.getEdges.value.some(edge => edge.source === promptId && edge.target === directorId && edge.targetHandle === "in")) {
          const sourceNode = findNode(promptId);
          if (sourceNode && validateConnection(connection, { sourceNode, targetNode: director, nodes: flow.getNodes.value, edges: flow.getEdges.value })) addEdges({ id: crypto.randomUUID(), ...connection });
        }
        if (production.duration > 300) report.warnings.push("当前预演最长 300 秒，已采用前 300 秒作为初始时长；较长胶卷请按段制作。");
      }
      if (!production && !stage && availableNodes.value.some(node => node.type === "remote-imageGenerationNode")) {
        for (const item of items.filter(item => item.setupSnapshot && item.kind === "text")) {
          const snapshot = item.setupSnapshot!;
          const version = snapshot.visual?.setupVersionId ?? "legacy";
          const imageId = await materialNodeId(`${item.sourceKey}:imageGeneration:${version}`);
          check();
          if (findNode(imageId)) continue;
          const textNode = findNode(await nodeIdFor(item.key));
          check();
          const refs = items.filter(ref => ref.kind === "image" && (ref.sourceKey === `styleRef:${snapshot.visual?.style.referenceMediaId}` || item.referenceKeys?.includes(ref.sourceKey)));
          const sourceIds = await Promise.all(refs.map(ref => nodeIdFor(ref.key)));
          check();
          const prompt = item.text!;
          addNodes({id: imageId, type: "remote-imageGenerationNode", position: {x: (textNode?.position.x ?? startX) + 440, y: textNode?.position.y ?? startY},
            data: {label: `${item.label} · 分镜生图`, prompt, promptModel: prompt.split("\n").map(text => [{type: "Write", text}]),
              promptReferenceSelection: true, writingProduction: {setupSnapshots: [snapshot]}}});
          report.created++;
          await nextTick();
          await waitForControlValue(() => canvasReady.value ? true : undefined, AbortSignal.any([signal, AbortSignal.timeout(60000)])); check();
          for (const sourceId of sourceIds) {
            const connection = {source: sourceId, sourceHandle: "image", target: imageId, targetHandle: "in"};
            const sourceNode = findNode(sourceId), targetNode = findNode(imageId);
            if (sourceNode && targetNode && validateConnection(connection, {sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value}))
              addEdges({id: crypto.randomUUID(), ...connection});
          }
        }
      }
      if (production?.mode === "video") {
        const videoId = await nodeIdFor(`clip:${production.clipId}:video`);
        const promptId = await nodeIdFor(`clip:${production.clipId}:text`);
        const referenceImages = [...items.filter(item => item.kind === "image" && item.sourceKey.startsWith("shot:")), ...items.filter(item => item.kind === "image" && (item.sourceKey.startsWith("entity:") || item.sourceKey.startsWith("assetView:") || item.sourceKey.startsWith("styleRef:")))];
        const referenceIds = await Promise.all(referenceImages.map(item => nodeIdFor(item.key)));
        check();
        let video = findNode(videoId);
        const created = !video;
        const legacyPrompt = "按连接的分镜制作说明和参考图完成本胶卷。";
        const seedPrompt = created || (video && (getPromptText(video.data.promptModel ?? []) || video.data.prompt || "").trim() === legacyPrompt);
        if (video && (video.type !== "remote-videoGenerationNode" || video.data.writingProduction?.clipId !== production.clipId)) throw new Error("制作节点标识冲突，请核对画布");
        if (!video) {
          const prompt = items.find(item => item.key === `clip:${production.clipId}:text`)!.text!;
          addNodes({ id: videoId, type: "remote-videoGenerationNode", position: { x: startX + 920, y: startY + 80 }, data: {
            label: production.batchId ? `${items.find(item => item.sourceKey === `clip:${production.clipId}`)?.label.replace(/ · 制作说明$/, "") ?? "分镜"} · 视频生成` : "胶卷 · 视频生成", prompt, promptModel: [[{ type: "Write", text: prompt }]], duration: production.duration, ratio: "16:9", writingProduction: { clipId: production.clipId, batchId: production.batchId, setupSnapshots: production.setupSnapshots, styleOverride: production.styleOverride },
          } });
          report.created++;
          await nextTick();
          await waitForControlValue(() => canvasReady.value ? true : undefined, AbortSignal.any([signal, AbortSignal.timeout(60000)])); check();
          video = findNode(videoId)!;
        }
        const oldPrompt = getPromptText(video.data.promptModel ?? []) || video.data.prompt || '';
        const setupStyle = writingSetupStyle(production).text;
        const metadata = video.data.writingProduction as { clipId: string; initialized?: boolean; setupSnapshots?: typeof production.setupSnapshots; styleOverride?: string; continuity?: typeof production.continuity; referenceNodeId?: string; referenceEdgeId?: string; referenceEdges?: { source: string; edgeId: string }[] };
        // Older imported nodes may already have outputs, so backfill only an
        // ungenerated node whose original prompt still matches its source.
        const savedBrief = items.find(item=>item.key===`clip:${production.clipId}:text`)!.text!;
        if (metadata.setupSnapshots === undefined && production.setupSnapshots?.length && !video.data.mediaTask && !video.data.outputs?.video?.value &&
          (seedPrompt || removeWritingSetupStyle(oldPrompt, setupStyle) === savedBrief)) {
          metadata.setupSnapshots = production.setupSnapshots;
          metadata.styleOverride = production.styleOverride;
          if (oldPrompt !== savedBrief && removeWritingSetupStyle(oldPrompt, setupStyle) === savedBrief) {
            video.data.prompt = savedBrief;
            video.data.promptModel = savedBrief.split('\n').map(text=>[{type:'Write',text}]);
          }
        }
        metadata.continuity = production.continuity;
        const connect = (sourceId: string, sourceHandle: string) => {
          const connection = { source: sourceId, sourceHandle, target: videoId, targetHandle: "in" };
          const existing = flow.getEdges.value.find(edge => edge.source === sourceId && edge.sourceHandle === sourceHandle && edge.target === videoId && edge.targetHandle === "in");
          if (existing) return existing.id;
          const sourceNode = findNode(sourceId)!;
          if (!sourceNode || !validateConnection(connection, { sourceNode, targetNode: video!, nodes: flow.getNodes.value, edges: flow.getEdges.value })) throw new Error("制作节点尚未准备好连接，请再次同步资料");
          const id = crypto.randomUUID(); addEdges({ id, ...connection }); return id;
        };
        if (!metadata.initialized) connect(promptId, "text");
        const previous = metadata.referenceEdges ?? (metadata.referenceNodeId && metadata.referenceEdgeId ? [{ source: metadata.referenceNodeId, edgeId: metadata.referenceEdgeId }] : []);
        const untouched = previous.every(reference => {
          const edge = findEdge(reference.edgeId);
          return edge && edge.source === reference.source && edge.target === videoId && edge.sourceHandle === "image" && edge.targetHandle === "in";
        });
        if (!metadata.initialized || untouched) {
          for (const reference of previous) if (!referenceIds.includes(reference.source)) removeEdges(reference.edgeId);
          // Keep metadata incrementally so a partial save can resume without duplicating connections.
          metadata.referenceEdges = previous.filter(reference => referenceIds.includes(reference.source));
          for (const source of referenceIds) {
            const edgeId = connect(source, "image");
            if (!metadata.referenceEdges.some(reference => reference.source === source)) metadata.referenceEdges.push({ source, edgeId });
          }
        } else report.warnings.push("视频参考连线已有手工调整，已保留；请核对分镜和人物、地点、道具参考图。");
        metadata.initialized = true;
        if (seedPrompt) {
          const brief = items.find(item => item.key === `clip:${production.clipId}:text`)!.text!;
          // 关联图只是候选；由用户或 AI 按本镜内容插入 @ 后才参与生成。
          video.data.prompt = brief;
          video.data.promptModel = brief.split("\n").map(text => [{type: "Write", text}]);
        }
        if (!referenceIds.length) report.warnings.push("胶卷尚无分镜图或资产参考图；可先用文生视频，或补图后同步。");
        if (sharedImageKeys.size) report.warnings.push("生成时请通过 @ 选择本镜头实际需要的资产参考图。");
        if (created) report.warnings.push(`镜头合计 ${production.duration} 秒，请在视频节点选择支持该时长的模型；较长胶卷可拆成多个胶卷。`);
      }
    });
    await flushCanvasSave(); check();
    if (arrangeNewProduction && flow.getSelectedNodes.value.length === 0) {
      try {
        await waitForControlValue(() => flow.getNodes.value.every(node => node.dimensions.width > 0 && node.dimensions.height > 0) ? true : undefined, AbortSignal.any([signal, AbortSignal.timeout(10000)]));
        check(); await getCanvasContext()!.call({ name: "arrangeCanvas", args: {} }, signal); check();
      } catch (error) {
        check(); report.warnings.push(`资料已保存，自动排布未完成，可点击画布左下角“整理画布”：${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (report.created) {
      const nodes = new Set(await Promise.all(items.map(item => nodeIdFor(item.key))));
      if (production?.batchId) {
        const batchIds = new Set(flow.getNodes.value.filter(node => node.data.writingProduction?.batchId === production.batchId).map(node => node.id));
        for (const id of batchIds) nodes.add(id);
        for (const edge of flow.getEdges.value) {
          if (!batchIds.has(edge.target)) continue;
          const source = findNode(edge.source);
          if (source?.type === "remote-imageNode" && !source.data.writingProduction && (source.data.writingSource?.sourceKey?.startsWith("entity:") || source.data.writingSource?.sourceKey?.startsWith("assetView:"))) nodes.add(source.id);
        }
      } else if (!production && !stage) {
        for (const item of items.filter(item => item.setupSnapshot && item.kind === "text"))
          nodes.add(await materialNodeId(`${item.sourceKey}:imageGeneration:${item.setupSnapshot!.visual?.setupVersionId ?? "legacy"}`));
      } else if (production) {
        nodes.add(await nodeIdFor(`clip:${production.clipId}:${production.mode === "previs" ? "previs" : "video"}`));
      }
      check();
      await flow.fitView({ nodes: [...nodes], padding: .2, maxZoom: .8 });
    }
    if (production?.mode === "previs") {
      check();
      const directorId = await nodeIdFor(`clip:${production.clipId}:previs`);
      try { await getNodeTools().call({ nodeId: directorId, name: "node:openPrevis", args: {} }, signal); }
      catch (error) { check(); report.warnings.push(`预演资料已保存，请点击白模预演节点打开：${error instanceof Error ? error.message : String(error)}`); }
    }
    return report;
  } finally { importingMaterials = false; }
}
provide("canvas", getCanvasContext);
const getHostCanvasActive = inject("hostCanvasActive", () => true);
provide("nodeCanvasActive", () => props.active && !props.settingsVisible && getHostCanvasActive());
provide("nodePersistence", () => {
  const directory = project.value?.directory;
  const canvasPath = canvasId.value;
  if (!directory || !canvasPath) return;
  return {
    directory,
    canvasPath,
    async save(signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (project.value?.directory !== directory || canvasId.value !== canvasPath) throw new Error("画布已切换，无法保存节点任务");
      let abort = () => {};
      try {
        const saving = flushCanvasSave();
        await (signal ? Promise.race([saving, new Promise<never>((_resolve, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
        })]) : saving);
      } finally { signal?.removeEventListener("abort", abort); }
      signal?.throwIfAborted();
      if (project.value?.directory !== directory || canvasId.value !== canvasPath) throw new Error("画布已切换，无法确认节点任务保存结果");
    },
  };
});
// ACT: 「独立项目」型节点（如白模预演 TrumanMap）会全屏打开编辑器并自行卸载；此处只提供退出回调。
// 素材库两项先不提供，节点发现缺能力时会自行把导出降级为下载。
provide("nodeProject", {
  close(error?: unknown) {
    if (error) ElMessage.error(error instanceof Error ? error.message : String(error));
  },
});
async function openVirtualStageEditor() {
  const director = flow.getNodes.value.find(node => node.type === "remote-director3dNode" && (node.data as { virtualStage?: boolean }).virtualStage === true);
  if (!director) throw new Error("此文件不包含虚拟片场");
  await getNodeTools().call({ nodeId: director.id, name: "node:openPrevis", args: {} }, canvasController.signal);
  await flushCanvasSave();
}
async function closePrevisEditors() {
  for (const director of flow.getNodes.value.filter(node => node.type === "remote-director3dNode")) {
    await getNodeTools().call({ nodeId: director.id, name: "node:closePrevis", args: {} }, canvasController.signal);
  }
  await flushCanvasSave();
}
async function addStageOutput(output:VirtualStageOutput) {
  validateVirtualStageOutput(output);
  if(!canvasReady.value || savePaused)throw new Error("目标画布尚未就绪，请稍后重新导出");
  const type=`remote-${output.kind}Node`;
  if(!availableNodes.value.some(node=>node.type===type))throw new Error("请先启用基础图片/视频节点");
  const directory=project.value?.directory,target=canvasId.value,signal=canvasController.signal;
  const id=`stageOutput-${crypto.randomUUID()}`,x=flow.getNodes.value.reduce((end,node)=>Math.max(end,node.position.x+(node.dimensions?.width||360)),-440)+440;
  await canvasHistory.batch(async()=>{
    addNodes({id,type,position:{x,y:80},data:{label:output.label,outputs:{[output.kind]:{dataType:output.kind.toUpperCase(),value:{url:output.url,mimeType:output.mimeType}}}}});
    await nextTick();await waitForControlValue(()=>canvasReady.value?true:undefined,AbortSignal.any([signal,AbortSignal.timeout(60000)]));
    if(project.value?.directory!==directory || canvasId.value!==target)throw new Error("画布已切换，输出节点保留在原目标画布");
    await flushCanvasSave();
  });
  return {canvasId:target,nodeId:id};
}
// Invalidate host preview/transactions when image identities or selected candidates change,
// including edits in another retained canvas panel. Text and viewport movement are irrelevant.
watch(() => JSON.stringify([
  flow.getNodes.value.filter(node => ['remote-imageNode', 'remote-imageGenerationNode'].includes(node.type)).map(node => [
    node.id, node.data.outputs, node.data.imageWorkbench?.sourceFingerprint, node.data.imageWorkbench?.templateId,
    node.data.imageWorkbench?.mode, node.data.imageWorkbench?.cells?.map((cell: {id: string; selectedCandidateId?: string}) => [cell.id, cell.selectedCandidateId]),
    node.data.imageWorkbench?.selectedSheetCandidateId, node.data.imageWorkbenchCrop, node.data.imageWorkbenchResult,
  ]),
  flow.getEdges.value.map(edge => [edge.source, edge.sourceHandle, edge.target, edge.targetHandle]),
]), () => {
  if (window.parent !== window) window.parent.postMessage({ type: 'lum:adoptionContextChanged' }, '*');
}, { flush: 'sync' });
async function importStorySources(value: unknown, context: { directory: string; canvasPath: string }) {
  const signal = canvasController.signal;
  const check = () => {
    signal.throwIfAborted();
    if (!canvasReady.value || savePaused || context.directory !== project.value?.directory || context.canvasPath !== canvasId.value) {
      throw new Error("导入期间画布已切换");
    }
  };
  const findImage = (key: string) => {
    const node = flow.getNodes.value.find(node => node.data.writingSource?.key === key);
    if (!node) return;
    const output = node.data.outputs?.image;
    const handle = node.data.handles?.find((item: { id: string; type: string }) => item.id === "image" && item.type === "source");
    if (node.type !== "remote-imageNode" || !handle || output?.dataType !== "IMAGE" || !output.value?.url || !output.value?.mimeType
      || !flow.nodesConnectable.value || node.connectable === false) throw new Error("画布已有来源相同但输出不可用的图片节点：" + node.id);
    return { nodeId: node.id, handleId: "image", path: output.value.url as string, mimeType: output.value.mimeType as string };
  };
  check();
  if (!availableNodes.value.some(node => node.type === "remote-imageNode")) throw new Error("请先启用 Lum 基础图片节点");
  return importStoryGridImages(value, useWorkspaceFiles(context.directory), findImage, items => importWritingMaterials(items, undefined, true), check);
}
function adoptionContext() {
  return { directory: project.value?.directory ?? '', canvasPath: canvasId.value };
}
async function verifyAdoption(request: ImageWorkbenchAdoption, readMedia = true) {
  const context = adoptionContext(), signal = canvasController.signal;
  const check = () => {
    signal.throwIfAborted();
    if (!canvasReady.value || context.directory !== project.value?.directory || context.canvasPath !== canvasId.value
      || request.directory !== context.directory || request.canvasPath !== context.canvasPath) throw new Error("采用来源画布已切换");
  };
  check();
  await flushCanvasSave(); check();
  const files = useWorkspaceFiles(context.directory);
  const saved = await files.readJson<any>(context.canvasPath); check();
  const outputs = verifyWorkbenchAdoption(saved, request);
  const proof = JSON.stringify(saved);
  const media: { cellId: string; blob: Blob }[] = [];
  let total = 0;
  for (const output of outputs) {
    if (!readMedia) break;
    const bytes = await files.read(output.path); check();
    total += bytes.byteLength;
    if (!bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024 || total > 128 * 1024 * 1024) throw new Error("采用原图超过单张32MiB或批次128MiB限制");
    media.push({ cellId: output.cellId, blob: new Blob([bytes], { type: output.mimeType }) });
  }
  check();
  // Recheck both the persisted proof and the current unsaved graph after file reads.
  if (JSON.stringify(await files.readJson(context.canvasPath)) !== proof) throw new Error("采用期间画布存档已变化");
  check();
  verifyWorkbenchAdoption({ lumCanvas: true, nodes: flow.getNodes.value, edges: flow.getEdges.value }, request);
  return { ...context, media };
}
defineExpose({ openScriptSetup, adoptionContext, verifyAdoption, canvasId, canvasReady, getCanvasContext, importWritingMaterials, importStorySources, openVirtualStageEditor, closePrevisEditors, addStageOutput, addNodeAtPointer, readDocumentNode, saveDocumentNode, mountDocumentNode, observeDocumentNode, prepareCanvasDelete, flushSave: flushCanvasSave, cancelSave: cancelCanvasSave,
  openNodeSearch: () => nodeSearchRef.value?.open(),
  getCanvases: (signal?: AbortSignal) => {
    if (!canvasMenuRef.value) throw new Error("画布菜单尚未就绪");
    return canvasMenuRef.value.getCanvases(signal);
  },
  syncCanvasPath: (previous: string, target: string) => canvasMenuRef.value?.syncCanvasPath(previous, target),
  getMentionNodes: () => flow.nodes.value, findMentionNode: flow.findNode,
  getRetainedNodes: canvasHistory.getRetainedNodes,
  get canvasListReady() { return canvasMenuRef.value?.initialized ?? false; },
  get saveBusy() { return savePaused; }, get loadError() { return canvasMenuRef.value?.loadError ?? ""; },
});

async function prepareCanvasDelete() {
  const directory = project.value?.directory;
  const fileName = canvasId.value;
  const nodes = [...flow.getNodes.value];
  const signal = AbortSignal.any([workspaceController.signal, canvasController.signal]);
  function checkCanvas() {
    signal.throwIfAborted();
    if (!directory || directory !== project.value?.directory || !fileName || fileName !== canvasId.value) {
      throw new Error("工作区或画布已切换，请重新删除");
    }
  }
  checkCanvas();
  await nextTick();
  checkCanvas();
  assertNodesRemovable(flow, nodes);
  // 宿主已暂停画布保存；这里只执行节点生命周期，文件删除成功后由宿主取消保存并卸载。
  for (const node of nodes) {
    if (flow.findNode(node.id) !== node) throw new Error("画布节点已变化，请重新删除");
    await useNodeEvent(node.id, flow).emit("delete");
    checkCanvas();
    if (flow.findNode(node.id) !== node) throw new Error("画布节点已变化，请重新删除");
  }
  if (flow.getNodes.value.length !== nodes.length || nodes.some(node => flow.findNode(node.id) !== node)) {
    throw new Error("画布节点已变化，请重新删除");
  }
  assertNodesRemovable(flow, nodes);
}

type DocumentNodeData = { label?: string; handles?: NodeHandle[]; outputs?: Record<string, NodeOutput | undefined>; textPath?: string };

function checkDocumentDirectory(directory: string) {
  if (!directory || directory !== project.value?.directory) throw new Error("工作目录已切换，请重新打开节点");
}

function observeDocumentNode(directory: string, canvasPath: string, nodeId: string, onState: (state: NodeDocumentState) => void) {
  checkDocumentDirectory(directory);
  if (canvasId.value !== canvasPath || !findNode(nodeId)) throw new Error("节点不存在，请刷新文件树");
  const stop = watch((): NodeDocumentState => {
    const node = findNode(nodeId);
    const state = nodeDocument.states.get(nodeId);
    return { dirty: !!node && (canvasDirty.value || !!state?.dirty),
      error: state?.error || canvasSaveError.value || (node && nodeErrors.value[node.type]) || "", deleted: !node };
  }, onState, { immediate: true, flush: "sync" });
  const release = () => { stop(); documentObservers.delete(dispose); };
  const dispose = () => { onState({ dirty: false, error: "", deleted: true }); release(); };
  documentObservers.add(dispose);
  return {
    release,
    async flushSave() {
      checkDocumentDirectory(directory);
      if (!findNode(nodeId)) throw new Error("节点已删除，请刷新文件树");
      await flushCanvasSave();
    },
  };
}

async function mountDocumentNode(directory: string, canvasPath: string, nodeId: string, target: HTMLElement) {
  checkDocumentDirectory(directory);
  if (canvasId.value !== canvasPath) throw new Error("画布已切换，请重新打开节点");
  await nextTick();
  checkDocumentDirectory(directory);
  const node = findNode(nodeId);
  if (!node) throw new Error("节点已删除，请刷新文件树");
  if (nodeErrors.value[node.type]) throw new Error(nodeErrors.value[node.type]);
  const mount = nodeDocument.mounts.get(nodeId);
  if (!mount) throw new Error("当前节点未提供文档视图，请确认节点正常加载并更新节点插件");
  const release = mount(target);
  try {
    await nextTick();
    checkDocumentDirectory(directory);
    if (!target.isConnected || !target.querySelector(".documentNode")) throw new Error("节点文档视图加载失败，请重新打开节点");
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

function documentHandles(node: Node<DocumentNodeData>) {
  const handles = node.data?.handles;
  if (Array.isArray(handles) && handles.length) {
    return handles.filter(
      (handle) =>
        handle &&
        typeof handle.id === "string" &&
        handle.type === "source" &&
        (Array.isArray(handle.dataType) ? handle.dataType.includes("STRING") : handle.dataType === "STRING")
    );
  }
  return Object.entries(node.data?.outputs ?? {}).flatMap(([id, output]) => (output?.dataType === "STRING" ? [{ id, label: id }] : []));
}

async function readDocumentCanvas(directory: string, canvasPath: string, nodeId: string) {
  checkDocumentDirectory(directory);
  const files = useWorkspaceFiles(directory);
  const canvas = await files.readJson<{ lumCanvas?: boolean; toonflowCanvas?: boolean; nodes?: Node<DocumentNodeData>[] }>(canvasPath);
  checkDocumentDirectory(directory);
  if ((canvas?.lumCanvas !== true && canvas?.toonflowCanvas !== true) || !Array.isArray(canvas.nodes)) throw new Error("文件不是有效画布");
  const node = canvas.nodes.find((item) => item && item.id === nodeId);
  if (!node) throw new Error("节点已删除，请刷新文件树");
  if (node.data !== undefined && (!node.data || typeof node.data !== "object" || Array.isArray(node.data))) throw new Error("节点数据无效");
  const liveNode = canvasId.value === canvasPath ? findNode(nodeId) : undefined;
  if (canvasId.value === canvasPath && !liveNode) throw new Error("节点已删除，请刷新文件树");
  const textPath = node.data?.textPath;
  if (
    textPath !== undefined &&
    (typeof textPath !== "string" ||
      !textPath.trim() ||
      /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(textPath) ||
      textPath.includes("\0") ||
      textPath.split(/[\\/]/).includes(".."))
  )
    throw new Error("文本文件路径必须位于工作区内");
  return { files, canvas, node, liveNode, textPath };
}

async function readDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  checkDocumentDirectory(directory);
  await flushCanvasSave();
  const { files, node, liveNode, textPath } = await readDocumentCanvas(directory, canvasPath, nodeId);
  const source = liveNode ?? node;
  const handles = documentHandles(source);
  const storedText = textPath === undefined ? undefined : await files.readText(textPath);
  checkDocumentDirectory(directory);
  return {
    label: typeof source.data?.label === "string" ? source.data.label : nodeId,
    outputs: handles.map((handle) => {
      const output = source.data?.outputs?.[handle.id];
      return {
        id: handle.id,
        label: handle.label || handle.id,
        text: output?.dataType === "STRING" && typeof output.value === "string" ? output.value : storedText ?? "",
      };
    }),
  };
}

async function saveDocumentNode(directory: string, canvasPath: string, nodeId: string, handleId: string, text: string, expectedText?: string) {
  checkDocumentDirectory(directory);
  await flushCanvasSave(async () => {
    const { files, canvas, node, liveNode, textPath } = await readDocumentCanvas(directory, canvasPath, nodeId);
    if (!documentHandles(liveNode ?? node).some((handle) => handle.id === handleId)) throw new Error("文本输出已删除，请重新打开节点");
    if (expectedText !== undefined) {
      const output = (liveNode ?? node).data?.outputs?.[handleId];
      const currentText = output?.dataType === "STRING" && typeof output.value === "string" ? output.value : textPath === undefined ? "" : await files.readText(textPath);
      if (currentText !== expectedText) throw new Error("文档内容已变化，请重新读取后编辑");
    }
    if (liveNode?.type === "remote-textNode") {
      await getNodeTools().call({ nodeId, name: "node:setText", args: { text } }, canvasController.signal);
      checkDocumentDirectory(directory);
      // 节点工具已同步输出并排队保存；等待期间用户可能继续编辑，不能再写入旧文本快照。
      return;
    }
    if (liveNode && canvasId.value === canvasPath && findNode(nodeId) === liveNode) {
      const output = liveNode.data.outputs?.[handleId];
      if (output?.dataType === "STRING") output.value = text;
      else if (textPath === undefined) (liveNode.data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
    }
    canvasMenuRef.value?.syncDocumentNode(canvasPath, nodeId, handleId, text, textPath === undefined);
    if (textPath !== undefined) {
      await files.write(textPath, text);
    } else {
      const data = (node.data ??= {});
      const output = data.outputs?.[handleId];
      if (output?.dataType === "STRING") output.value = text;
      else (data.outputs ??= {})[handleId] = { dataType: "STRING", value: text };
      await files.writeJson(canvasPath, canvas);
    }
    checkDocumentDirectory(directory);
  });
}

function showEdgeDisconnect({ event, edge }: EdgeMouseEvent) {
  if (!(event instanceof MouseEvent)) return;
  event.stopPropagation();
  edgeDisconnect.value = { id: edge.id, x: event.clientX, y: event.clientY };
}

function dragFilesOver(event: DragEvent) {
  if (!props.active || props.settingsVisible || !canvasId.value || !project.value?.directory || !isCanvasFileDrag(event)) return;
  if (!(event.target instanceof Element) || !event.target.closest(".vue-flow__pane")) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = "copy";
  return true;
}

async function dropFiles(event: DragEvent) {
  const directory = project.value?.directory;
  if (!directory || !dragFilesOver(event)) return;
  try {
    await canvasHistory.batch(() => dropCanvasFiles(event, { directory, availableNodes: availableNodes.value, signal: canvasController.signal, flow }));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文件导入失败");
  }
}

function selectFiles(position: { x: number; y: number }) {
  const directory = project.value?.directory;
  if (!props.active || props.settingsVisible || !canvasId.value || !directory) return;
  const context = { directory, availableNodes: availableNodes.value, signal: canvasController.signal, flow };
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files ?? []);
    if (!files.length || context.signal.aborted) return;
    try {
      await canvasHistory.batch(async () => { await importCanvasFiles(files, position, context); });
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "文件导入失败");
    }
  };
  input.click();
}

function openNodeMenu(event: MouseEvent) {
  if (event.target instanceof Element && event.target.classList.contains("vue-flow__pane")) nodeMenuRef.value?.openMenu(event, true);
}

function createEmptyNode(type: string) {
  if (type === "scriptSetup") { openScriptSetup(); return; }
  if (!props.active || props.settingsVisible || !project.value?.directory || !canvasReady.value || flow.getNodes.value.length) return;
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const center = screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  void nodeMenuRef.value?.addNode(type, { x: center.x - 200, y: center.y - 160 });
}

// —— 剧本设定器：确认后先在画布放一个空剧本节点，再把设定交给 Agent ——
const scriptSetupVisible = ref(false);
function openScriptSetup() {
  if (!props.active || props.settingsVisible || !project.value?.directory || !canvasReady.value) return;
  if (!availableNodes.value.some(node => node.type === "remote-scriptNode")) { ElMessage.warning("请先在设置中启用「剧本」节点插件"); return; }
  scriptSetupVisible.value = true;
}
function createScriptFromSetup({ setup, value, extra }: { setup: Record<string, unknown>; value: Parameters<typeof setupTags>[0]; extra: string }) {
  if (!canvasReady.value) return;
  const rect = canvasElement.value?.getBoundingClientRect();
  const center = rect ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
  const taken = new Set(flow.getNodes.value.map(node => String(node.data?.label ?? "")));
  let index = 1;
  while (taken.has(`剧本 ${index}`)) index++;
  const label = `剧本 ${index}`;
  const id = crypto.randomUUID();
  let position = { x: center.x - 290, y: center.y - 160 };
  // 避开已有节点：向下找一块空位。
  for (const other of [...flow.getNodes.value].filter(node => !node.parentNode).sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
    const box = other.computedPosition;
    if (box.x < position.x + 600 && box.x + (other.dimensions.width || 320) > position.x && box.y < position.y + 360 && box.y + (other.dimensions.height || 300) > position.y) {
      position = { x: position.x, y: box.y + (other.dimensions.height || 300) + 60 };
    }
  }
  canvasHistory.commit();
  addNodes({ id, type: "remote-scriptNode", position, data: { label, initialTitle: label, initialSetup: setup } });
  const prompt = ["/skill:scriptWriting 基于我的设定，帮我写个剧本。", `目标剧本节点：「${label}」（节点 ID：${id}），请把大纲、人物、场景、道具和每一集都写进这个节点。`, "", "【设定】", ...setupTags(value), ...(extra ? [`补充：${extra}`] : [])].join("\n");
  window.dispatchEvent(new CustomEvent("lum:agentDraft", { detail: { prompt, submit: false } }));
}

function addNodeAtPointer() {
  if (!props.active || props.settingsVisible || !project.value?.directory || !canvasReady.value) return;
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const position = pointerPosition ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  void nodeMenuRef.value?.openMenu(new MouseEvent("contextmenu", { clientX: position.x, clientY: position.y }), true);
}

async function changeHistory(direction: "undo" | "redo") {
  try {
    await canvasHistory[direction]();
    edgeDisconnect.value = undefined;
  } catch (error) {
    ElMessage.error(
      axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data.message || "恢复画布失败"
        : error instanceof Error
        ? error.message
        : "恢复画布失败"
    );
  }
}

let saving = Promise.resolve();
let flushing = Promise.resolve();
let saveError: unknown;
let savePaused = false;
let saveCancelled = false;
let changedWhilePaused = false;
let saveRevision = 0;
const saveCanvas = debounce((directory: string, fileName: string) => {
  const flow = toObject();
  const revision = saveRevision;
  // ACT: 同页保存按顺序完成，防止慢请求覆盖后续修改；不处理多个客户端的并发编辑。
  saving = saving.then(async () => {
    try {
      await useWorkspaceFiles(directory).writeJson(fileName, { lumCanvas: true, nodes: flow.nodes, edges: flow.edges, viewport: flow.viewport });
      saveError = undefined;
      canvasSaveError.value = "";
      if (revision === saveRevision) canvasDirty.value = false;
    } catch (err) {
      saveError = err;
      canvasSaveError.value = axios.isAxiosError<{ message?: string }>(err) ? err.response?.data.message || err.message : err instanceof Error ? err.message : "画布保存失败";
      ElMessage.error(
        axios.isAxiosError<{ message?: string }>(err)
          ? err.response?.data.message || "画布保存失败"
          : err instanceof Error
          ? err.message
          : "画布保存失败"
      );
    }
  });
}, 500);

function scheduleCanvasSave() {
  if (saveCancelled) return;
  canvasDirty.value = true;
  saveRevision++;
  if (savePaused) {
    changedWhilePaused = true;
    return;
  }
  const directory = project.value?.directory;
  if (directory && canvasId.value) saveCanvas(directory, canvasId.value);
}

function scheduleCanvasChange() {
  scheduleCanvasSave();
  canvasHistory.record();
}

const elementSaveWatchers = new Map<Node | Edge, () => void>();
const nodeRuntimeFields = new Set([
  "data",
  "computedPosition",
  "handleBounds",
  "selected",
  "dimensions",
  "isParent",
  "resizing",
  "dragging",
  "events",
]);
const edgeRuntimeFields = new Set(["data", "selected", "sourceNode", "targetNode", "sourceX", "sourceY", "targetX", "targetY", "events"]);
// ACT: 仅增删、替换元素时扫描列表；位移与 data 各自监听，单个节点变化不遍历其余节点。
watch(
  () => [...flow.nodes.value, ...flow.edges.value],
  (elements) => {
    const current = new Set<Node | Edge>(elements);
    for (const [element, stop] of elementSaveWatchers) {
      if (!current.has(element)) {
        stop();
        elementSaveWatchers.delete(element);
      }
    }
    for (const element of elements) {
      if (elementSaveWatchers.has(element)) continue;
      // 与 toObject 排除的运行态字段保持一致，其他自定义持久字段仍参与自动保存。
      const runtimeFields = isNode(element) ? nodeRuntimeFields : edgeRuntimeFields;
      const stopFields = watch(
        () =>
          Object.keys(element)
            .filter((key) => !runtimeFields.has(key))
            .map((key) => Reflect.get(element, key)),
        scheduleCanvasChange,
        { deep: true, flush: "post" }
      );
      const stopData = watch(() => element.data, scheduleCanvasSave, { deep: true, flush: "post" });
      const stopName = isNode(element)
        ? watch(
            () => element.data?.label,
            () => canvasHistory.record(),
            { flush: "post" }
          )
        : () => {};
      let stopDimensions = () => {};
      if (isNode(element)) {
        const parents = computed(() => {
          const result: GraphNode[] = [];
          const visited = new Set([element.id]);
          let parent = findNode(element.parentNode);
          while (parent && !visited.has(parent.id)) {
            visited.add(parent.id);
            result.push(parent);
            parent = findNode(parent.parentNode);
          }
          return result;
        });
        let dimensionsChanged = false;
        stopDimensions = watch(
          [
            () => element.dimensions.width,
            () => element.dimensions.height,
            () => [element, ...parents.value].some(node => node.dragging || node.resizing),
          ],
          ([width, height, interacting], [previousWidth, previousHeight]) => {
            dimensionsChanged ||= width !== previousWidth || height !== previousHeight;
            if (!dimensionsChanged || interacting) return;
            dimensionsChanged = false;
            // ACT: 尺寸变化延后到拖动、缩放结束贴合，只调整祖先分组，不改变节点归属。
            const groups = new Set(parents.value.filter(node => node.type === "canvasGroup"));
            if (groups.size) fitGroupBounds(flow.getNodes.value, groups);
          },
          { flush: "post" },
        );
      }
      elementSaveWatchers.set(element, () => {
        stopFields();
        stopData();
        stopName();
        stopDimensions();
      });
    }
    scheduleCanvasChange();
  },
  { immediate: true, flush: "post" }
);
onScopeDispose(() => elementSaveWatchers.forEach((stop) => stop()));
watch(() => [viewport.value.x, viewport.value.y, viewport.value.zoom], scheduleCanvasSave, { flush: "post" });

watch(
  [() => project.value?.directory, canvasId],
  ([directory, fileName], [previousDirectory, previousFileName]) => {
    if (directory !== previousDirectory) {
      workspaceController.abort(new Error("工作区已切换，本轮画布操作已停止"));
      workspaceController = new AbortController();
    }
    edgeDisconnect.value = undefined;
    dragCopy = undefined;
    pointerPosition = undefined;
    resetCanvasKeys();
    // 同一实例只在重新装载画布时失效；重命名仅更新保存路径。
    if (directory !== previousDirectory || !fileName || !previousFileName) {
      canvasController.abort(new Error("画布已重新加载，本次画布调用已停止"));
      canvasController = new AbortController();
    }
    if (!savePaused) saveCanvas.flush();
  },
  { flush: "sync" }
);

// ACT: 切换显示面板不会卸载画布；仅清理交互，不中断本轮工具调用。
watch(() => props.active, (active) => {
  if (!active) assetsVisible.value = false;
  edgeDisconnect.value = undefined;
  dragCopy = undefined;
  pointerPosition = undefined;
  resetCanvasKeys();
}, { flush: "sync" });

function flushCanvasSave(action?: () => Promise<void>): Promise<void> {
  // ACT: 完整保存及其文件操作串行执行，重命名暂停期间的显式保存也必须等待。
  const next = flushing.then(() => saveCanvasState(action)).then(() => { canvasSaveError.value = ""; }, error => {
    canvasSaveError.value = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data.message || error.message : error instanceof Error ? error.message : "画布保存失败";
    throw error;
  });
  flushing = next.catch(() => {});
  return next;
}

async function saveCanvasState(action?: () => Promise<void>) {
  if (saveCancelled) throw new Error("画布保存已取消");
  await Promise.all(flow.getNodes.value.map((node) => useNodeEvent(node.id, flow).emit("save")));
  await nextTick();
  if (saveCancelled) throw new Error("画布保存已取消");
  if (saveError && project.value?.directory && canvasId.value) saveCanvas(project.value.directory, canvasId.value);
  if (action) savePaused = true;
  try {
    let revision: number;
    do {
      if (saveCancelled) throw new Error("画布保存已取消");
      revision = saveRevision;
      if (changedWhilePaused && project.value?.directory && canvasId.value) {
        saveCanvas(project.value.directory, canvasId.value);
        changedWhilePaused = false;
      }
      saveCanvas.flush();
      await saving;
      if (saveError) throw saveError;
      // 画布写入期间节点可能完成生成，等新增落盘后重新保存变化。
      await Promise.all(flow.getNodes.value.map((node) => useNodeEvent(node.id, flow).emit("save")));
      await nextTick();
    } while (revision !== saveRevision);
    if (saveCancelled) throw new Error("画布保存已取消");
    await action?.();
  } finally {
    if (action && !saveCancelled) {
      savePaused = false;
      if (changedWhilePaused && project.value?.directory && canvasId.value) saveCanvas(project.value.directory, canvasId.value);
      changedWhilePaused = false;
    }
  }
}

function cancelCanvasSave() {
  saveCancelled = true;
  savePaused = true;
  changedWhilePaused = false;
  saveCanvas.cancel();
}
function canUseCanvasClipboard(event: Event) {
  const target = event.target;
  return props.active && !event.defaultPrevented && !props.settingsVisible && !!canvasId.value && !!project.value?.directory
    && target instanceof Element
    && !target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider'], [role='dialog'], #agentPanel")
    && (target === document.body || target === document.documentElement || canvasElement.value?.contains(target));
}

function beforeClipboard(event: Event) {
  if (!canUseCanvasClipboard(event)) return;
  if (event.type === "beforecopy" && (!flow.getSelectedNodes.value.length || window.getSelection()?.toString())) return;
  // ACT: WKWebView 通过 beforecopy/beforepaste 判定非输入区能否使用原生编辑菜单。
  event.preventDefault();
}

function copyNode(event: ClipboardEvent) {
  if (!canUseCanvasClipboard(event) || !flow.getSelectedNodes.value.length || window.getSelection()?.toString()) return;
  event.preventDefault();
  void copySelectedNodes();
}

function imageOutput(data: { outputs?: Record<string, NodeOutput | undefined> } | undefined) {
  for (const output of Object.values(data?.outputs ?? {})) {
    if (output?.dataType !== "IMAGE" || !output.value || typeof output.value !== "object") continue;
    if (typeof output.value.url === "string" && output.value.url) return output.value;
  }
}

async function copyImageNodeToClipboard(directory: string, node: Parameters<typeof copyNodeToClipboard>[0]) {
  const output = imageOutput(node.data);
  if (!output) return false;
  const content = await useWorkspaceFiles(directory).read(output.url);
  await writeClipboardImage(new Blob([content], { type: output.mimeType || "image/png" }));
  return true;
}

async function copySelectedNodes() {
  if (copyingNodes || !project.value?.directory) return;
  const nodes = getSelectionTree(flow.getSelectedNodes.value, flow.getNodes.value);
  if (!nodes.length) return;
  const directory = project.value.directory;
  const signal = canvasController.signal;
  copyingNodes = true;
  try {
    if (nodes.length === 1 && await copyImageNodeToClipboard(directory, { data: nodes[0]!.data ?? {} })) {
      ElMessage.success("已复制图片");
      return;
    }
    const ids = new Set(nodes.map(node => node.id));
    const snapshot = toObject();
    const savedNodes = new Map(snapshot.nodes.map(node => [node.id, node]));
    const copies = await Promise.all(nodes.map(async node => {
      const patch = await useNodeEvent(node.id, flow).emit("copy");
      const saved = savedNodes.get(node.id)!;
      const parentNode = ids.has(saved.parentNode ?? "") ? saved.parentNode : undefined;
      return { ...saved, data: { ...saved.data, ...patch }, parentNode,
        ...(saved.parentNode && !parentNode ? { extent: undefined, expandParent: false } : {}),
        position: parentNode ? { ...saved.position } : { x: node.computedPosition.x, y: node.computedPosition.y } };
    }));
    signal.throwIfAborted();
    if (nodes.some(node => findNode(node.id) !== node)) throw new Error("节点已变化，请重新复制");
    const edges = snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    await copyNodesToClipboard(copies, edges, directory);
  } catch (error) {
    if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "节点复制失败");
  } finally {
    copyingNodes = false;
  }
}

async function pasteNode(event: ClipboardEvent) {
  if (!canUseCanvasClipboard(event)) return;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (nodeClipboardCommand.test(text)) {
    event.preventDefault();
    await pasteNodeAtCenter(text);
    return;
  }
  const canvasSignal = canvasController.signal;
  let files = getClipboardMediaFiles(event);
  if (files.length || text.trim()) event.preventDefault();
  // ACT: 部分 WebView 不向 paste 事件暴露剪贴板文件，桌面端回退到原生剪贴板读取。
  if (!files.length && actualPlatform.isDesktop) files = await readClipboardFiles().catch(() => []);
  if (canvasSignal.aborted) return;
  if (!files.length && text.trim()) files = [new File([text], "粘贴文本.txt", { type: "text/plain" })];
  if (!files.length) return;
  event.preventDefault();
  const position = pastePosition();
  if (position) await importCanvasContent(files, position);
}

function pastePosition() {
  const rect = canvasElement.value?.getBoundingClientRect();
  if (!rect) return;
  const point = pointerPosition && pointerPosition.x >= rect.left && pointerPosition.x <= rect.right && pointerPosition.y >= rect.top && pointerPosition.y <= rect.bottom
    ? pointerPosition
    : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return screenToFlowCoordinate(point);
}

async function pasteNodeAtCenter(command?: string) {
  const position = pastePosition();
  if (position) await pasteClipboardNode(position, command);
}

async function importCanvasContent(files: File[], position: { x: number; y: number }) {
  const directory = project.value?.directory;
  if (!directory) return false;
  const canvasSignal = canvasController.signal;
  try {
    await canvasHistory.batch(async () => { await importCanvasFiles(files, position, { directory, availableNodes: availableNodes.value, signal: canvasSignal, flow }); });
    return true;
  } catch (error) {
    if (!canvasSignal.aborted) ElMessage.error(error instanceof Error ? error.message : "剪贴板内容导入失败");
    return false;
  }
}

async function pasteClipboardNode(position: { x: number; y: number }, command?: string) {
  if (!props.active || !canvasId.value || !project.value?.directory) return false;
  const canvasSignal = canvasController.signal;
  try {
    const directory = project.value.directory;
    const text = command ?? (await readClipboardText());
    const snapshot = await readClipboardNodes(text, directory);
    if (canvasSignal.aborted) return false;
    if (snapshot) {
      if (snapshot.nodes.some(node => node.type !== "canvasGroup" && !availableNodes.value.some(item => item.type === node.type))) {
        throw new Error("请先安装并启用对应的节点插件");
      }
      const ids = new Map(snapshot.nodes.map(node => [node.id, crypto.randomUUID()]));
      for (const node of snapshot.nodes) remapNodeReferences(node, ids);
      const roots = snapshot.nodes.filter(node => !node.parentNode);
      const left = Math.min(...roots.map(node => node.position.x));
      const top = Math.min(...roots.map(node => node.position.y));
      await canvasHistory.batch(async () => {
        flow.removeSelectedElements();
        addNodes(snapshot.nodes.map(node => ({ ...node, id: ids.get(node.id)!, parentNode: ids.get(node.parentNode ?? ""), selected: true,
          position: node.parentNode ? node.position : { x: position.x + node.position.x - left, y: position.y + node.position.y - top } })));
        await nextTick();
        if (canvasSignal.aborted) return;
        addEdges(snapshot.edges.map(edge => ({ ...edge, id: crypto.randomUUID(), source: ids.get(edge.source)!, target: ids.get(edge.target)! })));
      });
      return true;
    }
    const files = await readClipboardFiles().catch((error): File[] => {
      if (text.trim()) return [];
      throw error;
    });
    if (canvasSignal.aborted) return false;
    if (!files.length && text.trim()) files.push(new File([text], "粘贴文本.txt", { type: "text/plain" }));
    if (!files.length) throw new Error("剪贴板中没有可粘贴的节点、文本、图片、视频或音频");
    return await importCanvasContent(files, position);
  } catch (error) {
    const pasteShortcut = generalSettings.value.canvasShortcuts.paste;
    const clipboardMessage = getShortcutBindings(pasteShortcut).some(binding => /^(Ctrl|Meta)\+KeyV$/.test(binding))
      ? t`无法读取剪贴板，请在画布上按 ${shortcutLabel(pasteShortcut)} 粘贴`
      : translate("无法读取剪贴板，请允许浏览器访问剪贴板");
    if (!canvasSignal.aborted)
      ElMessage.error(
        error instanceof DOMException && error.name === "NotAllowedError" ? clipboardMessage : error instanceof Error ? error.message : "剪贴板内容粘贴失败"
      );
    return false;
  }
}
function zoomCanvas(event: WheelEvent | (Event & { scale: number })) {
  if (event.type === "gestureend") gestureScale = undefined;
  if (!props.active || props.settingsVisible || document.fullscreenElement || flow.userSelectionActive.value) return;
  if (!(event.target instanceof Element) || !event.target.closest(".vue-flow__pane, .vue-flow__node, .vue-flow__edge, .vue-flow__nodesselection")) return;
  let factor: number;
  let point = pointerPosition;
  if ("scale" in event) {
    if (!Number.isFinite(event.scale) || event.scale <= 0) return;
    factor = event.type === "gesturechange" && gestureScale !== undefined ? event.scale / gestureScale : 1;
    gestureScale = event.type === "gestureend" ? undefined : event.scale;
  } else {
    // ACT: Chromium 捏合发送 Ctrl+wheel，但不发送 Control 按键；WebKit 使用上方原生 gesture 事件。
    const pinching = event.ctrlKey && !pressedCodes.has("ControlLeft") && !pressedCodes.has("ControlRight");
    // 无需按键的滚轮缩放让节点控件保留自己的滚动；显式缩放快捷键及捏合仍沿用原行为。
    if (defaultWheelZoom.value && !pinching && !zoomKeyPressed.value
      && event.target.closest(".nowheel, input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='slider']")) return;
    if (!pinching && !shortcutPressed(event, generalSettings.value.canvasShortcuts.zoom, pressedCodes)) {
      if (!event.ctrlKey) return;
      // 实体 Ctrl 未绑定缩放时，阻止 Vue Flow 和节点骨架将它误判为捏合。
      factor = 1;
    } else if (pinching && gestureScale !== undefined) {
      factor = 1;
    } else if (pinching) {
      factor = 2 ** (-event.deltaY * 0.02);
    } else {
      // ACT: 捏合已单独处理；实体滚轮只按 deltaMode 换算，避免 Vue Flow 基于 UA 的额外倍率。
      const delta = -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002);
      factor = 2 ** delta;
    }
    point = { x: event.clientX, y: event.clientY };
  }
  const zoom = flow.d3Zoom.value;
  const selection = flow.d3Selection.value;
  if (!zoom || !selection) return;
  event.preventDefault();
  event.stopPropagation();
  if (factor === 1) return;
  const bounds = selection.node()?.getBoundingClientRect();
  if (!bounds) return;
  point ??= { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  selection.call<[number, [number, number], Event]>(zoom.scaleBy, factor, [point.x - bounds.left, point.y - bounds.top], event);
}

function preventMiddleClick(event: MouseEvent) {
  if (event.button === 1) event.preventDefault();
}

function updateCanvasSelection(event: MouseEvent | KeyboardEvent) {
  // 失焦期间可能漏掉修饰键；不能在按下到抬起之间改变已命中的选区，避免 click 落到画布清空选择。
  if (event.type === "pointerdown" && event.target instanceof Element && event.target.closest(".vue-flow__nodesselection-rect")) return;
  flow.multiSelectionActive.value = props.active && !props.settingsVisible && !handMode.value
    && shortcutPressed(event, generalSettings.value.canvasShortcuts.multiSelection, pressedCodes);
}

function updateCanvasKeys(event: KeyboardEvent) {
  if (event.type === "keydown") {
    pressedCodes.add(event.code);
  } else pressedCodes.delete(event.code);
  if (!props.active || props.settingsVisible) return resetCanvasKeys();
  const target = event.target;
  const shortcuts = generalSettings.value.canvasShortcuts;
  const inCanvas =
    target instanceof Element &&
    !target.closest("[role='dialog'], #agentPanel") &&
    (target === document.body || target === document.documentElement || canvasElement.value?.contains(target));
  // None 只配置默认鼠标手势，不能触发会禁用节点交互的临时抓手或节点内部缩放。
  zoomKeyPressed.value = !event.isComposing && shortcutPressed(event, getShortcutBindings(shortcuts.zoom).filter(binding => binding !== "None").join(" / "), pressedCodes);
  selectionKeyPressed.value = !event.isComposing && shortcutPressed(event, shortcuts.selection, pressedCodes);
  if (!selectionKeyPressed.value && !flow.userSelectionActive.value) flow.userSelectionRect.value = null;
  const editing =
    !(target instanceof Element) ||
    !!target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider']");
  panKeyPressed.value = !!inCanvas && !editing && !event.isComposing
    && shortcutPressed(event, getShortcutBindings(shortcuts.pan).filter(binding => binding !== "None").join(" / "), pressedCodes);
  updateCanvasSelection(event);
  if (event.type === "keyup" || event.defaultPrevented || event.isComposing || !inCanvas || editing) return;
  const action = ([
    "group", "mergeGroup", "ungroup", "addNode", "moveTool", "handTool", "arrange", "search",
    "delete", "copy", "paste", "undo", "redo", "zoomIn", "zoomOut", "fitView",
  ] as const).find((action) =>
    shortcutMatches(event, shortcuts[action])
  );
  if (!action) {
    const nativeClipboardKey = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      && (event.code === "KeyV" || event.code === "KeyC" && flow.getSelectedNodes.value.length && !window.getSelection()?.toString());
    if (panKeyPressed.value || nativeClipboardKey) event.preventDefault();
    return;
  }
  if (!canvasId.value || !project.value?.directory) return;
  if (action === "copy" && (!flow.getSelectedNodes.value.length || window.getSelection()?.toString())) return;
  // 桌面快捷键直接复用原生剪贴板桥接；浏览器 Ctrl/Cmd+V 保留原生事件，避免额外读取权限。
  if (!actualPlatform.isDesktop && action === "paste" && event.code === "KeyV" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) return;
  event.preventDefault();
  if (event.repeat) return;
  if (action === "delete") {
    const nodes = [...flow.getSelectedNodes.value];
    const menu = nodeMenuRef.value;
    if (!menu || !nodes.some((node) => node.deletable !== false)) return;
    void canvasHistory
      .batch(() => menu.deleteSelection(nodes))
      .catch((error) => {
        ElMessage.error(error instanceof Error ? error.message : "节点删除失败");
      });
    return;
  }
  if (action === "copy") void copySelectedNodes();
  else if (action === "paste") void pasteNodeAtCenter();
  else if (action === "undo" || action === "redo") void changeHistory(action);
  else if (action === "group" || action === "mergeGroup" || action === "ungroup") {
    void selectionToolbarRef.value?.operate(action);
  } else if (action === "addNode") addNodeAtPointer();
  else if (action === "moveTool" || action === "handTool") selectedTool.value = action === "handTool" ? "hand" : "move";
  else if (action === "arrange") void canvasControlsRef.value?.arrangeNodes();
  else if (action === "search") nodeSearchRef.value?.open();
  else void flow[action]();
}

function resetCanvasKeys() {
  pressedCodes.clear();
  gestureScale = undefined;
  zoomKeyPressed.value = false;
  panKeyPressed.value = false;
  selectionKeyPressed.value = getShortcutBindings(generalSettings.value.canvasShortcuts.selection).includes("None");
  flow.multiSelectionActive.value = false;
  if (!flow.userSelectionActive.value) flow.userSelectionRect.value = null;
}

watch([() => props.active, () => props.settingsVisible, () => generalSettings.value.canvasShortcuts], resetCanvasKeys, { deep: true, flush: "sync", immediate: true });

function refreshInstalled(event: WindowEventMap["lum:plugin-installed"]) {
  if (event.detail.type === "node") void loadRemoteNodes(event.detail.name);
}

const refreshNodeConfig = () => { void loadRemoteNodes(); };

onMounted(() => {
  // 在捕获阶段同步修饰键，避免节点编辑器截断 keydown/keyup 后缩放状态丢失或卡住。
  window.addEventListener("keydown", updateCanvasKeys, true);
  window.addEventListener("keyup", updateCanvasKeys, true);
  window.addEventListener("blur", resetCanvasKeys);
  window.addEventListener("lum:plugin-installed", refreshInstalled);
  window.addEventListener("lum:node-config-updated", refreshNodeConfig);
  document.addEventListener("paste", pasteNode);
  document.addEventListener("copy", copyNode);
  document.addEventListener("beforecopy", beforeClipboard);
  document.addEventListener("beforepaste", beforeClipboard);
  void loadRemoteNodes();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", updateCanvasKeys, true);
  window.removeEventListener("keyup", updateCanvasKeys, true);
  window.removeEventListener("blur", resetCanvasKeys);
  window.removeEventListener("lum:plugin-installed", refreshInstalled);
  window.removeEventListener("lum:node-config-updated", refreshNodeConfig);
  document.removeEventListener("paste", pasteNode);
  document.removeEventListener("copy", copyNode);
  document.removeEventListener("beforecopy", beforeClipboard);
  document.removeEventListener("beforepaste", beforeClipboard);
  workspaceController.abort(new Error("工作区已关闭"));
  canvasController.abort(new Error("画布已关闭"));
  saveCanvas.flush();
  loadRequest++;
});

const nodeWindow = window as typeof window & {
  lumNodeHost?: { vue: typeof vueRuntime; vueFlow: typeof vueFlowRuntime; elementPlus: typeof elementPlusRuntime; three: typeof threeRuntime; modelIcons: typeof modelIcons; ai: { runAgentLoop: typeof runAgentLoop; createAssistantMessageEventStream: typeof createAssistantMessageEventStream } };
  lumNodes?: NodeTypesObject;
  toonflowNodes?: NodeTypesObject;
};
nodeWindow.lumNodeHost = { vue: vueRuntime, vueFlow: vueFlowRuntime, elementPlus: elementPlusRuntime, three: threeRuntime, modelIcons, ai: { runAgentLoop, createAssistantMessageEventStream } };
const nodeRegistry = nodeWindow.lumNodes ?? nodeWindow.toonflowNodes ?? {};
Object.assign(nodeWindow, { toonflowNodeHost: nodeWindow.lumNodeHost, lumNodes: nodeRegistry, toonflowNodes: nodeRegistry });
provide("nodeConfig", (nodeType: string) => nodeConfigs.value[nodeType] ?? {});
provide("workspaceFiles", () => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  return useWorkspaceFiles(directory);
});
provide("workspaceDirectory", () => {
  const directory = project.value?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  return directory;
});
provide("reloadRemoteNode", (type: string) => {
  const name = type.replace(/^remote-/, "");
  if (!type.startsWith("remote-") || !/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error("节点类型无效");
  return loadNode(name, `/api/nodes/files?name=${name}`, true);
});

async function loadNode(name: string, url: string, force = false): Promise<void> {
  const nodeType = `remote-${name}`;
  const signal = canvasController.signal;
  const pending = nodeLoads.get(nodeType);
  if (pending) {
    if (!force) return pending;
    await pending.catch(() => {});
  }
  if (!force && nodeTypes.value[nodeType] && !nodeErrors.value[nodeType]) return;
  if (force) {
    signal.throwIfAborted();
    // ACT: 复用画布修订号收敛等待期间的编辑；持续修改画布时延后刷新，不额外维护节点修订状态。
    let revision: number;
    do {
      revision = saveRevision;
      await Promise.all(flow.getNodes.value.filter(node => node.type === nodeType).map(node => useNodeEvent(node.id, flow).emit("save", "reload")));
      await nextTick();
      signal.throwIfAborted();
    } while (revision !== saveRevision);
    const loading = nodeLoads.get(nodeType);
    if (loading) return loading;
  }
  delete nodeErrors.value[nodeType];
  const nodeLoad = loadNodeComponent(name, url, force)
    .then((remoteNode) => {
      // 同类型节点共享组件，运行错误由每个节点自己的边界显示。
      nodeTypes.value = { ...nodeTypes.value, [nodeType]: markRaw(remoteNode) };
    })
    .catch((error) => {
      nodeErrors.value[nodeType] = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => nodeLoads.delete(nodeType));
  nodeLoads.set(nodeType, nodeLoad);
  return nodeLoad;
}

async function loadRemoteNodes(reloadName?: string) {
  if (reloadName) nodeReloads.add(reloadName);
  const requestId = ++loadRequest;
  const signal = canvasController.signal;
  nodeListLoading.value = true;
  try {
    const { data } = await axios.get<{ code: number; data: { name: string; displayName: string; url: string; enabled?: boolean; config?: Record<string, unknown> }[] }>(
      "/api/nodes/get",
      { headers: { "Cache-Control": "no-cache", "x-lum-workspace": "1" } }
    );
    if (requestId !== loadRequest) return;
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error("节点列表格式错误");
    const nodes = data.data.filter(node => {
      if (!node || typeof node.name !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(node.name) || node.url !== `/api/nodes/files?name=${node.name}`) {
        console.error("节点地址无效", node);
        return false;
      }
      return true;
    });
    nodeConfigs.value = Object.fromEntries(nodes.map(node => [`remote-${node.name}`, node.config ?? {}]));
    const enabledNodes = nodes.filter(node => node.enabled !== false);
    // 节点各自加载完成后即可出现在菜单中，不等待其他节点的脚本。
    nodeOptions.value = enabledNodes.map(node => ({ type: `remote-${node.name}`, label: node.displayName }))
      .sort((left, right) => left.type.localeCompare(right.type));
    // ACT: 安装事件合并到最新列表请求，避免连续更新不同节点时丢失较早的刷新名称。
    const reloadNames = new Set(nodeReloads);
    nodeReloads.clear();
    await Promise.all(
      enabledNodes.map(async (node) => {
        const nodeType = `remote-${node.name}`;
        try {
          if (nodeTypes.value[nodeType] && !nodeErrors.value[nodeType] && !reloadNames.has(node.name)) return;
          await loadNode(node.name, node.url, reloadNames.has(node.name));
        } catch (error) {
          console.error("加载远端节点失败", node, error);
          // 保存拒绝时旧组件仍可用，不从节点菜单中移除；脚本加载错误仍排除。
          if (nodeTypes.value[nodeType] && !nodeErrors.value[nodeType]) {
            if (reloadNames.has(node.name) && !signal.aborted) ElMessage.warning({
              message: `${node.displayName}已安装，但当前节点无法刷新。请等待任务结束后，点击节点右上角的刷新按钮。`,
              grouping: true,
            });
          }
        }
      })
    );
  } catch (error) {
    if (requestId === loadRequest) console.error("获取远端节点列表失败", error);
  } finally {
    if (requestId === loadRequest) nodeListLoading.value = false;
  }
}

const defaultEdgeOptions = markRaw({
  type: "simplebezier",
  animated: false,
  class: ({ sourceNode, targetNode }: GraphEdge) => {
    if (!sourceNode.selected && !sourceNode.dragging && !targetNode.selected && !targetNode.dragging) return "";
    return ["edgeNodeActive", generalSettings.value.canvasEdgeColorMode !== "none" && "edgeActive", generalSettings.value.canvasEdgeAnimationEnabled && "animated"].filter(Boolean).join(" ");
  },
  focusable: false,
  selectable: false,
  updatable: false,
  interactionWidth: 40,
});
</script>

<style lang="scss" scoped>
:global(.referenceAssetDialog) {
  display: flex;
  flex-direction: column;
  height: 80dvh;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
}

:global(.referenceAssetDialog .el-dialog__body) {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.canvas {
  --assetSidebarWidth: 340px;
  width: 100%;
  height: 100%;

  &.canvasUnselected :deep(.vue-flow__viewport) {
    visibility: hidden;
    pointer-events: none;
  }

  .canvasOverlay {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--el-bg-color);
    color: var(--el-text-color-secondary);
    font-size: 14px;
    line-height: 1.6;
    text-align: center;
    cursor: default;
  }

  &.compositingEnabled :deep(.vue-flow__transformationpane) {
    will-change: transform;
  }

  &.handMode :deep(.vue-flow__transformationpane),
  &.handMode :deep(.vue-flow__transformationpane *) {
    pointer-events: none !important;
  }

  &.handMode :deep(.vue-flow__pane) {
    cursor: grab;
  }

  &.edgesHidden :deep(.vue-flow__edges:not(:has(.edgeNodeActive))) {
    display: none;
  }
  &.edgesHidden :deep(.vue-flow__handle:not(.connectedNodeActive)) {
    // Vue Flow 仍会测量隐藏端口，必须保留布局以免零尺寸污染连线坐标。
    visibility: hidden !important;
  }

  :deep(.vue-flow__edge.edgeActive .vue-flow__edge-path) {
    stroke: var(--canvasEdgeColor);
  }

  &:has(.selectionConnection) :deep(.vue-flow__node:not(.selected) .nodeHandle.target .handleIcon) {
    opacity: 1;
  }

  :deep(.vue-flow__nodesselection-rect) {
    box-sizing: content-box;
    padding: 8px;
    margin: -8px;
    border-radius: 4px;
  }

  &.multiSelectionMode :deep(.vue-flow__nodesselection-rect) {
    pointer-events: none;
  }
}
.edgeDisconnect {
  position: fixed;
  z-index: 1000;
  width: 32px;
  height: 32px;
  padding: 0;
  transform: translate(-50%, -50%);
}
</style>
