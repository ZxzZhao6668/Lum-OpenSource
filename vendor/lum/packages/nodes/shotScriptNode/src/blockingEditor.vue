<template>
  <el-dialog :modelValue="true" appendToBody alignCenter width="min(1470px, 97vw)" :closeOnClickModal="false" :showClose="false" :beforeClose="close">
    <template #header>
      <div class="editorHeader">
        <div><h2>人物走位</h2><span>{{ document.episodeTitle || '分镜脚本' }} · {{ document.shots.length }} 镜</span></div>
        <el-button text :icon="IconArrowBackUp" :disabled="!history.length || busy" @click="undo">撤销</el-button>
        <el-button text :icon="IconX" aria-label="关闭人物走位编辑器" :disabled="saving" @click="close" />
      </div>
    </template>
    <div v-if="shot && stage && scene" class="editorLayout">
      <nav class="shotNav" aria-label="分镜列表">
        <h3>镜头列表</h3>
        <button v-for="(item, i) in document.shots" :key="item.id" type="button" :class="{ active: item.id === shot.id }"
          :aria-current="item.id === shot.id ? 'step' : undefined" :disabled="busy" @click="selectShot(i)">
          <span><b>镜 {{ String(i + 1).padStart(2, '0') }}</b><small>{{ item.duration }}s</small></span>
          <span class="excerpt">{{ item.description || item.shotSize }}</span>
        </button>
      </nav>
      <main class="editingPane">
        <div class="shotTitle"><h3>镜 {{ shotIndex + 1 }} · {{ shot.shotSize }}</h3><p>{{ shot.description || '尚未填写镜头描述' }}</p></div>
        <fieldset class="shotSettings" :disabled="busy"><legend>镜头设置</legend>
          <label>场景<select :value="stage.sceneId" @change="switchScene(valueOf($event))"><option v-for="item in draft.scenes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <button type="button" :disabled="draft.scenes.length >= 300" @click="addScene">＋ 场景</button>
          <label>衔接<select :value="stage.cut ? 'cut' : 'continue'" @change="alter(() => stage!.cut = valueOf($event) === 'cut')"><option value="continue">连续</option><option value="cut">跳切</option></select></label>
          <label>机位<select :value="stage.camera" @change="alter(() => stage!.camera = valueOf($event) as ShotStage['camera'])"><option v-for="camera in cameras" :key="camera.id" :value="camera.id">{{ camera.name }}</option></select></label>
          <label>取景中心<select :value="stage.focus" @change="alter(() => stage!.focus = valueOf($event))"><option value="">场景中心</option><option v-for="item in targets" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        </fieldset>
        <blockingViews :tracks="tracks" :scene="scene" :stage="stage" :shot="shot" :time="progress" :actorId="track?.actor.id || ''" :markId="mark?.id || ''"
          :pointIndex="pointIndex" :disabled="busy" @choose="choose" @beginMove="checkpoint" @move="movePoint" />
        <div class="playBar">
          <button type="button" class="playButton" :disabled="busy" @click="togglePlay"><icon-player-pause v-if="playing" :size="16" /><icon-player-play v-else :size="16" />{{ playing ? '暂停' : '播放' }}</button>
          <input aria-label="当前镜头播放时间" type="range" min="0" max="1" step="0.001" :disabled="busy" :value="progress" @input="scrub" />
          <span>{{ (progress * shot.duration).toFixed(1) }} / {{ shot.duration }} 秒</span>
        </div>
        <fieldset class="entityPanel" :disabled="busy"><legend>场景与人物</legend>
          <div class="entityRow">
            <label>场景名称<input :key="scene.id" :value="scene.name" maxlength="80" @change="rename($event, scene!)" /></label>
            <label>编辑对象<select :value="track?.actor.id || mark?.id || ''" @change="selectEntity(valueOf($event))"><option v-if="!targets.length" value="">未添加</option>
              <optgroup v-if="scene.actors.length" label="人物"><option v-for="item in scene.actors" :key="item.id" :value="item.id">{{ item.name }}</option></optgroup>
              <optgroup v-if="scene.marks.length" label="固定地标"><option v-for="item in scene.marks" :key="item.id" :value="item.id">{{ item.name }}</option></optgroup>
            </select></label>
            <button type="button" :disabled="scene.actors.length >= 48" @click="addEntity('actor')">＋ 人物</button>
            <button type="button" :disabled="scene.marks.length >= 48" @click="addEntity('mark')">＋ 地标</button>
          </div>
          <div v-if="track || mark" class="entityRow">
            <label>{{ mark ? '地标名称' : '人物姓名' }}<input :key="(mark || track?.actor)?.id" :value="(mark || track?.actor)?.name" maxlength="80" @change="rename($event, (mark || track?.actor)!)" /></label>
            <template v-if="track">
              <label class="check"><input type="checkbox" :checked="track.actor.locked" @change="setLock" />固定站位</label>
              <label class="check"><input type="checkbox" :checked="track.route.visible" @change="alter(() => editRoute().visible = checkedOf($event))" />本镜入画</label>
              <label>朝向<select :value="track.route.facing" @change="alter(() => editRoute().facing = valueOf($event))">
                <option value="">未指定</option><option v-for="option in facingOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
              </select></label>
            </template>
          </div>
          <div v-if="currentPoint" class="entityRow">
            <label v-if="track && !track.actor.locked">路径点<select v-model.number="pointIndex"><option v-for="(_, i) in track.points" :key="i" :value="i">{{ i === 0 ? '起点' : i === track.points.length - 1 ? '终点' : '拐点 ' + i }}</option></select></label>
            <span v-else>{{ mark ? '地标位置' : '固定位置' }}</span>
            <label v-for="axis in axes" :key="axis">{{ axis === 'x' ? 'X' : 'Y' }}<input class="coordinate" type="number" min="0" max="100" step="0.1" :value="currentPoint[axis]" @change="setCoordinate(axis, $event)" /></label>
            <template v-if="track && !track.actor.locked">
              <button type="button" :disabled="track.route.via.length >= 16" @click="addVia">＋ 拐点</button>
              <button v-if="pointIndex > 0 && pointIndex < track.points.length - 1" type="button" @click="removeVia">移除拐点</button>
              <button v-if="pointIndex === 0 && stage.routes[track.actor.id]?.start" type="button" @click="alter(() => delete editRoute().start)">恢复自动起点</button>
              <button v-if="pointIndex === track.points.length - 1 && stage.routes[track.actor.id]?.end" type="button" @click="alter(() => delete editRoute().end)">恢复自动终点</button>
            </template>
          </div>
          <p class="hint">拖动俯视图上的起点、终点或拐点可修改路径。连续镜头继承前镜终点。固定人物和地标的位置会影响同场所有镜头。</p>
        </fieldset>
        <fieldset class="frameSettings" :disabled="busy"><legend>本镜参考帧</legend>
          <label v-for="field in frameFields" :key="field">{{ field === 'startFrame' ? '首帧' : '尾帧' }}
            <select :value="stage[field]?.url || ''" @change="setFrame(field, valueOf($event))">
              <option value="">自动（沿用连线或文字）</option>
              <option v-if="stage[field] && !frameChoices?.some(item => item.url === stage![field]!.url)" :value="stage[field]!.url">{{ stage[field]!.url }}</option>
              <option v-for="item in frameChoices" :key="item.url" :value="item.url">{{ item.label }}</option>
            </select>
          </label>
        </fieldset>
        <div class="suggestion">
          <div><strong>调度依据</strong><p>{{ stage.note || '初始站位和机位由分镜文字推测，请结合实际场景校正。' }}</p></div>
          <div v-if="suggest" class="suggestActions">
            <label class="check"><input v-model="useImage" type="checkbox" :disabled="busy" />参考分镜图</label>
            <button v-if="!analyzing" type="button" :disabled="saving" title="使用所选文本模型分析本镜，建议可撤销" @click="analyze">AI 分析本镜</button>
            <button v-else type="button" @click="abortSuggestion">取消分析</button>
          </div>
        </div>
        <div v-if="analysisError" class="analysisError" role="alert">{{ analysisError }}</div>
      </main>
    </div>
    <p v-else>请先在镜头表添加镜头。</p>
    <template #footer>
      <el-button :disabled="saving" @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!shot || busy" @click="apply">确认并同步</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElButton, ElDialog } from "element-plus";
import { IconArrowBackUp, IconPlayerPause, IconPlayerPlay, IconX } from "@tabler/icons-vue";
import blockingViews from "./blockingViews.vue";
import type { ActorRoute, BlockingPlan, Point, ShotStage, StageFrame, StageScene } from "./blockingTypes";
import type { ShotDocument } from "./shotData";
import { pointAt, resolveTracks } from "./shotBlocking";

const props = defineProps<{
  document: ShotDocument; initial: BlockingPlan; saving: boolean; frameChoices?: (StageFrame & { label: string })[];
  suggest?: (plan: BlockingPlan, shotId: string, signal: AbortSignal, useImage?: boolean) => Promise<BlockingPlan>;
}>();
const emit = defineEmits<{ close: []; apply: [plan: BlockingPlan] }>();
const axes = ["x", "y"] as const;
const frameFields = ["startFrame", "endFrame"] as const;
const cameras = [{ id: "south", name: "南侧朝北" }, { id: "north", name: "北侧朝南" }, { id: "east", name: "东侧朝西" }, { id: "west", name: "西侧朝东" }];
const valueOf = (event: Event) => (event.target as HTMLInputElement).value;
const checkedOf = (event: Event) => (event.target as HTMLInputElement).checked;
const clone = (plan: BlockingPlan): BlockingPlan => JSON.parse(JSON.stringify(plan));
const draft = ref(clone(props.initial));
const history = ref<string[]>([]);
const shotIndex = ref(0);
const selected = ref("");
const pointIndex = ref(0);
const progress = ref(0);
const playing = ref(false);
const analyzing = ref(false);
const useImage = ref(true);
const analysisError = ref("");
const busy = computed(() => props.saving || analyzing.value);
const shot = computed(() => props.document.shots[shotIndex.value]);
const stage = computed(() => shot.value && draft.value.shots[shot.value.id]);
const scene = computed(() => draft.value.scenes.find(item => item.id === stage.value?.sceneId));
const targets = computed(() => scene.value ? [...scene.value.actors, ...scene.value.marks] : []);
const tracks = computed(() => shot.value ? resolveTracks(draft.value, props.document.shots, shot.value.id) : []);
const track = computed(() => tracks.value.find(item => item.actor.id === selected.value));
const mark = computed(() => scene.value?.marks.find(item => item.id === selected.value));
const currentPoint = computed(() => mark.value?.at ?? (track.value?.actor.locked ? track.value.actor.home : track.value?.points[pointIndex.value]));
const facingOptions = computed(() => {
  const options = [...["东", "南", "西", "北"].map(name => ({ id: name, name })), ...targets.value.filter(item => item.id !== selected.value)];
  const facing = track.value?.route.facing;
  if (facing && !options.some(item => item.id === facing)) options.push({ id: facing, name: facing });
  return options;
});
let request: AbortController | undefined;
let animation = 0;
function newScene(): StageScene {
  return { id: crypto.randomUUID(), name: `场景 ${draft.value.scenes.length + 1}`, actors: [], marks: [] };
}
if (!draft.value.scenes.length && props.document.shots.length) draft.value.scenes.push(newScene());
let previousScene = draft.value.scenes[0]?.id;
for (const item of props.document.shots) {
  const existing = draft.value.shots[item.id];
  if (!existing && previousScene) draft.value.shots[item.id] = { shotId: item.id, sceneId: previousScene, cut: false, camera: "south", focus: "", routes: {}, note: "" };
  previousScene = existing?.sceneId ?? previousScene;
}
watch(targets, items => {
  if (!items.some(item => item.id === selected.value)) {
    selected.value = items[0]?.id ?? "";
    pointIndex.value = 0;
  }
}, { immediate: true });
watch(() => track.value?.points.length ?? 0, length => { pointIndex.value = Math.min(pointIndex.value, Math.max(0, length - 1)); });

function pause() {
  playing.value = false;
  cancelAnimationFrame(animation);
}
function checkpoint() {
  pause();
  const snapshot = JSON.stringify(draft.value);
  if (history.value.at(-1) === snapshot) return;
  if (history.value.length >= 24) history.value.shift();
  history.value.push(snapshot);
}
function alter(change: () => void) {
  if (busy.value) return;
  checkpoint();
  change();
}
function undo() {
  if (busy.value) return;
  const snapshot = history.value.pop();
  if (snapshot) { pause(); draft.value = JSON.parse(snapshot); }
}
function choose(_kind: "actor" | "mark", id: string, index: number) {
  pause();
  selected.value = id;
  pointIndex.value = index;
}
function selectEntity(id: string) { choose("actor", id, 0); }
function selectShot(i: number) {
  if (busy.value) return;
  pause();
  shotIndex.value = i;
  progress.value = 0;
  pointIndex.value = 0;
  analysisError.value = "";
}
function togglePlay() {
  if (playing.value) { pause(); return; }
  if (busy.value || !shot.value) return;
  if (progress.value >= 1) progress.value = 0;
  playing.value = true;
  let last = performance.now();
  function tick(now: number) {
    if (!playing.value || !shot.value) return;
    let elapsed = progress.value * shot.value.duration + (now - last) / 1000;
    last = now;
    while (elapsed >= shot.value.duration) {
      elapsed -= shot.value.duration;
      if (shotIndex.value >= props.document.shots.length - 1) {
        progress.value = 1;
        pause();
        return;
      }
      shotIndex.value++;
      pointIndex.value = 0;
      analysisError.value = "";
    }
    progress.value = elapsed / shot.value.duration;
    animation = requestAnimationFrame(tick);
  }
  animation = requestAnimationFrame(tick);
}
function scrub(event: Event) { pause(); progress.value = Number(valueOf(event)); }

function assignScene(id: string) {
  if (!stage.value || stage.value.sceneId === id) return;
  Object.assign(stage.value, { sceneId: id, routes: {}, focus: "", note: "" });
  pointIndex.value = 0;
}
function switchScene(id: string) { alter(() => assignScene(id)); }
function addScene() {
  alter(() => {
    const item = newScene();
    draft.value.scenes.push(item);
    assignScene(item.id);
  });
}
function rename(event: Event, item: { id: string; name: string }) {
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  if (!name || name === item.name) { input.value = item.name; return; }
  alter(() => { item.name = name; });
}
function addEntity(kind: "actor" | "mark") {
  if (!scene.value) return;
  alter(() => {
    const current = scene.value!;
    const id = crypto.randomUUID();
    if (kind === "actor") {
      current.actors.push({ id, name: `人物 ${current.actors.length + 1}`, home: { x: 50, y: 50 }, locked: false });
      stage.value!.routes[id] = { via: [], visible: true, facing: "" };
    } else current.marks.push({ id, name: `地标 ${current.marks.length + 1}`, at: { x: 50, y: 50 } });
    choose(kind, id, 0);
  });
}
function editRoute(): ActorRoute {
  const current = track.value!;
  // 仅存储本镜的显式覆盖；拖终点或修改朝向时，保留自动起点的继承关系。
  return stage.value!.routes[current.actor.id] ??= { via: [], visible: current.route.visible, facing: current.route.facing };
}
function setLock(event: Event) {
  if (!track.value) return;
  alter(() => {
    const { actor, points } = track.value!;
    if (checkedOf(event)) actor.home = { ...pointAt(points, progress.value) };
    actor.locked = checkedOf(event);
    pointIndex.value = 0;
  });
}
function movePoint(p: Point) {
  if (busy.value) return;
  if (mark.value) { mark.value.at = p; return; }
  const current = track.value;
  if (!current) return;
  if (current.actor.locked) { current.actor.home = p; return; }
  const route = editRoute();
  if (pointIndex.value === 0) route.start = p;
  else if (pointIndex.value === current.points.length - 1) route.end = p;
  else route.via[pointIndex.value - 1] = p;
}
function setCoordinate(axis: "x" | "y", event: Event) {
  const p = currentPoint.value;
  if (!p) return;
  const input = event.target as HTMLInputElement;
  const n = input.valueAsNumber;
  if (!Number.isFinite(n)) { input.value = String(p[axis]); return; }
  const value = Math.max(0, Math.min(100, Math.round(n * 10) / 10));
  input.value = String(value);
  if (value !== p[axis]) alter(() => movePoint({ ...p, [axis]: value }));
}
function addVia() {
  const current = track.value;
  if (!current || current.actor.locked) return;
  const i = Math.min(pointIndex.value, current.points.length - 2);
  const a = current.points[i]!, b = current.points[i + 1]!;
  alter(() => {
    editRoute().via.splice(i, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    pointIndex.value = i + 1;
  });
}
function removeVia() {
  if (!track.value || pointIndex.value <= 0 || pointIndex.value >= track.value.points.length - 1) return;
  alter(() => { editRoute().via.splice(pointIndex.value - 1, 1); pointIndex.value--; });
}
function setFrame(field: typeof frameFields[number], url: string) {
  const frame = props.frameChoices?.find(item => item.url === url);
  alter(() => {
    if (frame) stage.value![field] = { url: frame.url, mimeType: frame.mimeType };
    else delete stage.value![field];
  });
}
function abortSuggestion() {
  request?.abort();
  request = undefined;
  analyzing.value = false;
}
async function analyze() {
  if (busy.value || !props.suggest || !shot.value) return;
  pause();
  const controller = new AbortController();
  request = controller;
  analyzing.value = true;
  analysisError.value = "";
  try {
    const plan = await props.suggest(clone(draft.value), shot.value.id, controller.signal, useImage.value);
    if (request === controller) { checkpoint(); draft.value = clone(plan); }
  } catch (error) {
    if (!controller.signal.aborted) analysisError.value = error instanceof Error ? error.message : "分析本镜失败，请重试。";
  } finally {
    if (request === controller) { request = undefined; analyzing.value = false; }
  }
}
function close() {
  if (props.saving) return;
  pause();
  abortSuggestion();
  emit("close");
}
function apply() {
  if (busy.value) return;
  pause();
  emit("apply", clone(draft.value));
}
onBeforeUnmount(() => { pause(); abortSuggestion(); });
</script>

<style lang="scss" scoped>
.editorHeader {
  display: flex; align-items: center; gap: 6px;
  div { display: flex; align-items: baseline; gap: 12px; margin-right: auto; }
  h2 { font-size: 21px; font-weight: 650; margin: 0; }
  span { color: var(--el-text-color-secondary); font-size: 12px; }
}
.editorLayout {
  display: grid; grid-template-columns: 146px minmax(0, 1fr); gap: 16px;
  height: min(76vh, 840px); overflow: hidden; color: var(--el-text-color-primary);
  h3, p { margin: 0; }
  h3 { font-size: 14px; }
  button, select, input { font: inherit; }
  button, select, input:not([type="checkbox"], [type="range"]) {
    background: var(--el-bg-color); color: var(--el-text-color-primary);
    border: 1px solid var(--el-border-color); border-radius: 4px; padding: 4px 7px; min-height: 28px; box-sizing: border-box;
  }
  button, select { cursor: pointer; }
  button:hover:enabled { border-color: var(--el-color-primary); }
  button:disabled, select:disabled { opacity: 0.6; cursor: default; }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
  .shotNav {
    display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-width: 0; padding-right: 10px; overflow: auto;
    border-right: 1px solid var(--el-border-color);
    h3 { padding: 8px 0; }
    button {
      flex: 0 0 auto; text-align: left; padding: 8px; background: transparent; border: 1px solid transparent;
      span:first-child { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
      small, .excerpt { color: var(--el-text-color-secondary); font-size: 12px; }
      .excerpt { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
      &.active { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
    }
  }
  .editingPane {
    overflow: auto; min-width: 0; padding: 0 8px 6px 0;
    > * + * { margin-top: 10px; }
    .shotTitle { display: flex; align-items: baseline; gap: 10px; h3 { flex: none; } p { overflow-wrap: anywhere; line-height: 1.5; } }
    fieldset {
      min-width: 0; margin-left: 0; margin-right: 0; border: 1px solid var(--el-border-color); border-radius: 5px; padding: 7px 10px 10px;
      legend { padding: 0 5px; font-weight: 600; font-size: 12px; }
    }
    label { display: inline-flex; gap: 5px; align-items: center; font-size: 12px; }
    .check { white-space: nowrap; input { margin: 0; accent-color: var(--el-color-primary); } }
    .shotSettings, .frameSettings, .entityRow { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 12px; }
    .shotSettings, .entityRow { select { max-width: 180px; } input:not([type="checkbox"]) { width: 105px; } }
    .entityPanel {
      .entityRow + .entityRow { margin-top: 8px; }
      input.coordinate { width: 65px; }
      .hint { margin-top: 9px; color: var(--el-text-color-secondary); font-size: 12px; }
    }
    .frameSettings { select { max-width: min(280px, 55vw); } }
    .playBar {
      display: flex; align-items: center; gap: 12px; padding: 6px 0;
      .playButton { display: inline-flex; align-items: center; gap: 5px; }
      input { flex: 1; min-width: 0; accent-color: var(--el-color-primary); }
      span { white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
    }
    .suggestion {
      display: flex; justify-content: space-between; gap: 12px; align-items: center;
      padding: 9px 10px; background: var(--el-fill-color-light); border-radius: 4px;
      p { margin-top: 3px; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
      .suggestActions { display: flex; flex-wrap: wrap; gap: 7px; flex-shrink: 0; align-items: center; }
    }
    .analysisError { color: var(--el-color-danger); }
  }
  @media (max-width: 830px) { grid-template-columns: 95px minmax(0, 1fr); gap: 8px; }
  @media (max-width: 600px) {
    display: flex; flex-direction: column;
    .shotNav { flex: none; flex-direction: row; padding: 0 0 4px; border: 0; h3, .excerpt { display: none; } }
    .editingPane { padding-right: 0; .suggestion { align-items: flex-start; flex-direction: column; } }
  }
}
</style>
