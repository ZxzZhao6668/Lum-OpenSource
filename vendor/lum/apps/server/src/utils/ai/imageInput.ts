import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";
import { getRequestFiles } from "@/utils/ai/requestFiles";

export async function prepareImage(source: Buffer, mimeType: string, signal?: AbortSignal, maxBytes = Math.ceil(1024 * 1024 / 3) * 4) {
  signal?.throwIfAborted();
  const metadata = await new Bun.Image(source).metadata().catch(() => undefined);
  // Common formats use Bun's decoder, which is also available in the compiled desktop service.
  if (!metadata || !["jpeg", "png", "webp"].includes(metadata.format)) {
    return resizeImage(source, mimeType, { maxWidth: 2048, maxHeight: 2048, maxBytes });
  }
  let size = 2048;
  while (size >= 1) {
    const image = new Bun.Image(source).resize(size, size, { fit: "inside", withoutEnlargement: true });
    signal?.throwIfAborted();
    let bytes = await image.png().buffer();
    signal?.throwIfAborted();
    const width = image.width;
    const height = image.height;
    const dimensions = { originalWidth: metadata.width, originalHeight: metadata.height, width, height };
    // Decode before reusing original bytes so a valid header alone cannot pass.
    if (metadata.width <= 2048 && metadata.height <= 2048 && Math.ceil(source.length / 3) * 4 < maxBytes && mimeType === `image/${metadata.format}`) {
      return { ...dimensions, data: source.toString("base64"), mimeType, wasResized: false };
    }
    let outputMimeType = "image/png";
    for (const quality of [80, 70, 55, 40]) {
      if (Math.ceil(bytes.length / 3) * 4 < maxBytes) break;
      signal?.throwIfAborted();
      bytes = await image.jpeg({ quality }).buffer();
      outputMimeType = "image/jpeg";
    }
    if (Math.ceil(bytes.length / 3) * 4 < maxBytes) {
      return { ...dimensions, data: bytes.toString("base64"), mimeType: outputMimeType, wasResized: true };
    }
    if (size === 1) break;
    size = Math.max(1, Math.floor(size * .75));
  }
  return null;
}

export async function prepareRequestImages(payload: unknown, limits: { maxRequestImageBytes: number; maxRequestBytes: number }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const images = getRequestFiles(payload).filter(file => file.mimeType.toLowerCase().startsWith("image/"));
  if (!images.length) return;
  const imageBytes = images.reduce((sum, image) => sum + image.inlineBytes, 0);
  const otherBytes = Buffer.byteLength(JSON.stringify(payload), "utf8") - imageBytes;
  // ACT: Keep every attachment and its ordinal. Reserve room for MIME changes and dimension notes;
  // only the in-memory analysis copies are resized, never workspace originals or generation inputs.
  const budget = Math.min(limits.maxRequestImageBytes, limits.maxRequestBytes - otherBytes - images.length * 1024);
  const perImageBytes = Math.min(Math.ceil(1024 * 1024 / 3) * 4, Math.floor(budget / images.length));
  if (perImageBytes <= 0) throw new Error("模型请求中的文本或其他附件已占满请求体预算，请精简上下文或减少其他附件；原图未修改");
  for (const [index, image] of images.entries()) {
    signal?.throwIfAborted();
    try {
      const prepared = await prepareImage(Buffer.from(image.data, "base64"), image.mimeType, signal, perImageBytes);
      signal?.throwIfAborted();
      if (!prepared || Buffer.byteLength(prepared.data, "utf8") > perImageBytes) throw new Error("图片分析副本仍超出可用字节预算");
      image.replace(prepared, formatDimensionNote(prepared));
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(`第 ${index + 1} 张参考图片无法生成模型分析副本：${error instanceof Error ? error.message : "无法解码图片"}；原图未修改`);
    }
  }
}
