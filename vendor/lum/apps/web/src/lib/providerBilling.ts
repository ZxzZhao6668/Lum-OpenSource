import { translate } from "@lum/i18n/vue";
import axios from "axios";
import { onScopeDispose, ref, watch } from "vue";
import type { ProviderBalance } from "@lum/providers";
import { settings } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

type BalanceSnapshot = { accountId: string; balance: ProviderBalance | null; revision: number };

async function getProviderBalance(providerId: string, signal?: AbortSignal) {
  const entry = providerBalances.value.find(item => item.id === providerId);
  const { data } = await axios.post<{ code: number; data: BalanceSnapshot; message?: string }>("/api/ai/media/balance", {
    providerId,
  }, { signal, timeout: 25000, headers: { "x-lum-workspace": "1" } });
  if (data.code !== 200) throw new Error(data.message || "余额查询失败，请重试");
  if (entry && !signal?.aborted && providerBalances.value.includes(entry)) {
    if (entry.accountId !== data.data.accountId) entry.revision = -1;
    entry.accountId = data.data.accountId;
    applySnapshot(data.data);
  }
  return data.data;
}

type BalanceProvider = { id: string; label: string; supportsBalance?: boolean };
type BalanceEntry = BalanceSnapshot & { id: string; label: string; configKey: string; loading: boolean; error: string };
export const providerBalances = ref<BalanceEntry[]>([]);
const balanceRequests = new Map<string, { entry: BalanceEntry; controller: AbortController; signal: AbortSignal; pending: Promise<void> }>();

function applySnapshot(snapshot: BalanceSnapshot) {
  const entry = providerBalances.value.find(item => item.accountId === snapshot.accountId);
  if (!entry || snapshot.revision < entry.revision) return;
  entry.revision = snapshot.revision;
  entry.balance = snapshot.balance;
  entry.error = "";
}

export function refreshProviderBalance(providerId: string, signal?: AbortSignal): Promise<void> {
  const entry = providerBalances.value.find(item => item.id === providerId);
  if (!entry || signal?.aborted) return Promise.resolve();
  const previous = balanceRequests.get(providerId);
  if (previous?.entry === entry && !previous.signal.aborted) return previous.pending;
  const controller = new AbortController();
  const request = { entry, controller, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, pending: Promise.resolve() };
  balanceRequests.set(providerId, request);
  entry.loading = true;
  request.pending = (async () => {
    try {
      await getProviderBalance(providerId, request.signal);
    } catch (error) {
      if (!request.signal.aborted && providerBalances.value.includes(entry)) {
        // 服务重启后的旧 ID 不得留在批量订阅中，避免一个失败账户拖垮整组通知。
        entry.accountId = "";
        entry.error = axios.isAxiosError<{ message?: string }>(error)
          ? error.response?.data?.message || error.message : error instanceof Error ? error.message : translate("余额查询失败，请重试");
      }
    } finally {
      if (balanceRequests.get(providerId) === request) {
        balanceRequests.delete(providerId);
        entry.loading = false;
      }
    }
  })();
  return request.pending;
}

export function useProviderBalances() {
  const workspaceStore = useWorkspaceStore();
  let providers: BalanceProvider[] = [];
  let request: AbortController | undefined;
  let snapshotRequest: AbortController | undefined;
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotDelay = 3000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscriptionTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1000;
  let disposed = false;
  let refreshRequested = false;

  function syncProviders() {
    const configs = settings.value.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
    const previousEntries = new Map(providerBalances.value.map(entry => [entry.id, entry]));
    providerBalances.value = providers.filter(item => item.supportsBalance).map(provider => {
      const configKey = JSON.stringify(configs?.[provider.id] ?? {});
      const previous = previousEntries.get(provider.id);
      if (previous?.configKey === configKey) {
        previous.label = provider.label;
        return previous;
      }
      return {
        id: provider.id, label: provider.label, configKey, accountId: "", revision: -1, balance: null, loading: false, error: "",
      };
    });
  }

  function stopSnapshots() {
    clearTimeout(snapshotTimer);
    snapshotRequest?.abort();
    snapshotRequest = undefined;
  }

  function subscribe() {
    stopSnapshots();
    if (disposed || document.visibilityState === "hidden") return;
    const ids = [...new Set(providerBalances.value.map(item => item.accountId).filter(Boolean))].sort();
    if (!ids.length) return;
    const groups = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, index * 100 + 100));
    const controller = new AbortController();
    snapshotRequest = controller;
    // ACT: Read only cached balances in short requests; visible windows never reserve HTTP/1 connections.
    void (async () => {
      try {
        for (const group of groups) {
          const { data } = await axios.get<{ code: number; data: BalanceSnapshot[] }>("/api/ai/media/balanceEvents", {
            params: { accountIds: group.join(","), snapshot: true }, signal: controller.signal, timeout: 10000,
          });
          if (controller.signal.aborted) return;
          if (data.code !== 200 || !Array.isArray(data.data)) throw new Error("余额通知快照无效");
          data.data.forEach(applySnapshot);
        }
        snapshotDelay = 3000;
      } catch (error) {
        if (controller.signal.aborted) return;
        snapshotDelay = Math.min(snapshotDelay * 2, 30000);
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          // Server restart invalidates account IDs. Do not turn notification polling into provider queries.
          for (const entry of providerBalances.value) if (ids.includes(entry.accountId)) {
            entry.accountId = "";
            entry.error = translate("余额账户已失效，请刷新余额");
          }
        }
      } finally {
        if (snapshotRequest === controller) snapshotRequest = undefined;
        if (!disposed && !controller.signal.aborted && document.visibilityState !== "hidden") {
          snapshotTimer = setTimeout(subscribe, snapshotDelay);
        }
      }
    })();
  }

  function scheduleSubscribe() {
    if (disposed || document.visibilityState === "hidden" || subscriptionTimer !== undefined) return;
    // 合并同批返回的账户；已读到的余额立即订阅，不等其他供应商超时或完成排队。
    subscriptionTimer = setTimeout(() => {
      subscriptionTimer = undefined;
      if (!disposed) subscribe();
    }, 100);
  }

  async function refresh() {
    if (disposed || document.visibilityState === "hidden") return;
    if (request) { refreshRequested = true; return; }
    refreshRequested = false;
    const controller = new AbortController();
    request = controller;
    try {
      const { data } = await axios.get<{ code: number; data: BalanceProvider[] }>("/api/providers/media/list", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (data.code !== 200 || !Array.isArray(data.data)) throw new Error("读取媒体供应商失败");
      providers = data.data;
      syncProviders();
      const pending = [...providerBalances.value];
      // 多供应商分批查询，不让一次显示占满所有 HTTP 连接。
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        let entry: BalanceEntry | undefined;
        while (!controller.signal.aborted && (entry = pending.shift())) {
          await refreshProviderBalance(entry.id, controller.signal);
        }
      }));
      if (!controller.signal.aborted) { reconnectDelay = 1000; scheduleSubscribe(); }
    } catch (error) {
      if (!controller.signal.aborted) {
        for (const entry of providerBalances.value) entry.error = error instanceof Error ? error.message : translate("余额查询失败，请重试");
        retryConnection();
      }
    } finally {
      if (request === controller) {
        request = undefined;
        if (refreshRequested && !controller.signal.aborted) scheduleRefresh();
      }
    }
  }

  function retryConnection() {
    if (disposed || document.visibilityState === "hidden") return;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function scheduleRefresh() {
    if (document.visibilityState === "hidden") return;
    clearTimeout(timer);
    // ACT: 合并同一次窗口显示事件；多画布共用工作区这一处监听。
    timer = setTimeout(() => void refresh(), 200);
  }

  function syncVisibility() {
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      clearTimeout(subscriptionTimer);
      subscriptionTimer = undefined;
      stopSnapshots();
    } else {
      scheduleSubscribe();
      scheduleRefresh();
    }
  }

  function invalidate() {
    request?.abort();
    for (const request of balanceRequests.values()) request.controller.abort();
    request = undefined;
    refreshRequested = false;
    syncProviders();
    subscribe();
    scheduleRefresh();
  }
  watch(() => providerBalances.value.map(entry => entry.accountId).join(","), scheduleSubscribe);
  watch(() => JSON.stringify(settings.value.mediaProviderConfigs), invalidate, { immediate: true, flush: "sync" });
  watch(() => workspaceStore.project?.lastOpenedAt, scheduleRefresh);
  const refreshProvider = (event: WindowEventMap["lum:plugin-installed"]) => {
    if (event.detail.type === "provider") invalidate();
  };
  window.addEventListener("pageshow", scheduleRefresh);
  window.addEventListener("focus", scheduleRefresh);
  window.addEventListener("lum:plugin-installed", refreshProvider);
  window.addEventListener("lum:provider-config-changed", invalidate);
  document.addEventListener("visibilitychange", syncVisibility);
  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    clearTimeout(subscriptionTimer);
    request?.abort();
    for (const request of balanceRequests.values()) request.controller.abort();
    stopSnapshots();
    window.removeEventListener("pageshow", scheduleRefresh);
    window.removeEventListener("focus", scheduleRefresh);
    window.removeEventListener("lum:plugin-installed", refreshProvider);
    window.removeEventListener("lum:provider-config-changed", invalidate);
    document.removeEventListener("visibilitychange", syncVisibility);
  });
}

