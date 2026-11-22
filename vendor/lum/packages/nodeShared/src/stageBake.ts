import { isStageMesh, type StageMesh } from "./stageMesh";

export interface StageBakeOptions { samples: 16 | 32 | 64; distance: number }
export interface StageBake extends StageBakeOptions {
  enabled: boolean;
  strength: number;
  signature: string;
  motionSignature: string;
  objects: { objectId: string; parts: StageMesh }[];
}
type BakeObject = { threeJsonId: string; objType: string; stageRole?: string; geometry: unknown; position: unknown; rotation?: unknown; scale?: unknown; attachment?: unknown; presetId?: string; meshParts?: StageMesh };
type BakeScene = { objectList: BakeObject[]; studio?: { bake?: StageBake } };
export const canBakeObject = (object: Pick<BakeObject, "objType" | "stageRole">) => object.objType !== "mannequin" && object.stageRole !== "character";

function fingerprint(value: unknown) {
  const text = JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
  let first = 2166136261, second = 5381;
  for (let i = 0; i < text.length; i++) { first = Math.imul(first ^ text.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ text.charCodeAt(i); }
  return `${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}-${text.length}`;
}
export function stageBakeSignature(scene: BakeScene) {
  return fingerprint(scene.objectList.filter(canBakeObject).map(object => ({ id: object.threeJsonId, type: object.objType, role: object.stageRole, geometry: object.geometry, position: object.position, rotation: object.rotation, scale: object.scale, attachment: object.attachment, presetId: object.presetId, meshParts: object.meshParts })).sort((a, b) => a.id.localeCompare(b.id)));
}
export function stageBakeMotionSignature(scene: BakeScene, tracks: { objectId: string }[]) {
  const ids = new Set(scene.objectList.filter(canBakeObject).map(object => object.threeJsonId));
  return fingerprint(tracks.filter(track => ids.has(track.objectId)).sort((a, b) => a.objectId.localeCompare(b.objectId)));
}
export function isStageBake(value: unknown): value is StageBake {
  if (!value || typeof value !== "object") return false;
  const data = value as StageBake;
  if (Object.keys(data).some(key => !["enabled", "strength", "signature", "motionSignature", "samples", "distance", "objects"].includes(key))) return false;
  if (typeof data.enabled !== "boolean" || !Number.isFinite(data.strength) || data.strength < 0 || data.strength > 1 || ![16, 32, 64].includes(data.samples) || !Number.isFinite(data.distance) || data.distance < .05 || data.distance > 10) return false;
  if (![data.signature, data.motionSignature].every(key => typeof key === "string" && /^[\da-f]+-[\da-f]+-\d{1,9}$/.test(key))) return false;
  if (!Array.isArray(data.objects) || !data.objects.length || data.objects.length > 200 || new Set(data.objects.map(entry => entry?.objectId)).size !== data.objects.length) return false;
  let vertices = 0, triangles = 0;
  for (const entry of data.objects) {
    if (!entry || Object.keys(entry).some(key => !["objectId", "parts"].includes(key)) || typeof entry.objectId !== "string" || !entry.objectId.length || entry.objectId.length > 100 || !isStageMesh(entry.parts) || entry.parts.some(part => !part.ao)) return false;
    for (const part of entry.parts) { vertices += part.positions.length / 3; triangles += part.indices.length / 3; }
  }
  return vertices <= 480000 && triangles <= 160000;
}

// Apply a cached mesh only to eligible objects. The original document remains editable.
export function withStageBake<T extends BakeScene>(scene: T): T {
  const bake = scene.studio?.bake;
  if (!bake?.enabled || bake.signature !== stageBakeSignature(scene)) return scene;
  const meshes = new Map(bake.objects.map(entry => [entry.objectId, entry.parts]));
  return { ...scene, studio: { ...scene.studio, bake: undefined }, objectList: scene.objectList.map(object => {
    const parts = canBakeObject(object) && meshes.get(object.threeJsonId);
    if (!parts) return object;
    return { ...object, objType: "mesh", geometry: {}, presetId: undefined, meshParts: parts.map(part => ({ ...part, ao: part.ao!.map(value => 1 - bake.strength * (1 - value)) })) };
  }) };
}
