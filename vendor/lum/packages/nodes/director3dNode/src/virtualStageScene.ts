import { presetObject } from "./previsPresets";
import { createEmptyScene, type SceneDocument } from "./scene";

export function createVirtualStageScene(layout: "courtyard" | "study"): SceneDocument {
  const scene = createEmptyScene();
  scene.studio = { clayEnvironment: true, lighting: "daylight", renderer: "eevee" };
  scene.sceneConfig.scene.background = "#dfe4e8";
  scene.sceneConfig.lights = [
    { type: "hemisphere", color: "#eef3ff", intensity: .8 },
    { type: "directional", color: "#fff4df", intensity: 3, position: { x: -8, y: 12, z: 6 }, target: { x: 0, y: 0, z: -8 } },
  ];
  const add = (id: string, x: number, z: number, yaw = 0) => {
    const object = presetObject(id);
    object.position = { x, y: 0, z };
    object.rotation = { rotationX: 0, rotationY: yaw, rotationZ: 0 };
    object.stageRole = "environment";
    scene.objectList.push(object);
    return object;
  };
  if (layout === "courtyard") {
    for (let i = 0; i < 6; i++) {
      add(i === 1 ? "stageMoonGate" : "stagePalaceWall", 2.6, 3 - i * 6, Math.PI / 2);
      add("stagePlaneTree", -4.5, 3 - i * 5.8, i * 1.7);
    }
    for (let i = 0; i < 8; i++) add("stagePaving", -1.1, 8 - i * 5);
    scene.sceneConfig.camera.position = { x: -6.8, y: 2.1, z: 9 };
    scene.sceneConfig.controls.target = { x: .5, y: 1.6, z: -4 };
  } else {
    for (const x of [-2.5, 2.5]) for (const z of [-2.5, 2.5]) add("stagePaving", x, z);
    for (const x of [-3, 3]) add("stagePalaceWall", x, -5);
    for (const x of [-4.5, 4.5]) for (const z of [-4.5, 4.5]) add("stageColumn", x, z);
    add("stageTable", 0, -2);
    add("stageChair", 0, -3);
    scene.sceneConfig.camera.position = { x: -5.5, y: 2.5, z: 5 };
    scene.sceneConfig.controls.target = { x: 0, y: 1, z: -2 };
  }
  scene.sceneConfig.camera.fov = 48;
  return scene;
}
