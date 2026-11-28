import { computed, onBeforeUnmount, shallowRef, watch } from "vue";

type Action = "read" | "check" | "download" | "install";
type Snapshot = {
  status: "idle" | "checking" | "current" | "available" | "downloading" | "ready";
  currentVersion: string;
  latestVersion: string;
  notes: string;
  received: number;
  total: number;
  error: string;
};

const hostOrigin = "http://127.0.0.1:6178";
const canvasOrigin = "http://127.0.0.1:6181";

function requestInstallerUpdate(action: Action, signal: AbortSignal) {
  return new Promise<Snapshot>((resolve, reject) => {
    signal.throwIfAborted();
    const { port1, port2 } = new MessageChannel();
    // A browser or an older host might never acknowledge the initial probe.
    const timeout = action === "read" ? window.setTimeout(() => {
      cleanup();
      reject(new Error("无法读取桌面更新状态，请重试"));
    }, 3000) : undefined;
    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      port1.close();
    }
    function abort() {
      cleanup();
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
    port1.onmessage = ({ data }) => {
      cleanup();
      if (data?.snapshot) resolve(data.snapshot);
      else reject(new Error(data?.error || "无法读取桌面更新结果，请重试"));
    };
    window.parent.postMessage({ type: "lum:installerUpdateRequest", action }, hostOrigin, [port2]);
  });
}

export function useInstallerUpdate(visible: () => boolean) {
  const embeddedDesktop = window.parent !== window && location.origin === canvasOrigin
    && new URLSearchParams(location.search).has("project") && URL.canParse(document.referrer)
    && new URL(document.referrer).origin === hostOrigin;
  const controller = new AbortController();
  const snapshot = shallowRef<Snapshot>();
  const activeAction = shallowRef<Exclude<Action, "read">>();
  const commandError = shallowRef("");
  const readError = shallowRef("");
  const checking = computed(() => activeAction.value === "check" || snapshot.value?.status === "checking");
  const downloading = computed(() => activeAction.value === "download" || snapshot.value?.status === "downloading");
  const busy = computed(() => !!activeAction.value || checking.value || downloading.value);
  const error = computed(() => commandError.value || snapshot.value?.error || readError.value);
  let pollTimer: number | undefined;
  let readGeneration = 0;

  function scheduleRead() {
    clearTimeout(pollTimer);
    if (visible() && (checking.value || downloading.value) && !controller.signal.aborted) {
      pollTimer = window.setTimeout(() => void refresh(), 750);
    }
  }

  async function refresh() {
    const generation = ++readGeneration;
    try {
      const state = await requestInstallerUpdate("read", controller.signal);
      if (generation === readGeneration && visible()) {
        snapshot.value = state;
        readError.value = "";
      }
    } catch (error) {
      if (generation === readGeneration && visible() && snapshot.value) {
        readError.value = error instanceof Error ? error.message : "无法读取桌面更新状态，请重试";
      }
    } finally {
      if (generation === readGeneration) scheduleRead();
    }
  }

  async function run(action: Exclude<Action, "read">) {
    if (!embeddedDesktop || !visible() || !snapshot.value || busy.value) return;
    activeAction.value = action;
    commandError.value = "";
    readError.value = "";
    ++readGeneration;
    scheduleRead();
    try {
      const state = await requestInstallerUpdate(action, controller.signal);
      if (!controller.signal.aborted) snapshot.value = state;
    } catch (error) {
      if (!controller.signal.aborted) commandError.value = error instanceof Error ? error.message : "桌面更新操作失败，请重试";
    } finally {
      ++readGeneration;
      activeAction.value = undefined;
      if (commandError.value && visible() && !controller.signal.aborted) void refresh();
      else scheduleRead();
    }
  }

  watch(visible, shown => {
    if (shown && embeddedDesktop) void refresh();
    else {
      ++readGeneration;
      clearTimeout(pollTimer);
    }
  }, { immediate: true });

  onBeforeUnmount(() => {
    ++readGeneration;
    controller.abort();
    clearTimeout(pollTimer);
  });

  return { embeddedDesktop, snapshot, activeAction, checking, downloading, busy, error, run };
}
