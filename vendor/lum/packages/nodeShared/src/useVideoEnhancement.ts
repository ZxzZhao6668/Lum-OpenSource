import { computed, onScopeDispose, watch } from "vue";
import { useVueFlow, type GraphNode } from "@vue-flow/core";
import { useNodeAi, type EnhancementTaskSnapshot } from "@lum/nodes-scaffold/nodeAi";
import { useNodePersistence } from "@lum/nodes-scaffold/nodeDocument";
import { enhancementClaimsSlot, enhancementError, enhancementReady, enhancementView, ownedEnhancementAttempt, sameSource, type VideoEnhancementAttempt, type VideoEnhancementData } from "./videoEnhancement";

export function useVideoEnhancement() {
  const flow = useVueFlow();
  const getPersistence = useNodePersistence();
  const ai = useNodeAi();
  let disposed = false;
  onScopeDispose(() => { disposed = true; });

  function capture(node: GraphNode) {
    const context = getPersistence?.();
    const data: VideoEnhancementData = node.data;
    const attempt = ownedEnhancementAttempt(node, context);
    if (!context || !attempt || attempt.request.outputDirectory !== `assets/${node.id}` || attempt.request.operation !== "upscale"
      || attempt.request.enhancement.sourceHandleId !== "video"
      || attempt.request.enhancement.source.path !== attempt.source.path
      || attempt.request.enhancement.sourceSha256 !== attempt.source.metadata.sha256) {
      throw Error("此节点不拥有原超分任务，或任务快照已变化");
    }
    const identity = JSON.stringify(attempt);
    const check = () => {
      const current = getPersistence?.();
      if (disposed || current?.directory !== context.directory || current.canvasPath !== context.canvasPath
        || flow.findNode(node.id) !== node || node.data !== data || JSON.stringify(data.videoEnhancementAttempt) !== identity) {
        throw Error("超分节点、画布或工作区已切换");
      }
    };
    check();
    return { context, data, attempt: JSON.parse(identity) as VideoEnhancementAttempt, check };
  }

  async function update(node: GraphNode, captured: ReturnType<typeof capture>, snapshot: EnhancementTaskSnapshot) {
    const { context, data, attempt, check } = captured;
    const { owner } = attempt, view = enhancementView(node);
    check();
    if (snapshot.taskId !== owner.taskId || snapshot.nodeId !== owner.nodeId || snapshot.canvasPath !== owner.canvasPath
      || snapshot.preparation && snapshot.preparation.metadata.sha256 !== attempt.source.metadata.sha256) throw Error("服务端任务与原超分快照不一致");
    view.queried = true;
    view.missing = false;
    view.progress = snapshot.progress;
    const { progress: _progress, ...saved } = snapshot;
    const previous = data.videoEnhancementSnapshot, previousIntent = data.videoEnhancementIntent, previousIssue = data.videoEnhancementIssue;
    const terminal = ["failed", "cancelled", "succeeded"].includes(snapshot.state);
    const nextIntent = terminal || previousIntent !== "abandon" && (snapshot.state === "running" || snapshot.state === "interrupted")
      ? undefined : previousIntent;
    if (JSON.stringify(previous) === JSON.stringify(saved) && previousIntent === nextIntent && !previousIssue) return;
    // 保存失败会恢复原状态，槽位也必须保留到保存完成。
    view.holdingSlot = enhancementClaimsSlot(data);
    data.videoEnhancementIntent = nextIntent;
    data.videoEnhancementIssue = undefined;
    data.videoEnhancementSnapshot = saved;
    try {
      await context.save();
      check();
    } catch (error) {
      check();
      data.videoEnhancementSnapshot = previous;
      data.videoEnhancementIntent = previousIntent;
      data.videoEnhancementIssue = previousIssue;
      throw error;
    } finally { view.holdingSlot = false; }
  }

  async function act(node: GraphNode, action: "prepare" | "submit" | "read" | "resume" | "abandon", signal?: AbortSignal, beforeDispatch?: () => void) {
    const view = enhancementView(node);
    if (view.busy) return;
    const captured = capture(node), { context, data, attempt, check } = captured;
    const { owner, request } = attempt;
    view.busy = true;
    if (action !== "read" && action !== "submit") view.error = undefined;
    try {
      let snapshot: EnhancementTaskSnapshot;
      if (action === "prepare" || action === "submit") {
        const assertSource = () => {
          signal?.throwIfAborted();
          check();
          beforeDispatch?.();
          const { sourceNodeId } = request.enhancement;
          const sourceNode = flow.findNode(sourceNodeId);
          if (!sameSource(sourceNode, attempt.source.path, request.enhancement.source.mimeType)) throw Error("源视频输出已变化，旧报价不可提交");
        };
        assertSource();
        if (action === "prepare") {
          if (data.videoEnhancementPreparing || data.videoEnhancementSnapshot || data.videoEnhancementIntent) throw Error("请查询这条原任务");
          data.videoEnhancementPreparing = true;
          try { await context.save(signal); assertSource(); }
          catch (error) {
            check();
            data.videoEnhancementPreparing = undefined;
            await context.save().catch(() => {});
            throw error;
          }
          snapshot = await ai.prepareEnhancement("video", request, owner);
        } else {
          const prepared = data.videoEnhancementSnapshot;
          const quote = prepared?.preparation;
          if (prepared?.state !== "prepared" || !quote?.cost || !quote.seconds || !quote.validUntil || quote.validUntil <= Date.now()
            || data.videoEnhancementIntent || !view.queried || view.missing || view.error) throw Error("原报价待核对、不可用或已过期");
          data.videoEnhancementIntent = "submit";
          try {
            await context.save(signal);
            assertSource();
            if (data.videoEnhancementSnapshot !== prepared || data.videoEnhancementIntent !== "submit" || quote.validUntil <= Date.now()) throw Error("原报价已变化或过期");
          } catch (error) {
            check();
            if (data.videoEnhancementIntent === "submit") {
              data.videoEnhancementIntent = undefined;
              await context.save().catch(() => {});
            }
            throw error;
          }
          snapshot = await ai.submitEnhancement("video", request, owner, quote.preparationId);
        }
      } else if (action === "abandon" || action === "resume") {
        if (action === "resume" && (data.videoEnhancementSnapshot?.state !== "interrupted" || !data.videoEnhancementSnapshot.resumable
          || data.videoEnhancementIntent === "abandon")) throw Error("原任务没有可用的同 ID 恢复状态");
        const previous = data.videoEnhancementIntent;
        data.videoEnhancementIntent = action;
        try {
          await context.save(signal);
          signal?.throwIfAborted();
          check();
          beforeDispatch?.();
        } catch (error) {
          check();
          data.videoEnhancementIntent = previous;
          await context.save().catch(() => {});
          throw error;
        }
        snapshot = action === "abandon" ? await ai.abandonEnhancement(context.directory, owner) : await ai.readEnhancement(context.directory, owner, true);
      } else {
        snapshot = await ai.readEnhancement(context.directory, owner, false, signal);
      }
      await update(node, captured, snapshot);
      view.error = undefined;
    } catch (error) {
      if (action !== "read" || !signal?.aborted) {
        check();
        const failure = error as { status?: number; data?: { missingEnhancementTask?: boolean } };
        if (action === "read" && failure.status === 404 && failure.data?.missingEnhancementTask === true) {
          view.queried = true;
          view.missing = true;
          view.error = undefined;
          return;
        }
        view.error = enhancementError(error);
        if (action === "prepare") {
          data.videoEnhancementIssue = view.error;
          await context.save().catch(() => {});
        }
      }
      if (action !== "read") throw error;
    } finally { view.busy = false; }
  }
  return { ai, flow, getPersistence, capture, act };
}

export function useVideoEnhancementChild(node: GraphNode, attach: (output?: { url: string; mimeType: string }) => void) {
  const tasks = useVideoEnhancement();
  const view = enhancementView(node);
  const data = computed<VideoEnhancementData>(() => node.data);
  const attempt = computed(() => data.value.videoEnhancementAttempt);
  const owned = computed(() => {
    if (!attempt.value) return false;
    try { tasks.capture(node); return true; } catch { return false; }
  });
  const ready = computed(() => enhancementReady(node));

  async function attachResult() {
    if (view.saving || view.missing || !owned.value || ready.value) return;
    const { check, context, data: record, attempt: frozen } = tasks.capture(node);
    const snapshot = record.videoEnhancementSnapshot;
    if (snapshot?.state !== "succeeded" || snapshot.result?.code !== 200 || snapshot.result.data?.length !== 1 || record.videoEnhancementResult) return;
    const [result] = snapshot.result.data;
    if (!result || result.mediaType !== "video" || result.mimeType !== "video/mp4"
      || !result.path.startsWith(frozen.request.outputDirectory + "/") || !/^enhanced\d+x\d+[a-f0-9-]+\.mp4$/.test(result.path.split("/").at(-1) ?? "")
      || node.data.outputs?.video) { view.error = "校验结果与原节点输出不匹配"; return; }
    view.saving = true;
    view.error = undefined;
    const marker = { taskId: frozen.owner.taskId, path: result.path, mimeType: result.mimeType };
    record.videoEnhancementResult = marker;
    attach({ url: result.path, mimeType: result.mimeType });
    try {
      await context.save();
      check();
      view.error = undefined;
    } catch (error) {
      try {
        check();
        const output = node.data.outputs?.video?.value;
        if (record.videoEnhancementResult?.taskId === marker.taskId && record.videoEnhancementResult?.path === marker.path
          && output?.url === marker.path && output?.mimeType === marker.mimeType) {
          record.videoEnhancementResult = undefined;
          attach(undefined);
        }
        view.error = enhancementError(error);
      } catch { /* A detached node must not mutate its replacement. */ }
    } finally { view.saving = false; }
  }

  watch([owned, attempt], ([active], _previous, onCleanup) => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => { controller.abort(); clearTimeout(timer); });
    async function poll() {
      const snapshot = data.value.videoEnhancementSnapshot;
      if (controller.signal.aborted || !owned.value || ready.value) return;
      if (!view.busy) {
        // 即使关闭面板，也只读原任务；没有准备、接单或恢复的自动动作。
        if (!(view.queried && !data.value.videoEnhancementIntent && ["prepared", "preparationUnknown", "interrupted", "failed", "cancelled", "succeeded"].includes(snapshot?.state ?? ""))) {
          await tasks.act(node, "read", controller.signal).catch(() => {});
        }
        if (!controller.signal.aborted && view.queried) await attachResult().catch(error => { view.error = enhancementError(error); });
      }
      if (!controller.signal.aborted && !ready.value) timer = setTimeout(poll, view.missing || view.error ? 4500 : 1800);
    }
    void poll();
  }, { immediate: true });

  async function action(value: "read" | "resume" | "abandon", beforeDispatch?: () => void) {
    await tasks.act(node, value, undefined, beforeDispatch);
    if (view.queried) await attachResult();
  }
  return { attempt, owned, ready, view, action };
}
