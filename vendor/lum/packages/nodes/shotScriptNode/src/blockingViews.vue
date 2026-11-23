<template>
  <div class="blockingViews">
    <section class="viewPane">
      <header><h3>场景俯视图</h3><span>{{ scene.name }}</span><button type="button" title="导出俯视图 PNG" aria-label="导出俯视图 PNG" @click="download(topView, '俯视图')"><icon-download :size="15" /></button></header>
      <svg ref="topView" class="topView" viewBox="0 0 720 420" width="720" height="420" role="img" aria-label="可编辑的场景俯视图"
        @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
        <rect width="720" height="420" fill="#172625" />
        <g stroke="#354845" stroke-width="1" fill="none">
          <path v-for="i in 11" :key="i" :d="`M ${worldX((i - 1) * 10)} 32 V 384 M 38 ${worldY((i - 1) * 10)} H 682`" />
        </g>
        <rect x="38" y="32" width="644" height="352" fill="none" stroke="#80958b" stroke-width="1.5" />
        <g fill="#c2cfc7" font-size="13" text-anchor="middle">
          <text x="360" y="21">北</text><text x="360" y="408">南</text><text x="16" y="213">西</text><text x="704" y="213">东</text>
        </g>
        <g v-for="(track, index) in tracks" :key="track.actor.id" :opacity="track.route.visible ? 1 : 0.48">
          <polyline :points="track.points.map(p => `${worldX(p.x)},${worldY(p.y)}`).join(' ')" fill="none" :stroke="color(index)" :stroke-width="actorId === track.actor.id ? 3 : 1.5" stroke-dasharray="6 4" />
        </g>
        <g v-for="mark in scene.marks" :key="mark.id" :transform="at(mark.at)" class="dragItem" @pointerdown.stop="beginDrag($event, 'mark', mark.id, 0, mark.at)">
          <title>{{ mark.name }}（场景地标）</title>
          <circle r="12" fill="transparent" />
          <path d="M 0 -7 L 7 0 L 0 7 L -7 0 Z" fill="#dfc389" :stroke="markId === mark.id ? '#fff5d2' : '#423d2e'" stroke-width="2" />
          <text y="21" :text-anchor="anchor(mark.at.x)" fill="#efdaad" font-size="13" paint-order="stroke" stroke="#172625" stroke-width="3">{{ mark.name }}</text>
        </g>
        <g v-for="(track, index) in tracks" :key="track.actor.id" :transform="at(locations[index]!)" class="dragItem"
          :opacity="track.route.visible ? 1 : 0.58" @pointerdown.stop="chooseActor($event, index)">
          <title>{{ track.actor.name }}{{ track.actor.locked ? '（固定）' : '' }}</title>
          <path v-if="facings[index]" :transform="`rotate(${facings[index]!.angle})`" d="M 9 -3 L 17 0 L 9 3 Z" :fill="color(index)" stroke="#192620" stroke-width="1" />
          <circle r="11" :fill="color(index)" stroke="#112320" stroke-width="2" />
          <text y="4" text-anchor="middle" fill="#192620" font-size="11" font-weight="bold">{{ index + 1 }}</text>
          <text y="25" :text-anchor="anchor(locations[index]!.x)" fill="#ecf5ef" font-size="14" paint-order="stroke" stroke="#172625" stroke-width="3">{{ track.actor.name }}</text>
        </g>
        <g v-if="activeTrack && !activeTrack.actor.locked">
          <g v-for="(p, i) in activeTrack.points" :key="i" :transform="at(p)" class="dragItem" @pointerdown.stop="beginDrag($event, 'actor', activeTrack.actor.id, i, p)">
            <line x1="0" y1="0" :x2="handleOffset(i)" y2="-14" stroke="#e6f0eb" stroke-width="1.5" />
            <g :transform="`translate(${handleOffset(i)},-15)`">
              <rect x="-11" y="-9" width="22" height="18" rx="4" :fill="pointIndex === i ? '#f3f3d4' : '#213833'" stroke="#b7cabd" />
              <text text-anchor="middle" y="4" font-size="11" :fill="pointIndex === i ? '#283c32' : '#e3eee5'">{{ i === 0 ? '起' : i === activeTrack.points.length - 1 ? '终' : i }}</text>
            </g>
          </g>
        </g>
        <g :transform="cameraTransform" fill="#ffcf89" stroke="#292921" stroke-width="1.5" pointer-events="none">
          <path d="M -8 6 V -4 H 8 V 6 Z M -6 -5 L 0 -13 L 6 -5 Z" />
        </g>
      </svg>
    </section>
    <section class="viewPane">
      <header><h3>机位画面</h3><span>{{ cameraName }} · {{ shot.shotSize }}</span><button type="button" title="导出机位画面 PNG" aria-label="导出机位画面 PNG" @click="download(cameraView, '机位画面')"><icon-download :size="15" /></button></header>
      <svg ref="cameraView" class="cameraView" viewBox="0 0 640 360" width="640" height="360" role="img" aria-label="当前机位人物构图预览">
        <rect width="640" height="360" fill="#263138" />
        <path d="M 0 158 H 640 V 360 H 0 Z" fill="#394440" />
        <path d="M 0 158 H 640" stroke="#64716c" stroke-width="1.5" />
        <g stroke="#4a5652" fill="none">
          <path d="M 0 189 H 640 M 0 245 H 640 M 0 328 H 640 M 320 158 L -260 360 M 320 158 L 104 360 M 320 158 L 542 360 M 320 158 L 910 360" />
        </g>
        <g v-for="item in projection" :key="item.id" :transform="`translate(${item.x * 6.4},${item.y * 3.6}) scale(${item.scale})`">
          <template v-if="item.mark">
            <path d="M -4 0 H 4 M 0 0 V -32 M 0 -32 L 11 -26 L 0 -20" fill="#ddc084" stroke="#ddc084" stroke-width="2" />
            <text y="-38" text-anchor="middle" fill="#ebdbb8" font-size="12" paint-order="stroke" stroke="#263138" stroke-width="2">{{ item.name }}</text>
          </template>
          <template v-else>
            <ellipse cy="-1" rx="23" ry="4" fill="#101b1b" opacity="0.45" />
            <g :fill="item.tint" stroke="#172426" stroke-width="1.3">
              <circle cy="-91" r="10" />
              <circle v-if="item.look && item.look.front > -0.6" :cx="item.look.side * 6" cy="-92" r="1.6" fill="#273538" stroke="none" />
              <path d="M -6 -79 Q -16 -78 -18 -67 L -22 -44 Q -22 -39 -17 -40 L -11 -58 L -10 -42 L -9 -1 H -2 L 0 -31 L 4 -1 H 11 L 10 -42 L 11 -58 L 16 -40 Q 22 -38 21 -45 L 17 -67 Q 14 -78 6 -79 Z" />
            </g>
            <text y="-109" text-anchor="middle" fill="#fff" font-size="12" paint-order="stroke" stroke="#263138" stroke-width="2">{{ item.name }}</text>
          </template>
        </g>
        <path d="M 20 43 V 20 H 43 M 597 20 H 620 V 43 M 620 317 V 340 H 597 M 43 340 H 20 V 317" stroke="#e0e7e0" opacity="0.55" stroke-width="1.5" fill="none" />
      </svg>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { IconDownload } from "@tabler/icons-vue";
import type { Point, ShotStage, StageScene } from "./blockingTypes";
import type { Shot } from "./shotData";
import { pointAt, projectPoint, type resolveTracks } from "./shotBlocking";

const props = defineProps<{
  tracks: ReturnType<typeof resolveTracks>; scene: StageScene; stage: ShotStage; shot: Shot; time: number;
  actorId: string; markId: string; pointIndex: number; disabled: boolean;
}>();
type TargetKind = "actor" | "mark";
const emit = defineEmits<{
  choose: [kind: TargetKind, id: string, index: number];
  beginMove: [];
  move: [p: Point];
}>();
const topView = ref<SVGSVGElement>();
const cameraView = ref<SVGSVGElement>();
const activeTrack = computed(() => props.tracks.find(track => track.actor.id === props.actorId));
const locations = computed(() => props.tracks.map(track => pointAt(track.points, props.time)));
const compass: Record<string, Point> = { 东: { x: 1, y: 0 }, 西: { x: -1, y: 0 }, 北: { x: 0, y: -1 }, 南: { x: 0, y: 1 } };
const facings = computed(() => props.tracks.map((track, i) => {
  const facing = track.route.facing;
  const other = props.tracks.findIndex(item => item.actor.id === facing);
  const target = locations.value[other] ?? props.scene.marks.find(mark => mark.id === facing)?.at;
  const origin = locations.value[i]!;
  const direction = target ? { x: target.x - origin.x, y: target.y - origin.y } : Object.hasOwn(compass, facing) ? compass[facing] : undefined;
  if (!direction) return;
  const length = Math.hypot(direction.x, direction.y);
  if (!length) return;
  const x = direction.x / length, y = direction.y / length;
  const angle = Math.atan2(y * 3.52, x * 6.44) * 180 / Math.PI;
  const camera = props.stage.camera;
  return { angle, side: camera === "south" ? x : camera === "north" ? -x : camera === "east" ? -y : y,
    front: camera === "south" ? y : camera === "north" ? -y : camera === "east" ? x : -x };
}));
const cameraName = computed(() => ({ north: "北侧机位", south: "南侧机位", east: "东侧机位", west: "西侧机位" })[props.stage.camera]);
const cameraTransform = computed(() => ({ north: "translate(360,34) rotate(180)", south: "translate(360,382)", east: "translate(678,208) rotate(-90)", west: "translate(42,208) rotate(90)" })[props.stage.camera]);
const colors = ["#94d4be", "#f1b987", "#acbff4", "#ebb2cf", "#e2d887", "#a8d3e9"];
const color = (i: number) => colors[i % colors.length]!;
const worldX = (x: number) => 38 + x * 6.44;
const worldY = (y: number) => 32 + y * 3.52;
const at = (p: Point) => `translate(${worldX(p.x)},${worldY(p.y)})`;
const anchor = (x: number) => x < 15 ? "start" : x > 85 ? "end" : "middle";
const handleOffset = (i: number) => i === 0 ? -13 : i === (activeTrack.value?.points.length ?? 0) - 1 ? 13 : 0;
const projection = computed(() => {
  const focus = props.tracks.find(track => track.actor.id === props.stage.focus)?.points[0]
    ?? props.scene.marks.find(mark => mark.id === props.stage.focus)?.at ?? { x: 50, y: 50 };
  const project = (p: Point) => projectPoint(p, props.stage.camera, focus, props.shot.shotSize);
  const people = props.tracks.flatMap((track, i) => track.route.visible
    ? [{ id: track.actor.id, name: track.actor.name, tint: color(i), look: facings.value[i], mark: false, ...project(locations.value[i]!) }] : []);
  const marks = props.scene.marks.map(mark => ({ id: mark.id, name: mark.name, tint: "", look: undefined, mark: true, ...project(mark.at) }));
  return [...marks, ...people].sort((a, b) => a.y - b.y);
});

let drag: { pointer: number; cursor: Point; origin: Point; moved: boolean } | undefined;
function cursor(event: PointerEvent) {
  const matrix = topView.value?.getScreenCTM();
  if (!matrix) return;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: (p.x - 38) / 6.44, y: (p.y - 32) / 3.52 };
}
function chooseActor(event: PointerEvent, index: number) {
  if (props.disabled || !event.isPrimary || event.button !== 0) return;
  const track = props.tracks[index]!;
  if (track.actor.locked) beginDrag(event, "actor", track.actor.id, 0, track.actor.home);
  else emit("choose", "actor", track.actor.id, 0);
}
function beginDrag(event: PointerEvent, kind: TargetKind, id: string, index: number, origin: Point) {
  const p = cursor(event);
  if (props.disabled || !event.isPrimary || event.button !== 0 || !p) return;
  event.preventDefault();
  emit("choose", kind, id, index);
  drag = { pointer: event.pointerId, cursor: p, origin: { ...origin }, moved: false };
  topView.value?.setPointerCapture(event.pointerId);
}
function moveDrag(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId || props.disabled) return;
  const p = cursor(event);
  if (!p) return;
  const dx = p.x - drag.cursor.x, dy = p.y - drag.cursor.y;
  if (!drag.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 0.3) return;
    emit("beginMove");
    drag.moved = true;
  }
  const bound = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));
  emit("move", { x: bound(drag.origin.x + dx), y: bound(drag.origin.y + dy) });
}
function endDrag(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return;
  drag = undefined;
  if (topView.value?.hasPointerCapture(event.pointerId)) topView.value.releasePointerCapture(event.pointerId);
}
async function download(svg: SVGSVGElement | undefined, title: string) {
  if (!svg) return;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = svg.viewBox.baseVal.width * 2;
    canvas.height = svg.viewBox.baseVal.height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const link = document.createElement("a");
    link.download = `${props.scene.name}-${props.shot.id.slice(0, 8)}-${title}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "导出 PNG 失败");
  } finally {
    URL.revokeObjectURL(url);
  }
}
</script>

<style lang="scss" scoped>
.blockingViews {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 12px;
  .viewPane {
    min-width: 0;
    header {
      display: flex; align-items: center; gap: 10px; min-height: 34px;
      h3 { margin: 0; font-size: 14px; white-space: nowrap; }
      span { overflow: hidden; color: var(--el-text-color-secondary); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      button { margin-left: auto; border: 0; background: transparent; color: var(--el-text-color-regular); cursor: pointer; }
    }
    svg.topView, svg.cameraView { display: block; width: 100%; height: auto; background: #172625; border-radius: 5px; overflow: hidden; font-family: sans-serif; user-select: none; }
    .topView { touch-action: none; .dragItem { cursor: grab; &:active { cursor: grabbing; } } }
  }
  @media (max-width: 820px) { grid-template-columns: 1fr; }
}
</style>
