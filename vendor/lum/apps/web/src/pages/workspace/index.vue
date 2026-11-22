<template>
  <main class="workspacePage" :inert="workspaceStore.projectLoadingVisible" :style="{ '--agentWidth': `${agentVisible ? agentWidth : 0}px` }">
    <canvasPanel
      :key="workspaceStore.project?.directory"
      v-model:selectedTool="selectedTool"
      ref="canvasPanelRef"
      class="canvasPanel"
      :class="{ backgroundPanel: activePanel !== 'canvas' }"
      :inert="activePanel !== 'canvas'"
      :aria-hidden="activePanel !== 'canvas'"
      :active="activePanel === 'canvas' || activePanel === 'virtualStage'"
      :settingsVisible="settingsVisible" />
    <virtualStage v-if="activePanel === 'virtualStage'" :key="workspaceStore.project?.directory" :list="getVirtualStages" :open="openVirtualStage" />
    <keep-alive :key="workspaceStore.project?.directory" :max="1">
      <documentPanel
        v-if="activePanel === 'document'"
        :key="workspaceStore.project?.directory"
        :ref="setDocumentPanel"
        :readNode="readDocumentNode"
        :readNodes="readDocumentNodes"
        :focusNode="focusDocumentNode"
        :mountNode="mountDocumentNode"
        :resolveNodeFile="resolveDocumentNodeFile"
        :observeNode="observeDocumentNode"
        :flushNodes="flushDocumentNodes"
        :fileAction="performFileAction"
        :saveNode="saveDocumentNode" />
    </keep-alive>
    <workspaceMenu class="workspaceMenu" @openSettings="settingsVisible = true" />
    <div class="workspaceTools">
      <el-segmented :modelValue="activePanel" class="panelSwitcher" :options="panelOptions" size="small" aria-label="切换面板" @change="switchPanel">
        <template #default="{ item }">
          <span class="panelOption">
            <component :is="item.icon" :size="15" aria-hidden="true" />
            {{ item.label }}
          </span>
        </template>
      </el-segmented>
      <div class="bottomTools">
        <el-card v-if="activePanel === 'canvas'" class="toolMenu" shadow="never" :bodyStyle="{ padding: '2px 4px' }">
          <div class="toolMenuContent" role="toolbar" aria-label="画布工具">
            <el-tooltip content="添加节点" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton addNodeButton" :disabled="!canvasPanelRef?.canvasReady || settingsVisible" aria-label="添加节点" aria-haspopup="menu" @click="canvasPanelRef?.addNodeAtPointer()">
                <icon-plus :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip content="剧本设定器" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton" text :disabled="!canvasPanelRef?.canvasReady || settingsVisible" aria-label="剧本设定器" @click="canvasPanelRef?.openScriptSetup()">
                <icon-script :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :content="selectedTool === 'move' ? '移动工具，点击切换为抓手' : '抓手工具，点击切换为移动'" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button
                class="toolButton"
                text
                :type="selectedTool === 'hand' ? 'primary' : 'default'"
                :aria-pressed="selectedTool === 'hand'"
                aria-label="切换抓手/移动工具"
                @click="selectedTool = selectedTool === 'move' ? 'hand' : 'move'">
                <component :is="selectedTool === 'move' ? IconPointer : IconHandStop" :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip content="搜索节点" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton" text :disabled="!canvasPanelRef?.canvasReady || settingsVisible" aria-label="搜索节点" @click="canvasPanelRef?.openNodeSearch()">
                <icon-search :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :showArrow="false" content="帮助" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]" :disabled="helpVisible">
              <span class="toolTrigger">
                <el-popover v-model:visible="helpVisible" trigger="click" placement="top-end" :width="196">
                  <template #reference>
                    <el-button class="toolButton" text aria-label="帮助">
                      <icon-help :size="18" />
                    </el-button>
                  </template>
                  <div class="helpMenu">
                    <el-button
                      class="helpAction"
                      tag="a"
                      text
                      :icon="IconBook"
                      :href="userGuideUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      @click="helpVisible = false">
                      使用教程
                    </el-button>
                    <el-button v-for="(contact, type) in contacts" :key="type" class="helpAction" text
                      :icon="contact.icon" :tag="wechatContactUrl ? 'button' : 'a'"
                      :href="wechatContactUrl ? undefined : contactPage(type)" :target="wechatContactUrl ? undefined : '_blank'"
                      rel="noopener noreferrer" @click="showContact(type)">{{ contact.title }}</el-button>
                  </div>
                </el-popover>
              </span>
            </el-tooltip>
          </div>
        </el-card>
        <el-tooltip v-if="!agentVisible" content="Lum Agent" placement="top" :showArrow="false" :hideAfter="0">
          <el-button
            ref="agentLauncher"
            class="agentButton"
            :class="{ standalone: activePanel !== 'canvas', dragging: agentDragging }"
            :style="{ translate: `${agentOffset.x}px ${agentOffset.y}px` }"
            :aria-expanded="agentVisible"
            aria-label="Lum Agent"
            aria-controls="agentPanel"
            @pointerdown.stop="startAgentDrag"
            @pointermove.stop="moveAgentDrag"
            @pointerup.stop="finishAgentDrag"
            @pointercancel.stop="cancelAgentDrag"
            @lostpointercapture="cancelAgentDrag"
            @dragstart.prevent
            @click.stop="openAgent"></el-button>
        </el-tooltip>
      </div>
    </div>
    <floatingAgent v-model="agentVisible" :inert="workspaceStore.projectLoadingVisible" @resize="agentWidth = $event" />
    <settings v-model="settingsVisible" />
    <el-dialog v-model="contactVisible" :title="contactInfo.title" width="min(360px, calc(100vw - 32px))" alignCenter appendToBody>
      <div class="contactContent">
        <img v-if="wechatContactUrl" class="contactQr" :src="wechatContactUrl" :alt="`${contactInfo.title}微信二维码`" width="224" height="224" />
        <p v-if="wechatContactUrl" class="contactTip">{{ contactInfo.tip }}</p>
        <a :href="contactPage(contactType)" target="_blank" rel="noopener noreferrer">查看{{ contactInfo.title }}说明</a>
      </div>
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { translate } from "@lum/i18n/vue";
import { computed, defineAsyncComponent, nextTick, onMounted, onScopeDispose, provide, ref, shallowRef, watch, type ComponentPublicInstance } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import axios from "axios";
import http from "@/lib/http";
import { embeddedProjectId } from "@/lib/embeddedProject";
import { IconScript, IconVector, IconFileText, IconMovie, IconPointer, IconHandStop, IconPlus, IconSearch, IconHelp, IconBook, IconBug, IconBrandWechat, IconBriefcase } from "@tabler/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";

import settings from "@/components/settings/index.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { registerWorkspaceControl, waitForControlValue } from "@/lib/mcpControl";
import { useProviderBalances } from "@/lib/providerBilling";
import canvasPanel from "./panels/canvas/canvasHost.vue";
import type { DocumentNodeOptions } from "./panels/canvas/canvasFiles";
import workspaceMenu from "./components/workspaceMenu.vue";
import floatingAgent from "./components/floatingAgent.vue";
import virtualStage from "./panels/virtualStage.vue";

const documentPanel = defineAsyncComponent(() => import("./panels/document/index.vue"));

const activePanel = ref<"canvas" | "document" | "virtualStage">("canvas");
const selectedTool = ref<"move" | "hand">("move");
const sideButtonEvents = ["mousedown", "mouseup", "auxclick"] as const;
// 鼠标侧键会直接触发原生历史导航，需在 DOM 事件阶段拦截，避免生成中的工作区被误关闭。
function preventSideButtonNavigation(event: MouseEvent) {
  if (event.button === 3 || event.button === 4) event.preventDefault();
}
onMounted(() => {
  for (const eventName of sideButtonEvents) window.addEventListener(eventName, preventSideButtonNavigation, true);
});
onScopeDispose(() => {
  for (const eventName of sideButtonEvents) window.removeEventListener(eventName, preventSideButtonNavigation, true);
});
const workspaceStore = useWorkspaceStore();
useProviderBalances();
const panelOptions = [
  { label: "工作流", value: "canvas", icon: IconVector },
  { label: "故事板", value: "document", icon: IconFileText },
  { label: "虚拟片场", value: "virtualStage", icon: IconMovie },
];
const agentVisible = ref(true);
const agentWidth = ref(0);
const agentLauncher = shallowRef<ComponentPublicInstance>();
const agentOffset = ref({ x: 0, y: 0 });
const agentDragging = ref(false);
const agentPositionKey = "lum:agentLauncherOffset";
let suppressAgentClick = false;
let agentDrag: { pointerId: number; element: HTMLElement; x: number; y: number; left: number; top: number; width: number; height: number; offset: { x: number; y: number } } | undefined;
try {
  const saved = JSON.parse(localStorage.getItem(agentPositionKey) ?? localStorage.getItem("toonflow:agentLauncherOffset") ?? "null");
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) agentOffset.value = { x: saved.x, y: saved.y };
} catch { /* ACT: 浏览器禁用存储时，拖动位置仍在当前页面生效。 */ }

function keepAgentVisible(value: number, size: number, available: number) {
  const gap = Math.min(8, Math.max(0, available - size) / 2);
  return Math.max(gap, Math.min(value, available - size - gap));
}
function saveAgentOffset() {
  try { localStorage.setItem(agentPositionKey, JSON.stringify(agentOffset.value)); } catch { /* 位置记忆不可用不影响拖动与打开对话。 */ }
}
function clampAgentOffset() {
  const element = agentLauncher.value?.$el as HTMLElement | undefined;
  const rect = element?.getBoundingClientRect();
  if (!rect?.width || !rect.height || !window.innerWidth || !window.innerHeight) return;
  agentOffset.value = {
    x: agentOffset.value.x + keepAgentVisible(rect.left, rect.width, window.innerWidth) - rect.left,
    y: agentOffset.value.y + keepAgentVisible(rect.top, rect.height, window.innerHeight) - rect.top,
  };
}
function startAgentDrag(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || agentDrag) return;
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  suppressAgentClick = false;
  agentDrag = { pointerId: event.pointerId, element, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: element.offsetWidth, height: element.offsetHeight, offset: { ...agentOffset.value } };
  element.setPointerCapture(event.pointerId);
}
function moveAgentDrag(event: PointerEvent) {
  const drag = agentDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!agentDragging.value && Math.hypot(dx, dy) < 5) return;
  event.preventDefault();
  agentDragging.value = true;
  suppressAgentClick = true;
  agentOffset.value = {
    x: drag.offset.x + keepAgentVisible(drag.left + dx, drag.width, window.innerWidth) - drag.left,
    y: drag.offset.y + keepAgentVisible(drag.top + dy, drag.height, window.innerHeight) - drag.top,
  };
}
function finishAgentDrag(event?: PointerEvent, cancel = false) {
  const drag = agentDrag;
  if (!drag || event && event.pointerId !== drag.pointerId) return;
  if (!cancel && event) moveAgentDrag(event);
  agentDrag = undefined;
  if (cancel) { agentOffset.value = drag.offset; suppressAgentClick = true; }
  else if (agentDragging.value) saveAgentOffset();
  agentDragging.value = false;
  if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
}
function cancelAgentDrag(event?: PointerEvent) { finishAgentDrag(event, true); }
function openAgent(event: MouseEvent) {
  if (suppressAgentClick && event.detail !== 0) { suppressAgentClick = false; return; }
  suppressAgentClick = false;
  agentVisible.value = true;
}
function blurAgentLauncher() { cancelAgentDrag(); }
function resizeAgentLauncher() { cancelAgentDrag(); void nextTick(clampAgentOffset); }
watch([agentVisible, activePanel], async () => { cancelAgentDrag(); await nextTick(); clampAgentOffset(); });
onMounted(() => {
  clampAgentOffset();
  window.addEventListener("resize", resizeAgentLauncher);
  window.addEventListener("blur", blurAgentLauncher);
});
onScopeDispose(() => {
  cancelAgentDrag();
  window.removeEventListener("resize", resizeAgentLauncher);
  window.removeEventListener("blur", blurAgentLauncher);
});
const settingsVisible = ref(false);
const repositoryDocs = `${import.meta.env.repositoryUrl}/blob/main/docs`;
const userGuideUrl = `${repositoryDocs}/user-guide.md`;
const helpVisible = ref(false);
const contactVisible = ref(false);
const bundledContactImages = import.meta.glob<string>("../../assets/wechatContact.png", {
  eager: true, query: "?url", import: "default",
});
const wechatContactUrl = import.meta.env.VITE_LUM_WECHAT_QR || Object.values(bundledContactImages)[0];
const contacts = {
  bug: { icon: IconBug, title: "汇报 BUG", tip: "微信扫码添加联系人，备注「Lum 反馈」，并附上软件版本和复现步骤。" },
  community: { icon: IconBrandWechat, title: "加入交流群", tip: "微信扫码添加联系人，备注「Lum 入群」。" },
  business: { icon: IconBriefcase, title: "商务合作", tip: "微信扫码添加联系人，备注「Lum 合作」，简要说明合作意向。" },
};
type ContactType = keyof typeof contacts;
const contactType = ref<ContactType>("community");
const contactInfo = computed(() => contacts[contactType.value]);

function contactPage(type: ContactType) {
  return `${repositoryDocs}/contact.md#${type}`;
}

function showContact(type: ContactType) {
  contactType.value = type;
  helpVisible.value = false;
  contactVisible.value = Boolean(wechatContactUrl);
}
const canvasPanelRef = ref<InstanceType<typeof canvasPanel>>();
let importingWriting = false;
async function receiveAdoptionProof(event: MessageEvent) {
  if (window.parent === window || event.source !== window.parent || !["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(event.origin)) return;
  const message = event.data;
  if (message?.type !== 'lum:adoptionProofRequest' || typeof message.id !== 'string' || !/^[\w-]{1,100}$/.test(message.id)) return;
  const panel = canvasPanelRef.value;
  try {
    if (!panel?.canvasReady) throw new Error('请先打开并保存来源画布');
    const projectId = embeddedProjectId(), context = panel.adoptionContext();
    const project = await http<{ directory: string }>({ method: 'POST', url: '/api/integration/project', data: { projectId } });
    if (project?.directory !== context.directory || context.directory !== workspaceStore.project?.directory
      || context.canvasPath !== panel.canvasId) throw new Error('当前工作区不属于关联项目');
    const result = { ...(message.method === 'context' ? context : await panel.verifyAdoption(message.adoption, message.method !== 'check')), projectId };
    if (panel !== canvasPanelRef.value) throw new Error('来源画布已切换');
    window.parent.postMessage({ type: 'lum:adoptionProofResponse', id: message.id, result }, event.origin);
  } catch (error) {
    window.parent.postMessage({ type: 'lum:adoptionProofResponse', id: message.id, error: error instanceof Error ? error.message : String(error) }, event.origin);
  }
}
onMounted(() => window.addEventListener('message', receiveAdoptionProof));
onScopeDispose(() => window.removeEventListener('message', receiveAdoptionProof));
watch(() => [workspaceStore.project?.directory, canvasPanelRef.value?.canvasId], () => {
  if (window.parent !== window) window.parent.postMessage({ type: 'lum:adoptionContextChanged' }, '*');
}, { flush: 'sync' });
const productionTargets = new Map<string, { directory: string; canvasId: string; clipId?: string; batchId?: string; expires: number }>();
const storyImports = new Map<string, { directory: string; canvasPath: string; session: string; expires: number }>();
let storySession = crypto.randomUUID();
watch(() => [workspaceStore.project?.directory, canvasPanelRef.value, canvasPanelRef.value?.canvasId, activePanel.value], () => {
  storySession = crypto.randomUUID();
  storyImports.clear();
}, { flush: "sync" });
async function receiveProduction(event: MessageEvent) {
  if (window.parent === window || event.source !== window.parent || !["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(event.origin)) return;
  const message = event.data;
  if (message?.type !== "laper:productionRequest" || typeof message.id !== "string" || !/^[\w-]{1,100}$/.test(message.id)) return;
  const reply = (value: Record<string, unknown>) => window.parent.postMessage({ type: "lum:productionResponse", id: message.id, ...value }, event.origin);
  if (message.method === "storyContext") {
    try {
      const panel = canvasPanelRef.value, session = storySession, projectId = embeddedProjectId();
      const context = panel?.adoptionContext();
      if (!panel?.canvasReady || !context?.directory || !context.canvasPath || message.projectId !== projectId
        || context.directory !== message.context?.directory || context.canvasPath !== message.context?.canvasPath) throw new Error("剧情素材来源画布已切换");
      const project = await http<{ directory: string }>({ method: "POST", url: "/api/integration/project", data: { projectId } });
      if (project?.directory !== context.directory || context.directory !== workspaceStore.project?.directory
        || panel !== canvasPanelRef.value || session !== storySession) throw new Error("来源画布不属于当前 Lum 项目");
      const target = message.bindImport === true ? crypto.randomUUID() : undefined;
      if (target) {
        for (const [key, binding] of storyImports) if (binding.expires < Date.now()) storyImports.delete(key);
        if (storyImports.size >= 10) storyImports.delete(storyImports.keys().next().value!);
        storyImports.set(target, { ...context, session, expires: Date.now() + 60000 });
      }
      reply({ result: { ...context, projectId, session, target } });
    } catch (error) { reply({ error: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  if (importingWriting) { reply({ error: "已有素材正在送入，请等待保存回执" }); return; }
  importingWriting = true;
  try {
    if (message.method === "panel") {
      if (message.panel === "leave") {
        await canvasPanelRef.value?.closeEditors();
        await flushSave();
      } else if (!["canvas", "virtualStage"].includes(message.panel) || !await switchPanel(message.panel)) throw new Error("片场或画布仍有未完成的修改，请保存或取消后再切换");
      reply({ result: { panel: activePanel.value } }); return;
    }
    if (message.method === "target" && message.virtualStage === true) {
      if (activePanel.value !== "virtualStage" || !canvasPanelRef.value?.canvasId.startsWith("virtualStages/")) throw new Error("请先新建或打开一个虚拟片场，再加入素材");
      await canvasPanelRef.value.closeEditors();
    } else if (message.method === "target" && !(await switchPanel("canvas"))) throw new Error("请先保存文档并打开画布");
    const panel = canvasPanelRef.value;
    if (!panel?.canvasReady) throw new Error("请先打开一个制片画布，等待节点加载完成");
    if (message.method === "storyImport") {
      const target = typeof message.target === "string" ? storyImports.get(message.target) : undefined;
      if (!target || target.expires < Date.now() || target.session !== storySession || target.directory !== workspaceStore.project?.directory
        || target.canvasPath !== panel.canvasId) throw new Error("剧情素材来源画布已切换或导入目标已过期");
      storyImports.delete(message.target);
      const result = await panel.importStorySources(message.images, target);
      if (target.session !== storySession || panel !== canvasPanelRef.value) throw new Error("导入期间画布已切换，请在来源画布核对已导入图片");
      reply({ result });
      return;
    }
    for (const [token, target] of productionTargets) if (target.expires < Date.now()) productionTargets.delete(token);
    if (message.method === "target") {
      const directory = workspaceStore.project?.directory; if (!directory) throw new Error("项目尚未打开");
      if (message.clip !== undefined) await panel.openProductionCanvas(message.clip);
      if (directory !== workspaceStore.project?.directory) throw new Error("项目已切换，请重新打开胶卷");
      if (productionTargets.size >= 20) productionTargets.delete(productionTargets.keys().next().value!);
      const token = crypto.randomUUID(); productionTargets.set(token, { directory, canvasId: panel.canvasId, clipId: message.clip?.id, batchId: message.clip?.batchId, expires: Date.now() + 10 * 60 * 1000 });
      reply({ result: { target: token, canvasId: panel.canvasId, clipId: message.clip?.id, batchId: message.clip?.batchId } }); return;
    }
    const target = typeof message.target === "string" ? productionTargets.get(message.target) : undefined;
    if (message.method !== "import" || !target || target.directory !== workspaceStore.project?.directory || target.canvasId !== panel.canvasId) throw new Error("准备素材期间画布已切换或目标已过期，未写入；请在目标画布重新送入");
    if ((message.production?.clipId ?? undefined) !== target.clipId) throw new Error("胶卷与目标画布不一致，未写入");
    if ((message.production?.batchId ?? undefined) !== target.batchId) throw new Error("分镜批次与目标画布不一致，未写入");
    productionTargets.delete(message.target);
    reply({ result: await panel.importWritingMaterials(message.nodes, message.production) });
  } catch (error) { reply({ error: error instanceof Error ? error.message : String(error) }); }
  finally { importingWriting = false; }
}
onMounted(() => window.addEventListener("message", receiveProduction));
onScopeDispose(() => window.removeEventListener("message", receiveProduction));
watch(() => canvasPanelRef.value?.canvasId, canvasId => {
  if (window.parent !== window && canvasId) window.parent.postMessage({ type: "lum:productionCanvas", canvasId }, "*");
});
watch(() => canvasPanelRef.value?.canvasListReady, ready => {
  workspaceStore.projectLoading = !ready;
}, { immediate: true });
onScopeDispose(() => { workspaceStore.projectLoading = false; });
const documentPanelCache = shallowRef<{ directory: string; instance: InstanceType<typeof documentPanel> }>();
const documentPanelRef = computed(() => documentPanelCache.value?.directory === workspaceStore.project?.directory ? documentPanelCache.value?.instance : undefined);
watch(() => workspaceStore.project?.directory, () => {
  documentPanelCache.value?.instance.cancelSave();
  documentPanelCache.value = undefined;
}, { flush: "sync" });
function setDocumentPanel(value: Element | ComponentPublicInstance | null) {
  const directory = workspaceStore.project?.directory;
  // KeepAlive 失活会清空模板 ref，保留同一工作区实例以协调后台文档保存和文件操作。
  if (value && directory) documentPanelCache.value = { directory, instance: value as InstanceType<typeof documentPanel> };
}
provide("canvas", () => canvasPanelRef.value?.getCanvasContext());
provide("mentionCanvas", () => canvasPanelRef.value?.mentionSource);
provide("activateCanvasPanel", () => activePanel.value === "virtualStage" ? Promise.resolve(true) : switchPanel("canvas"));
provide("performWorkspaceFileAction", (directory: string, action: "copy" | "rename" | "move" | "delete", path: string, target?: string, entryType: "canvas" | "directory" = "canvas") =>
  documentPanelRef.value ? documentPanelRef.value.performFileAction(directory, action, path, target, entryType) : performFileAction(directory, action, path, target));

const controlLifetime = new AbortController();
onScopeDispose(() => {
  controlLifetime.abort(new Error("工作区已关闭"));
  // 离开守卫已完成保存，先释放文档观察者，避免画布卸载被当成节点删除。
  documentPanelRef.value?.cancelSave();
});
registerWorkspaceControl({
  getState: () => ({
    directory: workspaceStore.project?.directory ?? null,
    canvasId: canvasPanelRef.value?.canvasId || null,
    panel: activePanel.value,
    tools: canvasPanelRef.value?.canvasReady ? canvasPanelRef.value.getCanvasContext()?.tools ?? [] : [],
    document: documentPanelRef.value?.getDocument(false),
  }),
  flushSave,
  async call(request, signal) {
    const directory = workspaceStore.project?.directory;
    if (!directory) throw new Error("请先打开工作区");
    const callSignal = AbortSignal.any([signal, controlLifetime.signal]);
    const checkDirectory = () => {
      callSignal.throwIfAborted();
      if (directory !== workspaceStore.project?.directory) throw new Error("工作区已切换，本次调用已停止");
    };
    checkDirectory();
    if (request.name === "switchPanel") {
      if (request.args.panel !== "canvas" && request.args.panel !== "document" && request.args.panel !== "virtualStage") throw new Error("未知面板");
      if (!(await switchPanel(request.args.panel))) throw new Error("面板切换失败，请检查文档是否保存成功");
      if (request.args.panel === "document") await waitForControlValue(() => documentPanelRef.value?.ready ? documentPanelRef.value : undefined, callSignal);
      checkDirectory();
      return { panel: activePanel.value };
    }
    if (["getDocument", "openDocument", "writeDocument"].includes(request.name)) {
      if (!(await switchPanel("document"))) throw new Error("文档面板无法打开");
      const panel = await waitForControlValue(() => documentPanelRef.value?.ready ? documentPanelRef.value : undefined, callSignal);
      checkDirectory();
      if (request.name === "openDocument") await panel.openDocument(request.args, callSignal);
      if (request.name === "writeDocument") await panel.writeDocument(request.args, callSignal);
      checkDirectory();
      return panel.getDocument();
    }
    if (activePanel.value !== "virtualStage" && !(await switchPanel("canvas"))) throw new Error("画布面板无法打开");
    const context = await waitForControlValue(
      () => (canvasPanelRef.value?.canvasReady || (!canvasPanelRef.value?.canvasId && canvasPanelRef.value?.canvasListReady) ? canvasPanelRef.value.getCanvasContext() : undefined),
      callSignal
    );
    checkDirectory();
    return context.call({ name: request.name, args: request.args }, callSignal);
  },
});

async function flushSave() {
  await documentPanelRef.value?.flushSave();
  await canvasPanelRef.value?.flushSave();
}

onBeforeRouteLeave(async () => {
  if (canvasPanelRef.value?.saveBusy) {
    ElMessage.warning("画布操作尚未完成，请稍后退出");
    return false;
  }
  try {
    await flushSave();
    return true;
  } catch (error) {
    const message = axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message || error.message
      : error instanceof Error
      ? error.message
      : translate("项目保存失败");
    const leave = await ElMessageBox.confirm(`无法保存项目：${message}。文件或目录可能已被移动或删除。仍然退出将丢弃尚未保存的修改。`, "项目未保存", {
      type: "warning",
      confirmButtonText: "仍然退出",
      cancelButtonText: "留在项目",
      closeOnClickModal: false,
    }).then(
      () => true,
      () => false
    );
    if (leave) {
      documentPanelRef.value?.cancelSave();
      canvasPanelRef.value?.cancelSave();
    }
    return leave;
  }
});

let panelTransition = Promise.resolve(true);
function switchPanel(value: string | number | boolean) {
  panelTransition = panelTransition.then(() => performSwitchPanel(value));
  return panelTransition;
}
async function performSwitchPanel(value: string | number | boolean) {
  if (value !== "canvas" && value !== "document" && value !== "virtualStage") return false;
  if (value === activePanel.value) return true;
  try {
    if (value === "virtualStage") await canvasPanelRef.value?.closeEditors();
    if (activePanel.value === "virtualStage" && value !== "virtualStage") await canvasPanelRef.value?.leaveVirtualStage();
    if (activePanel.value === "document") await documentPanelRef.value?.flushSave();
    activePanel.value = value;
    await nextTick();
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文本保存失败");
    return false;
  }
}

async function getVirtualStages() {
  const panel = await waitForControlValue(() => canvasPanelRef.value?.canvasListReady ? canvasPanelRef.value : undefined, controlLifetime.signal);
  return panel.getVirtualStages();
}
async function openVirtualStage(id?: string, name?: string) {
  if (!canvasPanelRef.value) throw new Error("片场尚未就绪");
  return canvasPanelRef.value.openVirtualStage(id,name);
}
// 节点把要求交给 Agent：剧本节点、脚本节点、剧本设定器都走这里。
function receiveAgentDraft(event: Event) {
  const detail = (event as CustomEvent<{ prompt?: unknown; submit?: unknown }>).detail;
  const directory = workspaceStore.project?.directory;
  if (!directory || typeof detail?.prompt !== "string" || !detail.prompt.trim()) return;
  agentVisible.value = true;
  workspaceStore.pendingAgentMessage = { directory, source: "canvas", prompt: detail.prompt, submit: detail.submit !== false };
}
onMounted(() => window.addEventListener("lum:agentDraft", receiveAgentDraft));
onScopeDispose(() => window.removeEventListener("lum:agentDraft", receiveAgentDraft));
function receiveWorkspacePanel(event: MessageEvent) {
  if (event.source !== window.parent || window.parent === window || !["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(event.origin)) return;
  if (event.data?.type !== "laper:workspacePanel" || !["canvas","virtualStage"].includes(event.data.panel)) return;
  void switchPanel(event.data.panel);
}
onMounted(() => window.addEventListener("message",receiveWorkspacePanel));
onScopeDispose(() => window.removeEventListener("message",receiveWorkspacePanel));

function readDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.readDocumentNode(directory, canvasPath, nodeId);
}

function readDocumentNodes(directory: string, options?: DocumentNodeOptions) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.readDocumentNodes(directory, options);
}

async function focusDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  if (!directory || workspaceStore.project?.directory !== directory) throw new Error("工作目录已切换，请重新选择节点");
  if (!await switchPanel("canvas")) throw new Error("画布面板无法打开");
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  await canvasPanelRef.value.focusDocumentNode(directory, canvasPath, nodeId);
}

function mountDocumentNode(directory: string, canvasPath: string, nodeId: string, target: HTMLElement) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.mountDocumentNode(directory, canvasPath, nodeId, target);
}

function resolveDocumentNodeFile(directory: string, path: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.resolveDocumentNodeFile(directory, path);
}

function observeDocumentNode(directory: string, canvasPath: string, nodeId: string, onState: (state: { dirty: boolean; error: string; deleted: boolean }) => void) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.observeDocumentNode(directory, canvasPath, nodeId, onState);
}

async function flushDocumentNodes() {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  await canvasPanelRef.value.flushSave();
}

function performFileAction(directory: string, action: "copy" | "rename" | "move" | "delete", path: string, target?: string, nodeId?: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.performFileAction(directory, action, path, target, nodeId);
}

function saveDocumentNode(directory: string, canvasPath: string, nodeId: string, handleId: string, text: string, expectedText?: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.saveDocumentNode(directory, canvasPath, nodeId, handleId, text, expectedText);
}
</script>

<style scoped lang="scss">
.workspacePage {
  position: relative;
  width: 100%;
  height: 100dvh;
  background-color: var(--el-bg-color);

  :deep(.workspaceMenu > .el-card),
  :deep(.canvasMenu),
  :deep(.balanceCard),
  :deep(.canvasControlsCard),
  .panelSwitcher,
  .toolMenu {
    background: color-mix(in srgb, var(--el-bg-color-overlay) 70%, transparent);
    backdrop-filter: blur(6px);
    border-color: var(--el-border-color-light);
    box-shadow: var(--el-box-shadow-light);
  }

  .canvasPanel {
    position: absolute;
    inset: 0;
    width: calc(100% - var(--agentWidth, 0px));
    container: canvasWorkspace / inline-size;

    &.backgroundPanel {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
  }

  .workspaceMenu {
    position: absolute;
    top: 15px;
    left: 15px;
    z-index: 5;
  }

  .workspaceTools {
    position: absolute;
    inset: 0;
    z-index: 6;
    width: calc(100% - var(--agentWidth, 0px));
    container: workspaceTools / inline-size;
    pointer-events: none;

    .panelSwitcher {
      --el-border-radius-base: var(--ui-radius-large);
      --el-segmented-color: var(--el-text-color-secondary);
      --el-segmented-item-selected-color: var(--el-color-white);
      --el-segmented-item-selected-bg-color: var(--el-color-primary);
      --el-segmented-item-hover-bg-color: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
      position: absolute;
      top: 15px;
      left: 50%;
      z-index: 5;
      min-height: 28px;
      padding: 2px;
      border: 1px solid var(--el-border-color-light);
      font-size: 12px;
      transform: translateX(-50%);
      pointer-events: auto;

      .panelOption {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 0 2px;
        line-height: 22px;
        font-weight: 500;
      }
    }

    .bottomTools {
      position: absolute;
      bottom: 15px;
      left: 50%;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: 8px;
      transform: translateX(-50%);
      pointer-events: auto;

      .toolMenu {
        flex-shrink: 0;
        transition: none;

        .toolMenuContent {
          display: flex;
          align-items: center;
          gap: 2px;

          .toolButton {
            width: 28px;
            height: 28px;
            margin: 0;
            padding: 0;

            &.addNodeButton {
              margin-right: 6px;
              color: var(--el-bg-color);
              background: var(--el-text-color-primary);
              border-color: transparent;

              &:hover { opacity: 0.85; }
              &.is-disabled { opacity: 0.45; }
            }
          }

          .toolTrigger { display: inline-flex; }

          .el-divider { margin: 0; }
        }
      }

      .agentButton {
        cursor: grab;
        touch-action: none;
        user-select: none;
        position: absolute;
        left: calc(100% + 8px);
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        margin: 0;
        padding: 0;
        border: 1px solid color-mix(in srgb, #6edfdc 30%, var(--el-border-color-light));
        border-radius: 50%;
        background: linear-gradient(145deg, color-mix(in srgb, #96f9f0 15%, var(--el-bg-color-overlay)), var(--el-bg-color-overlay) 65%,
          color-mix(in srgb, #8588ff 18%, var(--el-bg-color-overlay)));
        box-shadow: inset 0 1px 0 #ffffff52;
        color: #f4fffe;
        overflow: hidden;
        isolation: isolate;
        transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;

        &.standalone {
          position: relative;
          left: auto;
        }

        &::before,
        &::after {
          content: "";
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          pointer-events: none;
        }

        &::before {
          z-index: -2;
          background: radial-gradient(ellipse at 22% 15%, #adfff0, transparent 50%), radial-gradient(ellipse at 85% 85%, #b29aff, transparent 55%),
            radial-gradient(ellipse at 85% 20%, #25dccc, transparent 50%), linear-gradient(150deg, #10aec1, #3765c6 60%, #765bd3);
          animation: agentFlow 5.4s linear infinite;
          filter: saturate(1.05);
          transition: filter 180ms ease;
        }

        &::after {
          z-index: -1;
          background: radial-gradient(ellipse 12% 18% at 50% 50%, #ffffffa6, #d3fff773 35%, transparent 80%),
            radial-gradient(ellipse at 32% 18%, #ffffff99, transparent 42%), radial-gradient(ellipse at 65% 95%, #17246070, transparent 65%);
          background-size: 160% 160%, 100% 100%, 100% 100%;
          background-position: 75% 85%, 0 0, 0 0;
          background-repeat: no-repeat;
          box-shadow: inset 0 0 0 1px #ffffff52, inset 0 2px 3px #ffffff80, inset 0 -3px 6px #16305b73;
          animation: agentShine 3.2s linear infinite;
        }

        &:hover::before {
          filter: saturate(1.2);
        }

        &:hover {
          transform: translateY(-1px);
          border-color: #87f2eb99;
          box-shadow: inset 0 1px 0 #ffffff70;
        }

        &:active {
          transform: scale(0.95);
        }

        &.dragging {
          cursor: grabbing;
          transform: none;
          transition: none;
        }

        &:focus-visible {
          outline: 2px solid var(--el-color-primary);
          outline-offset: 3px;
        }

        .agentLogo {
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          background: currentColor;
          mask-size: contain;
          mask-position: center;
          mask-repeat: no-repeat;
        }

        @media (prefers-reduced-motion: reduce) {
          transition: none;

          &::before,
          &::after {
            animation: none;
          }
        }
      }
    }
  }
}

@keyframes agentFlow {
  from {
    transform: rotate(0deg) scale(1);
  }
  25% {
    transform: rotate(90deg) scale(1.06, 1.02);
  }
  50% {
    transform: rotate(180deg) scale(1.02, 1.06);
  }
  75% {
    transform: rotate(270deg) scale(1.05, 1.03);
  }
  to {
    transform: rotate(360deg) scale(1);
  }
}

@keyframes agentShine {
  0%,
  100% {
    background-size: 160% 160%, 100% 100%, 100% 100%;
    background-position: 75% 85%, 0 0, 0 0;
  }
  12.5% {
    background-position: 40% 98%, 0 0, 0 0;
  }
  25% {
    background-size: 180% 140%, 100% 100%, 100% 100%;
    background-position: 10% 75%, 0 0, 0 0;
  }
  37.5% {
    background-position: 2% 40%, 0 0, 0 0;
  }
  50% {
    background-size: 160% 160%, 100% 100%, 100% 100%;
    background-position: 25% 10%, 0 0, 0 0;
  }
  62.5% {
    background-position: 60% 2%, 0 0, 0 0;
  }
  75% {
    background-size: 140% 180%, 100% 100%, 100% 100%;
    background-position: 95% 25%, 0 0, 0 0;
  }
  87.5% {
    background-position: 98% 60%, 0 0, 0 0;
  }
}
.helpMenu {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .helpAction {
    justify-content: flex-start;
    margin-left: 0;
  }
}

.contactContent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  .contactQr {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .contactTip {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.7;
  }
}
</style>
