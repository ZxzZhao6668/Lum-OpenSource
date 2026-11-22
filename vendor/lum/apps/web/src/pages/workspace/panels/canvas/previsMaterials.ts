import type { WritingMaterial } from "./writingMaterials";

// ACT: 素材图片作为造型参考；初始模型只提供带真实资产 ID 的简化占位，后续由导演台编辑。
export function createPrevisSnapshot(items: WritingMaterial[], seconds: number) {
  const duration = Math.max(0.2, Math.min(300, seconds));
  let characterIndex = 0, propIndex = 0;
  const assets = items.filter(item => item.kind === "text" && item.entityKind && item.sourceKey.startsWith("entity:"));
  if (assets.length > 200) throw new Error("单个预演最多容纳 200 个资产，请将胶卷拆成较小的场次后再进入。");
  const objectList = assets.map(item => {
    const common = { threeJsonId: item.sourceKey, name: item.label.slice(0, 100), material: { type: "standard", color: "#c6cdd1", roughness: 0.8 } };
    if (item.entityKind === "character") return { ...common, objType: "mannequin", geometry: {}, position: { x: (characterIndex++ % 6) * 1.3 - 2, y: 0, z: Math.floor((characterIndex - 1) / 6) * 1.8 } };
    if (item.entityKind === "location") return { ...common, objType: "plane", geometry: { width: 12, height: 12 }, position: { x: 0, y: -0.02 - propIndex++ * 0.01, z: 0 }, rotation: { rotationX: -Math.PI / 2, rotationY: 0, rotationZ: 0 }, material: { ...common.material, color: "#dce1e3" } };
    return { ...common, objType: "box", geometry: { width: 0.8, height: 0.8, depth: 0.8 }, position: { x: (propIndex++ % 8) * 1.1 - 3, y: 0.4, z: 3 + Math.floor((propIndex - 1) / 8) } };
  });
  const camera = { position: { x: 6, y: 4, z: 8 }, fov: 45, near: 0.1, far: 1000 };
  const controls = { target: { x: 0, y: 1, z: 0 } };
  return {
    version: 1,
    scene: { version: "next", sceneConfig: { scene: { background: "#e8edef" }, camera, controls, lights: [{ type: "ambient", color: "#ffffff", intensity: 1.2 }, { type: "directional", color: "#ffffff", intensity: 2, position: { x: 5, y: 8, z: 4 } }] }, objectList },
    plans: [{ id: crypto.randomUUID(), name: "场次白模预演", duration, tracks: [], cameraFrames: [{ time: 0, view: { camera, controls }, easing: "linear" }], instruction: "根据当前场次和关联资产建立的白模占位，可继续调整机位、绘制路线和编排动作。" }],
  };
}
