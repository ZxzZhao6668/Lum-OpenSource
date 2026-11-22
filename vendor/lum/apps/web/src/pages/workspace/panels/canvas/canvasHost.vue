<template>
  <div class="canvasHost">
    <canvasPanel
      v-for="entry in entries"
      v-model:selectedTool="selectedTool"
      :key="entry.key"
      :ref="value => setInstance(entry.key, value)"
      class="canvasRuntime"
      :class="{ backgroundCanvas: entry.key !== activeKey }"
      :aria-hidden="entry.key !== activeKey"
      :inert="entry.key !== activeKey"
      :runtimeKey="entry.key"
      :initialCanvasId="entry.fileName"
      :active="active && entry.key === activeKey"
      :settingsVisible="settingsVisible"
      :activateCanvas="activateCanvas"
      :resolveCanvasContext="resolveCanvasContext"
      :flushCanvases="flushSave" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, provide, shallowReactive, shallowRef, ref, watch, type ComponentPublicInstance } from "vue";
import axios from "axios";
import type { CanvasContext } from "@lum/tool-canvas/runtime";
import { waitForControlValue } from "@/lib/mcpControl";
import canvasPanel from "./index.vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";
import { createCanvasMention, mentionNodeOutputs, queryMentionNodes, type MentionCanvasSource } from "@lum/server/agent/mentionSources";
import type { NodeDocumentState } from "@lum/nodes-scaffold/nodeDocument";
import { galleryMediaBlob, galleryMediaPath } from "./galleryMedia";
import { galleryCanvasCopy, galleryFileStem, type GalleryCanvas } from "./galleryCanvas";
import { copyCanvasFiles, findRemainingCanvas, readCanvasFiles, type DocumentNode, type DocumentNodeOptions } from "./canvasFiles";
import { createVirtualStage, listVirtualStages, virtualStagePath } from "./virtualStages";
import { virtualStageOutputKey, validateVirtualStageOutput, type PublishVirtualStageOutput } from "@lum/node-shared/virtualStageOutput";

const props = withDefaults(defineProps<{ active?: boolean; settingsVisible?: boolean }>(), { active: true, settingsVisible: false });
const selectedTool = defineModel<"move" | "hand">("selectedTool", { default: "move" });
type CanvasInstance = InstanceType<typeof canvasPanel>;
const entries = shallowRef<{ key: string; fileName?: string }[]>([{ key: crypto.randomUUID() }]);
const activeKey = ref(entries.value[0]!.key);
const instances = shallowReactive(new Map<string, CanvasInstance>());
const activeInstance = computed(() => instances.get(activeKey.value));
const canvasId = computed(() => activeInstance.value?.canvasId ?? "");
const canvasReady = computed(() => activeInstance.value?.canvasReady ?? false);
const canvasListReady = computed(() => activeInstance.value?.canvasListReady ?? false);
const lifetime = new AbortController();
const workspaceStore = useWorkspaceStore();
const canvases = shallowRef<{ id: string; name: string }[]>([]);
let fileActionBusy = false;
provide("canvasList", canvases);
provide("canvasFolders", shallowRef([]));
provide("canvasLoadedDirectories", shallowRef<string[]>([]));
provide("canvasAssetNodes", (id: string) => [...instances.values()].find(panel => panel.canvasId === id)?.getRetainedNodes() ?? []);
watch(canvases, (current, previous) => {
  const removed = new Set(previous.filter(canvas => !current.includes(canvas)).map(canvas => canvas.id));
  if (!removed.size) return;
  entries.value = entries.value.filter(entry => {
    const panel = instances.get(entry.key);
    if (!removed.has(panel?.canvasId || entry.fileName || "")) return true;
    // 卸载会刷新待保存内容，删除文件后必须先取消，避免重新创建 JSON。
    panel?.cancelSave();
    return false;
  });
  if (!entries.value.some(entry => entry.key === activeKey.value)) activeKey.value = entries.value[0]?.key ?? "";
}, { flush: "sync" });
onScopeDispose(() => lifetime.abort(new Error("工作区已关闭")));

function setInstance(key: string, value: Element | ComponentPublicInstance | null) {
  if (value) instances.set(key, value as CanvasInstance);
  else instances.delete(key);
}

function canonicalCanvasPath(path: string) {
  path = relativePath(path);
  if (!/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(workspaceStore.project?.directory ?? "")) return path;
  const paths = [...entries.value.map(entry => instances.get(entry.key)?.canvasId || entry.fileName), ...canvases.value.map(canvas => canvas.id)];
  return paths.find(candidate => candidate?.replaceAll("\\", "/").toLowerCase() === path.toLowerCase()) ?? path;
}

async function ensureCanvas(fileName: string, signal?: AbortSignal, activate = false) {
  const callSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(120000), ...(signal ? [signal] : [])]);
  callSignal.throwIfAborted();
  fileName = relativePath(fileName);
  if (!canvases.value.length && entries.value.some(entry => entry.fileName === undefined)) {
    await waitForControlValue(() => activeInstance.value?.canvasListReady || activeInstance.value?.loadError || undefined, callSignal);
  }
  fileName = canonicalCanvasPath(fileName);
  if (!canvases.value.some(canvas => canvas.id === fileName)) {
    const directory = workspaceStore.project?.directory;
    if (!directory) throw new Error("请先选择工作目录");
    const data = await useWorkspaceFiles(directory).readJson<{ lumCanvas?: boolean; toonflowCanvas?: boolean; nodes?: unknown[]; edges?: unknown[]; viewport?: { x: number; y: number; zoom: number } }>(fileName);
    checkDirectory(directory);
    callSignal.throwIfAborted();
    if ((data?.lumCanvas !== true && data?.toonflowCanvas !== true) || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !data.viewport
      || ![data.viewport.x, data.viewport.y, data.viewport.zoom].every(Number.isFinite) || data.viewport.zoom <= 0) throw new Error("画布文件格式无效");
    fileName = canonicalCanvasPath(fileName);
    if (!canvases.value.some(canvas => canvas.id === fileName)) canvases.value = [...canvases.value, { id: fileName, name: canvasName(fileName) }];
  }
  const previousKey = activeKey.value;
  let entry = entries.value.find(item => instances.get(item.key)?.canvasId === fileName || (!instances.get(item.key)?.canvasId && item.fileName === fileName));
  if (!entry) {
    // ACT: 已打开的画布保留至退出工作区，避免卸载后台节点任务；大量画布时可按任务引用回收空闲实例。
    entry = { key: crypto.randomUUID(), fileName };
    entries.value = [...entries.value, entry];
  }
  if (activate) activeKey.value = entry.key;
  const key = entry.key;
  try {
    const panel = await waitForControlValue(() => {
      const instance = instances.get(key);
      return instance?.canvasReady || instance?.loadError ? instance : undefined;
    }, callSignal);
    if (panel.loadError) throw new Error(panel.loadError);
    return panel;
  } catch (error) {
    if (activate && activeKey.value === key) activeKey.value = previousKey;
    if (!instances.get(key)?.canvasId) entries.value = entries.value.filter(item => item.key !== key);
    throw error;
  }
}

async function activateCanvas(fileName: string, signal?: AbortSignal) {
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  await ensureCanvas(fileName, signal, true);
}

let previousCanvasId = "";
provide<PublishVirtualStageOutput>(virtualStageOutputKey,async output=>{
  validateVirtualStageOutput(output);
  const directory=workspaceStore.project?.directory;
  if(!directory || fileActionBusy || !canvasId.value.startsWith("virtualStages/") || !activeInstance.value?.getRetainedNodes().some(node=>node.id===output.sourceId && node.data.virtualStage===true)) throw new Error("请在当前片场内导出，或等待画布切换完成");
  const target=previousCanvasId || canvases.value.find(item=>!item.id.startsWith("virtualStages/"))?.id;
  if(!target)throw new Error("请先创建一个普通画布，再把片场输出加入画布");
  const panel=await ensureCanvas(target);checkDirectory(directory);
  return panel.addStageOutput(output);
});
async function getVirtualStages() {
  const directory = workspaceStore.project?.directory;
  if (!directory) throw new Error("请先打开项目");
  const result = await listVirtualStages(directory);
  checkDirectory(directory);
  return result;
}
async function openVirtualStage(id?: string, name?: string) {
  if (fileActionBusy) throw new Error("片场正在切换，请稍后重试");
  const directory = workspaceStore.project?.directory;
  if (!directory) throw new Error("请先打开项目");
  fileActionBusy = true;
  try {
    await activeInstance.value?.closePrevisEditors(); checkDirectory(directory);
    await flushSave(); checkDirectory(directory);
    if (canvasId.value && !canvasId.value.startsWith("virtualStages/")) previousCanvasId = canvasId.value;
    const stageId = id ?? await createVirtualStage(directory, name ?? "未命名片场");
    checkDirectory(directory);
    const panel = await ensureCanvas(virtualStagePath(stageId), undefined, true);
    checkDirectory(directory);
    await panel.openVirtualStageEditor();
    checkDirectory(directory);
    return stageId;
  } finally { fileActionBusy = false; }
}
async function leaveVirtualStage() {
  if (fileActionBusy) throw new Error("片场正在切换，请稍后重试");
  const directory = workspaceStore.project?.directory;
  if (!directory) throw new Error("请先打开项目");
  fileActionBusy = true;
  try {
    await activeInstance.value?.closePrevisEditors(); checkDirectory(directory);
    await flushSave(); checkDirectory(directory);
    const target = previousCanvasId || canvases.value.find(item => !item.id.startsWith("virtualStages/"))?.id;
    if (canvasId.value.startsWith("virtualStages/") && target) await ensureCanvas(target, undefined, true);
    checkDirectory(directory);
  } finally { fileActionBusy = false; }
}
async function closeEditors() {
  if (fileActionBusy) throw new Error("画布正在保存或切换，请稍后重试");
  for (const panel of instances.values()) await panel.closePrevisEditors();
}

async function openProductionCanvas(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("胶卷参数无效");
  const clip = value as { id?: unknown; canvasId?: unknown; batchId?: unknown };
  if (typeof clip.id !== "string" || !/^[\w-]{1,100}$/.test(clip.id)
    || (clip.batchId !== undefined && (typeof clip.batchId !== "string" || !/^[\w-]{1,100}$/.test(clip.batchId)))
    || (clip.canvasId !== undefined && (typeof clip.canvasId !== "string" || clip.canvasId.length > 256))) throw new Error("胶卷标识或画布路径无效");
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  const directory = workspaceStore.project?.directory;
  if (!directory) throw new Error("请先打开项目");
  const files = useWorkspaceFiles(directory);
  let fileName = clip.canvasId ? relativePath(clip.canvasId as string) : clip.batchId ? `分镜视频-${clip.batchId}.json` : `制片胶卷-${clip.id}.json`;
  fileActionBusy = true;
  try {
    await flushSave(); checkDirectory(directory);
    if (!clip.canvasId) {
      try {
        await files.writeJson(fileName, { lumCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true);
      } catch (error) {
        if (!axios.isAxiosError<{ data?: { code?: string } }>(error) || error.response?.status !== 409 || error.response.data.data?.code !== "EEXIST") throw error;
      }
    } else {
      // 胶卷按节点来源追踪已重命名的画布；不因旧路径失效而另建空白画布。
      try { await files.readJson(fileName); }
      catch (error) {
        if (!axios.isAxiosError<{ data?: { code?: string } }>(error) || error.response?.data.data?.code !== "ENOENT") throw error;
        const matches = (await readCanvasFiles(files)).filter(canvas => canvas.data.nodes.some(node => node.data?.writingProduction?.clipId === clip.id || (clip.batchId && node.data?.writingProduction?.batchId === clip.batchId)));
        if (matches.length !== 1) throw new Error("胶卷画布已移动或存在多个副本，请在画布中核对文件");
        fileName = matches[0]!.id;
      }
    }
    checkDirectory(directory);
    const panel = await ensureCanvas(fileName, undefined, true);
    checkDirectory(directory);
    if (panel.getMentionNodes().some(node => {
      const owner = node.data?.writingProduction;
      return owner?.clipId && (clip.batchId ? owner.batchId !== clip.batchId : owner.clipId !== clip.id);
    })) throw new Error("此画布属于其他胶卷或分镜批次，未写入素材");
    return panel.canvasId;
  } finally { fileActionBusy = false; }
}

async function focusDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  checkDirectory(directory);
  const panel = await ensureCanvas(canvasPath, undefined, true);
  checkDirectory(directory);
  await nextTick();
  const node = panel.findMentionNode(nodeId);
  if (!node) throw new Error("节点已删除，请刷新文件树");
  if (node.hidden) throw new Error("节点已隐藏，无法在画布上聚焦");
  const context = panel.getCanvasContext();
  if (!context) throw new Error("画布尚未就绪");
  await context.call({ name: "selectNodes", args: { nodeIds: [nodeId] } }, lifetime.signal);
  const result = await context.call({ name: "fitCanvas", args: { nodeIds: [nodeId] } }, lifetime.signal) as { fitted: boolean };
  checkDirectory(directory);
  if (!result.fitted) throw new Error("节点尚未完成尺寸测量，请稍后重试");
}

async function mountDocumentNode(directory: string, canvasPath: string, nodeId: string, target: HTMLElement) {
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  if (!directory || workspaceStore.project?.directory !== directory) throw new Error("工作目录已切换，请重新打开节点");
  const panel = await ensureCanvas(canvasPath);
  if (workspaceStore.project?.directory !== directory) throw new Error("工作目录已切换，请重新打开节点");
  return panel.mountDocumentNode(directory, panel.canvasId, nodeId, target);
}

async function observeDocumentNode(directory: string, canvasPath: string, nodeId: string, onState: (state: NodeDocumentState) => void) {
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  checkDirectory(directory);
  const panel = await ensureCanvas(canvasPath);
  checkDirectory(directory);
  return panel.observeDocumentNode(directory, panel.canvasId, nodeId, onState);
}

async function resolveDocumentNodeFile(directory: string, path: string) {
  checkDirectory(directory);
  path = relativePath(path);
  if (!/^assets\/[^/]+\/content\.md$/i.test(path)) return;
  const caseFold = /^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(directory);
  const identity = (value: string) => caseFold ? value.replaceAll("\\", "/").toLowerCase() : value.replaceAll("\\", "/");
  const matches: { canvasPath: string; nodeId: string; label: string }[] = [];
  const sources = await readDocumentCanvases(directory);
  for (const source of sources.values()) for (const node of source.nodes) {
    if (node.type !== "remote-textNode") continue;
    const textPath = node.data?.textPath ?? `assets/${node.id}/content.md`;
    if (typeof textPath === "string" && identity(textPath) === identity(path)) matches.push({ canvasPath: source.path, nodeId: node.id, label: node.data?.label || node.id });
  }
  if (matches.length > 1) throw new Error("多个画布共用此节点正文，请先创建独立画布副本，再从对应节点编辑");
  return matches[0];
}

async function readDocumentCanvases(directory: string, options: DocumentNodeOptions = {}) {
  checkDirectory(directory);
  const signal = AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const windowsPath = /^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(directory);
  const identity = (path: string) => windowsPath ? path.replaceAll("\\", "/").toLowerCase() : path.replaceAll("\\", "/");
  const path = options.canvasPath ? relativePath(options.canvasPath) : "";
  const live = [...instances.values()].filter(panel => panel.canvasId && (!path || identity(panel.canvasId) === identity(path)));
  // 已加载画布直接取实时节点；展开单个 JSON 不再扫描其余画布和素材目录。
  if (path && live.length) return new Map(live.map(panel => [identity(panel.canvasId), { path: panel.canvasId, nodes: panel.getMentionNodes() }]));
  const stored = await readCanvasFiles(useWorkspaceFiles(directory), path, { signal, onError: options.onError });
  checkDirectory(directory);
  signal.throwIfAborted();
  const sources = new Map(stored.map(canvas => [identity(canvas.id), { path: canvas.id, nodes: canvas.data.nodes }]));
  for (const panel of live) sources.set(identity(panel.canvasId), { path: panel.canvasId, nodes: panel.getMentionNodes() });
  return sources;
}

async function readDocumentNodes(directory: string, options: DocumentNodeOptions = {}): Promise<DocumentNode[]> {
  const sources = await readDocumentCanvases(directory, options);
  return [...sources.values()].flatMap(source => source.nodes.filter(node => options.includeGroups || node.type !== "canvasGroup").map(node => ({
    canvasPath: source.path, nodeId: node.id, nodeType: node.type, parentNode: node.parentNode,
    label: typeof node.data?.label === "string" && node.data.label.trim() ? node.data.label : node.id,
  })));
}

function resolveCanvasContext(fileName: string): CanvasContext | undefined {
  fileName = canonicalCanvasPath(fileName);
  return [...instances.values()].find(instance => instance.canvasId === fileName)?.getCanvasContext();
}

function getCanvasContext() {
  return props.active ? activeInstance.value?.getCanvasContext() : undefined;
}

async function flushSave(action?: () => Promise<void>) {
  const panels = entries.value.map(entry => instances.get(entry.key)).filter((panel): panel is CanvasInstance => !!panel);
  if (!action) {
    await Promise.all(panels.map(panel => panel.flushSave()));
    return;
  }
  // 重命名文件期间暂停所有实例自动保存，目标实例同步新路径后再恢复。
  const run = (index: number): Promise<void> => index < panels.length ? panels[index]!.flushSave(() => run(index + 1)) : action();
  await run(0);
}

function relativePath(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(part => part && part !== ".");
  if (!parts.length || path.startsWith("/") || path.startsWith("\\") || /^[a-z][a-z\d+.-]*:/i.test(path) || parts.includes("..")) throw new Error("请选择工作区内的文件或目录");
  return parts.join("/");
}

function containsPath(parent: string, path: string) { return path === parent || path.startsWith(`${parent}/`); }
function canvasName(path: string) { return path.split("/").at(-1)!.replace(/\.json$/i, ""); }
function checkDirectory(directory: string) {
  lifetime.signal.throwIfAborted();
  if (!directory || workspaceStore.project?.directory !== directory) throw new Error("工作目录已切换，本次文件操作已停止");
}

function checkNodeResources(path: string) {
  const requested = path.toLowerCase();
  for (const panel of instances.values()) {
    for (const node of panel.getRetainedNodes()) {
      const data = node.data as { textPath?: unknown; outputs?: Record<string, { value?: unknown } | undefined> } | undefined;
      const references: unknown[] = [`assets/${node.id}`, data?.textPath];
      for (const output of Object.values(data?.outputs ?? {})) {
        if (output?.value && typeof output.value === "object" && "url" in output.value) references.push(output.value.url);
      }
      for (const reference of references) {
        if (typeof reference !== "string" || !reference || /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(reference)) continue;
        const resource = reference.replaceAll("\\", "/").split("/").filter(part => part && part !== ".").join("/").toLowerCase();
        // ACT: 包含撤销历史，并保守合并大小写；节点资源仍被运行时持有时拒绝移动，避免后台生成写回旧路径。
        if (containsPath(requested, resource) || containsPath(resource, requested)) throw new Error(`“${path}”仍被画布“${panel.canvasId}”中的节点使用，无法重命名或移动`);
      }
    }
  }
}

async function performFileAction(directory: string, action: "copy" | "rename" | "move" | "mkdir" | "delete", path: string, target?: string, nodeId?: string) {
  checkDirectory(directory);
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  path = relativePath(path);
  if (!["copy", "rename", "move", "mkdir", "delete"].includes(action)) throw new Error("不支持的文件操作");
  if (nodeId && action !== "delete") throw new Error("此操作不支持画布节点");
  if (action !== "delete" && action !== "mkdir") {
    if (!target) throw new Error("请提供目标文件名");
    target = relativePath(target);
    if (target === path) return;
  }
  if (target) target = relativePath(target);
  fileActionBusy = true;
  try {
    if (nodeId) {
      const panel = await ensureCanvas(path);
      checkDirectory(directory);
      const context = panel.getCanvasContext();
      if (!context) throw new Error("画布尚未就绪");
      await context.call({ name: "deleteNodes", args: { nodeIds: [nodeId] } }, lifetime.signal);
      checkDirectory(directory);
      return;
    }
    if (action === "rename" || action === "move") checkNodeResources(path);
    const files = useWorkspaceFiles(directory);
    const deletingPanels = new Set<CanvasInstance>();
    if (action === "delete") {
      const stored = await readCanvasFiles(files, path);
      checkDirectory(directory);
      if (stored.length) {
        const replacement = await findRemainingCanvas(files, path, lifetime.signal);
        checkDirectory(directory);
        if (!replacement) throw new Error("项目里需要保留至少一个画布。你可以先新建一个，再删除这个画布。");
        if (!canvases.value.some(canvas => canvas.id === replacement.id)) canvases.value = [...canvases.value, replacement];
      }
      for (const canvas of stored) {
        deletingPanels.add(await ensureCanvas(canvas.id));
        checkDirectory(directory);
      }
      for (const panel of instances.values()) if (panel.canvasId && containsPath(path, panel.canvasId)) deletingPanels.add(panel);
    }
    const removed = action === "delete" ? canvases.value.filter(canvas => containsPath(path, canvas.id)) : [];
    if (removed.length) {
      const replacement = canvases.value.find(canvas => !removed.includes(canvas));
      if (replacement && !entries.value.some(entry => {
        const id = instances.get(entry.key)?.canvasId;
        return id && !containsPath(path, id);
      })) await ensureCanvas(replacement.id);
    }
    await flushSave(async () => {
      checkDirectory(directory);
      if (action === "rename" || action === "move") checkNodeResources(path);
      const affected = canvases.value.filter(canvas => containsPath(path, canvas.id));
      if (action === "mkdir") {
        await files.mkdir(path);
      } else if (action === "copy") {
        const copies = await copyCanvasFiles(files, path, target!);
        checkDirectory(directory);
        if (copies.length) canvases.value = [...canvases.value, ...copies];
      } else if (action === "rename" || action === "move") {
        await files.rename(path, target!);
        checkDirectory(directory);
        for (const canvas of affected) {
          const previous = canvas.id;
          const id = `${target}${previous.slice(path.length)}`;
          Object.assign(canvas, { id, name: canvasName(id) });
          for (const panel of instances.values()) panel.syncCanvasPath(previous, id);
        }
        for (const entry of entries.value) {
          if (entry.fileName && containsPath(path, entry.fileName)) entry.fileName = `${target}${entry.fileName.slice(path.length)}`;
        }
        canvases.value = [...canvases.value];
      } else {
        for (const panel of deletingPanels) {
          await panel.prepareCanvasDelete();
          checkDirectory(directory);
        }
        await files.remove(path, true);
        checkDirectory(directory);
        // 共享列表移除会同步取消匹配实例的保存；只删除所选路径，不连带清理画布的素材。
        canvases.value = canvases.value.filter(canvas => !affected.includes(canvas));
        await nextTick();
      }
    });
  } finally { fileActionBusy = false; }
}

async function readDocumentNode(...args: Parameters<CanvasInstance["readDocumentNode"]>) {
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  checkDirectory(args[0]);
  const instance = await ensureCanvas(args[1]);
  checkDirectory(args[0]);
  args[1] = instance.canvasId;
  return instance.readDocumentNode(...args);
}

async function saveDocumentNode(...args: Parameters<CanvasInstance["saveDocumentNode"]>) {
  if (fileActionBusy) throw new Error("工作区文件正在操作，请稍后重试");
  checkDirectory(args[0]);
  const instance = await ensureCanvas(args[1]);
  checkDirectory(args[0]);
  args[1] = instance.canvasId;
  return instance.saveDocumentNode(...args);
}

async function importGallery(work: GalleryCanvas) {
  const directory = workspaceStore.project?.directory;
  if (!directory || fileActionBusy) throw new Error("请打开项目并等待当前文件操作完成");
  const copy = galleryCanvasCopy(work);
  const name = "分享-" + galleryFileStem(work.title) + "-" + crypto.randomUUID().slice(0, 8);
  const files = useWorkspaceFiles(directory);
  const created: { path: string; directory: string; written: boolean }[] = [];
  let publishing = false;
  fileActionBusy = true;
  try {
    if (work.nodes.some(node => node.media)) {
      await files.mkdir("assets").catch(error => { if (error.response?.data?.data?.code !== "EEXIST") throw error; });
    }
    for (const [i, node] of work.nodes.entries()) {
      if (!node.media) continue;
      checkDirectory(directory);
      const id = copy.nodes[i]!.id;
      const folder = "assets/" + id, path = galleryMediaPath(id, node.media);
      await files.mkdir(folder);
      const item = { directory: folder, path, written: false };
      created.push(item);
      await files.write(path, galleryMediaBlob(node.media), true);
      item.written = true;
    }
    checkDirectory(directory);
    publishing = true;
    await files.writeJson(name + ".json", copy, true);
  } catch (error) {
    // 写入响应丢失时先确认画布是否已发布，防止回滚导致已创建的画布丢失素材。
    if (publishing) {
      try {
        const saved = await files.readJson(name + ".json");
        if (JSON.stringify(saved) === JSON.stringify(copy)) {
          if (!lifetime.signal.aborted && workspaceStore.project?.directory === directory && !canvases.value.some(c => c.id === name + ".json")) canvases.value = [...canvases.value, { id: name + ".json", name }];
          return name + ".json";
        }
      } catch (lookup) {
        if (!axios.isAxiosError(lookup) || lookup.response?.data?.data?.code !== "ENOENT") throw new Error("无法确认副本保存结果，请检查原项目中的 " + name + ".json");
      }
    }
    for (const item of created) {
      for (const path of item.written ? [item.path, item.directory] : [item.directory]) {
        await files.remove(path).catch(cleanup => {
          if (cleanup.response?.data?.data?.code !== "ENOENT") throw new Error("导入失败，部分素材未能清理：" + item.directory);
        });
      }
    }
    throw error;
  } finally { fileActionBusy = false; }
  if (!lifetime.signal.aborted && workspaceStore.project?.directory === directory) canvases.value = [...canvases.value, { id: name + ".json", name }];
  return name + ".json";
}

function cancelSave() {
  for (const panel of instances.values()) panel.cancelSave();
}

function mentionInstance(canvasId: string) {
  canvasId = canonicalCanvasPath(canvasId);
  return [...instances.values()].find(panel => panel.canvasId === canvasId);
}

const mentionSource: MentionCanvasSource = {
  currentCanvasId: () => canvasId.value,
  async canvases(signal) {
    const directory = workspaceStore.project?.directory;
    const panel = activeInstance.value;
    if (!directory || !panel) return [];
    const callSignal = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
    const loaded = await panel.getCanvases(callSignal);
    checkDirectory(directory);
    callSignal.throwIfAborted();
    return loaded.map(canvas => ({ id: canvas.id, name: canvas.id.replace(/\.json$/i, "") }));
  },
  nodes(canvasId, options) {
    const panel = mentionInstance(canvasId);
    if (!panel) return;
    const nodes = panel.getMentionNodes();
    return queryMentionNodes(nodes, `${workspaceStore.project?.directory}:${canvasId}:${nodes.length}`, options);
  },
  outputs(canvasId, nodeId) {
    const panel = mentionInstance(canvasId);
    if (!panel) return;
    const node = panel.findMentionNode(nodeId);
    if (!node) throw new Error("节点已删除，请重新选择");
    return mentionNodeOutputs(node);
  },
  selectCanvas(canvasId, nodeId, outputId) {
    const panel = mentionInstance(canvasId);
    if (!panel) return;
    const node = panel.findMentionNode(nodeId);
    if (!node) throw new Error("节点已删除，请重新选择");
    const directory = workspaceStore.project?.directory;
    if (!directory) throw new Error("请先打开工作区");
    return createCanvasMention(node, canvasId, outputId, async path => {
      const text = await useWorkspaceFiles(directory).readText(path, 400001);
      if (text.length > 100000) throw new Error("文本引用最多支持 100000 个字符，请缩小内容后重试");
      return text;
    });
  },
};

defineExpose({
  importGallery,
  captureGallery: (...args: Parameters<CanvasInstance["captureGallery"]>) => {
    if (!activeInstance.value) throw new Error("请先打开要分享的画布");
    return activeInstance.value.captureGallery(...args);
  },
  adoptionContext: () => { if (!activeInstance.value) throw new Error('请打开来源画布'); return activeInstance.value.adoptionContext(); },
  verifyAdoption: async (...args: Parameters<CanvasInstance['verifyAdoption']>) => {
    const instance = activeInstance.value; if (!instance) throw new Error('请打开来源画布');
    const result = await instance.verifyAdoption(...args);
    if (activeInstance.value !== instance) throw new Error('来源画布已切换');
    return result;
  }, canvasId, canvasReady, canvasListReady, getCanvasContext, readDocumentNode, readDocumentNodes, focusDocumentNode, saveDocumentNode, mountDocumentNode, observeDocumentNode, resolveDocumentNodeFile, performFileAction, flushSave, cancelSave,
  openProductionCanvas, getVirtualStages, openVirtualStage, leaveVirtualStage, closeEditors,
  importWritingMaterials: (value: unknown, production?: unknown) => { if (!activeInstance.value) throw new Error("请先打开制片画布"); return activeInstance.value.importWritingMaterials(value, production); },
  importStorySources: (value: unknown, context: { directory: string; canvasPath: string }) => {
    if (!activeInstance.value) throw new Error("请先打开来源画布");
    return activeInstance.value.importStorySources(value, context);
  },
  addNodeAtPointer: () => activeInstance.value?.addNodeAtPointer(),
  openScriptSetup: () => activeInstance.value?.openScriptSetup(),
  openNodeSearch: () => activeInstance.value?.openNodeSearch(),
  mentionSource,
  get saveBusy() { return fileActionBusy || [...instances.values()].some(panel => panel.saveBusy); },
});
</script>

<style scoped lang="scss">
.canvasHost {
  position: relative;
  width: 100%;
  height: 100%;

  .canvasRuntime {
    position: absolute;
    inset: 0;

    &.backgroundCanvas {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
  }
}
</style>
