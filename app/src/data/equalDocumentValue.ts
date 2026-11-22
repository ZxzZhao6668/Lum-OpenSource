/** Compare plain document data without allocating serialized copies of embedded images. */
export function equalDocumentValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => equalDocumentValue(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const before = left as Record<string, unknown>;
  const after = right as Record<string, unknown>;
  const keys = Object.keys(before).filter(key => before[key] !== undefined);
  return keys.length === Object.keys(after).filter(key => after[key] !== undefined).length
    && keys.every(key => Object.hasOwn(after, key) && equalDocumentValue(before[key], after[key]));
}
