import { blobDataUrl } from '../entities/entityImageUpload';
import { writingExportHtml, type WritingExport } from './writingExport';

const inlineImage = /^data:image\/(?:png|jpeg|webp|gif);base64,/i;

export async function saveDesktopWritingPdf(data: WritingExport, name: string): Promise<boolean> {
  const bridge = window.lumDesktop;
  if (!bridge?.saveWritingPdf) throw Error('未连接桌面 PDF 导出服务');
  // Blob URLs belong to this renderer. The isolated print window only receives embedded images.
  for (const section of data.sections) {
    for (const row of section.rows ?? []) {
      if (!row.image || inlineImage.test(row.image)) continue;
      try {
        if (!/^(blob:|https?:\/\/)/i.test(row.image)) throw Error('图片地址无效');
        const response = await fetch(row.image, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error('图片无法读取');
        const embedded = await blobDataUrl(await response.blob());
        if (!inlineImage.test(embedded)) throw Error('图片格式无效');
        row.image = embedded;
      } catch {
        data.warnings.push(section.title + ' 图片加载失败，导出中保留占位');
        row.image = '';
      }
    }
  }
  return bridge.saveWritingPdf(writingExportHtml(data), name);
}
