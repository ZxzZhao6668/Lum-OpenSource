import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { WorkspaceFiles } from "@lum/nodes-scaffold/workspaceFiles";
import { enhancementError, fileSize, previewByteLimit } from "./videoEnhancement";

export type EnhancementPreviewFile = { path: string; mimeType: string; sha256?: string };

export function useEnhancementPreview(file: Ref<EnhancementPreviewFile | undefined>, getFiles: () => WorkspaceFiles) {
  const url = ref(""), error = ref(""), size = ref<number>(), loading = ref(false);
  let controller: AbortController | undefined;
  let resource: ReturnType<NonNullable<WorkspaceFiles["acquireUrl"]>> | undefined;
  function clear() {
    controller?.abort();
    resource?.release();
    controller = resource = undefined;
    url.value = error.value = "";
    size.value = undefined;
    loading.value = false;
  }
  watch(file, clear, { flush: "sync" });
  onScopeDispose(clear);

  async function open() {
    const selected = file.value;
    if (!selected) return;
    clear();
    const request = controller = new AbortController();
    loading.value = true;
    try {
      const files = getFiles();
      const actual = await files.inspectBinary(selected.path, request.signal);
      request.signal.throwIfAborted();
      if (selected.sha256 && selected.sha256 !== actual.sha256) throw Error("视频内容已变化，请重新读取原片");
      size.value = actual.size;
      if (!actual.size || actual.size > previewByteLimit) throw Error(`文件 ${fileSize(actual.size)}；本地预览上限为 128 MiB，可定位文件后查看。`);
      const entry = files.acquireUrl?.(selected.path, selected.mimeType, actual.sha256, previewByteLimit);
      if (!entry) throw Error("当前工作区不支持视频预览");
      resource = entry;
      const address = await entry.url;
      request.signal.throwIfAborted();
      url.value = address;
    } catch (cause) { if (!request.signal.aborted) error.value = enhancementError(cause); }
    finally { if (controller === request) loading.value = false; }
  }

  async function reveal() {
    const selected = file.value;
    if (!selected) return;
    try {
      const files = getFiles();
      if (!files.reveal) throw Error("当前工作区不能打开文件所在文件夹");
      await files.reveal(selected.path);
    } catch (cause) { if (file.value === selected) error.value = enhancementError(cause); }
  }
  return { url, error, size, loading, clear, open, reveal };
}
