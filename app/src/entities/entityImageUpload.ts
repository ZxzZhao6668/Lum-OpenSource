const MiB = 1024 * 1024;
const maxStoredBytes = 4 * MiB;
const maxEdge = 4096;

// Inspect actual bytes: Windows file associations can leave File.type empty or incorrect.
export function imageHeader(bytes: Uint8Array): {mime: string; width: number; height: number} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n) && ascii(12,4) === 'IHDR') {
    return {mime:'image/png', width:view.getUint32(16), height:view.getUint32(20)};
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) {
        return {mime:'image/jpeg', width:view.getUint16(offset + 5), height:view.getUint16(offset + 3)};
      }
      offset += length;
    }
  }
  if (bytes.length >= 20 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP') {
    const uint24 = (offset: number) => bytes[offset] | bytes[offset+1] << 8 | bytes[offset+2] << 16;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = ascii(offset,4), length = view.getUint32(offset + 4,true), data = offset + 8;
      if (data + length > bytes.length) break;
      if (kind === 'VP8X' && length >= 10) return {mime:'image/webp', width:uint24(data+4)+1, height:uint24(data+7)+1};
      if (kind === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
        return {mime:'image/webp', width:1+(bytes[data+1]|(bytes[data+2]&63)<<8), height:1+((bytes[data+2]>>6)|bytes[data+3]<<2|(bytes[data+4]&15)<<10)};
      }
      if (kind === 'VP8 ' && length >= 10 && bytes[data+3] === 0x9d && bytes[data+4] === 1 && bytes[data+5] === 0x2a) {
        return {mime:'image/webp', width:view.getUint16(data+6,true)&0x3fff, height:view.getUint16(data+8,true)&0x3fff};
      }
      offset = data + length + (length % 2);
    }
  }
  throw Error('图片格式无法识别或文件已损坏，请选择 PNG、JPG / JPEG 或 WebP 图片');
}

export function checkImageDimensions(width: number, height: number) {
  if (!width || !height) throw Error('图片尺寸无效，请重新导出图片');
  // Reject oversized compressed images before the browser allocates their decoded pixels.
  if (width > 16384 || height > 16384 || width * height > 32_000_000) {
    throw Error('图片分辨率过大，请将长边缩小到 16384 像素以内、总像素缩小到 3200 万以内');
  }
}

export function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('图片读取失败，请重新选择文件'));
    reader.onabort = () => reject(Error('图片读取已取消'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareEntityImage(file: File) {
  if (!file.size) throw Error('图片文件为空，请重新选择');
  if (file.size > 32 * MiB) throw Error('图片超过 32MB，请先缩小文件后再导入');
  const header = imageHeader(new Uint8Array(await file.arrayBuffer()));
  checkImageDimensions(header.width,header.height);
  const source = file.slice(0,file.size,header.mime), url = URL.createObjectURL(source), image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    image.src = url;
    try { await image.decode(); } catch { throw Error('图片无法解码，可能已损坏；请重新导出为 PNG、JPG 或 WebP'); }
    checkImageDimensions(image.naturalWidth,image.naturalHeight);
    if (file.size <= maxStoredBytes && Math.max(image.naturalWidth,image.naturalHeight) <= maxEdge) {
      return {dataUrl:await blobDataUrl(source), adjusted:false, width:image.naturalWidth, height:image.naturalHeight};
    }
    canvas = document.createElement('canvas');
    let scale = Math.min(1,maxEdge / Math.max(image.naturalWidth,image.naturalHeight));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1,Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1,Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw Error('无法处理图片，请关闭部分图片窗口后重试');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const output = await new Promise<Blob>((resolve,reject) => canvas!.toBlob(blob => blob ? resolve(blob) : reject(Error('图片压缩失败，请重新导出图片')), 'image/webp',.9));
      if (output.size <= maxStoredBytes) return {dataUrl:await blobDataUrl(output), adjusted:true, width:canvas.width, height:canvas.height};
      scale *= .75;
    }
    throw Error('图片压缩后仍然过大，请降低分辨率后再导入');
  } finally {
    image.removeAttribute('src'); URL.revokeObjectURL(url);
    if (canvas) canvas.width = canvas.height = 1;
  }
}
