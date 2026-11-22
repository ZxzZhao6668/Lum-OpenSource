import { app, BrowserWindow, dialog, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const documents = new Map<string, string>();
let printSession: Session | undefined;

function isolatedPrintSession() {
  if (printSession) return printSession;
  const isolated = session.fromPartition('lum-writing-pdf', { cache: false });
  isolated.protocol.handle('lum-print', request => {
    const html = documents.get(request.url);
    if (!html) return new Response(null, { status: 404 });
    return new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    } });
  });
  printSession = isolated;
  return isolated;
}

export async function saveWritingPdf(owner: BrowserWindow, html: unknown, name: unknown): Promise<boolean> {
  if (typeof html !== 'string' || !html || typeof name !== 'string') throw Error('PDF 导出内容无效');
  const stem = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100).trim() || '写作项目';
  const target = await dialog.showSaveDialog(owner, {
    title: '保存 PDF', defaultPath: join(app.getPath('documents'), stem + '.pdf'),
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });
  if (target.canceled || !target.filePath) return false;
  const print = new BrowserWindow({
    show: false, parent: owner, webPreferences: {
      session: isolatedPrintSession(), sandbox: true, contextIsolation: true, nodeIntegration: false,
      javascript: false, devTools: false, disableDialogs: true,
    },
  });
  const url = 'lum-print://document/' + randomUUID();
  print.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  print.webContents.on('will-navigate', event => event.preventDefault());
  documents.set(url, html);
  try {
    await print.loadURL(url);
    const pdf = await print.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    const tempPath = join(dirname(target.filePath), '.lum-' + randomUUID() + '.tmp');
    try {
      await writeFile(tempPath, pdf, { flag: 'wx' });
      await rename(tempPath, target.filePath);
    } finally { await rm(tempPath, { force: true }); }
    return true;
  } finally {
    documents.delete(url);
    if (!print.isDestroyed()) print.destroy();
  }
}
