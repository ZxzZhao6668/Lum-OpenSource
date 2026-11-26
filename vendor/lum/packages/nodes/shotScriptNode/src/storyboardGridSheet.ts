import { frameTime, gridTransitionLabel, gridViewLabel, type GridFrame } from "./storyboardGrid";

export const gridSheetPageSize = 9;

const tileWidth = 560;
const imageHeight = 315;
const padding = 32;
const gap = 20;
const captionPadding = 20;
const metadataFont = '18px system-ui, "Microsoft YaHei", sans-serif';
const headerFont = '600 23px system-ui, "Microsoft YaHei", sans-serif';
const titleFont = '700 31px system-ui, "Microsoft YaHei", sans-serif';
const lineHeight = 28;
const pageHeaderHeight = 86;

function wrapText(context: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of text.trim().replace(/\s+/gu, " ")) {
    if (context.measureText(line + character).width > width && line) {
      if (lines.length === maxLines - 1) {
        const characters = Array.from(line.trimEnd());
        while (context.measureText(characters.join("") + "…").width > width && characters.length) characters.pop();
        lines.push(characters.join("") + "…");
        return lines;
      }
      lines.push(line.trimEnd());
      line = "";
    }
    if (line || character !== " ") line += character;
  }
  if (line) lines.push(line);
  return lines;
}

function frameCaption(context: CanvasRenderingContext2D, frame: GridFrame, index: number) {
  const width = tileWidth - captionPadding * 2;
  const fields = [
    { text: [gridViewLabel(frame.view), gridTransitionLabel(frame.transition), frame.shotSize].filter(Boolean).join("  ·  "), lines: 2 },
    { text: frame.camera && `机位  ${frame.camera}`, lines: 2 },
    { text: frame.movement && `运镜  ${frame.movement}`, lines: 2 },
    { text: frame.focalLength && `焦距  ${frame.focalLength}`, lines: 2 },
    { text: frame.aperture && `光圈  ${frame.aperture}`, lines: 2 },
    { text: frame.action && `画面  ${frame.action}`, lines: 5 },
  ];
  context.font = metadataFont;
  const details = fields.flatMap(field => wrapText(context, field.text, width, field.lines));
  return {
    title: `${String(index + 1).padStart(2, "0")}    ${frameTime(frame.from, frame.to)}  ·  时长 ${frame.duration} 秒`,
    details,
    height: captionPadding * 2 + (details.length + 1) * lineHeight,
  };
}

async function drawFrameImage(context: CanvasRenderingContext2D, blob: Blob, x: number, y: number) {
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(tileWidth / image.width, imageHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.fillStyle = "#242a28";
    context.fillRect(x, y, tileWidth, imageHeight);
    context.drawImage(image, x + (tileWidth - width) / 2, y + (imageHeight - height) / 2, width, height);
  } finally {
    image.close();
  }
}

export async function downloadGridSheets(
  title: string,
  frames: GridFrame[],
  readFrame: (key: string) => Promise<Blob | undefined>,
  page = 1,
): Promise<void> {
  const pages = Math.ceil(frames.length / gridSheetPageSize);
  if (!pages) throw new Error("没有可导出的分镜图");
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new Error("请重新选择要导出的分镜页");
  const offset = (page - 1) * gridSheetPageSize;
  const pageFrames = frames.slice(offset, offset + gridSheetPageSize);
  const columns = pageFrames.length === 4 ? 2 : Math.min(3, pageFrames.length);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建分镜图导出画布");

  const captions = pageFrames.map((frame, index) => frameCaption(context, frame, offset + index));
  const rowHeights: number[] = [];
  for (let index = 0; index < captions.length; index += columns) {
    rowHeights.push(imageHeight + Math.max(...captions.slice(index, index + columns).map(caption => caption.height)));
  }
  canvas.width = padding * 2 + columns * tileWidth + (columns - 1) * gap;
  canvas.height = padding * 2 + pageHeaderHeight + rowHeights.reduce((total, height) => total + height, 0) + (rowHeights.length - 1) * gap;
  context.fillStyle = "#eef2ee";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = "top";
  context.font = titleFont;
  context.fillStyle = "#243930";
  const sheetTitle = title.trim() || "分镜图";
  context.fillText(wrapText(context, sheetTitle, canvas.width - padding * 2, 1)[0] ?? "", padding, padding);
  context.font = metadataFont;
  context.fillText(`第 ${page} / ${pages} 页    ·    第 ${offset + 1}–${offset + pageFrames.length} 帧    ·    共 ${frames.length} 帧`, padding, padding + 43);
  context.imageSmoothingQuality = "high";

  const unreadable: number[] = [];
  let y = padding + pageHeaderHeight;
  for (const [row, rowHeight] of rowHeights.entries()) {
    const start = row * columns;
    const rowFrames = pageFrames.slice(start, start + columns);
    let x = (canvas.width - rowFrames.length * tileWidth - (rowFrames.length - 1) * gap) / 2;
    for (const [column, frame] of rowFrames.entries()) {
      try {
        const blob = await readFrame(frame.key);
        if (blob?.size) await drawFrameImage(context, blob, x, y);
        else unreadable.push(offset + start + column + 1);
      } catch {
        unreadable.push(offset + start + column + 1);
      }
      const caption = captions[start + column];
      context.fillStyle = "#ffffff";
      context.fillRect(x, y + imageHeight, tileWidth, rowHeight - imageHeight);
      context.font = headerFont;
      context.fillStyle = "#243930";
      const captionY = y + imageHeight + captionPadding;
      context.fillText(caption.title, x + captionPadding, captionY);
      context.font = metadataFont;
      context.fillStyle = "#33453c";
      for (const [index, line] of caption.details.entries()) {
        context.fillText(line, x + captionPadding, captionY + (index + 1) * lineHeight);
      }
      x += tileWidth + gap;
    }
    y += rowHeight + gap;
  }
  if (unreadable.length) {
    throw new Error(`本页有 ${unreadable.length} 张分镜图缺失或无法读取（第 ${unreadable.join("、")} 帧），请检查图片后再导出`);
  }

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法生成分镜图 PNG")), "image/png");
  });
  const filename = sheetTitle.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/gu, " ");
  const pageSuffix = pages > 1 ? `_第${String(page).padStart(String(pages).length, "0")}页` : "";
  const url = URL.createObjectURL(png);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${Array.from(filename).slice(0, 72).join("")}_分镜图${pageSuffix}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
