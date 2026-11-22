import Dexie, { type ObservabilitySet } from 'dexie';
import { db, type EntityKind, type EntityRow } from './db';

export type EntitySummary = Readonly<Omit<EntityRow, 'image'> & { hasImage: boolean; imageMimeType?: string }>;
const kinds: EntityKind[] = ['character', 'location', 'prop'];
const summaries = new Map<EntityKind, Promise<readonly EntitySummary[]>>();
let revision = 0;

// Dexie emits this after commit, including writes from other tabs/DB instances.
// Document saves and aborted transactions must not evict the asset catalogue.
const invalidate = (parts: ObservabilitySet) => {
  if (!Object.keys(parts).some(key => key === 'all' || key.startsWith(`idb://${db.name}/entities/`))) return;
  revision++;
  summaries.clear();
};
Dexie.on('storagemutated', invalidate);
import.meta.hot?.dispose(() => Dexie.on.storagemutated.unsubscribe(invalidate));

async function readSummaries(kind: EntityKind): Promise<readonly EntitySummary[]> {
  const rows: EntitySummary[] = [];
  // Stream records and retain only small metadata, never the original image.
  await db.entities.where('kind').equals(kind).each(({id, kind, name, meta, desc, order, image, assetSnapshot}) => {
    const imageMimeType = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(image?.slice(0,80) ?? '')?.[1];
    rows.push(Object.freeze({id, kind, name, meta, desc, order, assetSnapshot, hasImage: !!image, imageMimeType}));
  });
  return Object.freeze(rows.sort((a, b) => a.order - b.order));
}

function cachedSummaries(kind: EntityKind) {
  let request = summaries.get(kind);
  if (!request) {
    request = readSummaries(kind);
    summaries.set(kind, request);
    const pending = request;
    void request.catch(() => { if (summaries.get(kind) === pending) summaries.delete(kind); });
  }
  return request;
}

/** Shared by asset lists and shot mentions. Full originals remain in IndexedDB. */
export async function listEntitySummaries(kind?: EntityKind): Promise<readonly EntitySummary[]> {
  const requested = kind ? [kind] : kinds;
  // Read-your-writes and rollback isolation: never publish transaction-local data.
  if (Dexie.currentTransaction?.db === db) {
    return (await Promise.all(requested.map(readSummaries))).flat().sort((a, b) => a.order - b.order);
  }
  for (;;) {
    const started = revision;
    const rows = await Promise.all(requested.map(cachedSummaries));
    if (started !== revision) continue; // A commit raced the read; use the new snapshot.
    return kind ? rows[0] : Object.freeze(rows.flat().sort((a, b) => a.order - b.order));
  }
}
