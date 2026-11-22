<template>
  <section class="cameraControls">
    <details open><summary>人物跟拍</summary>
    <label>跟拍方式<select :value="camera.follow?.mode ?? ''" :disabled="disabled || !camera.targetId" @change="setFollow(($event.target as HTMLSelectElement).value)"><option value="">仅朝向目标</option><option value="front">正面跟拍</option><option value="back">背面跟拍</option><option value="left">左侧跟拍</option><option value="right">右侧跟拍</option></select></label>
    <template v-if="camera.follow"><label>距离（米）<input type="number" min=".5" max="100" step=".1" :value="camera.follow.distance" :disabled="disabled" @change="updateFollow('distance',Number(($event.target as HTMLInputElement).value))" /></label><label>高度（米）<input type="number" min=".1" max="50" step=".1" :value="camera.follow.height" :disabled="disabled" @change="updateFollow('height',Number(($event.target as HTMLInputElement).value))" /></label></template>
    <p>先在“拍谁”选择人物。跟拍会随人物移动；手动拖动机位会切回“仅朝向目标”。</p>
    </details><details open><summary>运镜预设</summary>
    <div class="presetGrid"><button v-for="(label,key) in cameraPresetNames" :key="key" :aria-pressed="preset===key" :class="{selected:preset===key}" :disabled="disabled" @click="preset=key"><span aria-hidden="true">{{ presetIcons[key] }}</span>{{ label }}</button></div>
    <label>开始（秒）<input v-model.number="start" type="number" min="0" :max="duration-.2" step=".1" :disabled="disabled" /></label><label>持续（秒）<input v-model.number="length" type="number" min=".2" :max="duration-start" step=".1" :disabled="disabled" /></label>
    <label>{{ preset.startsWith('orbit') ? '环绕角度' : '移动米数' }}<input v-model.number="amount" type="number" min=".1" :max="preset.startsWith('orbit') ? 360 : 100" step=".1" :disabled="disabled" /></label>
    <button :disabled="disabled" @click="$emit('preset',{preset,start,duration:length,amount})">应用运镜预设</button><p>替换此机位已有路线，保留其他机位。路线生成后可以拖动控制点。</p>
  </details></section>
</template>
<script setup lang="ts">
import { ref, watch } from "vue";
import { cameraPresetNames, type CameraPreset } from "./previsCamera";
import type { PrevisState } from "./previs";
const presetIcons={push:"↑",pull:"↓",truckLeft:"←",truckRight:"→",rise:"↥",descend:"↧",orbitLeft:"↶",orbitRight:"↷"};
type Follow = PrevisState["cameras"][number]["follow"];
const props = defineProps<{camera:PrevisState["cameras"][number];duration:number;time:number;disabled:boolean}>();
const emit = defineEmits<{follow:[value:Follow];preset:[value:{preset:CameraPreset;start:number;duration:number;amount:number}]}>();
const preset = ref<CameraPreset>("push"), start = ref(Math.min(props.time,props.duration-.2)), length = ref(Math.min(4,props.duration-start.value)), amount=ref(2);
watch(()=>props.camera.id,()=>{start.value=Math.min(props.time,props.duration-.2);length.value=Math.min(4,props.duration-start.value);});
watch(preset,value=>{amount.value=value.startsWith("orbit")?90:2;});
function setFollow(mode:string){emit("follow",mode?{mode:mode as NonNullable<Follow>["mode"],distance:props.camera.follow?.distance??4,height:props.camera.follow?.height??1.6}:undefined);}
function updateFollow(field:"distance"|"height",value:number){if(props.camera.follow) emit("follow",{...props.camera.follow,[field]:value});}
</script>
<style scoped>
summary{cursor:pointer;padding:9px 0;font-weight:600;color:#a7bbd8}details+details{border-top:1px solid #46516a}.presetGrid{display:grid;grid-template-columns:1fr 1fr;gap:5px}.presetGrid button{display:flex;align-items:center;gap:7px;margin:0;text-align:left}.presetGrid span{font-size:23px;color:#9ecaff}.presetGrid button.selected{border-color:#8abfff;background:#345373}
.cameraControls { border-top:1px solid #46516a; margin-top:12px; padding-top:4px; }h3 { font-size:13px; color:#a7bbd8; }label{display:flex;justify-content:space-between;align-items:center;gap:6px;margin:7px 0}input,select,button{font:inherit;color:inherit;border:1px solid #46516a;border-radius:6px;background:#242d3d;padding:6px;box-sizing:border-box;min-width:0}label input,label select{width:122px}section>select,button{width:100%;margin:5px 0}p{font-size:12px;color:#acb7ca}button{cursor:pointer}:disabled{opacity:.45;cursor:default}
</style>
