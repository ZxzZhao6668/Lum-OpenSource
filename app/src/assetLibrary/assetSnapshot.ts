export const assetCategories = { male: '男角色', female: '女角色', scene: '场景', prop: '道具' } as const;
export type AssetCategory = keyof typeof assetCategories;

export const assetViewPurposes = {
  reference: '通用参考', front: '正面', threeQuarter: '四分之三侧面', side: '侧面', back: '背面',
  face: '面部', hands: '手部', outfit: '衣饰', detail: '细节', overhead: '鸟瞰', sheet: '完整设定图',
} as const;
export type AssetViewPurpose = keyof typeof assetViewPurposes;

export interface AssetViewSource {
  projectId?: string;
  canvasId?: string;
  taskId?: string;
  cellId?: string;
  candidateId?: string;
  fingerprint?: string;
}

export interface AssetView {
  id: string;
  mediaId: string;
  name: string;
  purpose: AssetViewPurpose;
  source?: AssetViewSource;
}

export interface ProjectAssetSnapshot {
  assetId: string;
  libraryVersion: number;
  category: AssetCategory;
  name: string;
  notes: string;
  appearanceId: string;
  appearanceVersion: number;
  appearanceName: string;
  view: AssetView;
}

const own = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit;
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;
export const isProjectAssetMediaId = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

export function validateAssetViewSource(value: unknown): AssetViewSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('视图来源无效');
  const result: AssetViewSource = {};
  for (const [key, item] of Object.entries(value)) {
    if (!['projectId', 'canvasId', 'taskId', 'cellId', 'candidateId', 'fingerprint'].includes(key)
      || !text(item, key === 'fingerprint' ? 2048 : 256)) throw Error('视图来源无效或过长');
    result[key as keyof AssetViewSource] = item;
  }
  return result;
}

export function validateAssetViewFields(value: {name: string; purpose: AssetViewPurpose; source?: AssetViewSource}) {
  if (!text(value.name, 120)) throw Error('视图名称需为 1—120 字');
  if (!own(assetViewPurposes, value.purpose)) throw Error('视图用途无效');
  return {
    name: value.name.trim(),
    purpose: value.purpose,
    ...(value.source === undefined ? {} : { source: validateAssetViewSource(value.source) }),
  };
}

export function validateProjectAssetSnapshot(value: unknown): ProjectAssetSnapshot {
  const pin = value as ProjectAssetSnapshot | undefined;
  if (!pin || !id(pin.assetId) || !version(pin.libraryVersion) || !own(assetCategories, pin.category)
    || !text(pin.name, 200) || typeof pin.notes !== 'string' || pin.notes.length > 12000
    || !id(pin.appearanceId) || !version(pin.appearanceVersion) || !text(pin.appearanceName, 120)
    || !pin.view || !id(pin.view.id) || !isProjectAssetMediaId(pin.view.mediaId)) throw Error('项目资产快照损坏');
  validateAssetViewFields(pin.view);
  return pin;
}
