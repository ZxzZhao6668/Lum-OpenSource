import { isStageMesh, type StageMesh } from "./stageMesh";

export interface StageLibraryEntry {
  id: string;
  name: string;
  category: "建筑" | "自然" | "室内" | "道具" | "其他";
  tags: string[];
  source: string;
  license: string;
  dimensions: { x: number; y: number; z: number };
  triangles: number;
  hasPreview?: boolean;
}
export interface StageLibraryModel extends StageLibraryEntry { version: 1; meshParts: StageMesh }

export function isStageLibraryEntry(value: unknown): value is StageLibraryEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as StageLibraryEntry;
  return typeof item.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(item.id)
    && typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 100
    && ["建筑", "自然", "室内", "道具", "其他"].includes(item.category)
    && Array.isArray(item.tags) && item.tags.length <= 30 && item.tags.every(tag => typeof tag === "string" && tag.length > 0 && tag.length <= 60)
    && typeof item.source === "string" && item.source.length <= 500 && typeof item.license === "string" && item.license.length > 0 && item.license.length <= 100
    && !!item.dimensions && [item.dimensions.x, item.dimensions.y, item.dimensions.z].every(n => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 10000)
    && Number.isInteger(item.triangles) && item.triangles > 0 && item.triangles <= 20000
    && (item.hasPreview === undefined || typeof item.hasPreview === "boolean");
}

export function isStageLibraryModel(value: unknown): value is StageLibraryModel {
  return isStageLibraryEntry(value) && (value as StageLibraryModel).version === 1 && isStageMesh((value as StageLibraryModel).meshParts);
}

export function stageMeshDimensions(parts: StageMesh) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (let i = 0; i < part.positions.length; i++) {
    const axis = i % 3, value = part.positions[i]!;
    min[axis] = Math.min(min[axis]!, value); max[axis] = Math.max(max[axis]!, value);
  }
  return { x: Math.max(.001, max[0]! - min[0]!), y: Math.max(.001, max[1]! - min[1]!), z: Math.max(.001, max[2]! - min[2]!) };
}
