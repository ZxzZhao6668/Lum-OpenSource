<template>
  <el-dialog v-model="visible" title="宫格分镜图" appendToBody alignCenter width="min(1320px, 96vw)" :closeOnClickModal="false">
    <div v-if="shot && settings && beat" class="gridDialog">
      <div class="gridToolbar">
        <label>统一取帧间隔
          <select v-model="draft.interval" :disabled="busy || confirming">
            <option v-for="interval in gridIntervals" :key="interval" :value="interval">每 {{ interval }} 秒一帧</option>
          </select>
        </label>
        <label>当前镜头
          <select v-model="selectedId">
            <option v-for="(item, index) in shots" :key="item.id" :value="item.id">{{ shotLabel(index) }} · {{ item.duration }} 秒</option>
          </select>
        </label>
        <label>本镜取帧间隔
          <select :value="settings.interval ?? ''" :disabled="busy || confirming" @change="setShotInterval">
            <option value="">沿用统一间隔</option>
            <option v-for="interval in gridIntervals" :key="interval" :value="interval">每 {{ interval }} 秒一帧</option>
          </select>
        </label>
        <div class="gridStats" role="status">本镜 {{ frames.length }} 帧 · 已生成 {{ readyCount }} 帧</div>
      </div>

      <div class="gridLayout">
        <section class="cuePane" aria-label="机位和切换设置">
          <div class="sectionTitle"><h3>{{ shotTitle }}</h3></div>
          <p v-if="shot.description" class="shotDescription">{{ shot.description }}</p>
          <div class="sectionTitle cueTitle"><h3>起始画面与切换点</h3></div>
          <div class="cueTabs" aria-label="选择切换点">
            <button v-for="(item, index) in settings.beats" :key="index" type="button" :aria-pressed="index === cueIndex"
              @click="selectCue(index)">{{ item.time }} 秒 · {{ gridViewLabel(item.view) }}</button>
          </div>
          <div class="cueActions">
            <el-button size="small" :disabled="!canAddCut || busy || confirming" @click="addCut(false)">添加切换点</el-button>
            <el-button v-if="settings.beats.length === 1" size="small" :disabled="!canAddCut || busy || confirming" @click="addCut(true)">设置正反打</el-button>
            <el-button v-if="cueIndex > 0" size="small" text type="danger" :disabled="busy || confirming" @click="removeCut">移除切换点</el-button>
          </div>
          <fieldset class="cueEditor" :disabled="busy || confirming">
            <legend>{{ cueIndex === 0 ? '起始画面' : `${beat.time} 秒切换` }}</legend>
            <label v-if="cueIndex > 0">切换时间（秒）
              <input :key="beat.time" type="number" min="0.1" :max="maxCutTime / 10" step="0.1" :value="beat.time" @change="setCueTime" />
            </label>
            <label>画面视角
              <select v-model="beat.view">
                <option v-for="view in views" :key="view" :value="view">{{ gridViewLabel(view) }}</option>
              </select>
            </label>
            <label v-if="cueIndex > 0">切换方式
              <select v-model="beat.transition">
                <option value="cut">{{ gridTransitionLabel('cut') }}</option>
                <option value="dissolve">{{ gridTransitionLabel('dissolve') }}</option>
              </select>
            </label>
            <label v-for="field in cueFields" :key="field.key">{{ field.label }}
              <input v-model="beat[field.key]" :placeholder="scriptValue(field.key)" :maxlength="field.limit" />
            </label>
            <label class="actionField">画面动作
              <textarea v-model="beat.action" placeholder="补充本段的动作或表情" rows="3" maxlength="1000" />
            </label>
          </fieldset>
          <p v-if="cueError" class="gridError" role="alert">{{ cueError }}</p>
          <p class="gridHelp">景别和运镜留空时沿用分镜脚本。切换点会单独起一格。</p>
        </section>

        <section ref="previewPane" class="previewPane" aria-label="本镜宫格预览">
          <div class="sectionTitle previewTitle">
            <h3>本镜宫格</h3>
            <el-button size="small" :loading="exporting" :disabled="!pageReady" @click="exportSheets">{{ pageCount > 1 ? '导出本页 PNG' : '导出标注宫格 PNG' }}</el-button>
          </div>
          <p v-if="exportError" class="gridError" role="alert">{{ exportError }}</p>
          <div class="frameGrid">
            <article v-for="(frame, index) in pageFrames" :key="frame.key" class="frameCard">
              <div class="frameImage">
                <img v-if="imageUrls[frame.key]" :src="imageUrls[frame.key]" :alt="`${shotTitle}第 ${page * pageSize + index + 1} 格`" />
                <span v-else>{{ frameStatus(frame) === 'ready' ? imageErrors.has(frame.key) ? '图片读取失败' : '读取图片中' : frameStatus(frame) === 'created' ? '已创建图片节点' : '待生成' }}</span>
              </div>
              <div class="frameInfo">
                <div class="frameLine"><strong>{{ frameTime(frame.from, frame.to) }}</strong><span>{{ frame.duration }} 秒</span></div>
                <div class="frameLine"><span>{{ gridViewLabel(frame.view) }}</span><span>{{ gridTransitionLabel(frame.transition) }}</span></div>
                <dl v-if="frame.shotSize || frame.camera || frame.movement || frame.focalLength || frame.aperture || frame.action" class="frameDetails">
                  <template v-for="field in cueFields" :key="field.key">
                    <template v-if="frame[field.key]"><dt>{{ field.label }}</dt><dd>{{ frame[field.key] }}</dd></template>
                  </template>
                  <template v-if="frame.action"><dt>动作</dt><dd>{{ frame.action }}</dd></template>
                </dl>
                <el-button v-if="frameStatus(frame) === 'ready'" size="small" text type="primary" :disabled="!allowGenerate || busy || confirming"
                  :aria-label="`重新生成第 ${page * pageSize + index + 1} 格`" @click="request([frame], true, true)">重新生成</el-button>
              </div>
            </article>
          </div>
          <nav v-if="pageCount > 1" class="gridPagination" aria-label="宫格预览分页">
            <el-button size="small" :disabled="page === 0" @click="goToPage(page - 1)">上一页</el-button>
            <span>{{ page + 1 }} / {{ pageCount }}</span>
            <el-button size="small" :disabled="page >= pageCount - 1" @click="goToPage(page + 1)">下一页</el-button>
          </nav>
        </section>
      </div>
    </div>
    <p v-else>请先在镜头表中添加镜头。</p>

    <template #footer>
      <div class="gridFooter">
        <span v-if="busy" class="gridHelp" role="status">正在处理分镜图任务…</span>
        <span v-else-if="!allowGenerate && frames.length" class="gridHelp">请先在脚本节点完成提示词。</span>
        <span v-else-if="allPendingFrames.length > gridBatchLimit" class="gridHelp">单次最多 {{ gridBatchLimit }} 帧，请按镜头或逐页处理。</span>
        <div class="gridFooterActions">
          <el-button :disabled="busy || confirming || !dirty" @click="save">保存设置</el-button>
          <el-button :disabled="busy || confirming || !allowGenerate || !uncreatedFrames.length" @click="request(uncreatedFrames, false)">仅创建{{ creatingPage ? '本页' : '本镜' }}节点（{{ uncreatedFrames.length }}）</el-button>
          <el-button :disabled="busy || confirming || !allowGenerate || !pendingFrames.length" @click="request(pendingFrames, true)">生成{{ generatingPage ? '本页' : '本镜' }}（{{ pendingFrames.length }}）</el-button>
          <el-button type="primary" :disabled="busy || confirming || !allowGenerate || !allPendingFrames.length || allPendingFrames.length > gridBatchLimit" @click="request(allPendingFrames, true)">生成全部（{{ allPendingFrames.length }}）</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElButton, ElDialog, ElMessageBox } from "element-plus";
import type { Shot } from "./shotData";
import { frameTime, gridBatchLimit, gridFrames, gridIntervals, gridTransitionLabel, gridViewLabel, normalizeGrid } from "./storyboardGrid";
import type { GridBeat, GridFrame, GridInterval, GridSettings, GridShotSettings, GridView } from "./storyboardGrid";
import { downloadGridSheets, gridSheetPageSize } from "./storyboardGridSheet";

const props = defineProps<{
  shots: Shot[];
  grid: GridSettings;
  busy: boolean;
  allowGenerate: boolean;
  available: Record<string, 'ready' | 'created'>;
  readFrame: (key: string) => Promise<Blob | undefined>;
}>();
const visible = defineModel<boolean>("visible", { required: true });
const emit = defineEmits<{
  save: [GridSettings];
  generate: [{ grid: GridSettings; keys: string[]; run: boolean; replace?: boolean }];
}>();

const views: GridView[] = ["main", "a", "b"];
const cueFields = [
  { key: "shotSize", label: "景别", limit: 20 },
  { key: "camera", label: "机位", limit: 120 },
  { key: "movement", label: "运镜", limit: 160 },
  { key: "focalLength", label: "焦距", limit: 40 },
  { key: "aperture", label: "光圈", limit: 40 },
] as const;
type Parameter = (typeof cueFields)[number]['key'];

function newBeat(time: number, view: GridView = "main"): GridBeat {
  return { time, view, transition: "cut", shotSize: "", camera: "", movement: "", focalLength: "", aperture: "", action: "" };
}

const draft = ref(normalizeGrid(props.grid, props.shots));
const normalized = computed(() => persistedSettings(draft.value));
const saved = computed(() => persistedSettings(props.grid));
const dirty = computed(() => JSON.stringify(normalized.value) !== JSON.stringify(saved.value));
const selectedId = ref(props.shots[0]?.id ?? "");
const shot = computed(() => props.shots.find(item => item.id === selectedId.value) ?? props.shots[0]);
const shotIndex = computed(() => shot.value ? props.shots.indexOf(shot.value) : 0);
const shotLabel = (index: number) => `镜头 ${String(index + 1).padStart(2, '0')}`;
const shotTitle = computed(() => shotLabel(shotIndex.value));
const settings = ref<GridShotSettings>();
const cueIndex = ref(0);
const beat = computed(() => settings.value?.beats[cueIndex.value]);
const cueError = ref("");
const exportError = ref("");
const exporting = ref(false);
const confirming = ref(false);
const page = ref(0);
const pageSize = gridSheetPageSize;
const previewPane = ref<HTMLElement>();

function persistedSettings(grid: GridSettings): GridSettings {
  const result = normalizeGrid(grid, props.shots);
  for (const [id, entry] of Object.entries(result.shots)) {
    const head = entry.beats[0];
    if (head?.time === 0 && head.view === 'main' && !head.action && cueFields.every(field => !head[field.key])) entry.beats.shift();
    if (!entry.interval && !entry.beats.length) delete result.shots[id];
  }
  return result;
}

watch(() => shot.value?.id, (id) => {
  selectCue(0);
  goToPage(0);
  exportError.value = "";
  if (!id) {
    settings.value = undefined;
    return;
  }
  const entry = draft.value.shots[id] ?? { beats: [] };
  if (entry.beats[0]?.time !== 0) entry.beats.unshift(newBeat(0));
  draft.value.shots[id] = entry;
  settings.value = draft.value.shots[id];
}, { immediate: true });

const allFrames = computed(() => props.shots.flatMap(item => gridFrames(item, normalized.value)));
const savedFrames = computed(() => new Map(props.shots.flatMap(item => gridFrames(item, saved.value)).map(frame => [frame.key, JSON.stringify(frame)])));
const frames = computed(() => shot.value ? gridFrames(shot.value, normalized.value) : []);
const pageCount = computed(() => Math.ceil(frames.value.length / pageSize));
const pageFrames = computed(() => frames.value.slice(page.value * pageSize, (page.value + 1) * pageSize));
const readyCount = computed(() => frames.value.filter(frame => frameStatus(frame) === 'ready').length);
const pageReady = computed(() => !!pageFrames.value.length && pageFrames.value.every(frame => frameStatus(frame) === 'ready'));
const uncreatedShotFrames = computed(() => frames.value.filter(frame => !frameStatus(frame)));
const pendingShotFrames = computed(() => frames.value.filter(frame => frameStatus(frame) !== 'ready'));
const creatingPage = computed(() => uncreatedShotFrames.value.length > gridBatchLimit);
const generatingPage = computed(() => pendingShotFrames.value.length > gridBatchLimit);
const uncreatedFrames = computed(() => creatingPage.value ? pageFrames.value.filter(frame => !frameStatus(frame)) : uncreatedShotFrames.value);
const pendingFrames = computed(() => generatingPage.value ? pageFrames.value.filter(frame => frameStatus(frame) !== 'ready') : pendingShotFrames.value);
const allPendingFrames = computed(() => allFrames.value.filter(frame => frameStatus(frame) !== 'ready'));

watch(pageCount, count => { page.value = Math.max(0, Math.min(page.value, count - 1)); });

function goToPage(index: number) {
  page.value = index;
  if (previewPane.value) previewPane.value.scrollTop = 0;
}

function frameStatus(frame: GridFrame) {
  const status = props.available[frame.key];
  return status && savedFrames.value.get(frame.key) === JSON.stringify(frame) ? status : undefined;
}

const imageUrls = reactive<Record<string, string>>({});
const imageErrors = reactive(new Set<string>());
const refreshPreviews = ref(0);
watch(() => props.busy, (busy, wasBusy) => { if (wasBusy && !busy) refreshPreviews.value++; });
const visibleImageKeys = computed(() => visible.value ? pageFrames.value.filter(frame => frameStatus(frame) === 'ready').map(frame => frame.key).join("\n") : "");
watch([visibleImageKeys, refreshPreviews], ([keys], _, onCleanup) => {
  if (!keys) return;
  const requestedKeys = keys.split("\n");
  let active = true;
  onCleanup(() => {
    active = false;
    for (const key of requestedKeys) {
      if (imageUrls[key]) URL.revokeObjectURL(imageUrls[key]);
      delete imageUrls[key];
      imageErrors.delete(key);
    }
  });
  for (const key of requestedKeys) {
    void props.readFrame(key).then(blob => {
      if (!active) return;
      if (blob) imageUrls[key] = URL.createObjectURL(blob);
      else imageErrors.add(key);
    }).catch(() => {
      if (active) imageErrors.add(key);
    });
  }
}, { immediate: true });

const maxCutTime = computed(() => Math.max(0, Math.round((frames.value.at(-1)?.to ?? 0) * 10) - 1));
const canAddCut = computed(() => maxCutTime.value >= (settings.value?.beats.length ?? 1));

function selectCue(index: number) {
  cueIndex.value = index;
  cueError.value = "";
}

function setShotInterval(event: Event) {
  if (!settings.value) return;
  const value = (event.target as HTMLSelectElement).value;
  if (value) settings.value.interval = Number(value) as GridInterval;
  else delete settings.value.interval;
}

function scriptValue(field: Parameter): string {
  if (field === 'shotSize' && shot.value?.shotSize) return `沿用 ${shot.value.shotSize}`;
  if (field === 'movement' && shot.value?.camera) return `沿用 ${shot.value.camera}`;
  return '未设置';
}

function addCut(reverse: boolean) {
  if (!settings.value || !canAddCut.value) return;
  const cues = settings.value.beats;
  let longest = 0;
  let start = 0;
  for (let index = 0; index < cues.length; index++) {
    const from = Math.round(cues[index].time * 10);
    const to = cues[index + 1] ? Math.round(cues[index + 1].time * 10) : maxCutTime.value + 1;
    if (to - from > longest) {
      longest = to - from;
      start = from;
    }
  }
  const time = (start + Math.floor(longest / 2)) / 10;
  const previous = [...cues].reverse().find(item => item.time < time);
  if (reverse) cues[0].view = 'a';
  const cue = newBeat(time, reverse ? 'b' : previous?.view ?? 'main');
  cues.push(cue);
  sortAndSelect(cue);
}

function sortAndSelect(cue: GridBeat) {
  const cues = settings.value?.beats;
  if (!cues) return;
  cues.sort((a, b) => a.time - b.time);
  selectCue(cues.findIndex(item => item.time === cue.time));
}

function removeCut() {
  if (cueIndex.value === 0 || !settings.value) return;
  settings.value.beats.splice(cueIndex.value, 1);
  selectCue(cueIndex.value - 1);
}

function setCueTime(event: Event) {
  const input = event.target as HTMLInputElement;
  const cue = beat.value;
  if (!cue || cueIndex.value === 0) return;
  const tick = Math.round(input.valueAsNumber * 10);
  const duplicate = settings.value?.beats.some(item => item !== cue && Math.round(item.time * 10) === tick);
  if (!Number.isFinite(tick) || tick <= 0 || tick > maxCutTime.value || duplicate) {
    cueError.value = duplicate ? '这个时间已有切换点。' : `切换时间需在 0.1 至 ${maxCutTime.value / 10} 秒之间。`;
    input.value = String(cue.time);
    return;
  }
  cue.time = tick / 10;
  input.value = String(cue.time);
  sortAndSelect(cue);
}

function save() {
  emit('save', normalized.value);
}

async function request(selectedFrames: GridFrame[], run: boolean, replace = false) {
  if (!selectedFrames.length || !props.allowGenerate || props.busy || confirming.value) return;
  const grid = normalized.value;
  const keys = selectedFrames.map(frame => frame.key);
  if (run) {
    confirming.value = true;
    try {
      await ElMessageBox.confirm(`将提交 ${keys.length} 帧${replace ? '重新生成' : '生成'}，模型供应商可能按用量扣费。`, '确认生成分镜图', {
        type: 'warning', confirmButtonText: '开始生成', cancelButtonText: '取消',
      });
    } catch {
      return;
    } finally {
      confirming.value = false;
    }
  }
  if (visible.value && props.allowGenerate && !props.busy) emit('generate', { grid, keys, run, replace });
}

async function exportSheets() {
  if (exporting.value || !pageReady.value) return;
  const selectedFrames = frames.value;
  const selectedPage = page.value + 1;
  exporting.value = true;
  exportError.value = "";
  try {
    await downloadGridSheets(`${shotTitle.value} 宫格分镜图`, selectedFrames, props.readFrame, selectedPage);
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : '导出宫格时出错，请重试。';
  } finally {
    exporting.value = false;
  }
}
</script>

<style scoped>
.gridDialog { color: var(--el-text-color-primary); }
.gridToolbar { display: flex; gap: 12px 18px; align-items: end; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 1px solid var(--el-border-color-lighter); }
.gridToolbar label, .cueEditor label { display: flex; flex-direction: column; gap: 5px; min-width: 0; font-size: 12px; }
.gridToolbar select, .cueEditor input, .cueEditor select, .cueEditor textarea, .cueTabs button {
  box-sizing: border-box; min-height: 30px; min-width: 0; padding: 5px 8px; border: 1px solid var(--el-border-color);
  border-radius: 5px; background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit;
}
.gridToolbar select:focus-visible, .cueEditor :is(input, select, textarea):focus-visible, .cueTabs button:focus-visible {
  outline: 2px solid var(--el-color-primary); outline-offset: 1px;
}
.gridStats { margin-left: auto; padding: 5px 0; font-size: 12px; color: var(--el-text-color-regular); }
.gridLayout { display: grid; grid-template-columns: minmax(260px, 330px) minmax(0, 1fr); gap: 18px; }
.cuePane, .previewPane { min-width: 0; max-height: min(62vh, 700px); overflow: auto; padding: 14px 4px 4px; scrollbar-gutter: stable; }
.cuePane { border-right: 1px solid var(--el-border-color-lighter); padding-right: 14px; }
.sectionTitle { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.sectionTitle h3 { margin: 0; font-size: 15px; }
.shotDescription { margin: 6px 0 14px; font-size: 13px; color: var(--el-text-color-regular); white-space: pre-wrap; overflow-wrap: anywhere; }
.cueTitle { margin-top: 12px; }
.cueTabs, .cueActions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.cueTabs button { cursor: pointer; font-size: 12px; }
.cueTabs button[aria-pressed="true"] { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.cueActions .el-button + .el-button, .gridFooter .el-button + .el-button { margin-left: 0; }
.cueEditor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin: 10px 0 0; padding: 8px 9px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 5px; }
.cueEditor legend { padding: 0 4px; font-size: 12px; }
.cueEditor textarea { resize: vertical; }
.actionField { grid-column: 1 / -1; }
.gridHelp, .gridError { margin: 8px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
.gridError { color: var(--el-color-danger); }
.previewTitle { margin-bottom: 10px; }
.frameGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.frameCard { overflow: hidden; align-self: start; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.frameImage { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 9; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 12px; }
.frameImage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.frameInfo { display: grid; gap: 4px; padding: 8px; font-size: 12px; }
.frameInfo .el-button { justify-self: start; margin-left: -8px; }
.frameLine { display: flex; gap: 4px 8px; flex-wrap: wrap; justify-content: space-between; align-items: center; }
.frameDetails { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 6px; margin: 0; }
.frameDetails dt { color: var(--el-text-color-secondary); }
.frameDetails dd { margin: 0; overflow-wrap: anywhere; }
.gridPagination, .gridFooter, .gridFooterActions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.gridPagination { justify-content: center; margin-top: 10px; font-size: 12px; }
.gridFooter { justify-content: space-between; }
.gridFooter .gridHelp { margin: 0; }
.gridFooterActions { justify-content: end; margin-left: auto; }
@media (max-width: 980px) { .frameGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 680px) {
  .gridDialog { max-height: 60vh; overflow: auto; }
  .gridLayout { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .cuePane, .previewPane { max-height: none; overflow: visible; }
  .cuePane { padding-right: 4px; border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); }
  .gridStats { margin-left: 0; }
}
</style>
