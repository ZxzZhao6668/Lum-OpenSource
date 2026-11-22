import { computed, nextTick, onScopeDispose, ref, shallowReactive, shallowRef, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { useNodeAi, type NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";
import { useNodeFiles } from "@lum/nodes-scaffold/workspaceFiles";
import { useNodeToolsContext } from "@lum/nodes-scaffold/nodeTools";
import type { NodeData } from "@lum/nodes-scaffold/connection";
import type { NodeGenerationTask } from "@lum/node-shared/useNodeGeneration";
import {
  createImageWorkbenchState, getImageWorkbenchSourceFingerprint, loadImageWorkbenchState,
  type ImageWorkbenchCandidate, type ImageWorkbenchCandidateOutput, type ImageWorkbenchSource,
  type ImageWorkbenchState, type ImageWorkbenchStoredPlan,
} from "./imageWorkbench";
import { describeWorkbenchAttempt, imageWorkbenchReferenceId, prepareWorkbenchAttempt, readWorkbenchReference, useImageWorkbenchChildren, validateWorkbenchReferenceCount } from "./imageWorkbenchChildren";
import { getImageWorkbenchTemplate, type ImageWorkbenchTemplateId } from "./imageWorkbenchTemplates";
import { useImageWorkbenchResults } from "./useImageWorkbenchResults";
import { clearStoryShotMapping, storySourcePlanError, useStoryGridSources } from "./useStoryGridSources";

export interface ImageWorkbenchOptions {
  source: () => ImageWorkbenchSource | undefined;
  sourceRevision?: () => string | undefined;
  templateId?: ImageWorkbenchTemplateId;
}

type CandidateGroup = { candidates: ImageWorkbenchCandidate[]; plan: ImageWorkbenchStoredPlan; cellId?: string };
type GenerationStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  error?: string;
};

const openWorkbenches = new WeakMap<object, symbol>();

function terminal(candidate: ImageWorkbenchCandidate) {
  return candidate.status === "succeeded" || candidate.status === "failed" || candidate.status === "cancelled";
}

function taskPending(task: NodeGenerationTask | undefined) {
  return !!task && task.state !== "failed" && task.state !== "cancelled" && (task.state !== "succeeded" || !task.applied);
}

function candidateGroups(plan: ImageWorkbenchStoredPlan): CandidateGroup[] {
  return [
    ...[...plan.cells, ...plan.dormantCells ?? []].map(cell => ({ plan, cellId: cell.id, candidates: cell.candidates })),
    { plan, candidates: plan.sheetCandidates },
  ];
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function outputOf(candidate: ImageWorkbenchCandidate, value: unknown): ImageWorkbenchCandidateOutput | undefined {
  if (!value || typeof value !== "object") return;
  const output = value as Partial<ImageWorkbenchCandidateOutput> & { taskId?: string };
  if (output.taskId !== candidate.id || output.handleId !== "image" || typeof output.path !== "string" || !output.path.trim()
    || output.path.length > 4096 || /^[\\/]|[<>:"|?*\x00-\x1f]/.test(output.path)
    || output.path.split(/[\\/]/).includes("..") || typeof output.mimeType !== "string"
    || !/^image\/[a-zA-Z0-9.+-]+$/.test(output.mimeType)) return;
  return { handleId: output.handleId, path: output.path, mimeType: output.mimeType };
}

function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function useImageWorkbench(options: ImageWorkbenchOptions) {
  const { id, node } = useNode<NodeData & { imageWorkbench?: unknown }>();
  const flow = useVueFlow();
  const getPersistence = useNodePersistence();
  const getNodeTools = useNodeToolsContext();
  const children = useImageWorkbenchChildren(node);
  const ai = useNodeAi();
  const files = useNodeFiles();
  const lifetime = new AbortController();
  const lease = Symbol();
  const error = ref("");
  const imageModels = shallowRef<NodeMediaModel[]>([]);
  const dispatching = ref(false);
  const preparing = ref(false);
  const submitting = shallowReactive(new Set<string>());
  let refreshRequest: Promise<void> | undefined;
  let operationBusy = false;
  const layoutSaving = ref(false);
  let targetOnly: string | undefined;
  let dispatchRevision = 0;
  let dispatchController: AbortController | undefined;
  let timer: ReturnType<typeof setInterval>;

  function currentSource() {
    const source = options.source();
    if (!source || source.nodeId !== id || flow.findNode(id) !== node) return;
    const reference = readWorkbenchReference(node, source.handleId);
    if (!reference || reference.path !== source.path) return;
    return { nodeId: source.nodeId, handleId: source.handleId, path: source.path };
  }
  function fingerprint(source: ImageWorkbenchSource) {
    return getImageWorkbenchSourceFingerprint(source, options.sourceRevision?.());
  }
  function sourceIdentity() {
    const source = currentSource();
    if (!source) return;
    const reference = readWorkbenchReference(node, source.handleId)!;
    return { ...source, fingerprint: fingerprint(source), output: node.data.outputs?.[source.handleId], mimeType: reference.mimeType };
  }

  const initialContext = getPersistence?.();
  if (openWorkbenches.has(node)) {
    throw new Error("此图片节点的工作台已打开");
  }
  openWorkbenches.set(node, lease);

  let initialState: ImageWorkbenchState | undefined;
  try {
    const source = currentSource();
    if (node.data.imageWorkbench !== undefined) initialState = loadImageWorkbenchState(node.data.imageWorkbench);
    else if (source) initialState = createImageWorkbenchState(options.templateId ?? "multiCamera9", source, fingerprint(source));
  } catch (failure) {
    error.value = message(failure);
  }
  // Retain the canvas instance identity so undo/reload cannot apply changes to a replaced plan.
  if (initialState) node.data.imageWorkbench = initialState;
  const boundState = shallowRef(initialState ? node.data.imageWorkbench as ImageWorkbenchState : undefined);
  const state = computed(() => node.data.imageWorkbench === boundState.value ? boundState.value : undefined);
  const sourceMatches = computed(() => !!state.value && state.value.source.nodeId === id && state.value.sourceFingerprint === sourceIdentity()?.fingerprint);
  const sourceReferenceId = computed(() => {
    const source = currentSource();
    return source ? imageWorkbenchReferenceId(id, source.handleId) : undefined;
  });
  const references = computed(() => flow.getNodes.value.flatMap(sourceNode =>
    !flow.nodesConnectable.value || sourceNode.connectable === false ? [] : (sourceNode.data.handles ?? []).flatMap(({ id: handleId }: { id: string }) => {
      const reference = readWorkbenchReference(sourceNode, handleId);
      return reference ? [reference] : [];
    }),
  ));
  const groups = computed(() => state.value ? [state.value, ...state.value.previousPlans ?? []].flatMap(candidateGroups) : []);
  function currentGroups(plan: ImageWorkbenchState) {
    return candidateGroups(plan).filter(group => !group.cellId || plan.cells.some(cell => cell.id === group.cellId)).filter(group => plan.mode === "sheet" ? !group.cellId : !!group.cellId);
  }
  function mediaTask(candidate: ImageWorkbenchCandidate) {
    return children.findChild(candidate)?.data.mediaTask as NodeGenerationTask | undefined;
  }
  function unavailableChildReason(candidate: ImageWorkbenchCandidate) {
    return flow.findNode(candidate.childNodeId) ? "同 ID 的节点已不属于此尝试" : "图片生成子节点已移除";
  }
  function hasPendingTask(candidate: ImageWorkbenchCandidate) {
    return !candidate.abandonedLocally && taskPending(mediaTask(candidate));
  }
  const activeCount = computed(() => groups.value.flatMap(group => group.candidates).filter(candidate =>
    hasPendingTask(candidate) || ["submitting", "running", "unknown"].includes(candidate.status),
  ).length);
  const requestCount = computed(() => state.value ? currentGroups(state.value).filter(group =>
    !group.candidates.length || group.candidates.at(-1)?.status === "queued",
  ).length : 0);
  const queuedCount = computed(() => state.value ? currentGroups(state.value)
    .filter(group => group.candidates.at(-1)?.status === "queued").length : 0);
  const submittingCount = computed(() => submitting.size);
  const selectedImageModel = computed(() => state.value && pickImageModel(state.value));
  const activeCandidates = computed(() => groups.value.flatMap(group => group.candidates)
    .filter(candidate => !terminal(candidate) && (candidate.status !== "queued" || !!mediaTask(candidate))));

  function bind() {
    const context = getPersistence?.();
    const plan = state.value;
    const source = sourceIdentity();
    if (!context || (initialContext && (initialContext.directory !== context.directory || initialContext.canvasPath !== context.canvasPath))) {
      throw new Error("工作区或画布已变化，请重新打开图片工作台");
    }
    function check(signal = lifetime.signal) {
      signal.throwIfAborted();
      const live = getPersistence?.();
      const current = sourceIdentity();
      if (openWorkbenches.get(node) !== lease || flow.findNode(id) !== node || live?.directory !== context!.directory
        || live.canvasPath !== context!.canvasPath || state.value !== plan || source?.fingerprint !== current?.fingerprint
        || source?.output !== current?.output || source?.mimeType !== current?.mimeType) {
        throw new Error("工作台画布、计划或原图已变化，请重新操作");
      }
    }
    check();
    return { context, plan, source, check };
  }
  type Binding = ReturnType<typeof bind>;
  function bindPlanning() {
    const binding = bind();
    return { ...binding, reference: currentReference(binding) };
  }
  const storySources = useStoryGridSources(state, references, bindPlanning, files.getWorkspaceFiles, lifetime.signal);

  function taskMatches(binding: Binding, candidate: ImageWorkbenchCandidate, task: NodeGenerationTask) {
    return task.taskId === candidate.id && task.nodeId === candidate.childNodeId && task.mediaType === "image"
      && task.directory === binding.context.directory && task.canvasPath === binding.context.canvasPath;
  }

  function localAbandonReason(binding: Binding, candidate: ImageWorkbenchCandidate) {
    if (!children.findChild(candidate)) return unavailableChildReason(candidate);
    const task = mediaTask(candidate);
    if (task && !taskMatches(binding, candidate, task)) return "子节点当前任务与此尝试的任务归属不匹配";
  }

  const results = useImageWorkbenchResults(node, () => {
    const binding = bind();
    const { source, plan } = binding;
    if (!source || !plan || source.fingerprint !== plan.sourceFingerprint || source.nodeId !== plan.source.nodeId
      || source.handleId !== plan.source.handleId || source.path !== plan.source.path) throw new Error("原图已变化，请明确新建图片工作台计划");
    const { nodeId, handleId, path, mimeType } = source;
    return { ...binding, plan, source: Object.freeze({ nodeId, handleId, path, mimeType }) };
  }, children.findChild, lifetime.signal, options.sourceRevision);

  async function persist(binding: Binding) {
    binding.check();
    if (!binding.plan) throw new Error("请先新建有效的图片工作台计划");
    loadImageWorkbenchState(binding.plan);
    await binding.context.save(lifetime.signal);
    binding.check();
  }

  function fail(failure: unknown) {
    if (lifetime.signal.aborted) return;
    error.value = message(failure);
    stopDispatch();
  }

  function stopDispatch() {
    dispatching.value = false;
    targetOnly = undefined;
    dispatchRevision++;
    dispatchController?.abort(new DOMException("已停止派发", "AbortError"));
    dispatchController = undefined;
  }

  async function save() {
    await perform(async binding => persist(binding));
  }

  async function perform<T>(action: (binding: Binding) => Promise<T>) {
    error.value = "";
    try {
      return await action(bind());
    } catch (failure) {
      fail(failure);
      throw failure;
    }
  }
  watch(() => [getPersistence?.()?.directory, getPersistence?.()?.canvasPath, flow.findNode(id)], ([directory, canvasPath, parent]) => {
    if (parent === node && (!initialContext || (directory === initialContext.directory && canvasPath === initialContext.canvasPath))) return;
    fail(new Error("工作台画布已变化，请重新打开图片工作台"));
    lifetime.abort();
    clearInterval(timer);
  }, { flush: "sync" });

  async function loadImageModels() {
    return perform(async binding => {
      const models = (await ai.getMediaModels(lifetime.signal, "generate")).filter(model => model.type === "image");
      binding.check();
      imageModels.value = models;
      return models;
    });
  }

  function currentReference(binding: Binding) {
    const plan = binding.plan;
    const source = plan && readWorkbenchReference(node, plan.source.handleId);
    if (!plan || !source || plan.source.nodeId !== id || source.path !== plan.source.path || binding.source?.fingerprint !== plan.sourceFingerprint) {
      throw new Error("原图已变化，请明确新建图片工作台计划");
    }
    return source;
  }

  function pickImageModel(plan: ImageWorkbenchState) {
    return plan.imageModel.followDefaultModel
      ? imageModels.value.find(item => item.isDefault) ?? imageModels.value[0]
      : imageModels.value.find(item => JSON.stringify([item.providerId, item.modelId]) === plan.imageModel.model);
  }

  function preflight(action: "start" | "resume" | "retry", cellId?: string) {
    const plan = state.value;
    if (!plan || !sourceMatches.value) return ["请先为当前原图新建计划"];
    const available = new Map(references.value.map(reference => [reference.id, reference]));
    const template = getImageWorkbenchTemplate(plan.templateId, plan.cells.length);
    return currentGroups(plan).flatMap(group => {
      const queued = group.candidates.at(-1);
      if (action === "retry" ? group.cellId !== cellId
        : queued ? queued.status !== "queued" : action === "resume") return [];
      const label = template.cells.find(cell => cell.id === group.cellId)?.label ?? "整张";
      try {
        if (action === "retry" || !queued) {
          const issue = storySourcePlanError(plan);
          if (issue) throw new Error(issue);
          const model = pickImageModel(plan);
          if (!model) throw new Error("请选择已启用的普通图片生成模型");
          describeWorkbenchAttempt(plan, group.cellId, model, available);
        } else {
          const child = children.findChild(queued);
          if (!child) throw new Error(unavailableChildReason(queued) + "，可放弃此尝试后重试");
          const { imageModel, references: snapshotReferences, sourceFingerprint, sourceMimeType } = queued.snapshot;
          if (sourceFingerprint !== plan.sourceFingerprint || (sourceMimeType && sourceMimeType !== sourceIdentity()?.mimeType)) {
            throw new Error("排队任务的原图已变化");
          }
          const { providerId, modelId, ratio, size } = imageModel;
          const model = imageModels.value.find(item => item.providerId === providerId && item.modelId === modelId);
          if (!model) throw new Error("排队任务的图片模型已不可用");
          if ((ratio !== undefined && !model.imageRatios?.includes(ratio)) || (size !== undefined && !model.imageSizes?.includes(size))) {
            throw new Error("排队任务的分辨率或比例已不可用");
          }
          validateWorkbenchReferenceCount(model, snapshotReferences.length);
          children.validateReferences(child, snapshotReferences, true);
        }
        return [];
      } catch (failure) {
        return [label + "：" + message(failure)];
      }
    });
  }

  async function replacePlan(templateId: ImageWorkbenchTemplateId) {
    return perform(async binding => {
      if (operationBusy || submitting.size) throw new Error("工作台正在准备提交，请稍后切换计划");
      stopDispatch();
      const source = currentSource();
      if (!source) throw new Error("此节点没有可用的图片输出");
      const next = createImageWorkbenchState(templateId, source, fingerprint(source));
      if (binding.plan) {
        const { previousPlans, ...previous } = binding.plan;
        next.previousPlans = [previous, ...previousPlans ?? []];
        next.languageModel = { ...previous.languageModel };
        next.imageModel = { ...previous.imageModel };
        next.concurrency = previous.concurrency;
      } else if (node.data.imageWorkbench !== undefined) {
        throw new Error("图片工作台原有存档无法加载");
      }
      loadImageWorkbenchState(next);
      node.data.imageWorkbench = next;
      boundState.value = node.data.imageWorkbench as ImageWorkbenchState;
      const replacement = bind();
      await persistStatus(replacement, () => {
        node.data.imageWorkbench = binding.plan;
        boundState.value = binding.plan;
      });
    });
  }

  async function resizeStory(count: number) {
    return perform(async binding => {
      const plan = binding.plan;
      if (!plan || plan.templateId !== "storyTwentyFiveGrid") throw new Error("请先选择自选剧情分格");
      const template = getImageWorkbenchTemplate(plan.templateId, count);
      currentReference(binding);
      if (count === plan.cells.length) return;
      if (operationBusy || submitting.size || dispatching.value || preparing.value || results.busy.value || activeCount.value || refreshRequest) {
        throw new Error("正在处理结果或存在运行中、状态未知的任务，请完成核对后调整格数");
      }
      operationBusy = true;
      layoutSaving.value = true;
      try {
        const next = loadImageWorkbenchState(plan);
        const allCells = [...next.cells, ...next.dormantCells ?? []];
        if (next.sheetCandidates.length) {
          const { previousPlans, dormantCells, ...history } = next;
          history.cells = history.cells.map(({ candidates, selectedCandidateId, ...cell }) => ({ ...cell, candidates: [] }));
          next.previousPlans = [history, ...previousPlans ?? []];
          next.sheetCandidates = [];
          delete next.selectedSheetCandidateId;
        }
        next.cells = template.cells.map((cell, index) => allCells[index] ?? {
          id: cell.id, prompt: cell.defaultPrompt, referenceIds: [], reason: "", candidates: [],
        });
        next.dormantCells = allCells.slice(count);
        if (next.storySources?.shots.length) clearStoryShotMapping(next);
        loadImageWorkbenchState(next);
        binding.check();
        node.data.imageWorkbench = next;
        boundState.value = node.data.imageWorkbench as ImageWorkbenchState;
        const replacement = bind();
        try { await persist(replacement); }
        catch (failure) {
          // Roll back only our own replacement, even if the source changed during save.
          if (node.data.imageWorkbench === boundState.value && boundState.value === replacement.plan) {
            node.data.imageWorkbench = plan;
            boundState.value = plan;
            const live = getPersistence?.();
            if (live?.directory === binding.context.directory && live.canvasPath === binding.context.canvasPath && flow.findNode(id) === node) {
              try { await binding.context.save(lifetime.signal); }
              catch (rollback) { throw new Error("格数已恢复，但回滚存档未确认，请保存计划：" + message(rollback), { cause: failure }); }
            }
          }
          throw failure;
        }
      } finally { operationBusy = false; layoutSaving.value = false; }
    });
  }

  function lookup(candidateId: string) {
    const group = groups.value.find(item => item.candidates.some(candidate => candidate.id === candidateId));
    const candidate = group?.candidates.find(item => item.id === candidateId);
    if (!group || !candidate) throw new Error("该候选尝试已不可用");
    return { ...group, candidate };
  }

  async function selectCandidate(candidateId: string) {
    await perform(async binding => {
      const { plan, cellId, candidate } = lookup(candidateId);
      if (candidate.status !== "succeeded" || !candidate.output) throw new Error("请选择有可用图片的已完成候选");
      const selected = cellId ? [...plan.cells, ...plan.dormantCells ?? []].find(cell => cell.id === cellId)! : plan;
      const key = cellId ? "selectedCandidateId" : "selectedSheetCandidateId";
      const previous = Reflect.get(selected, key);
      Reflect.set(selected, key, candidate.id);
      await persistStatus(binding, () => {
        if (Reflect.get(selected, key) === candidate.id) Reflect.set(selected, key, previous);
      });
    });
  }

  function registered(candidate: ImageWorkbenchCandidate, names: string[]) {
    const tools = getNodeTools();
    return [...tools.list([candidate.childNodeId], names)].length === names.length;
  }

  async function waitForChild(binding: Binding, candidate: ImageWorkbenchCandidate, names: string[]) {
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(6000)]);
    await nextTick();
    binding.check(signal);
    while (children.findChild(candidate) && !registered(candidate, names)) {
      await delay(50, signal);
      binding.check(signal);
    }
    const child = children.findChild(candidate);
    if (!child || !registered(candidate, names)) throw new Error("图片生成子节点尚未就绪，请检查画布节点插件");
    return child;
  }

  async function call(binding: Binding, candidate: ImageWorkbenchCandidate, name: "node:getConfig" | "node:setConfig" | "node:generateImage" | "node:getGenerationStatus" | "node:cancelGeneration", args: Record<string, unknown> = {}, signal = lifetime.signal) {
    binding.check(signal);
    if (!children.findChild(candidate)) throw new Error("图片生成子节点已移除或不匹配");
    const result = await getNodeTools().call({ nodeId: candidate.childNodeId, name, args }, signal);
    binding.check();
    if (!children.findChild(candidate)) throw new Error("图片生成子节点已变化");
    return result;
  }

  function updateCandidate(candidate: ImageWorkbenchCandidate, status: ImageWorkbenchCandidate["status"], fields: {
    taskId?: string; error?: string; output?: ImageWorkbenchCandidateOutput; abandonedLocally?: true;
  } = {}) {
    const reason = fields.error?.slice(0, 2000);
    if (candidate.status === status && candidate.taskId === fields.taskId && candidate.error === reason && !fields.output
      && candidate.abandonedLocally === fields.abandonedLocally) return;
    const before = { status: candidate.status, taskId: candidate.taskId, error: candidate.error, output: candidate.output, abandonedLocally: candidate.abandonedLocally };
    Object.assign(candidate, { status, taskId: fields.taskId, error: reason, output: fields.output, abandonedLocally: fields.abandonedLocally });
    return () => {
      if (candidate.status === status && candidate.taskId === fields.taskId && candidate.error === reason
        && candidate.abandonedLocally === fields.abandonedLocally) Object.assign(candidate, before);
    };
  }

  function reconcile(binding: Binding, candidate: ImageWorkbenchCandidate, status?: GenerationStatus) {
    const child = children.findChild(candidate);
    const task = mediaTask(candidate);
    if (terminal(candidate) || submitting.has(candidate.id)) return;
    if (!child && candidate.status === "queued") return;
    if (!child) return updateCandidate(candidate, "unknown", {
      taskId: candidate.taskId, error: unavailableChildReason(candidate) + "，可放弃本地等待",
    });
    const output = outputOf(candidate, child.data.imageWorkbenchResult);
    if (task && !taskMatches(binding, candidate, task)) {
      // A later terminal task may leave this candidate's original image intact.
      const image = output && readWorkbenchReference(child, output.handleId);
      if (task.taskId !== candidate.id && !taskPending(task) && status?.status !== "running"
        && output && image?.path === output.path && image.mimeType === output.mimeType) {
        return updateCandidate(candidate, "succeeded", { taskId: candidate.id, output });
      }
      return updateCandidate(candidate, "unknown", { taskId: candidate.taskId, error: "子节点当前任务与此尝试的任务归属不匹配，可核对供应商记录或放弃本地等待" });
    }
    if (output && status?.status !== "running" && !taskPending(task)) {
      return updateCandidate(candidate, "succeeded", { taskId: candidate.id, output });
    }
    if (task?.state === "failed" && status?.status !== "running") {
      return updateCandidate(candidate, "failed", { taskId: task.taskId, error: status?.error || "图片生成任务失败" });
    }
    if (task?.state === "cancelled" && status?.status !== "running") return updateCandidate(candidate, "cancelled", { taskId: task.taskId });
    if (status?.status === "running" && (!task || task.state !== "interrupted")) {
      return updateCandidate(candidate, "running", { taskId: task?.taskId });
    }
    if (task) {
      const taskId = task.taskId;
      if (task.state === "running" && status?.status !== "failed") return updateCandidate(candidate, "running", { taskId });
      if (task.state === "submitting" && !status) return updateCandidate(candidate, "submitting", { taskId });
      return updateCandidate(candidate, "unknown", { taskId, error: status?.error || "任务尚未确认出图，可复查此前任务" });
    }
    if (status?.status === "failed" && !candidate.taskId) return updateCandidate(candidate, "failed", { error: status.error || "子节点在提交前失败" });
    // A saved workbench marker can precede child tool execution. The child saves a task ID before calling the provider.
    if (status?.status === "idle" && candidate.status === "submitting" && !candidate.taskId) return updateCandidate(candidate, "queued");
    if (candidate.status === "queued") return;
    return updateCandidate(candidate, "unknown", { taskId: candidate.taskId, error: "暂未找到可确认的任务状态，请先核对子节点" });
  }

  async function refreshStatuses(binding: Binding) {
    if (!binding.plan) return;
    const undo: (() => void)[] = [];
    const candidates = [...activeCandidates.value];
    // ACT: the image nodes own polling. This reads local tool state only, and batches canvas writes.
    const statuses = await Promise.all(candidates.filter(candidate => !submitting.has(candidate.id)).map(async candidate => ({
      candidate,
      status: !localAbandonReason(binding, candidate) && registered(candidate, ["node:getGenerationStatus"])
        ? await call(binding, candidate, "node:getGenerationStatus") as GenerationStatus : undefined,
    })));
    for (const { candidate, status } of statuses) {
      binding.check();
      const restore = reconcile(binding, candidate, status);
      if (restore) undo.push(restore);
    }
    if (undo.length) await persistStatus(binding, () => undo.reverse().forEach(restore => restore()));
  }

  async function persistStatus(binding: Binding, undo: () => void) {
    try {
      await persist(binding);
    } catch (failure) {
      binding.check();
      undo();
      throw failure;
    }
  }

  async function refresh() {
    if (refreshRequest) return refreshRequest;
    error.value = "";
    return observe();
  }

  function observe() {
    if (refreshRequest) return refreshRequest;
    refreshRequest = Promise.resolve().then(() => refreshStatuses(bind())).catch(failure => {
      fail(failure);
      throw failure;
    }).finally(() => { refreshRequest = undefined; });
    return refreshRequest;
  }

  async function queueGroups(binding: Binding, requested: CandidateGroup[]) {
    const plan = binding.plan!;
    const source = currentReference(binding);
    if (!requested.length) return [];
    const selection = () => JSON.stringify([plan.templateId, plan.mode, plan.requirements, plan.imageModel, plan.storySources, plan.storyPlanning,
      plan.cells.map(cell => [cell.id, cell.prompt, cell.referenceIds])]);
    const savedSelection = selection();
    const available = new Map(references.value.map(reference => [reference.id, reference]));
    const models = await ai.getMediaModels(lifetime.signal, "generate");
    await storySources.validatePlan({ ...binding, reference: source });
    binding.check();
    if (savedSelection !== selection()) throw new Error("已修改图片生成计划，请重新开始");
    imageModels.value = models.filter(model => model.type === "image");
    const model = pickImageModel(plan);
    if (!model) throw new Error("请选择已启用的普通图片生成模型");
    const attempts = requested.map(group => prepareWorkbenchAttempt(plan, group.cellId, model, available, source.mimeType));
    const proposed = loadImageWorkbenchState(plan);
    for (const [index, attempt] of attempts.entries()) {
      candidateGroups(proposed).find(group => group.cellId === requested[index].cellId)!.candidates.push(attempt.candidate);
    }
    loadImageWorkbenchState(proposed);
    await children.createChildren(attempts, binding.check, () => {
      for (const attempt of attempts) attempt.group.push(attempt.candidate);
    });
    binding.check();
    return attempts.map(attempt => attempt.candidate);
  }

  async function dispatch(binding: Binding, candidate: ImageWorkbenchCandidate, revision: number) {
    const plan = binding.plan!;
    const source = currentReference(binding);
    const check = () => {
      binding.check();
      if (!dispatching.value || revision !== dispatchRevision || !currentGroups(plan).some(group => group.candidates.at(-1) === candidate)) {
        throw new DOMException("已停止派发", "AbortError");
      }
      const occupied = candidate.status === "submitting" ? activeCount.value - 1 : activeCount.value;
      if (occupied >= plan.concurrency) throw new DOMException("当前生成队列已满", "AbortError");
    };
    const names = ["node:getConfig", "node:setConfig", "node:getGenerationStatus", "node:generateImage"];
    const dispatchSignal = dispatchController?.signal ?? lifetime.signal;
    let invoked = false;
    submitting.add(candidate.id);
    try {
      const child = await waitForChild(binding, candidate, names);
      check();
      const status = await call(binding, candidate, "node:getGenerationStatus") as GenerationStatus;
      check();
      if (child !== children.findChild(candidate) || mediaTask(candidate) || status.status !== "idle") {
        await persistIfReconciled(binding, candidate, status);
        return;
      }
      const { prompt, references, imageModel, sourceFingerprint, sourceMimeType } = candidate.snapshot;
      if (sourceFingerprint !== plan.sourceFingerprint || (sourceMimeType && sourceMimeType !== source.mimeType)) throw new Error("排队任务的原图已变化");
      children.validateReferences(child, references, true);
      const attachmentDigests = candidate.snapshot.attachmentDigests;
      if (attachmentDigests?.length) {
        const workspace = files.getWorkspaceFiles();
        for (const attachment of attachmentDigests) {
          const current = await workspace.inspectBinary(attachment.path, dispatchSignal);
          check();
          if (current.sha256 !== attachment.sha256) throw new Error("排队任务的原图或素材文件已变化，请重新规划后新建尝试");
        }
      }
      const { providerId, modelId, size, ratio } = imageModel;
      const config = await call(binding, candidate, "node:getConfig") as {
        config: { providerId: string; modelId: string; size: string; ratio: string };
        models: NodeMediaModel[];
      };
      check();
      const model = config.models.find(item => item.type === "image" && item.providerId === providerId && item.modelId === modelId);
      if (!model) throw new Error("排队任务的图片模型已不可用");
      if ((size !== undefined && !model.imageSizes?.includes(size)) || (ratio !== undefined && !model.imageRatios?.includes(ratio))) {
        throw new Error("排队任务的分辨率或比例已不可用，可修改计划后新建尝试");
      }
      validateWorkbenchReferenceCount(model, references.length);
      const parameters = { ...(size !== undefined ? { size } : {}), ...(ratio !== undefined ? { ratio } : {}) };
      if (config.config.providerId !== providerId || config.config.modelId !== modelId
        || (size !== undefined && config.config.size !== size) || (ratio !== undefined && config.config.ratio !== ratio)) {
        await call(binding, candidate, "node:setConfig", { providerId, modelId, ...parameters });
        check();
      }
      if (child !== children.findChild(candidate) || mediaTask(candidate)) {
        await persistIfReconciled(binding, candidate);
        return;
      }
      children.validateReferences(child, references, true);
      updateCandidate(candidate, "submitting");
      await persist(binding);
      check();
      if (child !== children.findChild(candidate) || mediaTask(candidate)) {
        await persistIfReconciled(binding, candidate);
        return;
      }
      children.validateReferences(child, references, true);
      const toBinding = ({ nodeId, handleId, path, mimeType }: typeof source | typeof references[number]) => ({ nodeId, handleId, path, mimeType });
      invoked = true;
      await call(binding, candidate, "node:generateImage", { workbench: {
        taskId: candidate.id, directory: binding.context.directory, canvasPath: binding.context.canvasPath,
        source: toBinding(source), references: references.map(toBinding), prompt, providerId, modelId, ...parameters,
      } }, dispatchSignal);
      binding.check();
      const task = mediaTask(candidate);
      const restore = updateCandidate(candidate, "running", { taskId: task?.taskId === candidate.id ? task.taskId : undefined });
      if (restore) await persistStatus(binding, restore);
    } catch (failure) {
      if (lifetime.signal.aborted) return;
      binding.check();
      const stopped = failure instanceof DOMException && failure.name === "AbortError";
      const restore = invoked && stopped ? undefined
        : invoked ? updateCandidate(candidate, "unknown", { error: message(failure), taskId: candidate.taskId })
        : stopped || candidate.status === "submitting" ? updateCandidate(candidate, "queued")
          : updateCandidate(candidate, "failed", { error: message(failure) });
      if (restore) await persistStatus(binding, restore);
      if (!stopped) throw failure;
    } finally {
      submitting.delete(candidate.id);
    }
  }

  async function persistIfReconciled(binding: Binding, candidate: ImageWorkbenchCandidate, status?: GenerationStatus) {
    submitting.delete(candidate.id);
    const undo = reconcile(binding, candidate, status)
      || (candidate.status === "queued" ? updateCandidate(candidate, "unknown", { error: "子节点已启动生成，等待任务归属确认" }) : undefined);
    if (undo) await persistStatus(binding, undo);
  }

  let pumping = false;
  async function pump() {
    if (pumping || layoutSaving.value || lifetime.signal.aborted) return;
    pumping = true;
    try {
      await observe();
      while (dispatching.value && state.value && activeCount.value < state.value.concurrency) {
        const binding = bind();
        const plan = binding.plan;
        if (!plan) break;
        const candidate = currentGroups(plan).map(group => group.candidates.at(-1))
          .find(item => item?.status === "queued" && (!targetOnly || targetOnly === item.id));
        if (!candidate) break;
        if (mediaTask(candidate)) {
          await persistIfReconciled(binding, candidate);
          continue;
        }
        await dispatch(binding, candidate, dispatchRevision);
      }
      if (dispatching.value && state.value && !currentGroups(state.value).some(group =>
        group.candidates.at(-1)?.status === "queued" && (!targetOnly || targetOnly === group.candidates.at(-1)?.id))) stopDispatch();
    } catch (failure) {
      fail(failure);
    } finally {
      pumping = false;
    }
  }

  async function prepare(action: (binding: Binding) => Promise<void>) {
    if (operationBusy) throw new Error("正在准备图片工作台，请稍后再试");
    operationBusy = true;
    preparing.value = true;
    try {
      await perform(action);
    } finally {
      operationBusy = false;
      preparing.value = false;
    }
  }

  async function start(onlyQueued = false) {
    if (dispatching.value) return;
    await prepare(async binding => {
      const revision = dispatchRevision;
      currentReference(binding);
      const plan = binding.plan!;
      if (!onlyQueued) await queueGroups(binding, currentGroups(plan).filter(group => !group.candidates.length));
      binding.check();
      await persist(binding);
      binding.check();
      if (revision !== dispatchRevision) return;
      dispatchController = new AbortController();
      dispatching.value = true;
      void pump();
    });
  }

  async function retryCell(cellId?: string) {
    await prepare(async binding => {
      const revision = dispatchRevision;
      currentReference(binding);
      const group = currentGroups(binding.plan!).find(item => item.cellId === cellId);
      const previous = group?.candidates.at(-1);
      if (!group || !previous || !terminal(previous) || hasPendingTask(previous)) {
        throw new Error("此格仍有排队或未确认的任务，请先复查或明确放弃");
      }
      const [attempt] = await queueGroups(binding, [group]);
      binding.check();
      await persist(binding);
      binding.check();
      if (revision !== dispatchRevision) return;
      if (!dispatching.value) {
        targetOnly = attempt.id;
        dispatchController = new AbortController();
      }
      else if (targetOnly) targetOnly = undefined;
      dispatching.value = true;
      void pump();
    });
  }

  async function query(candidateId: string) {
    return perform(async binding => {
      const { candidate } = lookup(candidateId);
      if (terminal(candidate) || submitting.has(candidate.id)) return;
      if (localAbandonReason(binding, candidate)) {
        await persistIfReconciled(binding, candidate);
        return;
      }
      const child = await waitForChild(binding, candidate, ["node:getGenerationStatus", "node:generateImage"]);
      binding.check();
      if (localAbandonReason(binding, candidate)) {
        await persistIfReconciled(binding, candidate);
        return;
      }
      const status = await call(binding, candidate, "node:getGenerationStatus") as GenerationStatus;
      binding.check();
      const undo = reconcile(binding, candidate, status);
      if (undo) await persistStatus(binding, undo);
      binding.check();
      if (localAbandonReason(binding, candidate)) {
        await persistIfReconciled(binding, candidate);
        return;
      }
      const task = mediaTask(candidate);
      if (child !== children.findChild(candidate) || terminal(candidate) || status.status === "running" || !taskPending(task)) return;
      if (!task || !taskMatches(binding, candidate, task)) throw new Error("此尝试没有匹配的可复查任务，可放弃本地等待");
      if (task.state === "interrupted" && task.resumable === false) throw new Error("供应商未提供可恢复任务，请先核对供应商结果");
      await call(binding, candidate, "node:generateImage", { expectedTaskId: task.taskId });
      binding.check();
    });
  }

  async function abandon(candidateId: string) {
    return perform(async binding => {
      const { candidate } = lookup(candidateId);
      if (terminal(candidate) || submitting.has(candidate.id)) throw new Error("该候选当前不能放弃");
      stopDispatch();
      async function abandonLocally(reason: string) {
        binding.check();
        const queued = candidate.status === "queued" && !candidate.taskId;
        const restore = updateCandidate(candidate, "cancelled", {
          abandonedLocally: true, taskId: candidate.taskId,
          error: reason + (queued ? "，已放弃此排队尝试" : "，已放弃本地等待，供应商任务状态仍待核对"),
        });
        if (restore) await persistStatus(binding, restore);
      }
      let localReason = localAbandonReason(binding, candidate);
      if (localReason) {
        await abandonLocally(localReason);
        return;
      }
      await waitForChild(binding, candidate, ["node:getGenerationStatus", "node:cancelGeneration"]);
      binding.check();
      localReason = localAbandonReason(binding, candidate);
      if (localReason) {
        await abandonLocally(localReason);
        return;
      }
      const status = await call(binding, candidate, "node:getGenerationStatus") as GenerationStatus;
      binding.check();
      if (terminal(candidate)) return;
      localReason = localAbandonReason(binding, candidate);
      if (localReason) {
        await abandonLocally(localReason);
        return;
      }
      const undo = reconcile(binding, candidate, status);
      if (undo) await persistStatus(binding, undo);
      binding.check();
      if (terminal(candidate)) return;
      localReason = localAbandonReason(binding, candidate);
      if (localReason) {
        await abandonLocally(localReason);
        return;
      }
      const task = mediaTask(candidate);
      const result = await call(binding, candidate, "node:cancelGeneration", task
        ? { expectedTaskId: task.taskId } : { expectedNoTask: true }) as GenerationStatus;
      binding.check();
      if (task ? mediaTask(candidate)?.state !== "cancelled" : mediaTask(candidate) || result.status === "running") {
        throw new Error("任务尚未确认放弃，请复查后台状态");
      }
      const restore = updateCandidate(candidate, "cancelled", { taskId: task?.taskId });
      if (restore) await persistStatus(binding, restore);
    });
  }

  timer = setInterval(() => { void pump(); }, 1200);
  void pump();
  onScopeDispose(() => {
    stopDispatch();
    clearInterval(timer);
    lifetime.abort();
    if (openWorkbenches.get(node) === lease) openWorkbenches.delete(node);
  });

  return {
    state, references, sourceReferenceId, sourceMatches, imageModels, selectedImageModel, activeCount, requestCount, queuedCount, submittingCount, dispatching, preparing, layoutSaving, error, results,
    loadImageModels, replacePlan, resizeStory, save, refresh, start, resume: () => start(true), stopDispatch, query, abandon, retryCell, selectCandidate, preflight,
    bindPlanning, storySources,
  };
}
