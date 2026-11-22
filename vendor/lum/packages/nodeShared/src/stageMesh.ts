export interface StageMeshPart {
  positions: number[];
  indices: number[];
  color: string;
  ao?: number[];
}
export type StageMesh = StageMeshPart[];

// Bounded static geometry is persisted with the scene; no remote resources or scripts.
export function isStageMesh(value: unknown): value is StageMesh {
  if (!Array.isArray(value) || !value.length || value.length > 64) return false;
  let triangles = 0, vertices = 0;
  for (const part of value) {
    if (!part || typeof part !== "object" || Object.keys(part).some(key => !["positions", "indices", "color", "ao"].includes(key))) return false;
    if (typeof part.color !== "string" || !/^#[\da-f]{6}$/i.test(part.color)) return false;
    if (!Array.isArray(part.positions) || part.positions.length < 9 || part.positions.length % 3 || part.positions.length > 180000) return false;
    if (!part.positions.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 10000)) return false;
    if (part.ao !== undefined && (!Array.isArray(part.ao) || part.ao.length !== part.positions.length / 3 || !part.ao.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1))) return false;
    if (!Array.isArray(part.indices) || part.indices.length < 3 || part.indices.length % 3 || part.indices.length > 60000) return false;
    if (!part.indices.every((n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < part.positions.length / 3)) return false;
    triangles += part.indices.length / 3; vertices += part.positions.length / 3;
    if (triangles > 20000 || vertices > 60000) return false;
  }
  return true;
}
