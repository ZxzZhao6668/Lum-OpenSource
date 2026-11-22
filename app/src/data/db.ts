import Dexie from "dexie";
import seed from "./entities-seed.json";
import { currentProjectId, projectDatabaseName } from '../projects/projectIdentity';
import { renameShotMentions } from '../storyboard/mentionModel';
import type { Shot } from '../storyboard/shotModel';
import type { ProjectAssetSnapshot } from '../assetLibrary/assetSnapshot';
import type { AssetMedia } from '../assetLibrary/assetMedia';

export type EntityKind = "character" | "location" | "prop";

export interface EntityRow {
  id: string;
  kind: EntityKind;
  name: string;
  meta: string;
  desc: string;
  order: number;
  image?: string;
  assetSnapshot?: ProjectAssetSnapshot;
}

export interface DocRow {
  key: string;
  payload: unknown;
  updatedAt: number;
}

export interface ProjectVersionRow {
  id: string;
  label: string;
  createdAt: number;
  docs: DocRow[];
  entities: EntityRow[];
}

export class DataDB extends Dexie {
  entities!: Dexie.Table<EntityRow, string>;
  docs!: Dexie.Table<DocRow, string>;
  versions!: Dexie.Table<ProjectVersionRow, string>;
  assetMedia!: Dexie.Table<AssetMedia, string>;

  constructor(name = projectDatabaseName(currentProjectId ?? 'legacy')) {
    super(name);
    this.version(1).stores({
      entities: "id, kind, order",
      docs: "key, updatedAt",
    });
    this.version(2).stores({ entities: "id, kind, order", docs: "key, updatedAt", versions: "id, createdAt" });
    this.version(3).stores({ assetMedia: 'id' });
  }
}

export const db = new DataDB();

const uid = () => `ent_${Math.random().toString(36).slice(2, 9)}`;

let seedPromise: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seedPromise) {
    seedPromise = db.transaction('rw', db.entities, db.docs, async () => {
      if(await loadDoc('entities:initialized'))return;
      const count = await db.entities.count();
      if (count > 0) { await saveDoc('entities:initialized',true); return; }
      if (db.name !== 'laper-data') { await saveDoc('entities:initialized',true); return; }
      const rows: EntityRow[] = (seed as Omit<EntityRow, "id" | "order">[]).map((e, i) => ({
        id: uid(),
        kind: e.kind as EntityKind,
        name: e.name,
        meta: e.meta,
        desc: e.desc,
        order: i,
      }));
      await db.entities.bulkAdd(rows);
      await saveDoc('entities:initialized',true);
    }).catch(error=>{seedPromise=null;throw error;});
  }
  return seedPromise;
}

export async function listEntities(kind?: EntityKind): Promise<EntityRow[]> {
  return kind
    ? db.entities.where("kind").equals(kind).sortBy("order")
    : db.entities.orderBy("order").toArray();
}

export async function createEntity(
  kind: EntityKind,
  init: Partial<EntityRow> = {},
): Promise<EntityRow> {
  return db.transaction('rw',db.entities,async()=>{
  const last = await db.entities.orderBy('order').last();
  const row: EntityRow = {
    id: uid(),
    kind,
    name: init.name ?? (kind === "character" ? "新角色" : kind === "location" ? "新地点" : "新道具"),
    meta: init.meta ?? (kind === "character" ? "男 · 岁 · " : kind === "location" ? "地点" : "道具"),
    desc: init.desc ?? "",
    order: (last?.order ?? -1) + 1,
    ...(init.image !== undefined ? {image:init.image} : {}),
    ...(init.assetSnapshot !== undefined ? {assetSnapshot:init.assetSnapshot} : {}),
  };
  await db.entities.add(row);
  return row;
  });
}

export async function updateEntity(id: string, patch: Partial<EntityRow>): Promise<void> {
  await db.transaction('rw',db.entities,db.docs,async()=>{
    const before=await db.entities.get(id);if(!before)throw Error('资产不存在');
    const after={...before,...patch,id};
    if(patch.image!==undefined && patch.image!==before.image && patch.assetSnapshot===undefined) delete after.assetSnapshot;
    await syncEntityShotNames(before,after);
    await db.entities.put(after);
  });
}

/** Caller owns the entities+docs transaction. Returned snapshots can join an undo journal. */
export async function syncEntityShotNames(before:EntityRow,after:EntityRow) {
  const changes:{key:string;before:unknown;after:unknown}[]=[];
  if(before.name===after.name)return changes;
  const rows=await db.entities.toArray();
  for(const row of await db.docs.where('key').startsWith('storyboard:').toArray()){
    if(!/^storyboard:[^:]+$/.test(row.key)||!Array.isArray(row.payload))continue;
    const shots=row.payload as Shot[],next=shots.map(shot=>renameShotMentions(shot,before,after,rows));
    if(next.every((shot,i)=>shot===shots[i]))continue;
    changes.push({key:row.key,before:row.payload,after:next});
    await db.docs.put({...row,payload:next,updatedAt:Date.now()});
  }
  return changes;
}

export async function deleteEntity(id: string): Promise<void> {
  await db.entities.delete(id);
}

export async function loadDoc<T>(key: string): Promise<T | null> {
  const row = await db.docs.get(key);
  return (row?.payload as T) ?? null;
}

export async function saveDoc(key: string, payload: unknown): Promise<void> {
  await db.docs.put({ key, payload, updatedAt: Date.now() });
}
