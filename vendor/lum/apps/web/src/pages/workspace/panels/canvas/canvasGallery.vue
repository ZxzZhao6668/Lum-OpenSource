<template>
  <el-dialog v-model="visible" title="画布分享" width="min(880px, 94vw)" alignCenter appendToBody destroyOnClose>
    <div class="gallery">
      <el-tabs v-model="tab">
        <el-tab-pane label="浏览作品" name="browse">
          <div class="actions">
            <el-button size="small" @click="fetchPage(page)">刷新作品</el-button>
            <el-button size="small" @click="fileInput?.click()">打开分享文件</el-button>
            <input ref="fileInput" class="fileInput" type="file" accept=".json,application/json" @change="openFile" />
          </div>
          <p v-if="failure" class="error" role="alert">{{ failure }}</p>
          <div class="browse">
            <nav aria-label="收录作品">
              <p v-if="loadingList" role="status">正在读取作品目录…</p>
              <p v-else-if="!entries.length && !failure">这一页还没有收录作品。</p>
              <button v-for="entry in entries" :key="entry.id" type="button" class="entry" :class="{ chosen: entry.id === selectedId }"
                :aria-pressed="entry.id === selectedId" @click="selectEntry(entry.id)">
                <strong>{{ entry.title }}</strong><span>{{ entry.author }}</span>
              </button>
              <div v-if="page > 1 || entries.length === 12" class="pages">
                <el-button size="small" :disabled="page === 1 || loadingList" @click="fetchPage(page - 1)">上一页</el-button>
                <span>{{ page }}</span>
                <el-button size="small" :disabled="entries.length < 12 || loadingList" @click="fetchPage(page + 1)">下一页</el-button>
              </div>
            </nav>
            <section aria-label="作品预览" :aria-busy="loadingWork">
              <p v-if="loadingWork" role="status">正在读取画布…</p>
              <template v-else-if="selected">
                <galleryPreview :work="selected" />
                <div class="actions">
                  <el-button size="small" :disabled="working" @click="download(selected)">下载分享文件</el-button>
                  <el-button type="primary" size="small" :loading="working" :disabled="!canImport" @click="importSelected">导入为副本</el-button>
                </div>
                <p v-if="copyPath" role="status">已保存到当前项目，可从画布菜单打开：{{ copyPath }}</p>
              </template>
              <p v-else-if="entries.length">选择作品，查看节点、连线和正文。</p>
            </section>
          </div>
        </el-tab-pane>

        <el-tab-pane label="分享当前画布" name="share">
          <el-form labelPosition="top" class="shareForm" @submit.prevent="prepare">
            <el-form-item label="作品标题"><el-input v-model="title" maxlength="100" /></el-form-item>
            <el-form-item label="公开署名"><el-input v-model="author" maxlength="80" /></el-form-item>
            <el-form-item label="作品简介"><el-input v-model="description" type="textarea" :rows="2" maxlength="1500" /></el-form-item>
            <el-checkbox v-model="includeText">附上正文、剧本、分镜和生成提示词</el-checkbox>
            <p class="hint">分享文件包含节点名称、布局和连线。生成预览后可逐个勾选媒体。请核对节点名称、文字及附件（含文件自身的元数据）是否适合公开。</p>
            <el-button nativeType="submit" :disabled="!canvasReady || !title.trim() || !author.trim()">生成本地预览</el-button>
          </el-form>
          <p v-if="shareError" class="error" role="alert">{{ shareError }}</p>
          <section v-if="draft" class="review" aria-label="投稿预览">
            <p v-if="draft.converted.length">以下节点将转换为可编辑的文本节点：{{ draft.converted.join("、") }}。勾选附上正文时保留其文字输出。</p>
            <fieldset v-if="draft.media.length">
              <legend>选择随作品公开的媒体附件</legend>
              <p>每个节点可选当前输出，单个文件最多 10 MiB，作品文件合计最多 20 MiB。未勾选的媒体只分享节点与连线。</p>
              <el-checkbox-group v-model="chosenMedia">
                <el-checkbox v-for="attachment in draft.attachments" :key="attachment.id" :value="attachment.id">
                  {{ attachment.label }} · {{ attachment.mimeType }}
                </el-checkbox>
              </el-checkbox-group>
              <p v-if="draft.media.length !== draft.attachments.length" class="hint">部分节点没有支持的本地输出。可选格式为 PNG、JPEG、GIF、WebP、MP4、WebM、MP3、WAV、Ogg 和 M4A。</p>
              <el-button v-if="!reviewed" size="small" :loading="loadingMedia" @click="reviewMedia">更新附件预览</el-button>
            </fieldset>
            <template v-if="reviewed">
              <galleryPreview :work="reviewed" />
              <details><summary>核对投稿内容与附件清单</summary><pre>{{ reviewManifest }}</pre></details>
              <div class="actions"><el-button size="small" @click="download(reviewed)">保存完整分享文件</el-button></div>
              <gallerySubmission :work="reviewed" />
            </template>
          </section>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ElMessage } from "element-plus";
import saveFile from "@/lib/saveFile";
import { listGalleryEntries, loadGalleryEntry } from "@/lib/canvasGalleryRepository";
import { galleryFileStem, galleryMaxBytes, parseGalleryCanvas, type GalleryCanvas, type GalleryMetadata, type prepareGalleryCanvas } from "./galleryCanvas";
import type { GalleryAttachment } from "./galleryMedia";
import galleryPreview from "./galleryPreview.vue";
import gallerySubmission from "./gallerySubmission.vue";

type GalleryDraft = ReturnType<typeof prepareGalleryCanvas> & { attachments: GalleryAttachment[] };
const visible = defineModel<boolean>({ required: true });
const props = defineProps<{
  canvasReady: boolean; canvasId: string; canImport: boolean;
  prepareWork: (metadata: GalleryMetadata, includeText: boolean) => GalleryDraft;
  importWork: (work: GalleryCanvas) => Promise<string>;
}>();
const tab = ref("browse"), page = ref(1);
const entries = shallowRef<Awaited<ReturnType<typeof listGalleryEntries>>>([]);
const selectedId = ref(""), selected = shallowRef<GalleryCanvas>();
const fileInput = ref<HTMLInputElement>();
const failure = ref(""), shareError = ref(""), copyPath = ref("");
const loadingList = ref(false), loadingWork = ref(false), working = ref(false);
const title = ref(""), author = ref(""), description = ref(""), includeText = ref(false);
const draft = shallowRef<GalleryDraft>();
const reviewed = shallowRef<GalleryCanvas>();
const chosenMedia = ref<string[]>([]);
const loadingMedia = ref(false);
const reviewManifest = computed(() => reviewed.value && JSON.stringify(reviewed.value, (key, value) =>
  key === "base64" && typeof value === "string" ? "已包含二进制附件（" + value.length + " 个 Base64 字符）" : value, 2));
let mediaRequest: AbortController | undefined;
let listing: AbortController | undefined, reading: AbortController | undefined;

function errorText(e: unknown) { return e instanceof Error ? e.message : "操作失败，请重试"; }
function clearSelection() {
  reading?.abort(); selectedId.value = ""; selected.value = undefined; loadingWork.value = false; copyPath.value = "";
}
async function fetchPage(target: number) {
  listing?.abort(); clearSelection();
  const request = new AbortController();
  listing = request; loadingList.value = true; failure.value = ""; page.value = target; entries.value = [];
  try {
    const list = await listGalleryEntries(request.signal, target);
    if (!request.signal.aborted) entries.value = list;
  } catch (error) { if (!request.signal.aborted) failure.value = errorText(error); }
  finally { if (!request.signal.aborted) loadingList.value = false; }
}
async function selectEntry(id: string) {
  clearSelection(); failure.value = ""; selectedId.value = id; loadingWork.value = true;
  const request = new AbortController(); reading = request;
  try {
    const work = parseGalleryCanvas(await loadGalleryEntry(id, request.signal));
    if (!request.signal.aborted) selected.value = work;
  } catch (error) { if (!request.signal.aborted) failure.value = errorText(error); }
  finally { if (!request.signal.aborted) loadingWork.value = false; }
}
async function openFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = "";
  if (!file) return;
  clearSelection(); failure.value = ""; loadingWork.value = true;
  const request = new AbortController(); reading = request;
  try {
    if (file.size > galleryMaxBytes) throw new Error("分享文件超过 20 MiB");
    const work = parseGalleryCanvas(JSON.parse(await file.text()));
    if (!request.signal.aborted) selected.value = work;
  } catch (error) { if (!request.signal.aborted) failure.value = errorText(error); }
  finally { if (!request.signal.aborted) loadingWork.value = false; }
}
function prepare() {
  clearDraft();
  try {
    draft.value = props.prepareWork({ title: title.value.trim(), author: author.value.trim(), description: description.value.trim() }, includeText.value);
    reviewed.value = draft.value.work;
  } catch (error) { shareError.value = errorText(error); }
}
function clearDraft() {
  mediaRequest?.abort(); draft.value = undefined; chosenMedia.value = []; reviewed.value = undefined; shareError.value = "";
}
watch(chosenMedia, () => {
  mediaRequest?.abort(); loadingMedia.value = false; reviewed.value = undefined; shareError.value = "";
}, { deep: true, flush: "sync" });
async function reviewMedia() {
  const source = draft.value;
  if (!source || loadingMedia.value) return;
  const request = new AbortController(); mediaRequest = request;
  loadingMedia.value = true; shareError.value = ""; reviewed.value = undefined;
  try {
    const nodes = source.work.nodes.map(node => ({ ...node }));
    let size = new TextEncoder().encode(JSON.stringify(source.work, null, 2)).length;
    for (const id of chosenMedia.value) {
      const candidate = source.attachments.find(item => item.id === id);
      const target = nodes.find(node => node.id === id);
      if (!candidate || !target) throw Error("媒体选项已变化，请重新生成预览");
      const media = await candidate.read(request.signal);
      request.signal.throwIfAborted();
      size += media.base64.length;
      if (size > galleryMaxBytes) throw Error("作品超过 20 MiB，请减少所选附件");
      target.media = media;
    }
    request.signal.throwIfAborted();
    reviewed.value = parseGalleryCanvas({ ...source.work, nodes });
  } catch (error) { if (!request.signal.aborted) shareError.value = errorText(error); }
  finally { if (!request.signal.aborted) loadingMedia.value = false; }
}
async function download(work: GalleryCanvas) {
  try {
    await saveFile(new Blob([JSON.stringify(work, null, 2) + "\n"], { type: "application/json" }), "Lum-" + galleryFileStem(work.title) + ".json");
  } catch (error) { ElMessage.error(errorText(error)); }
}
async function importSelected() {
  const work = selected.value;
  if (!work || working.value) return;
  working.value = true; failure.value = ""; copyPath.value = "";
  try {
    const name = await props.importWork(work);
    if (selected.value === work) copyPath.value = name;
  } catch (error) { if (selected.value === work) failure.value = errorText(error); }
  finally { working.value = false; }
}

watch([title, author, description, includeText, () => props.canvasId], clearDraft, { flush: "sync" });
watch(visible, open => {
  if (open) { tab.value = "browse"; void fetchPage(1); }
  else { listing?.abort(); clearSelection(); clearDraft(); title.value = ""; author.value = ""; description.value = ""; includeText.value = false; }
}, { immediate: true });
onScopeDispose(() => { listing?.abort(); reading?.abort(); mediaRequest?.abort(); });
</script>

<style scoped lang="scss">
.gallery {
  max-height: 72vh; overflow-y: auto; padding: 0 3px;
  .actions, .pages { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
  .actions :deep(.el-button), .pages :deep(.el-button) { margin: 0; }
  .browse { display: grid; grid-template-columns: minmax(145px, 30%) minmax(0, 1fr); gap: 20px; }
  .entry { display: grid; gap: 3px; width: 100%; text-align: start; padding: 9px; background: transparent; color: inherit;
    border: 1px solid transparent; border-radius: var(--el-border-radius-base); cursor: pointer; overflow-wrap: anywhere;
    span { color: var(--el-text-color-secondary); }
    &:hover, &.chosen { background: var(--el-fill-color-light); border-color: var(--el-border-color); }
  }
  .fileInput { display: none; }
  .error { color: var(--el-color-danger); overflow-wrap: anywhere; }
  .hint { color: var(--el-text-color-secondary); font-size: 13px; }
  .review { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--el-border-color); }
  .review > p { overflow-wrap: anywhere; }
  fieldset { margin: 12px 0; padding: 12px; min-width: 0; border: 1px solid var(--el-border-color); }
  fieldset :deep(.el-checkbox) { white-space: normal; max-width: 100%; }
  details { margin: 12px 0; }
  summary { cursor: pointer; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; }
  @media (max-width: 600px) { .browse { grid-template-columns: minmax(0, 1fr); } }
}
</style>
