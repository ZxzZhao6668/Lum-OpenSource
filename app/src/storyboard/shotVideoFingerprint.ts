import type {Shot} from './shotModel';
import type {ReferenceImage} from './generationState';
import type {ProductionMaterial} from '../canvas/productionMaterials';

const imageDigests = new WeakMap<ReferenceImage, {path: string; digest: Promise<string>}>();
export async function textFingerprint(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
function imageFingerprint(image: ReferenceImage) {
  let cached = imageDigests.get(image);
  if (!cached || cached.path !== image.path) {
    cached = {path: image.path, digest: textFingerprint(image.path)};
    imageDigests.set(image, cached);
  }
  return cached.digest;
}
export async function videoContentFingerprint(shot: Shot, sceneId: string, materials: ProductionMaterial[]) {
  const {x: _x, y: _y, image: _image, ...content} = shot;
  const fingerprints = [];
  for (const material of materials) {
    const {image, ...text} = material;
    fingerprints.push({...text, image: image ? {mimeType: image.mimeType, hash: await imageFingerprint(image)} : undefined});
  }
  return textFingerprint(JSON.stringify({content, sceneId, materials: fingerprints}));
}

/** Older releases saved an array of [source JSON, prompt] with full images embedded.
 * Decode one entry at a time, rather than duplicating all images for the entire batch. */
function* legacyEntries(raw: string): Generator<[string, string]> {
  if (raw[0] !== '[' || raw[raw.length - 1] !== ']') throw Error('Invalid legacy batch');
  let cursor = 1, first = true;
  while (cursor < raw.length - 1) {
    if (!first && raw[cursor++] !== ',') throw Error('Invalid legacy separator');
    first = false;
    const start = cursor;
    if (raw[cursor] !== '[') throw Error('Invalid legacy entry');
    let depth = 0, quoted = false;
    for (; cursor < raw.length - 1; cursor++) {
      const char = raw[cursor];
      if (quoted) {
        if (char === '\\') cursor++;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '[') depth++;
      else if (char === ']' && --depth === 0) {cursor++; break;}
    }
    const entry: unknown = JSON.parse(raw.slice(start, cursor));
    if (!Array.isArray(entry) || entry.length !== 2 || entry.some(v => typeof v !== 'string')) throw Error('Invalid legacy values');
    yield entry as [string, string];
  }
}
export async function legacyBatchMatches(raw: string, drafts: {source: {signature: string}; prompt: string}[]) {
  if (!raw.startsWith('[')) return false;
  try {
    let index = 0;
    for (const [sourceText, prompt] of legacyEntries(raw)) {
      const draft = drafts[index++];
      if (!draft || draft.prompt !== prompt) return false;
      const source = JSON.parse(sourceText);
      const {content, sceneId, materials} = JSON.parse(source.contentSignature);
      const contentSignature = await videoContentFingerprint(content, sceneId, materials);
      if (JSON.stringify({contentSignature, settings: source.settings}) !== draft.source.signature) return false;
    }
    return index === drafts.length;
  } catch { return false; }
}
