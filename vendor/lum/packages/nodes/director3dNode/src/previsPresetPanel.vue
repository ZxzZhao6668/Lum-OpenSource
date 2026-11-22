<template>
  <details class="presetLibrary" @toggle="onToggle"><summary>资产预设</summary>
    <p>点击缩略图添加到观察中心附近。人物白模支持动作与路线。</p>
    <details v-for="category in categories" :key="category.name" class="presetCategory" :open="category.name==='人物'"><summary>{{ category.name }}预设 · {{ category.items.length }}</summary>
      <div class="presetCards"><button v-for="item in category.items" :key="item.id" :disabled="disabled" :aria-label="`添加预设 ${item.name}`" @click="$emit('add',item.id)"><img v-if="thumbnails[item.id]" :src="thumbnails[item.id]" :alt="item.name" /><span v-else class="loadingPreview">{{ previewError ? '预览暂不可用' : '预览加载中' }}</span><span>{{ item.name }}</span></button></div>
    </details>
    <small>基础资产：Kenney · CC0。宫墙、月亮门、梧桐与演员服装：Lum 程序化模型。</small>
  </details>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer, Mesh } from "three";
import { assetCatalog, characterPresets, createPresetMesh, presetObject } from "./previsPresets";
import { createMannequin } from "./mannequin";
defineProps<{disabled:boolean}>();defineEmits<{add:[id:string]}>();
const categories:{name:string;items:{id:string;name:string}[]}[]=[{name:"人物",items:characterPresets},...["场地","道具","建筑","树木"].map(name=>({name,items:assetCatalog.filter(item=>item.category===name)}))];
const thumbnails=ref<Record<string,string>>({}),previewError=ref(false);
let generating=false,destroyed=false;
async function onToggle(event:Event){
  if(!(event.target as HTMLDetailsElement).open||generating||Object.keys(thumbnails.value).length)return;
  generating=true;let renderer:WebGLRenderer|undefined;
  try{
    renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(160,120);renderer.setPixelRatio(1);
    const scene=new Scene();scene.background=new Color("#263142");scene.add(new AmbientLight(0xffffff,2));const light=new DirectionalLight(0xffffff,3);light.position.set(3,7,5);scene.add(light);
    const camera=new PerspectiveCamera(35,4/3,.01,1000);
    for(const item of categories.flatMap(category=>category.items)){
      if(destroyed)break;
      const actor=characterPresets.find(actor=>actor.id===item.id);
      const object=actor?createMannequin(actor.id,actor.color,[],presetObject(actor.id).appearance):createPresetMesh(item.id);scene.add(object);
      const box=new Box3().setFromObject(object),center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
      const distance=Math.max(size.x,size.y,size.z)*2.4;
      camera.position.copy(center).add(new Vector3(.75,.55,1).normalize().multiplyScalar(distance));camera.lookAt(center);renderer.render(scene,camera);
      thumbnails.value[item.id]=renderer.domElement.toDataURL("image/png");object.removeFromParent();object.traverse(part=>{if(part instanceof Mesh){part.geometry.dispose();(Array.isArray(part.material)?part.material:[part.material]).forEach(material=>material.dispose());}});
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
  }catch{previewError.value=true;}finally{renderer?.dispose();renderer?.forceContextLoss();generating=false;}
}
onBeforeUnmount(()=>{destroyed=true;});
</script>
<style scoped>
.presetLibrary{border:1px solid #52627a;border-radius:7px;padding:6px;margin:12px 0}summary{cursor:pointer;padding:6px 0;font-weight:600}.presetCategory{border-top:1px solid #3d4a5f}.presetLibrary p,.presetLibrary small{font-size:11px;line-height:1.5;color:#aabbd1;display:block}.presetCards{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px 0 9px}.presetCards button{font:inherit;font-size:11px;color:inherit;border:1px solid #445673;border-radius:6px;background:#263142;padding:3px;cursor:pointer;overflow:hidden}.presetCards button:hover{border-color:#85b7ff;background:#355074}.presetCards img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain}.presetCards span{display:block}.loadingPreview{height:65px;display:grid!important;place-items:center;color:#aabbd1}.presetCards button:disabled{opacity:.5;cursor:default}
</style>
