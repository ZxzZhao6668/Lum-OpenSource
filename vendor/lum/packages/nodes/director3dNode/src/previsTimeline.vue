<template>
  <section class="timelineEditor" aria-label="可编辑预演时间线" tabindex="0" @keydown.esc.stop="cancelDrag">
    <div class="timelineTools"><strong>时间线</strong><button :disabled="disabled" @click="openCreation('shot')">＋ 添加镜头</button><button :disabled="disabled || !actors.length" @click="openCreation('action')">＋ 添加动作</button><button :disabled="disabled || !actors.length" @click="openCreation('path')">＋ 人物路线</button><button :disabled="disabled || !canSplit" @click="$emit('split')">分割 Z</button><button :disabled="disabled || !selection || (selection.kind==='shot' && shots.length<2)" @click="$emit('remove')">删除 R</button><span>空格 播放/暂停 · ←/→ 逐帧 · Shift 快移 · 拖动边界调整时长</span><label>缩放<select v-model.number="zoom"><option :value=".5">50%</option><option :value="1">100%</option><option :value="2">200%</option><option :value="4">400%</option></select></label></div>
    <form v-if="creation" class="creationTools" @submit.prevent="submitCreation">
      <template v-if="creation!=='shot'"><label>人物<select v-model="createObject" aria-label="新动作人物" :disabled="disabled"><option v-for="actor in actors" :key="actor.threeJsonId" :value="actor.threeJsonId">{{ actor.name || actor.threeJsonId }}</option></select></label><label v-if="creation==='action'">动作<select v-model="createKind" aria-label="新动作类型" :disabled="disabled"><option v-for="(name,kind) in actionLabels" :key="kind" :value="kind">{{ name }}</option></select></label><label>持续秒数<input v-model.number="createDuration" aria-label="新动作持续秒数" type="number" min=".2" :max="duration-createStart" step=".1" required :disabled="disabled" /></label></template>
      <label v-else>机位<select v-model="createCamera" aria-label="新镜头机位" :disabled="disabled"><option v-for="camera in cameras" :key="camera.id" :value="camera.id">{{ camera.name }}</option><option value="">新建机位（当前取景）</option></select></label>
      <label>开始秒数<input v-model.number="createStart" aria-label="新片段开始秒数" type="number" min="0" :max="duration-(creation==='shot'?.1:.2)" step=".01" required :disabled="disabled" /></label><button type="submit" :disabled="disabled">{{ creation==='shot'?'创建镜头':creation==='path'?'开始绘制路线':'创建动作' }}</button><button type="button" @click="creation=''">收起</button>
    </form>
    <div v-if="paths.length" class="routeTools"><details open><summary>人物 / 机位路线（点击条形选择，拖动位置或两端编辑时间）</summary><div v-for="path in paths" :key="path.id" class="routeEntry"><button :disabled="disabled" :class="{selected:selection?.kind==='path'&&selection.id===path.id}" @click="$emit('selectPath',path.id)">{{ objects.find(o=>o.threeJsonId===path.objectId)?.name || cameras.find(c=>c.id===path.cameraId)?.name || '路线' }}</button><label>开始<input type="number" step=".1" :value="path.start" :disabled="disabled||path.locked" @change="$emit('editPath',path.id,Number(($event.target as HTMLInputElement).value),path.duration)" /></label><label>时长<input type="number" min=".2" step=".1" :value="path.duration" :disabled="disabled||path.locked" @change="$emit('editPath',path.id,path.start,Number(($event.target as HTMLInputElement).value))" /></label></div></details></div>
    <div ref="scroller" class="timelineScroll">
      <div ref="surface" class="timelineSurface" :style="{minWidth:Math.max(650,duration*70*zoom)+'px'}" @pointermove="move" @pointerup="finish" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag">
        <div class="timeRuler" aria-label="拖动时间尺定位" @pointerdown="beginSeek"><span v-for="tick in ticks" :key="tick" :style="{left:percent(tick)}">{{ tick }}s</span></div>
        <div class="shotTrack" :class="{cameraDropActive:cameraDropTime!==undefined}" ref="shotTrack" aria-label="镜头轨道" @pointerdown="beginSeek" @dragover="previewCameraDrop" @dragleave="leaveCameraDrop" @drop="dropCamera">
          <span v-if="cameraDropTime!==undefined" class="cameraDropMark" :style="{left:percent(cameraDropTime)}">{{ cameraDropTime.toFixed(2) }}s 切换机位</span>
          <div v-for="(shot,index) in displayedShots" :key="shot.id" role="button" tabindex="0" class="shotBlock" :class="{active:selection?.kind==='shot' && selection.id===shot.id,playing:time>=shot.start && time<endOf(displayedShots,index)}" :style="block(shot.start,endOf(displayedShots,index)-shot.start)" :aria-label="`镜头${index+1} ${cameraName(shot.cameraId)} ${shot.start.toFixed(2)}至${endOf(displayedShots,index).toFixed(2)}秒`" @pointerdown.stop="beginShot($event,shot.id,'move')" @keydown.enter.prevent="select(shot.id)">
            <span v-if="index>0" class="resizeHandle left" role="slider" :aria-label="`调整镜头${index+1}开始时间`" @pointerdown.stop="beginShot($event,shot.id,'left')" />
            <img v-if="cameraThumbnails?.[shot.cameraId]" class="shotThumbnail" :src="cameraThumbnails[shot.cameraId]" alt="" draggable="false" /><span class="clipLabel">{{ index+1 }} · {{ cameraName(shot.cameraId) }}</span><small>{{ shot.start.toFixed(1) }}–{{ endOf(displayedShots,index).toFixed(1) }}s</small>
            <span v-if="index<displayedShots.length-1" class="resizeHandle right" role="slider" :aria-label="`调整镜头${index+1}结束时间`" @pointerdown.stop="beginShot($event,shot.id,'right')" />
          </div>
        </div>
        <div v-for="row in actionRows" :key="row.id" class="actionTrack" :aria-label="row.name+'动作轨道'" @pointerdown="beginSeek"><span class="rowLabel">{{ row.name }}</span><div v-for="action in row.actions" :key="action.id" class="actionBlock" :class="{active:selection?.kind==='action' && selection.id===action.id}" role="button" tabindex="0" :aria-label="`${row.name} ${actionLabels[action.kind]??action.kind} ${action.start.toFixed(2)}至${(action.start+action.duration).toFixed(2)}秒`" :style="block(action.start,action.duration)" @pointerdown.stop="beginAction($event,action.id,'move')" @keydown.enter.prevent="$emit('selectAction',action.id)"><span class="resizeHandle left" @pointerdown.stop="beginAction($event,action.id,'left')" /><span class="clipLabel">{{ actionLabels[action.kind]??action.kind }}</span><span class="resizeHandle right" @pointerdown.stop="beginAction($event,action.id,'right')" /></div></div>
        <div v-for="path in displayedPaths" :key="path.id" class="actionTrack pathTrack" @pointerdown="beginSeek"><div role="button" tabindex="0" class="actionBlock pathBlock" :class="{active:selection?.kind==='path'&&selection.id===path.id}" :aria-label="`路线 ${objects.find(o=>o.threeJsonId===path.objectId)?.name || cameraName(path.cameraId || '')} ${path.start.toFixed(2)}至${(path.start+path.duration).toFixed(2)}秒`" :style="block(path.start,path.duration)" @pointerdown.stop="beginPath($event,path.id,'move')" @keydown.enter.prevent="$emit('selectPath',path.id)"><span class="resizeHandle left" @pointerdown.stop="beginPath($event,path.id,'left')"/><span class="clipLabel">路线 · {{ objects.find(o=>o.threeJsonId===path.objectId)?.name || cameraName(path.cameraId || '') }}</span><span class="resizeHandle right" @pointerdown.stop="beginPath($event,path.id,'right')"/></div></div>
        <div class="playhead" :style="{left:percent(time)}" aria-label="播放头" @pointerdown.stop="beginSeek"><span>{{ time.toFixed(2) }}</span></div>
      </div>
    </div>
    <div v-if="selected" class="selectionTools"><strong>所选镜头</strong><select :value="selected.cameraId" aria-label="时间线所选镜头机位" :disabled="disabled" @change="$emit('changeShot',selected.id,'cameraId',($event.target as HTMLSelectElement).value)"><option v-for="camera in cameras" :key="camera.id" :value="camera.id">{{ camera.name }}</option></select><label>从<input type="number" min="0" step=".1" :value="selected.start" :disabled="disabled || selected.start===0" @change="$emit('changeShot',selected.id,'start',Number(($event.target as HTMLInputElement).value))" />秒</label><span>至 {{ endOf(sorted,sorted.findIndex(shot=>shot.id===selected?.id)).toFixed(2) }} 秒</span></div>
    <p v-else-if="selectedAction" class="selectionHint">所选动作：{{ actionLabels[selectedAction.kind] }} · {{ selectedAction.start.toFixed(2) }}–{{ (selectedAction.start+selectedAction.duration).toFixed(2) }}秒 · 播放头移到片段内部后按Z分割</p>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PrevisState } from "./previs";
import type { TimelineSelection } from "./previsClips";
type Path=PrevisState["paths"][number];
type Shot=PrevisState["shots"][number]; type Action=PrevisState["actions"][number]; type Edge="left"|"right"|"move";
const props=defineProps<{cameraThumbnails?:Record<string,string>;shots:Shot[];actions:Action[];paths:Path[];cameras:PrevisState["cameras"];objects:{threeJsonId:string;name?:string;objType:string}[];duration:number;time:number;disabled:boolean;actionLabels:Record<string,string>;selection?:TimelineSelection;defaultObjectId?:string;defaultCameraId:string}>();
const emit=defineEmits<{selectPath:[id:string];editPath:[id:string,start:number,duration:number];createPath:[input:{objectId:string;start:number;duration:number}];seek:[time:number];selectShot:[id:string];selectAction:[id:string];editShots:[shots:Shot[]];editAction:[id:string,start:number,duration:number];changeShot:[id:string,field:"cameraId"|"start",value:string|number];split:[];remove:[];dragging:[value:boolean];createAction:[input:{objectId:string;kind:string;start:number;duration:number}];createShot:[input:{cameraId:string;start:number}]}>();
const shotTrack=ref<HTMLElement>();
const cameraDropTime=ref<number>();
function cameraDropPosition(event:Pick<DragEvent,"clientX">){const rect=surface.value?.getBoundingClientRect();if(!rect || !rect.width)return 0;const time=Math.round(Math.max(0,Math.min(props.duration-.1,(event.clientX-rect.left)/rect.width*props.duration))*100)/100;return sorted.value.find(shot=>Math.abs(shot.start-time)<.1)?.start??time;}
function previewCameraDrop(event:DragEvent){if(props.disabled || !event.dataTransfer?.types.includes("application/x-lum-stage-camera"))return;event.preventDefault();event.dataTransfer.dropEffect="copy";cameraDropTime.value=cameraDropPosition(event);}
function leaveCameraDrop(event:DragEvent){if(event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))return;cameraDropTime.value=undefined;}
function dropCamera(event:DragEvent){cameraDropTime.value=undefined;if(props.disabled)return;const id=event.dataTransfer?.getData("application/x-lum-stage-camera");if(!id || !props.cameras.some(camera=>camera.id===id))return;event.preventDefault();event.stopPropagation();emit("createShot",{cameraId:id,start:cameraDropPosition(event)});}
function previewCameraAt(cameraId:string,x:number,y:number){const rect=shotTrack.value?.getBoundingClientRect(),visible=scroller.value?.getBoundingClientRect();const valid=!props.disabled && !!rect && !!visible && x>=Math.max(rect.left,visible.left) && x<=Math.min(rect.right,visible.right) && y>=Math.max(rect.top,visible.top) && y<=Math.min(rect.bottom,visible.bottom) && !!surface.value?.contains(document.elementFromPoint(x,y)) && props.cameras.some(camera=>camera.id===cameraId);cameraDropTime.value=valid?cameraDropPosition({clientX:x}):undefined;return valid;}
function dropCameraAt(cameraId:string,x:number,y:number){const valid=previewCameraAt(cameraId,x,y),start=cameraDropTime.value;cameraDropTime.value=undefined;if(valid && start!==undefined)emit("createShot",{cameraId,start});return valid;}
function clearCameraDrop(){cameraDropTime.value=undefined;}
defineExpose({previewCameraAt,dropCameraAt,clearCameraDrop});
const surface=ref<HTMLElement>(),scroller=ref<HTMLElement>(),zoom=ref(1);
const creation=ref<""|"shot"|"action"|"path">(""),createObject=ref(""),createKind=ref("walk"),createCamera=ref(""),createStart=ref(0),createDuration=ref(2);
const actors=computed(()=>props.objects.filter(object=>object.objType==='mannequin'));
function openCreation(kind:"shot"|"action"|"path"){creation.value=kind;createStart.value=Math.round(Math.min(props.time,props.duration-(kind==='shot'?.1:.2))*100)/100;createDuration.value=Math.min(2,props.duration-createStart.value);createObject.value=actors.value.find(actor=>actor.threeJsonId===props.defaultObjectId)?.threeJsonId??actors.value[0]?.threeJsonId??"";createCamera.value=props.defaultCameraId;if(kind==="path"&&selectedAction.value){createObject.value=selectedAction.value.objectId;createStart.value=selectedAction.value.start;createDuration.value=selectedAction.value.duration;}}
function submitCreation(){if(props.disabled)return;if(creation.value==='shot')emit('createShot',{cameraId:createCamera.value,start:createStart.value});else if(creation.value==='path')emit('createPath',{objectId:createObject.value,start:createStart.value,duration:createDuration.value});else emit('createAction',{objectId:createObject.value,kind:createKind.value,start:createStart.value,duration:createDuration.value});}
const previewPaths=ref<Path[]>();const displayedPaths=computed(()=>previewPaths.value??props.paths);
const previewShots=ref<Shot[]>(),previewActions=ref<Action[]>();
const sorted=computed(()=>[...props.shots].sort((a,b)=>a.start-b.start));
const displayedShots=computed(()=>previewShots.value??sorted.value);
const selected=computed(()=>props.selection?.kind==='shot'?sorted.value.find(shot=>shot.id===props.selection?.id):undefined);
const selectedAction=computed(()=>props.selection?.kind==='action'?props.actions.find(action=>action.id===props.selection?.id):undefined);
const canSplit=computed(()=>{const clip=selected.value??selectedAction.value;if(!clip)return false;const end=selected.value?endOf(sorted.value,sorted.value.indexOf(selected.value)):selectedAction.value!.start+selectedAction.value!.duration;const minimum=selected.value ? .1 : .2;return props.time-clip.start>=minimum-1e-8&&end-props.time>=minimum-1e-8;});
const ticks=computed(()=>{const step=props.duration<=12?1:props.duration<=40?2:props.duration<=100?5:10;return Array.from({length:Math.floor(props.duration/step)+1},(_,index)=>index*step);});
const actionRows=computed(()=>[...new Set(props.actions.map(action=>action.objectId))].map(id=>({id,name:props.objects.find(object=>object.threeJsonId===id)?.name??"人物",actions:(previewActions.value??props.actions).filter(action=>action.objectId===id)})));
let drag:{kind:"seek"|"shot"|"action"|"path";id?:string;edge?:Edge;pointerId:number;clientX:number;time:number;shots:Shot[];actions:Action[];paths:Path[];moved:boolean}|undefined;
const percent=(time:number)=>`${time/props.duration*100}%`;
const block=(start:number,duration:number)=>({left:percent(start),width:percent(duration)});
const cameraName=(id:string)=>props.cameras.find(camera=>camera.id===id)?.name??"机位";
const endOf=(list:Shot[],index:number)=>list[index+1]?.start??props.duration;
function pointerTime(event:PointerEvent){const rect=surface.value!.getBoundingClientRect();return Math.max(0,Math.min(props.duration,(event.clientX-rect.left)/rect.width*props.duration));}
const round=(value:number)=>Math.round(value*100)/100;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
function select(id:string){emit("selectShot",id);}
function begin(event:PointerEvent,kind:"seek"|"shot"|"action"|"path",id?:string,edge?:Edge){
  if(event.button!==0 || (props.disabled && kind!=="seek"))return;
  event.preventDefault();surface.value!.closest<HTMLElement>(".timelineEditor")?.focus({preventScroll:true});
  drag={kind,id,edge,pointerId:event.pointerId,clientX:event.clientX,time:pointerTime(event),shots:sorted.value.map(shot=>({...shot})),actions:props.actions.map(action=>({...action})),paths:props.paths.map(path=>({...path})),moved:false};
  surface.value!.setPointerCapture(event.pointerId);
  emit('dragging',true);
  if(kind==="seek")emit("seek",drag.time);else if(kind==="shot")select(id!);else {emit("seek",props.time);if(kind==="path")emit('selectPath',id!);else emit('selectAction',id!);}
}
function beginPath(event:PointerEvent,id:string,edge:Edge){if(props.paths.find(path=>path.id===id)?.locked){emit("selectPath",id);return;}begin(event,"path",id,edge);}
function beginSeek(event:PointerEvent){begin(event,"seek");}
function beginShot(event:PointerEvent,id:string,edge:Edge){begin(event,"shot",id,edge);}
function beginAction(event:PointerEvent,id:string,edge:Edge){begin(event,"action",id,edge);}
function move(event:PointerEvent){
  if(!drag || event.pointerId!==drag.pointerId)return;
  const time=pointerTime(event),delta=time-drag.time;drag.moved ||= Math.abs(event.clientX-drag.clientX)>3;
  if(drag.kind==="seek"){emit("seek",time);return;} if(!drag.moved)return;
  if(drag.kind==="shot"){
    const shots=drag.shots.map(shot=>({...shot})),index=shots.findIndex(shot=>shot.id===drag!.id);
    if(drag.edge==="move"){
      const durations=new Map(shots.map((shot,index)=>[shot.id,endOf(shots,index)-shot.start]));const picked=shots.splice(index,1)[0]!;
      const target=shots.findIndex(shot=>time<shot.start+(durations.get(shot.id)??0)/2);shots.splice(target<0?shots.length:target,0,picked);
      let cursor=0;for(const shot of shots){shot.start=round(cursor);cursor+=durations.get(shot.id)!;}
    } else {
      const boundary=drag.edge==="left"?index:index+1;if(boundary<=0||boundary>=shots.length)return;
      shots[boundary]!.start=round(clamp(drag.shots[boundary]!.start+delta,shots[boundary-1]!.start+.1,endOf(shots,boundary)-.1));
    }
    previewShots.value=shots;
  } else {
    const actions=(drag.kind==="path"?drag.paths:drag.actions).map(action=>({...action})),action=actions.find(action=>action.id===drag!.id)!;
    if(drag.edge==="move")action.start=round(clamp(action.start+delta,0,props.duration-action.duration));
    else if(drag.edge==="left"){const end=action.start+action.duration;action.start=round(clamp(action.start+delta,0,end-.2));action.duration=round(end-action.start);}
    else action.duration=round(clamp(action.duration+delta,.2,props.duration-action.start));
    if(drag.kind==="path")previewPaths.value=actions as Path[];else previewActions.value=actions as Action[];
  }
}
function finish(event:PointerEvent){if(!drag||event.pointerId!==drag.pointerId)return;const completed=drag,shots=previewShots.value,action=(completed.kind==="path"?previewPaths.value:previewActions.value)?.find(action=>action.id===completed.id);cancelDrag();if(!completed.moved)return;if(completed.kind==="shot"&&shots)emit("editShots",shots);if(completed.kind==="path"&&action)emit("editPath",action.id,action.start,action.duration);if(completed.kind==="action"&&action)emit("editAction",action.id,action.start,action.duration);}
function cancelDrag(){const pointer=drag?.pointerId;drag=undefined;previewShots.value=undefined;previewActions.value=undefined;previewPaths.value=undefined;if(pointer!==undefined&&surface.value?.hasPointerCapture(pointer))surface.value.releasePointerCapture(pointer);emit('dragging',false);}
watch(()=>props.disabled,value=>{if(value){cancelDrag();cameraDropTime.value=undefined;}});watch(()=>props.shots,()=>{cancelDrag();},{deep:true});
onMounted(()=>window.addEventListener("blur",cancelDrag));onBeforeUnmount(()=>{cancelDrag();window.removeEventListener("blur",cancelDrag);});
</script>
<style scoped>
.routeTools{margin:6px 0}.routeTools summary{cursor:pointer}.routeEntry{display:flex;gap:6px;align-items:center;margin:4px 0}.routeEntry input{width:65px}.pathBlock{background:#3c426d;border-color:#9698d2}.pathBlock.active{outline-color:#b6b8ff}
.creationTools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px;background:#293344;border-radius:6px;margin-bottom:7px}.creationTools label{display:flex;align-items:center;gap:5px}.creationTools input{width:76px}.creationTools select{max-width:170px}.actionBlock.active{outline:2px solid #7fe4ac;outline-offset:-2px}.selectionHint{margin:5px 0;color:#b4d8c6}
.timelineEditor{font-size:12px;outline:none}.timelineTools,.selectionTools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:7px 0}.timelineTools>span{flex:1;color:#aebfd8}.timelineTools label,.selectionTools label{display:flex;align-items:center;gap:5px}select,input,button{font:inherit;color:inherit;border:1px solid #46516a;border-radius:5px;background:#242d3d;padding:4px 6px}.selectionTools input{width:65px}.timelineScroll{overflow:auto;border:1px solid #45516b;border-radius:6px;max-height:190px}.timelineSurface{position:relative;touch-action:none;user-select:none;min-height:91px;padding-bottom:8px;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),#ffffff08 calc(10% - 1px),#ffffff08 10%)}.timeRuler{height:28px;position:relative;cursor:ew-resize;background:#253044;border-bottom:1px solid #4b5970;overflow:hidden}.timeRuler>span{position:absolute;font-size:10px;top:4px;border-left:1px solid #8b9bb1;padding-left:3px;height:22px}.shotTrack{position:relative;height:52px}.shotBlock{position:absolute;top:4px;height:44px;box-sizing:border-box;background:#315778;border:1px solid #5a83a8;border-radius:5px;display:flex;flex-direction:column;justify-content:center;align-items:center;min-width:3px;cursor:grab;overflow:hidden}.shotBlock.active{border:2px solid #85b7ff;background:#3b678c}.shotBlock.playing{box-shadow:inset 0 -3px #4fe6a3}.clipLabel{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;padding:0 9px;pointer-events:none}.shotBlock small{font-size:10px;color:#c3d4e6;pointer-events:none}.resizeHandle{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:2;background:#ffffff18}.resizeHandle:hover{background:#8cb4ef99}.resizeHandle.left{left:0}.resizeHandle.right{right:0}.playhead{position:absolute;top:0;bottom:0;width:2px;background:#ffc571;z-index:4;cursor:ew-resize;touch-action:none}.playhead>span{display:block;position:absolute;top:0;transform:translateX(-50%);background:#ffc571;color:#171b24;border-radius:3px;padding:1px 4px;font-size:10px}.actionTrack{position:relative;height:31px;border-top:1px solid #ffffff12}.actionBlock{position:absolute;top:3px;height:25px;background:#285944;border:1px solid #4c9576;border-radius:4px;cursor:grab;box-sizing:border-box;overflow:hidden;display:flex;align-items:center}.rowLabel{position:absolute;right:4px;bottom:3px;color:#8ea29d;font-size:10px;pointer-events:none}:disabled{opacity:.45;cursor:default}
.shotThumbnail{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.24;pointer-events:none}.shotBlock .clipLabel,.shotBlock small{position:relative;z-index:1;text-shadow:0 1px 3px #0008}.cameraDropActive{outline:2px dashed #97c2ff;outline-offset:-2px}.cameraDropMark{position:absolute;top:0;bottom:0;z-index:6;border-left:3px solid #b7f45a;background:#142016e8;color:#e4ffd1;border-radius:8px;padding:4px 7px;white-space:nowrap;pointer-events:none}
</style>
