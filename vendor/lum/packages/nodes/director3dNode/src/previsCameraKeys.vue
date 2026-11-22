<template>
  <section class="cameraKeys" aria-label="机位关键帧">
    <h3>机位关键帧 <span>{{ camera.keyframes?.length ?? 0 }}</span></h3>
    <p>在不同时间记录取景。关键帧模式中，调整机位会记录当前时刻；拖动时间线检查中间运动。</p>
    <button v-if="hasPath || camera.follow" :disabled="disabled" @click="$emit('convert')">采样转换为关键帧（可撤销）</button>
    <button v-else :disabled="disabled" @click="$emit('record')">记录当前取景 · {{ time.toFixed(2) }} 秒</button>
    <div v-if="camera.keyframes?.length" class="keyList" aria-label="关键帧列表">
      <button v-for="(frame,index) in camera.keyframes" :key="frame.time" :class="{selected:selectedTime===frame.time}" :aria-label="`关键帧 ${index+1}，${frame.time.toFixed(2)} 秒`" @click="select(frame.time)">◆ {{ frame.time.toFixed(2) }}s</button>
    </div>
    <template v-if="selected">
      <label>关键帧时间<input aria-label="关键帧时间" type="number" min="0" :max="duration" step=".1" :value="selected.time" :disabled="disabled" @change="update('time',Number(($event.target as HTMLInputElement).value))" /></label>
      <label>进入此帧<select aria-label="关键帧插值" :value="selected.easing" :disabled="disabled" @change="update('easing',($event.target as HTMLSelectElement).value)"><option value="smooth">平滑起落</option><option value="linear">匀速</option><option value="cut">切换</option></select></label>
      <div v-for="group in groups" :key="group.id" class="keyVector"><strong>{{ group.label }}</strong><label v-for="axis in axes" :key="axis">{{ axis }}<input type="number" step=".1" :aria-label="`关键帧${group.label} ${axis}`" :value="group.id==='position' ? selected.view.camera.position[axis] : selected.view.controls.target[axis]" :disabled="disabled || (group.id==='target' && !!camera.targetId)" @change="updateVector(group.id,axis,Number(($event.target as HTMLInputElement).value))" /></label></div>
      <label>视角（度）<input type="number" min="10" max="120" :value="selected.view.camera.fov" :disabled="disabled" aria-label="关键帧视角" @change="update('fov',Number(($event.target as HTMLInputElement).value))" /></label>
      <button :disabled="disabled" @click="$emit('remove',selected.time)">删除所选关键帧</button>
    </template>
    <button v-if="camera.keyframes?.length" :disabled="disabled" @click="$emit('clear')">清除关键帧，保留当前取景</button>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PrevisState } from "./previs";
import type { CameraKeyframe } from "./previsCamera";
const props=defineProps<{camera:PrevisState["cameras"][number];time:number;duration:number;disabled:boolean;hasPath:boolean}>();
const emit=defineEmits<{record:[];convert:[];clear:[];remove:[time:number];update:[time:number,frame:CameraKeyframe];seek:[time:number]}>();
const axes=["x","y","z"] as const;
const groups=[{id:"position",label:"位置"},{id:"target",label:"目标"}] as const;
const selectedTime=ref<number>();
const selected=computed(()=>props.camera.keyframes?.find(frame=>frame.time===selectedTime.value));
watch(()=>props.camera.id,()=>selectedTime.value=undefined);
watch(()=>props.camera.keyframes,frames=>{if(!frames?.some(frame=>frame.time===selectedTime.value))selectedTime.value=frames?.find(frame=>Math.abs(frame.time-props.time)<.001)?.time ?? frames?.[0]?.time;},{immediate:true});
function select(time:number){selectedTime.value=time;emit("seek",time);}
function update(field:"time"|"easing"|"fov",value:number|string){if(!selected.value)return;const frame=JSON.parse(JSON.stringify(selected.value)) as CameraKeyframe;if(field==="fov")frame.view.camera.fov=Number(value);else if(field==="time")frame.time=Number(value);else frame.easing=value as CameraKeyframe["easing"];emit("update",selected.value.time,frame);}
function updateVector(group:"position"|"target",axis:typeof axes[number],value:number){if(!selected.value)return;const frame=JSON.parse(JSON.stringify(selected.value)) as CameraKeyframe;(group==="position"?frame.view.camera.position:frame.view.controls.target)[axis]=value;emit("update",selected.value.time,frame);}
</script>
<style scoped>
.cameraKeys{border-top:1px solid var(--lum-line,#46516a);margin-top:12px;padding-top:10px}.cameraKeys h3{display:flex;justify-content:space-between;margin:0 0 8px}.cameraKeys p{font-size:12px;line-height:1.6;color:var(--lum-muted,#b5c0d2)}button,input,select{font:inherit;box-sizing:border-box;border:1px solid var(--lum-line,#46516a);color:inherit;background:var(--lum-input,#242d3d);border-radius:9px;padding:7px;min-width:0}button{width:100%;cursor:pointer;margin:4px 0}.keyList{display:flex;flex-wrap:wrap;gap:5px;padding:6px 0}.keyList button{width:auto;flex:1 0 68px}.keyList .selected{border-color:var(--lum-link,#9ecaff);background:var(--lum-accent-soft,#314e75)}label{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:6px 0}label>input,label>select{width:125px}.keyVector{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.keyVector strong{grid-column:1/-1;font-weight:500;margin-top:8px}.keyVector label{flex-direction:column;align-items:stretch}.keyVector input{width:100%}:disabled{opacity:.45;cursor:default}
</style>
