import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshStandardMaterial } from "three";
import catalog from "./presets/catalog.json";
import { virtualStageAssets } from "@lum/node-shared/virtualStageAssets";
import type { SceneDocument } from "./scene";

export const assetCatalog = [...catalog, ...virtualStageAssets];
export function createPresetMesh(id: string, tint = "#ffffff", clay = false) {
  const preset = assetCatalog.find(item=>item.id===id);
  if (!preset) throw new Error("资产预设不存在，请更新预演插件");
  const positions:number[]=[], colors:number[]=[], indices:number[]=[];
  const multiplier = new Color(tint);
  for (const part of preset.parts) {
    const offset=positions.length/3, color=new Color(clay ? "#e5e3dd" : part.color).multiply(clay ? new Color("#ffffff") : multiplier);
    positions.push(...part.positions);
    for(let i=0;i<part.positions.length;i+=3) colors.push(color.r,color.g,color.b);
    indices.push(...part.indices.map(index=>index+offset));
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new Float32BufferAttribute(colors,3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return new Mesh(geometry,new MeshStandardMaterial({vertexColors:true,roughness:.8}));
}
export const characterPresets=[
  {id:"stageRobeActor",name:"古装演员 · 长袍",scale:1,color:"#28464b"},
  {id:"stageModernActor",name:"现代演员 · 便装",scale:1,color:"#527ba0"},
  {id:"actorAdult",name:"成人白模",scale:1,color:"#d9c9af"},
  {id:"actorTall",name:"高个白模",scale:1.12,color:"#a1bbd4"},
  {id:"actorChild",name:"儿童比例白模",scale:.65,color:"#d9af8b"},
];
export function presetObject(id:string):SceneDocument["objectList"][number] {
  const actor=characterPresets.find(item=>item.id===id), asset=assetCatalog.find(item=>item.id===id);
  if(!actor&&!asset)throw new Error("请选择有效资产预设");
  return {threeJsonId:crypto.randomUUID(),name:actor?.name??asset!.name,objType:actor?"mannequin":"preset",presetId:actor?undefined:id,geometry:{},position:{x:0,y:0,z:0},stageRole: actor ? "character" : asset!.category === "道具" ? "prop" : "environment",appearance:id==="stageRobeActor"||id==="stageModernActor"?{style:id==="stageRobeActor"?"robe":"modern",skin:"#c4a68b",hair:"#20252b",accent:"#9b916e"}:undefined,scale:actor?{scaleX:actor.scale,scaleY:actor.scale,scaleZ:actor.scale}:undefined,material:{type:"standard",color:actor?.color??"#ffffff",roughness:.8}};
}
