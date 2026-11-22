import { isProjectAssetMediaId, validateAssetViewSource, type AssetViewSource } from '../assetLibrary/assetSnapshot';
export interface ShotMediaPin { mediaId: string; source: AssetViewSource; prompt: string; adoptedAt: number; candidateId: string }
export interface ShotMediaHistory { image?: string; pin?: ShotMediaPin }
/** Only an explicitly selected newer generation may override the pinned original. */
export function effectiveShotGenerationImage<T>(pin: ShotMediaPin | undefined, selection?: { selected?: T; selectedAt?: number; useOriginal?: boolean }): T | undefined {
  if (selection?.useOriginal || !selection?.selected) return undefined;
  if (pin && !((selection.selectedAt ?? 0) > pin.adoptedAt)) return undefined;
  return selection.selected;
}
export function validateShotMediaPin(value: unknown): ShotMediaPin {
  const pin = value as ShotMediaPin;
  if (!pin || !isProjectAssetMediaId(pin.mediaId) || typeof pin.prompt !== 'string' || pin.prompt.length > 100000
    || typeof pin.candidateId !== 'string' || !pin.candidateId || pin.candidateId.length > 512 || !Number.isFinite(pin.adoptedAt)) throw Error('分镜采用原图记录损坏');
  validateAssetViewSource(pin.source); return pin;
}
