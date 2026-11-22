import { blobDataUrl, checkImageDimensions, imageHeader } from '../entities/entityImageUpload';

export const assetMediaLimits = { bytes: 32 * 1024 * 1024, thumbnailBytes: 256 * 1024, thumbnailEdge: 512 } as const;
export interface AssetMedia {
  id: string;
  original: Blob;
  bytes: number;
  width: number;
  height: number;
}
export interface PreparedAssetMedia extends AssetMedia {
  thumbnail: string;
}

const dataUrlPattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function imageDataUrlBytes(value: unknown, maxBytes: number): number {
  if (typeof value !== 'string' || value.length > 24 + 4 * Math.ceil(maxBytes / 3) || !dataUrlPattern.test(value)) {
    throw Error('图片数据无效或超过容量限制');
  }
  const encodedLength = value.length - value.indexOf(',') - 1;
  const length = encodedLength * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  if (encodedLength % 4 || length < 1 || length > maxBytes) throw Error('图片数据无效或超过容量限制');
  return length;
}

export async function imageDataUrlBlob(value: string, maxBytes: number): Promise<Blob> {
  imageDataUrlBytes(value, maxBytes);
  return (await fetch(value)).blob();
}

export async function readAssetMedia(blob: Blob): Promise<AssetMedia> {
  if (!(blob instanceof Blob) || !blob.size || blob.size > assetMediaLimits.bytes) {
    throw Error('原图必须为 1 字节至 32 MiB 的 PNG、JPEG 或 WebP 图片');
  }
  const buffer = await blob.arrayBuffer();
  const { mime, width, height } = imageHeader(new Uint8Array(buffer));
  checkImageDimensions(width, height);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const id = 'sha256:' + Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
  return { id, original: blob.slice(0, blob.size, mime), bytes: blob.size, width, height };
}

/** Validate and retain the supplied bytes. Only the thumbnail is re-encoded. */
export async function prepareAssetMedia(blob: Blob): Promise<PreparedAssetMedia> {
  const media = await readAssetMedia(blob);
  const url = URL.createObjectURL(media.original);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    image.src = url;
    await image.decode();
    checkImageDimensions(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, assetMediaLimits.thumbnailEdge / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('无法生成图片缩略图');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(Error('无法生成图片缩略图')), 'image/webp', .82);
    });
    if (thumbnail.size > assetMediaLimits.thumbnailBytes) throw Error('图片缩略图超过容量限制');
    return { ...media, thumbnail: await blobDataUrl(thumbnail) };
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 1;
  }
}
