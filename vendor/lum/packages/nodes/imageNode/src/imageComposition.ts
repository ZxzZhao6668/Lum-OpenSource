export type ImageCompositionGrid = { readonly rows: number; readonly columns: number };
export type ImageCompositionSize = { readonly width: number; readonly height: number };
export type ImageCompositionFit = "contain" | "cover";
export type ImageNormalizedRect = ImageCompositionSize & { readonly x: number; readonly y: number };
export type ImageWorkbenchSplitLayout = ImageCompositionGrid & { readonly confirmed: true } & (
  | { readonly kind: "grid"; readonly region: ImageNormalizedRect }
  | { readonly kind: "rectangles"; readonly rectangles: readonly { readonly cellId: string; readonly rect: ImageNormalizedRect }[] }
);
export type ImageCompositionResult = ImageCompositionSize & { blob: Blob };

export const imageCompositionLimits = Object.freeze({ side: 8192, pixels: 16_777_216 });
const maxSourcePixels = 32_000_000;
const maxSourceBytes = 100 * 1024 * 1024;
const previewMaxSide = 512;
type PixelRect = ImageCompositionSize & { readonly x: number; readonly y: number };
type DecodedImage = ImageCompositionSize & { drawable: CanvasImageSource; close(): void };
type LocalImageOperation = {
  check(): void;
  progress?(completed: number, total: number): void;
};

function checkGrid({ rows, columns }: ImageCompositionGrid) {
  if (![rows, columns].every(value => Number.isSafeInteger(value) && value > 0) || rows * columns > 100) {
    throw new Error("图片行列数无效，最多处理 100 格");
  }
}

function checkRect(rect: ImageNormalizedRect) {
  if (!rect || typeof rect !== "object") throw new Error("缺少裁剪区域");
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || x >= 1 || y >= 1 || width <= 0 || height <= 0
    || x + width > 1 + Number.EPSILON || y + height > 1 + Number.EPSILON) throw new Error("裁剪区域必须在原图范围内，且宽高大于 0");
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

export function getWorkbenchCropRectangles(
  layout: ImageWorkbenchSplitLayout,
  cellIds: readonly string[],
  requiresIndividualCrops: boolean,
): ImageNormalizedRect[] {
  checkGrid(layout);
  const { rows, columns } = layout;
  if (layout.confirmed !== true || !cellIds.length || cellIds.length > 100 || rows * columns < cellIds.length) throw new Error("请确认与模板格位数量一致的裁剪布局");
  if (layout.kind === "rectangles") {
    const byCell = new Map(layout.rectangles.map(({ cellId, rect }) => [cellId, rect]));
    if (layout.rectangles.length !== cellIds.length || byCell.size !== cellIds.length || cellIds.some(id => !byCell.has(id))) {
      throw new Error("请为每个模板格位确认一个裁剪区域");
    }
    return cellIds.map(id => checkRect(byCell.get(id)!));
  }
  if (layout.kind !== "grid" || requiresIndividualCrops) throw new Error("此布局需要逐格确认裁剪区域");
  const { x, y, width, height } = checkRect(layout.region);
  return cellIds.map((_id, index) => ({
    x: x + (index % columns) * width / columns,
    y: y + Math.floor(index / columns) * height / rows,
    width: width / columns,
    height: height / rows,
  }));
}

function readImageHeader(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  const size = view.byteLength;
  const ascii = (offset: number, value: string) =>
    offset + value.length <= size && [...value].every((char, index) => view.getUint8(offset + index) === char.charCodeAt(0));
  if (size >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && ascii(12, "IHDR")) {
    return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (size >= 10 && (ascii(0, "GIF87a") || ascii(0, "GIF89a"))) {
    return { mimeType: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (size >= 4 && view.getUint16(0) === 0xffd8) {
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 3 < size && view.getUint8(offset++) === 0xff) {
      while (offset < size && view.getUint8(offset) === 0xff) offset++;
      if (offset + 3 > size) break;
      const marker = view.getUint8(offset++);
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > size) break;
      if (length >= 7 && frameMarkers.has(marker)) {
        return { mimeType: "image/jpeg", width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  if (size >= 20 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    const format = "image/webp";
    const uint24 = (offset: number) => view.getUint16(offset, true) + view.getUint8(offset + 2) * 65536;
    const length = view.getUint32(16, true);
    if (length <= size - 20) {
      if (length >= 10 && ascii(12, "VP8X")) return { mimeType: format, width: uint24(24) + 1, height: uint24(27) + 1 };
      if (length >= 5 && ascii(12, "VP8L") && view.getUint8(20) === 0x2f) {
        const bits = view.getUint32(21, true);
        return { mimeType: format, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (length >= 10 && ascii(12, "VP8 ") && view.getUint8(23) === 0x9d && view.getUint16(24, true) === 0x2a01) {
        return { mimeType: format, width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
    }
  }
  throw new Error("图片格式无法识别，请使用 PNG、JPEG、WebP 或 GIF");
}

function checkSourceDimensions({ width, height }: ImageCompositionSize) {
  if (width < 1 || height < 1 || width > imageCompositionLimits.side || height > imageCompositionLimits.side || width * height > maxSourcePixels) {
    throw new Error("输入图片超出本地处理尺寸上限（单边 8192 像素，总计 3200 万像素）");
  }
}

function mayHaveImageOrientation(bytes: ArrayBuffer, mimeType: string) {
  const view = new DataView(bytes);
  // WebP carries EXIF in the extended container. PNG carries it in an eXIf chunk.
  if (mimeType === "image/webp") return view.getUint32(12) === 0x56503858 && (view.getUint8(20) & 0x08) !== 0;
  if (mimeType === "image/png") {
    for (let offset = 8; offset + 12 <= view.byteLength; offset += view.getUint32(offset) + 12) {
      const type = view.getUint32(offset + 4);
      if (type === 0x65584966) return true;
      if (type === 0x49454e44) break;
    }
  }
  return false;
}

async function decodeImage(
  load: () => Promise<ArrayBuffer>,
  check: () => void,
  target?: ImageCompositionSize & { fit: ImageCompositionFit; preserveOrientation?: boolean },
): Promise<DecodedImage> {
  check();
  const bytes = await load();
  check();
  if (!bytes.byteLength || bytes.byteLength > maxSourceBytes) throw new Error("输入图片为空或超过 100 MiB");
  const header = readImageHeader(bytes);
  checkSourceDimensions(header);
  const blob = new Blob([bytes], { type: header.mimeType });
  if (typeof createImageBitmap === "function") {
    const options: ImageBitmapOptions = { resizeQuality: "high" };
    // Decode at native dimensions when orientation can swap the target axes.
    if (target && header.mimeType !== "image/jpeg" && !(target.preserveOrientation && mayHaveImageOrientation(bytes, header.mimeType))) {
      const scale = (target.fit === "cover" ? Math.max : Math.min)(target.width / header.width, target.height / header.height);
      if (scale < 1) {
        if (header.width >= header.height) options.resizeWidth = Math.ceil(header.width * scale);
        else options.resizeHeight = Math.ceil(header.height * scale);
      }
    }
    const bitmap = await createImageBitmap(blob, options).catch(() => undefined);
    if (bitmap) {
      try {
        check();
        checkSourceDimensions(bitmap);
        return { drawable: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      } catch (error) {
        bitmap.close();
        throw error;
      }
    }
  }
  check();
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const close = () => {
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
  };
  try {
    image.src = url;
    await image.decode();
    check();
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    checkSourceDimensions(size);
    return { ...size, drawable: image, close };
  } catch (error) {
    close();
    throw error;
  }
}

function createPictureCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function encodePicture(canvas: HTMLCanvasElement, check: () => void): Promise<ImageCompositionResult> {
  check();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value?.size ? resolve(value) : reject(new Error("无法编码 PNG 图片")), "image/png");
  });
  check();
  return { blob, width: canvas.width, height: canvas.height };
}

export async function createWorkbenchPreview(load: () => Promise<ArrayBuffer>, check: () => void): Promise<Blob> {
  const canvas = createPictureCanvas(1, 1);
  try {
    const image = await decodeImage(load, check, { width: previewMaxSide, height: previewMaxSide, fit: "contain", preserveOrientation: true });
    try {
      check();
      const scale = Math.min(1, previewMaxSide / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建预览画布");
      context.imageSmoothingQuality = "high";
      context.drawImage(image.drawable, 0, 0, canvas.width, canvas.height);
    } finally { image.close(); }
    return (await encodePicture(canvas, check)).blob;
  } finally { canvas.width = canvas.height = 0; }
}

export async function composeWorkbenchImages(
  grid: ImageCompositionGrid,
  size: ImageCompositionSize,
  fit: ImageCompositionFit,
  tiles: readonly { label: string; load(): Promise<ArrayBuffer> }[],
  { check, progress }: LocalImageOperation,
) {
  checkGrid(grid);
  const { columns, rows } = grid;
  const { width, height } = size;
  if (!tiles.length || tiles.length > 100 || tiles.length > columns * rows || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < columns || height < rows
    || width > imageCompositionLimits.side || height > imageCompositionLimits.side || width * height > imageCompositionLimits.pixels
    || (fit !== "contain" && fit !== "cover")) throw new Error("拼版布局或尺寸无效，单边最多 8192 像素，总计最多 16777216 像素");
  check();
  const canvas = createPictureCanvas(width, height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建拼版画布");
    context.imageSmoothingQuality = "high";
    for (const [index, { label, load }] of tiles.entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = Math.floor(column * width / columns);
      const top = Math.floor(row * height / rows);
      const tileWidth = Math.floor((column + 1) * width / columns) - left;
      const tileHeight = Math.floor((row + 1) * height / rows) - top;
      const target = { width: tileWidth, height: tileHeight, fit };
      try {
        const image = await decodeImage(load, check, target);
        try {
          check();
          const scale = (fit === "cover" ? Math.max : Math.min)(tileWidth / image.width, tileHeight / image.height);
          const drawnWidth = image.width * scale;
          const drawnHeight = image.height * scale;
          context.save();
          try {
            context.beginPath();
            context.rect(left, top, tileWidth, tileHeight);
            context.clip();
            context.drawImage(image.drawable, left + (tileWidth - drawnWidth) / 2, top + (tileHeight - drawnHeight) / 2, drawnWidth, drawnHeight);
          } finally { context.restore(); }
        } finally { image.close(); }
      } catch (error) {
        check();
        throw new Error(label + "拼版失败：" + (error instanceof Error ? error.message : String(error)), { cause: error });
      }
      progress?.(index + 1, tiles.length);
    }
    return await encodePicture(canvas, check);
  } finally { canvas.width = canvas.height = 0; }
}

function getPixelRectangles(source: ImageCompositionSize, rects: readonly ImageNormalizedRect[], labels: readonly string[]) {
  const pixels: PixelRect[] = [];
  // Use the same integer boundaries for adjacent rectangles, including when the image size is indivisible.
  rects.forEach(({ x, y, width, height }, index) => {
    const toPixel = (fraction: number, side: number) => Math.floor(Math.min(1, fraction) * side + 1e-8);
    const left = toPixel(x, source.width);
    const top = toPixel(y, source.height);
    const right = toPixel(x + width, source.width);
    const bottom = toPixel(y + height, source.height);
    if (right <= left || bottom <= top) throw new Error(labels[index] + "的裁剪区域不足一个像素");
    if (pixels.some(other => other.x < right && other.x + other.width > left && other.y < bottom && other.y + other.height > top)) {
      throw new Error(labels[index] + "的裁剪区域与其他格位重叠");
    }
    pixels.push({ x: left, y: top, width: right - left, height: bottom - top });
  });
  return pixels;
}

export async function splitWorkbenchImage(
  load: () => Promise<ArrayBuffer>,
  rects: readonly ImageNormalizedRect[],
  labels: readonly string[],
  consume: (image: ImageCompositionResult, index: number) => Promise<void>,
  { check, progress }: LocalImageOperation,
) {
  if (!rects.length || rects.length > 100 || rects.length !== labels.length) throw new Error("拆图裁剪区域数量无效");
  let image: DecodedImage;
  try { image = await decodeImage(load, check); }
  catch (error) {
    check();
    throw new Error("整张图片无法读取：" + (error instanceof Error ? error.message : String(error)), { cause: error });
  }
  try {
    const pixels = getPixelRectangles(image, rects, labels);
    for (const [index, crop] of pixels.entries()) {
      check();
      const scale = Math.min(1, Math.sqrt(imageCompositionLimits.pixels / (crop.width * crop.height)));
      const canvas = createPictureCanvas(Math.max(1, Math.floor(crop.width * scale)), Math.max(1, Math.floor(crop.height * scale)));
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建拆图画布");
        context.imageSmoothingQuality = "high";
        context.drawImage(image.drawable, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
        const picture = await encodePicture(canvas, check);
        await consume(picture, index);
        check();
      } catch (error) {
        check();
        throw new Error(labels[index] + "拆图失败：" + (error instanceof Error ? error.message : String(error)), { cause: error });
      } finally { canvas.width = canvas.height = 0; }
      progress?.(index + 1, rects.length);
    }
  } finally { image.close(); }
}
