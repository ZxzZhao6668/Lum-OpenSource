<template>
  <section class="shootingHud" role="group" aria-label="片场拍摄" :class="{ capturing: recording, held: paused }">
    <div class="frameMarks" aria-hidden="true"><i /><i /><i /><i /></div>
    <header class="hudTop">
      <div class="topLeft">
        <button class="glassChip" type="button" title="回到片场" @click="emit('exit')"><icon-arrow-left :size="15" /><span>回到场</span></button>
        <span class="glassChip readout"><i class="signalDot" /><b v-if="recording" class="timecode">{{ paused ? '暂停' : 'REC' }} {{ clock(elapsed) }}</b><span>{{ method }} · {{ Number(focal.toFixed(1)) }} mm</span></span>
      </div>
      <button type="button" class="glassChip agentTrigger" :aria-expanded="agentOpen" title="打开场景 Agent（空格）" @click="dismiss(); emit('agent')"><icon-microphone :size="15" /><span>空格 说话</span></button>
      <div class="topRight">
        <button class="glassChip" type="button" aria-haspopup="true" :aria-expanded="panel === 'ratio'" :disabled="recording || !!playingTakeId" :title="recording ? '本拍次已锁定画幅' : '选择拍摄画幅'" @click="toggle('ratio')"><icon-aspect-ratio :size="16" /><b>{{ ratio }}</b><icon-dots :size="14" /></button>
        <span class="glassChip optics">焦点 {{ focusReadout }}<i /> f/{{ aperture }}<i /> {{ following ? '跟随' : locked ? '锁定' : '定点' }}</span>
      </div>
    </header>
    <aside class="dialRack" aria-label="拍摄参数">
      <div class="dialUnit">
        <button class="roundDial" type="button" aria-haspopup="true" :aria-expanded="panel === 'wheel'" @click="toggleWheel"><b>{{ method }}</b><small>拍法</small></button>
        <span class="keycaps"><kbd>Tab</kbd></span>
      </div>
      <div v-for="setting in sideSettings" :key="setting.kind" class="dialUnit">
        <button class="roundDial" type="button" :title="setting.label + '：点击调整或滚轮微调'" :aria-expanded="panel === setting.kind" @click="toggle(setting.kind)" @wheel.prevent.stop="adjustWheel($event, setting.kind)"><b>{{ setting.value }}</b><small>{{ setting.label }}</small></button>
        <span v-if="setting.keys.length" class="keycaps"><kbd v-for="key in setting.keys" :key="key">{{ key }}</kbd></span>
        <div v-if="panel === setting.kind" class="bumpPanel glassChip" :aria-label="setting.label">
          <button type="button" :aria-label="'降低' + setting.label" @click="emit('adjust', setting.kind, -1)"><icon-minus :size="15" /></button>
          <output>{{ setting.value }}</output>
          <button type="button" :aria-label="'提高' + setting.label" @click="emit('adjust', setting.kind, 1)"><icon-plus :size="15" /></button>
        </div>
      </div>
    </aside>
    <div v-if="panel === 'ratio'" class="ratioMenu glassPanel" role="group" aria-label="拍摄画幅">
      <button v-for="item in formats" :key="item.ratio" type="button" :aria-pressed="ratio === item.ratio" @click="emit('ratio', item.ratio); dismiss()"><span class="ratioGlyph"><i :style="{ width: item.w + 'px', height: item.h + 'px' }" /></span><b>{{ item.ratio }}</b><small>{{ item.name }}</small></button>
    </div>
    <button v-if="!panel && !agentOpen && !playingTakeId" class="glassChip lockChip" type="button" title="锁定或释放主体（F）" :aria-pressed="locked" @click="emit('lock')"><icon-focus-2 :size="13" />{{ locked ? '已锁定' : '盯住它' }}<kbd>F</kbd></button>
    <footer class="captureControls">
      <div class="lensStrip glassChip" role="group" aria-label="镜头焦段" title="横向拖动或滚轮连续变焦 · 左右键微调 · 点击切换定焦"
        @wheel.prevent.stop="stepLens" @pointerdown="startZoomDrag" @pointermove="moveZoomDrag" @pointerup="endZoomDrag" @pointercancel="endZoomDrag"
        @lostpointercapture="endZoomDrag" @click.capture="guardZoomClick" @keydown="stepLensKey">
        <button v-for="mm in lenses" :key="mm" type="button" :aria-pressed="mm === focal" :aria-label="mm + ' 毫米'" @click="requestFocal(mm)">{{ mm }}<small v-if="mm === focal"> mm</small></button>
        <output v-if="!lenses.includes(focal)" class="zoomValue">{{ Number(focal.toFixed(1)) }} mm</output>
      </div>
      <div class="transport">
        <button v-if="recording" class="glassChip pauseButton" type="button" :title="paused ? '继续录制（P）' : '暂停录制（P）'" :aria-label="paused ? '继续录制' : '暂停录制'" @click="emit('pause')"><icon-player-play v-if="paused" :size="16" /><icon-player-pause v-else :size="16" /></button>
        <button v-if="playingTakeId" type="button" class="glassChip playbackStop" @click="emit('playTake', playingTakeId)"><icon-player-stop :size="15" />停止回放</button>
        <button v-else class="recordButton" type="button" :aria-label="recording ? '停止录制' : '开始录制'" :title="recording ? '停止录制（R）' : '开始录制（R）'" @click="dismiss(); emit('record')"><i /></button>
      </div>
      <span v-if="!playingTakeId" class="keyHint">{{ recording ? (paused ? 'P 继续 · R 结束' : 'R 结束 · P 暂停') : 'WASD 移动 · 拖动转向 · 滚轮变焦 · R 开拍' }}</span>
      <div class="lowerRow">
        <button class="lastTake glassChip" type="button" title="查看已拍素材（B）" aria-label="查看已拍素材" :aria-expanded="panel === 'takes'" :disabled="recording" @click="toggleTakes"><img v-if="takes[0]?.thumbnail" :src="takes[0].thumbnail" alt="" /><icon-photo v-else :size="17" /></button>
        <div class="modeStrip glassChip" role="group" aria-label="拍摄视角">
          <button type="button" :disabled="recording" @click="emit('exit')">世界</button>
          <button type="button" :aria-pressed="!following" @click="emit('follow', false)">手持</button>
          <button type="button" :aria-pressed="following" @click="emit('follow', true)">跟拍</button>
        </div>
        <button class="historyButton glassChip" type="button" title="拍次历史（B）" aria-label="拍次历史" :aria-expanded="panel === 'takes'" :disabled="recording" @click="toggleTakes"><icon-history :size="17" /></button>
      </div>
    </footer>
    <aside v-if="panel === 'takes'" class="takeDrawer glassPanel" aria-label="已拍素材">
      <header><h3>已拍素材 <small>{{ takes.length }}</small></h3><button class="iconButton" type="button" aria-label="收起已拍素材" @click="dismiss"><icon-x :size="16" /></button></header>
      <p v-if="!takes.length" class="emptyTakes">按 R 拍摄第一条素材。</p>
      <template v-else>
        <button v-if="selected?.thumbnail && !exportOpen" class="takePoster" type="button" :aria-label="'回放' + selected.name" @click="previewTake(selected.id)"><img :src="selected.thumbnail" alt="" /><icon-player-play :size="20" /></button>
        <div class="takeList"><button v-for="take in takes" :key="take.id" class="takeItem" type="button" :aria-pressed="selected?.id === take.id" @click="emit('selectTake', take.id)">
          <img v-if="take.thumbnail" :src="take.thumbnail" alt="" /><span v-else class="takePlaceholder"><icon-movie :size="18" /></span>
          <span class="takeText"><strong>{{ take.name }}</strong><small>{{ take.duration < 1 ? take.duration.toFixed(1) + ' s' : clock(take.duration) }}<template v-if="takeFocal(take)"> · {{ takeFocal(take) }} mm</template></small></span>
          <icon-check v-if="adoptedTakeId === take.id" :size="15" aria-label="已采用" />
        </button></div>
        <template v-if="selected">
          <div class="takeActions">
            <button type="button" @click="previewTake(selected.id)"><icon-player-play :size="14" />回放</button>
            <button type="button" :disabled="adoptedTakeId === selected.id" @click="emit('adoptTake', selected.id)">{{ adoptedTakeId === selected.id ? '已采用' : '采用拍次' }}</button>
            <button type="button" :disabled="exportBusy" :aria-expanded="exportOpen" @click="exportOpen = !exportOpen"><icon-download :size="14" />导出</button>
          </div>
          <section v-if="exportOpen" class="takeExport" :aria-label="'导出' + selected.name">
            <label>导出格式<select v-model="exportKind" :disabled="exportBusy"><option value="video">白模视频</option><option value="frame">分镜图</option></select></label>
            <div class="takeActions">
              <button type="button" :disabled="exportBusy" @click="exportSelected('files')"><icon-download :size="14" />下载文件</button>
              <button v-if="canExportCanvas" type="button" :disabled="exportBusy" @click="exportSelected('canvas')">发送到画布</button>
            </div>
          </section>
        </template>
      </template>
    </aside>
    <div v-if="panel === 'wheel'" class="wheelShade" @click.self="dismiss">
      <section class="methodPicker" role="dialog" aria-label="选择拍法">
        <header>拍法 <kbd>Tab</kbd><button type="button" class="wheelClose iconButton" aria-label="关闭拍法转盘" @click="dismiss"><icon-x :size="16" /></button></header>
        <svg class="methodWheel" viewBox="-202 -202 404 404" aria-label="七种拍法">
          <g v-for="segment in parameterArcs" :key="segment.kind" class="wheelParameter" aria-hidden="true">
            <path :d="segment.path" /><text :x="segment.x" :y="segment.y - 2">{{ segment.label }}</text><text :x="segment.x" :y="segment.y + 10">{{ segment.value }}</text>
          </g>
          <g v-for="sector in sectors" :key="sector.name" class="wheelSector" tabindex="0" role="button" :aria-label="sector.name" :aria-pressed="method === sector.name" @click="emit('method', sector.name)" @keydown.enter.prevent.stop="emit('method', sector.name)" @keydown.space.prevent.stop="emit('method', sector.name)">
            <path :d="sector.path" /><text :x="sector.x" :y="sector.y - 2">{{ sector.name }}</text><text class="sectorNumber" :x="sector.x" :y="sector.y + 16">{{ sector.shortcut }}</text>
          </g>
          <g class="tickMarks" aria-hidden="true"><line v-for="tick in 84" :key="tick" :transform="'rotate(' + tick * 360 / 84 + ')'" x1="0" y1="-146" x2="0" :y2="tick % 6 ? -143 : -139" /></g>
          <circle class="wheelHub" r="47" /><text class="hubTitle" y="-1">{{ method }}</text><text class="hubNote" y="16">{{ speed }}×</text>
        </svg>
        <div class="wheelAdjustments" :aria-label="method + '参数'">
          <div v-for="item in wheelSettings" :key="item.kind">
            <button type="button" :aria-label="'降低' + item.label" @click="emit('adjust', item.kind, -1)">−</button>
            <span>{{ item.label }} <b>{{ item.value }}</b></span>
            <button type="button" :aria-label="'提高' + item.label" @click="emit('adjust', item.kind, 1)">+</button>
          </div>
        </div>
        <button type="button" class="wheelDone glassChip" @click="dismiss">完成</button>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconArrowLeft, IconAspectRatio, IconCheck, IconDots, IconDownload, IconFocus2, IconHistory, IconMicrophone, IconMinus, IconMovie, IconPhoto, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconPlus, IconX } from "@tabler/icons-vue";
import { shootingMethods, shootingLenses as lenses } from "./shootingSession";
import { focalLimits } from "./cameraDocument";

type Kind = "speed" | "shake" | "height" | "aperture" | "randomness";
type Panel = "" | "wheel" | "takes" | "ratio" | Kind;
type ExportKind = "video" | "frame";
type ExportDestination = "files" | "canvas";
type Take = { id: string; name: string; duration: number; focal?: number; thumbnail?: string; samples?: readonly { frame: { focalLength: number } }[] };
const props = defineProps<{
  method: string; speed: number; shake: number; height: number; aperture: number; focal: number;
  ratio: string; focusDistance: number; locked: boolean; following: boolean;
  recording: boolean; paused: boolean; elapsed: number; takes: readonly Take[];
  selectedTakeId?: string; adoptedTakeId?: string; playingTakeId?: string; randomness?: number; agentOpen?: boolean;
  canExportCanvas?: boolean; exportBusy?: boolean;
}>();
const emit = defineEmits<{
  overlay: [open: boolean]; exit: []; agent: []; method: [method: typeof shootingMethods[number]]; adjust: [kind: Kind, step: number]; lens: [mm: number]; ratio: [ratio: typeof formats[number]["ratio"]]; record: []; pause: []; lock: [];
  follow: [enabled: boolean]; selectTake: [id: string]; playTake: [id: string]; adoptTake: [id: string];
  exportTake: [id: string, kind: ExportKind, destination: ExportDestination];
}>();
const panel = ref<Panel>("");
const exportOpen = ref(false);
const exportKind = ref<ExportKind>("video");
const formats = [
  { ratio: "16:9", name: "横屏", w: 21, h: 12 }, { ratio: "9:16", name: "竖屏", w: 9, h: 16 },
  { ratio: "1:1", name: "方形", w: 14, h: 14 }, { ratio: "21:9", name: "宽银幕", w: 23, h: 10 },
] as const;
const selected = computed(() => props.takes.find(t => t.id === props.selectedTakeId) ?? props.takes[0]);
const focusReadout = computed(() => Number.isFinite(props.focusDistance) ? props.focusDistance.toFixed(1) + " m" : "∞");
const shakeValue = computed(() => ["稳", "轻", "中", "强"][Math.round(props.shake)] ?? String(props.shake));
const sideSettings = computed(() => [
  { kind: "speed", label: "速度", value: String(props.speed), keys: ["Z", "X"] },
  { kind: "shake", label: "晃动", value: shakeValue.value, keys: ["C", "T"] },
  { kind: "height", label: "高度", value: props.height.toFixed(2), keys: ["Q", "E"] },
  { kind: "aperture", label: "光圈", value: "f/" + props.aperture, keys: [] },
] as const);
const wheelSettings = computed(() => [
  { kind: "speed", label: "快慢", value: props.speed + "×" },
  { kind: "shake", label: "晃动", value: shakeValue.value },
  { kind: "randomness", label: "随机", value: (props.randomness ?? 0) + "%" },
] as const);

function polar(radius: number, radians: number) { return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }; }
function arcPath(inner: number, outer: number, start: number, end: number) {
  const a = polar(outer, start), b = polar(outer, end), c = polar(inner, end), d = polar(inner, start);
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 0 0 ${d.x} ${d.y} Z`;
}
const sectors = [0, 1, 2, 3, 4, 6, 5].map((index, position) => {
  const angle = (position - 1) * 2 * Math.PI / 7 - Math.PI / 2;
  return { name: shootingMethods[index]!, shortcut: index + 1, angle, ...polar(100, angle),
    path: arcPath(47, 148, angle - Math.PI / 7, angle + Math.PI / 7) };
});
const parameterArcs = computed(() => {
  const selectedAngle = sectors.find(sector => sector.name === props.method)?.angle ?? -Math.PI / 2;
  return wheelSettings.value.map((item, index) => {
    const angle = selectedAngle + (index - 1) * Math.PI / 10;
    return { ...item, ...polar(173, angle), path: arcPath(153, 193, angle - .15, angle + .15) };
  });
});
function clock(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds));
  return [Math.floor(whole / 60), whole % 60].map(n => String(n).padStart(2, "0")).join(":");
}
function takeFocal(take: Take) { return Number((take.focal ?? take.samples?.[0]?.frame.focalLength ?? 0).toFixed(1)); }
function dismiss() { const wasOpen = !!panel.value; panel.value = ""; return wasOpen; }
function toggle(next: Panel) { panel.value = panel.value === next ? "" : next; }
function toggleWheel() { toggle("wheel"); }
function toggleTakes() { if (!props.recording) toggle("takes"); }
function openTakes() { panel.value = "takes"; }
function previewTake(id: string) { dismiss(); emit("playTake", id); }
function exportSelected(destination: ExportDestination) {
  if (!selected.value || props.exportBusy || (destination === "canvas" && !props.canExportCanvas)) return;
  emit("exportTake", selected.value.id, exportKind.value, destination);
  exportOpen.value = false;
}
function handleMenuKey(event: KeyboardEvent) {
  if (!panel.value) return false;
  if (event.key === "Escape" && exportOpen.value) { exportOpen.value = false; return true; }
  if (event.key === "Escape") return dismiss();
  if (event.key === "Tab") {
    if (panel.value === "wheel" && !event.shiftKey) { dismiss(); return true; }
    return false;
  }
  if (panel.value === "wheel" && /^[1-7]$/.test(event.key)) { emit("method", shootingMethods[Number(event.key) - 1]!); return true; }
  if (panel.value === "takes" && event.key.toLowerCase() === "b") return dismiss();
  return false;
}
function adjustWheel(event: WheelEvent, kind: Kind) {
  if (event.deltaY) emit("adjust", kind, event.deltaY < 0 ? 1 : -1);
}
let requestedFocal = props.focal;
let lastSentFocal = props.focal;
let zoomDrag: { id: number; startX: number; startFocal: number; span: number; moved: boolean } | undefined;
let blockLensClick = false;
watch(() => props.focal, value => {
  if (value !== lastSentFocal) requestedFocal = value;
  lastSentFocal = value;
}, { flush: "sync" });
function requestFocal(value: number) {
  requestedFocal = Math.max(focalLimits.min, Math.min(focalLimits.max, value));
  // 触控板的小于 0.1 mm 的位移在本地累积，宿主只收到可见的十分位目标。
  const rounded = Math.round(requestedFocal * 10) / 10;
  if (rounded === lastSentFocal) return;
  lastSentFocal = rounded;
  emit("lens", rounded);
}
function startZoomDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0) return;
  const strip = event.currentTarget as HTMLElement;
  zoomDrag = { id: event.pointerId, startX: event.clientX, startFocal: requestedFocal, span: Math.max(140, strip.clientWidth), moved: false };
  blockLensClick = false;
  const target = (event.target as Element).closest("button") ?? strip;
  target.setPointerCapture(event.pointerId);
}
function moveZoomDrag(event: PointerEvent) {
  const drag = zoomDrag;
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved && Math.abs(dx) < 4) return;
  drag.moved = true;
  blockLensClick = true;
  requestFocal(drag.startFocal * (focalLimits.max / focalLimits.min) ** (dx / drag.span));
}
function endZoomDrag(event: PointerEvent) { if (zoomDrag?.id === event.pointerId) zoomDrag = undefined; }
function guardZoomClick(event: MouseEvent) {
  if (!event.detail || !blockLensClick) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  blockLensClick = false;
}
function stepLens(event: WheelEvent) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (event.currentTarget as HTMLElement).clientWidth : 1;
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? -event.deltaY : event.deltaX;
  if (delta) requestFocal(requestedFocal * Math.exp(Math.min(160, Math.max(-160, delta * unit)) / 650));
}
function stepLensKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 5 : 1;
  const values: Record<string, number> = { ArrowLeft: requestedFocal - step, ArrowRight: requestedFocal + step, Home: focalLimits.min, End: focalLimits.max };
  const value = values[event.key];
  if (value === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  requestFocal(value);
}
watch(() => !!panel.value, open => emit("overlay", open), { flush: "sync" });
watch([panel, () => selected.value?.id], () => { exportOpen.value = false; exportKind.value = "video"; }, { flush: "sync" });
watch(() => props.agentOpen, open => { if (open) dismiss(); });
watch(() => props.recording, (active, previous) => { if (active) dismiss(); else if (previous) panel.value = "takes"; });
defineExpose({ toggleWheel, toggleTakes, openTakes, dismiss, handleMenuKey, stepLens });
</script>

<style scoped lang="scss">
.shootingHud {
  --glass: rgba(43, 55, 66, .66);
  --glassSolid: rgba(36, 46, 54, .89);
  --edge: rgba(255, 255, 255, .31);
  --light: #ffdc79;
  --shadow: 0 4px 18px rgba(16, 31, 45, .14);
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow: hidden;
  container-type: size;
  pointer-events: none;
  color: #fff;
  font: 600 12px/1.25 system-ui, sans-serif;
  user-select: none;

  *, *::before, *::after { box-sizing: border-box; }
  button { border: 0; margin: 0; padding: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  button:disabled { cursor: default; opacity: .58; }
  button:focus-visible, [role="button"]:focus-visible { outline: 2px solid var(--light); outline-offset: 2px; }
  h3, p { margin: 0; }
  kbd { font: 700 10px/1.3 system-ui, sans-serif; }
  .glassChip, .roundDial, .glassPanel, .recordButton {
    background: var(--glass);
    border: 1px solid var(--edge);
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, .12), var(--shadow);
    backdrop-filter: blur(10px) saturate(.9);
  }
  .glassChip { display: inline-flex; justify-content: center; align-items: center; gap: 6px; min-height: 30px; border-radius: 20px; padding: 5px 11px; white-space: nowrap; }
  .glassPanel { background: var(--glassSolid); border-radius: 15px; }
  .frameMarks {
    position: absolute; inset: 10px;
    i { position: absolute; width: 15px; height: 15px; border: 0 solid rgba(255,255,255,.86); }
    i:nth-child(1) { inset: 0 auto auto 0; border-width: 1px 0 0 1px; }
    i:nth-child(2) { inset: 0 0 auto auto; border-width: 1px 1px 0 0; }
    i:nth-child(3) { inset: auto 0 0 auto; border-width: 0 1px 1px 0; }
    i:nth-child(4) { inset: auto auto 0 0; border-width: 0 0 1px 1px; }
  }
  .hudTop {
    position: absolute; inset: 14px 16px auto; display: flex; align-items: start; justify-content: space-between; gap: 6px;
    button { pointer-events: auto; }
    .topLeft { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px; max-width: 40%; }
    .topRight { display: flex; align-items: flex-end; flex-direction: column; gap: 6px; max-width: 32%; }
    .agentTrigger { position: absolute; top: 0; left: 50%; transform: translateX(-50%); }
    .optics { min-height: 25px; padding: 4px 8px; font-size: 11px; i { height: 12px; width: 1px; background: var(--edge); } }
    .signalDot { width: 7px; height: 7px; border-radius: 50%; background: #ddede7; }
    .timecode { color: #ffcbc5; font-variant-numeric: tabular-nums; }
  }
  &.capturing {
    &::before { content: ""; position: absolute; inset: 0; border: 2px solid #fc574a; }
    .signalDot { background: #ff5142; }
    .recordButton i { border-radius: 5px; width: 23px; height: 23px; }
  }
  &.held::before { border-color: #efbe65; }
  .dialRack {
    position: absolute; left: 13px; top: 50%; transform: translateY(-50%); display: grid; gap: clamp(5px, 1.35cqh, 14px); justify-items: center;
    .dialUnit { position: relative; display: grid; justify-items: center; gap: 3px; }
    .roundDial {
      width: clamp(41px, 5.8cqh, 57px); aspect-ratio: 1; border-radius: 50%; display: grid; place-content: center; line-height: 1.15; pointer-events: auto; position: relative;
      &::after { content: ""; position: absolute; inset: 2px; border-radius: 50%; border: 1.5px solid transparent; border-top-color: rgba(255,255,255,.8); border-right-color: rgba(255,255,255,.38); transform: rotate(-34deg); }
      b { font-size: clamp(12px, 1.6cqh, 16px); font-variant-numeric: tabular-nums; }
      small { margin-top: 1px; font-size: 10px; color: #f1f3f5; }
    }
    .keycaps { display: flex; gap: 3px; kbd { padding: 0 3px; border-radius: 3px; color: #34414a; background: #f9fbfcdd; } }
    .bumpPanel { position: absolute; left: calc(100% + 8px); top: 8px; padding: 3px; gap: 0; pointer-events: auto; output { min-width: 4ch; text-align: center; } button { width: 28px; height: 26px; display: grid; place-items: center; border-radius: 20px; } }
  }
  .ratioMenu { position: absolute; pointer-events: auto; right: 14px; top: 50px; padding: 5px; min-width: 138px;
    button { display: flex; align-items: center; gap: 9px; width: 100%; height: 31px; padding: 0 8px; border-radius: 9px; }
    small { opacity: .85; }
    .ratioGlyph { width: 24px; display: flex; justify-content: center; i { display: block; border: 1px solid; border-radius: 2px; } }
  }
  .lockChip { position: absolute; top: calc(50% + 20px); left: 50%; transform: translateX(-50%); pointer-events: auto; font-size: 10px; min-height: 22px; padding: 3px 7px; kbd { border-radius: 2px; background: #ffffff24; padding: 0 3px; } }
  .captureControls {
    position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: clamp(3px, .8cqh, 8px);
    button, .lensStrip, .modeStrip { pointer-events: auto; }
    .lensStrip, .modeStrip { padding: 3px; gap: 0; min-height: 26px; }
    .lensStrip { touch-action: none; position: relative; cursor: ew-resize; button { cursor: ew-resize; } }
    .zoomValue { position: absolute; left: calc(100% + 4px); padding: 2px 6px; border-radius: 8px; background: var(--glassSolid); color: var(--light); font-size: 10px; font-variant-numeric: tabular-nums; pointer-events: none; }
    .lensStrip button, .modeStrip button { border-radius: 20px; padding: 5px 9px; }
    .lensStrip small { font-size: .8em; }
    .transport { position: relative; display: grid; justify-items: center; }
    .recordButton { width: clamp(44px, 6.5cqh, 66px); aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; padding: 4px; border-color: #ffffff75; }
    .recordButton i { width: 100%; height: 100%; background: #ff493d; border-radius: 50%; transition: border-radius .15s ease; }
    .pauseButton { position: absolute; right: calc(100% + 10px); bottom: 5px; border-radius: 50%; width: 31px; height: 31px; padding: 0; }
    .keyHint { padding: 2px 7px; border-radius: 10px; font-size: 10px; background: rgba(32,41,48,.74); }
    .lowerRow { display: flex; align-items: center; gap: 12px; }
    .lastTake, .historyButton { width: 32px; height: 32px; border-radius: 50%; padding: 0; overflow: hidden; }
    .lastTake { border-radius: 10px; img { width: 100%; height: 100%; object-fit: cover; } }
  }
  [aria-pressed="true"]:is(.lensStrip button,.modeStrip button,.ratioMenu button) { background: #20282fba; color: var(--light); }
  .takeDrawer {
    position: absolute; bottom: 16px; right: 16px; width: min(300px, 43%); max-height: min(430px, 64%); padding: 13px; pointer-events: auto; display: flex; flex-direction: column; gap: 10px;
    header { display: flex; justify-content: space-between; align-items: center; h3 { font-size: 15px; } small { color: var(--light); } }
    .emptyTakes { font-weight: 400; color: #d0d9df; }
    .takePoster { position: relative; display: grid; place-items: center; width: 100%; height: clamp(60px, 15cqh, 147px); flex: none; border-radius: 7px; overflow: hidden; background: #202a31;
      img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
      svg { position: relative; box-sizing: content-box; padding: 6px; border-radius: 50%; background: #1a232ab5; }
    }
    .takeList { display: grid; overflow: auto; gap: 4px; }
    .takeItem { width: 100%; display: flex; align-items: center; gap: 9px; padding: 5px; border: 1px solid transparent; border-radius: 8px; text-align: left;
      &[aria-pressed="true"] { border-color: #f5d3799c; background: #ffffff10; }
      img, .takePlaceholder { width: 61px; aspect-ratio: 16/10; background: #263039; border-radius: 5px; object-fit: cover; }
      .takePlaceholder { display: grid; place-items: center; }
      .takeText { display: grid; flex: 1; min-width: 0; gap: 3px; strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: #d3dce2; } }
    }
    .takeActions { display: flex; align-items: center; gap: 6px; button { display: inline-flex; align-items: center; justify-content: center; flex: 1; gap: 4px; border-radius: 7px; padding: 7px; background: #ffffff17; } button:last-child { background: #e6cf8d; color: #2c2c29; } }
    .takeExport { display: grid; gap: 8px; border-top: 1px solid var(--edge); padding-top: 10px;
      label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      select { background: #303d45; color: inherit; border: 1px solid var(--edge); border-radius: 6px; padding: 3px 6px; font: inherit; }
    }
  }
  .iconButton { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 50%; }
  .wheelShade { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(24,31,38,.48); pointer-events: auto; }
  .methodPicker {
    width: min(400px, 80cqw, 82cqh); display: grid; justify-items: center; gap: 4px;
    header { display: flex; align-items: center; gap: 8px; position: relative; width: 100%; justify-content: center; text-shadow: 0 1px 4px #222; }
    header kbd { padding: 1px 4px; background: #ffffff27; border-radius: 3px; }
    .wheelClose { position: absolute; right: 0; background: #222a; }
    .methodWheel { width: min(100%, 59cqh); overflow: visible; }
    .wheelParameter { pointer-events: none; path { fill: #283039da; stroke: #e1dbbe99; stroke-width: .75; } text { fill: #f7e7be; text-anchor: middle; font-size: 10px; } }
    .wheelSector { cursor: pointer;
      path { fill: rgba(65,73,82,.79); stroke: #edf3fc5c; stroke-width: .8; }
      text { pointer-events: none; fill: #fff; font: bold 15px system-ui,sans-serif; text-anchor: middle; }
      text.sectorNumber { font: 600 10px system-ui,sans-serif; opacity: .76; }
      &[aria-pressed="true"] path { fill: rgba(246,246,240,.93); stroke: #fff; }
      &[aria-pressed="true"] text { fill: #253038; }
      &:focus-visible path { stroke: var(--light); stroke-width: 2px; }
    }
    .tickMarks { stroke: #ffffff8c; stroke-width: 1px; pointer-events: none; }
    .wheelHub { fill: #242b30ee; stroke: #ffffff52; }
    .hubTitle, .hubNote { fill: #fff; text-anchor: middle; pointer-events: none; font-size: 15px; }
    .hubNote { fill: #e1daba; font-size: 11px; }
    .wheelAdjustments { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px;
      > div { display: flex; align-items: center; gap: 3px; padding: 2px; border-radius: 8px; background: #222c34bd; }
      span { white-space: nowrap; font-size: 11px; } b { color: var(--light); }
      button { border-radius: 6px; width: 21px; min-height: 25px; font-size: 16px; }
    }
    .wheelDone { margin-top: 3px; min-height: 26px; }
  }
  @media (hover: hover) {
    button:not(:disabled):hover { background-color: rgba(70,83,94,.92); color: #fff; }
    .wheelSector:not([aria-pressed="true"]):hover path { fill: #767f87e0; }
  }
  @container (max-height: 510px) {
    .captureControls { bottom: 6px; gap: 2px; }
    .dialRack { gap: 3px; .roundDial { width: 37px; } .keycaps { display: none; } }
    .methodPicker { gap: 1px; }
  }
  @container (max-width: 570px) {
    .hudTop { inset: 8px 8px auto; .readout { font-size: 10px; } }
    .dialRack { left: 6px; }
    .takeDrawer { bottom: 52px; right: 8px; width: min(290px, 82%); }
  }
  @media (prefers-reduced-motion: reduce) { .recordButton i { transition: none; } }
}
</style>

