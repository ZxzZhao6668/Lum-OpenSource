import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { saveWritingPdf } from './writingPdf';
import { createInstallerUpdate } from './installerUpdate';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve, join, dirname, extname, relative, sep } from 'node:path';

const hostOrigin = 'http://127.0.0.1:6178';
const canvasOrigin = 'http://127.0.0.1:6181';
const allowedOrigins = new Set([hostOrigin, canvasOrigin]);
const sessionToken = randomBytes(32).toString('hex');
const dataRoot = process.env.LUM_USER_DATA_DIR ? resolve(process.env.LUM_USER_DATA_DIR) : join(app.getPath('appData'), 'Lum');
app.setPath('userData', dataRoot);
app.setName('影纪Lum');
app.setAppUserModelId('cn.lum.yingji');
let mainWindow: BrowserWindow | undefined;
let splashWindow: BrowserWindow | undefined;
let service: ChildProcess | undefined;
let writingServer: Server | undefined;
let quitting = false;
let closing = false;
let ready = false;
let shellReady = false;
let quitRequested = false;
const installerUpdate = createInstallerUpdate(app.getVersion(), join(dataRoot, 'updates'));
let installInProgress = false;
let installerToLaunch: { path: string; sha256: string } | undefined;
let pendingInstallSave: { id: string; finish: (error?: string) => void } | undefined;
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'payload') : join(app.getAppPath(), 'payload');
const assetsRoot = join(app.getAppPath(), 'assets');
const writingRoot = join(app.getAppPath(), 'out', 'writing');
const logFile = join(dataRoot, 'logs', 'desktop.log');
function log(message: string) {
  try { mkdirSync(join(dataRoot, 'logs'), { recursive: true }); appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`); } catch { /* The app can still show startup errors. */ }
}
function allowed(url: string) { try { return allowedOrigins.has(new URL(url).origin); } catch { return false; } }
function isShellUrl(url: string) {
  try { const target = new URL(url); return target.origin === hostOrigin && ['/', '/index.html'].includes(target.pathname); } catch { return false; }
}
function openInShell(url: string) {
  if (isShellUrl(url)) { void mainWindow?.loadURL(url); return; }
  try {
    if (new URL(url).origin === canvasOrigin) {
      const destination = new URL('/?view=canvas', hostOrigin);
      const project = new URL(mainWindow?.webContents.getURL() || hostOrigin).searchParams.get('project');
      if (project) destination.searchParams.set('project', project);
      void mainWindow?.loadURL(destination.href);
    } else if (!allowed(url)) openExternal(url);
  } catch { /* Local resource links must not replace the desktop shell. */ }
}
function trustedShell(event: IpcMainEvent | IpcMainInvokeEvent) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame && event.senderFrame?.url.startsWith(`${hostOrigin}/`));
}
function sendWindowState() {
  if (shellReady && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lum:windowState', { maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen() });
}
function toggleMaximize() {
  if (!mainWindow || mainWindow.isFullScreen()) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
}
function openExternal(url: string) {
  try { if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch { /* Ignore invalid external targets. */ }
}

function saveBeforeInstall(win: BrowserWindow) {
  return new Promise<void>((resolveSave, reject) => {
    const id = randomBytes(16).toString('hex');
    const finish = (error?: string) => {
      clearTimeout(timer);
      pendingInstallSave = undefined;
      if (error) reject(Error(error)); else resolveSave();
    };
    const timer = setTimeout(() => finish('等待项目保存超时，已取消安装'), 125000);
    pendingInstallSave = { id, finish };
    try { win.webContents.send('lum:prepareInstall', id); }
    catch { finish('无法联系编辑窗口，已取消安装'); }
  });
}

async function requestInstallerRestart(win: BrowserWindow) {
  if (installInProgress || quitting || quitRequested) throw Error('窗口正在退出或准备安装');
  if (!app.isPackaged || process.platform !== 'win32') throw Error('请在已安装的 Windows 版 Lum 中重启安装');
  if (installerUpdate.read().status !== 'ready') throw Error('请先完成安装包下载和校验');
  installInProgress = true;
  const frame = win.webContents.mainFrame;
  const confirmWindow = () => {
    if (win.isDestroyed() || !shellReady || frame.detached || frame !== win.webContents.mainFrame) {
      throw Error('编辑窗口已改变，已取消安装');
    }
  };
  try {
    const choice = await dialog.showMessageBox(win, {
      type: 'question', title: '重启安装 Lum', message: '保存当前项目并重启安装更新？',
      detail: '退出会中断正在生成或渲染的任务。也可以等任务完成后再安装。',
      buttons: ['稍后安装', '保存并重启安装'], defaultId: 0, cancelId: 0,
    });
    if (choice.response !== 1) return;
    confirmWindow();
    await saveBeforeInstall(win);
    const installer = await installerUpdate.verifiedInstaller();
    confirmWindow();
    installerToLaunch = installer;
    quitting = true;
    win.close();
  } finally {
    if (!installerToLaunch && !win.isDestroyed()) win.webContents.send('lum:releaseInstall');
    installInProgress = false;
  }
}

function launchInstaller(installer: { path: string; sha256: string }) {
  // Run outside the installation directory so Windows can replace every file there.
  const helper = join(dirname(installer.path), 'Lum-Install-' + randomBytes(12).toString('hex') + '.exe');
  writeFileSync(helper, readFileSync(join(app.getAppPath(), 'out/installUpdate.exe')), { flag: 'wx' });
  const child = spawn(helper, [String(process.pid), installer.path, installer.sha256, process.execPath], {
    cwd: dirname(installer.path), detached: true, windowsHide: true, stdio: 'pipe',
  });
  return new Promise<void>((resolveLaunch, reject) => {
    const timer = setTimeout(() => { child.stdin.end(); reject(Error('安装程序交接超时')); }, 120000);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    let output = '', detail = '';
    child.stderr.on('data', data => { detail = (detail + data).slice(-800); });
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.once('close', () => fail(Error(detail.trim() || '安装程序未就绪')));
    child.stdout.on('data', data => {
      output = (output + data).slice(-128);
      if (!output.includes('LUM_INSTALLER_READY\n') && !output.includes('LUM_INSTALLER_READY\r\n')) return;
      child.stdout.removeAllListeners('data');
      child.stdin.end('install\n', () => { clearTimeout(timer); child.unref(); resolveLaunch(); });
    });
  });
}

function serveWriting() {
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.mjs': 'application/javascript' };
  writingServer = createServer((request, response) => {
    response.on('finish', () => { if (response.statusCode >= 400 || request.url?.startsWith('/?')) log(`Writing response ${response.statusCode} ${request.method} ${new URL(request.url || '/', hostOrigin).pathname}`); });
    if (request.headers.host !== '127.0.0.1:6178' || request.headers['x-lum-session'] !== sessionToken) { response.writeHead(403).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(405).end(); return; }
    let path: string;
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', hostOrigin).pathname);
      path = resolve(writingRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      const offset = relative(writingRoot, path);
      if (offset.startsWith('..') || offset.includes(`..${sep}`)) throw new Error('Path outside application');
      if (!statSync(path).isFile()) throw new Error('Missing file');
    } catch { response.writeHead(404).end(); return; }
    const size = statSync(path).size;
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (range && (start > end || start >= size)) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    response.writeHead(range ? 206 : 200, {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
      'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(path, { start, end });
    stream.on('error', error => { log(`Resource read failed ${path}: ${String(error)}`); response.destroy(); });
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
  return new Promise<void>((resolveReady, reject) => {
    writingServer!.once('error', reject);
    writingServer!.listen(6178, '127.0.0.1', resolveReady);
  });
}

function startService() {
  return new Promise<void>((resolveReady, reject) => {
    const executable = join(runtimeRoot, 'lumService.exe');
    if (!existsSync(executable)) { reject(new Error('本地服务组件缺失，请重新安装 Lum。')); return; }
    const bunPath = join(runtimeRoot, 'bun.exe');
    service = spawn(executable, [], {
      cwd: runtimeRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production', LUM_RESOURCE_ROOT: runtimeRoot,
        LUM_SESSION_TOKEN: sessionToken, LUM_PARENT_PID: String(process.pid),
        LUM_DATA_DIR: join(dataRoot, 'data'), LUM_LOCAL_RUNTIME: '1',
        LUM_WORKER_ROOT: runtimeRoot, LUM_BUN_PATH: bunPath,
        // Previously installed runtime components still read these environment names.
        TOONFLOW_DATA_DIR: join(dataRoot, 'data'), TOONFLOW_LOCAL_RUNTIME: '1',
        TOONFLOW_WORKER_ROOT: runtimeRoot, TOONFLOW_BUN_PATH: bunPath,
        LUM_BUILD_REVISION: readFileSync(join(runtimeRoot, 'revision.txt'), 'utf8').trim(),
        ...(existsSync(join(runtimeRoot, 'blender/blender.exe')) ? { BLENDER_PATH: join(runtimeRoot, 'blender/blender.exe') } : {}),
        PATH: `${join(runtimeRoot, 'mediaTools')}${sep === '\\' ? ';' : ':'}${process.env.PATH || ''}`,
      },
    });
    let settled = false;
    let lastOutput = '';
    const timer = setTimeout(() => finish(new Error('本地服务启动超时，请查看运行日志。')), 45000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolveReady();
    };
    service.stdout?.on('data', data => {
      const text = String(data); lastOutput = (lastOutput + text).slice(-4000); log(text);
      if (lastOutput.includes('LUM_READY')) finish();
    });
    service.stderr?.on('data', data => { lastOutput = (lastOutput + String(data)).slice(-4000); log(String(data)); });
    service.once('error', error => finish(error));
    service.once('exit', code => {
      if (!settled) finish(new Error(`本地服务启动失败（${code}）。${/EADDRINUSE/.test(lastOutput) ? '端口 6181 已被占用，请关闭其他 Lum 实例后重试。' : '详细原因已记录到运行日志。'}`));
      else if (!quitting && ready) { void dialog.showMessageBox(mainWindow!, { type: 'error', title: 'Lum 本地服务已停止', message: '请退出后重新打开 Lum。你的已保存数据仍在本机。', detail: logFile }).then(() => mainWindow?.close()); }
    });
  });
}

async function closeApplication() {
  if (closing) return;
  closing = true; quitting = true;
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  writingServer?.close();
  writingServer?.closeAllConnections();
  if (service?.pid && service.exitCode === null && service.signalCode === null) {
    const child = service;
    await new Promise<void>(resolveClosed => {
      const deadline = setTimeout(resolveClosed, 15000);
      const timer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid && child.exitCode === null && child.signalCode === null) {
          const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          cleanup.once('error', error => { log('Service cleanup failed: ' + error.message); child.kill(); });
        } else if (child.exitCode === null && child.signalCode === null) child.kill();
      }, 4500);
      child.once('exit', () => { clearTimeout(timer); clearTimeout(deadline); resolveClosed(); });
      child.stdin?.on('error', () => { /* Child may already be exiting. */ });
      child.stdin?.end('quit\n');
    });
  }
  if (installerToLaunch) {
    if (service?.pid && service.exitCode === null && service.signalCode === null) {
      await dialog.showMessageBox({ type: 'warning', title: '本次安装已取消',
        message: '本地服务尚未退出。请稍后重新打开 Lum，再到「关于」中安装已下载的更新。' });
      app.exit(1);
      return;
    }
    try { await launchInstaller(installerToLaunch); }
    catch (error) {
      log('Installer launch failed: ' + String(error));
      await dialog.showMessageBox({ type: 'error', title: '无法启动安装程序',
        message: '将重新打开 Lum。已下载的安装包会保留，可在「关于」中重试。',
        detail: error instanceof Error ? error.message : String(error), buttons: ['重新打开 Lum'] });
      app.relaunch();
    }
  }
  app.exit(0);
}

async function start() {
  ipcMain.handle('lum:installerUpdate', async (event, action: unknown) => {
    if (!trustedShell(event) || !mainWindow || !isShellUrl(event.senderFrame?.url || '')) throw Error('此窗口无法更新桌面客户端');
    if (action === 'read') return installerUpdate.read();
    if (installInProgress || installerToLaunch || quitting) throw Error('正在准备重启安装');
    if (action === 'check') return installerUpdate.check();
    if (action === 'download') return installerUpdate.download();
    if (action !== 'install') throw Error('未知更新操作');
    await requestInstallerRestart(mainWindow);
    return installerUpdate.read();
  });
  ipcMain.on('lum:installerSaved', (event, id: unknown, error: unknown) => {
    if (!trustedShell(event) || !pendingInstallSave || pendingInstallSave.id !== id) return;
    pendingInstallSave.finish(error === null ? undefined : String(error || '项目保存失败').slice(0, 600));
  });
  ipcMain.handle('lum:saveWritingPdf', (event, html: unknown, name: unknown) => {
    if (!trustedShell(event) || !mainWindow) throw Error('无法从此窗口导出 PDF');
    return saveWritingPdf(mainWindow, html, name);
  });
  ipcMain.on('lum:desktopReady', event => {
    if (!trustedShell(event)) return;
    shellReady = true;
    sendWindowState();
    if (quitRequested) mainWindow?.webContents.send('lum:quitRequest', 'confirm');
  });
  ipcMain.on('lum:windowAction', (event, action: unknown) => {
    if (!trustedShell(event) || !mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') toggleMaximize();
    else if (action === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen());
    else if (action === 'close') mainWindow.close();
  });
  ipcMain.on('lum:quitResponse', (event, choice: unknown) => {
    if (!trustedShell(event) || !quitRequested || !['cancel', 'confirm'].includes(String(choice))) return;
    quitRequested = false;
    if (choice === 'confirm') { quitting = true; mainWindow?.close(); }
  });
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${hostOrigin}/*`, `${canvasOrigin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'x-lum-session': sessionToken } });
  });
  if (process.env.LUM_DEBUG_STARTUP === '1') session.defaultSession.webRequest.onCompleted({ urls: [`${hostOrigin}/*`] }, details => log(`Resource ${details.statusCode} ${new URL(details.url).pathname} cache=${details.fromCache}`));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(allowed(contents.getURL()) && ['clipboard-sanitized-write', 'media', 'notifications', 'fullscreen'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => Boolean(contents && allowed(origin) && ['clipboard-read', 'clipboard-sanitized-write', 'media', 'notifications', 'fullscreen'].includes(permission)));
  mainWindow = new BrowserWindow({
    width: 1480, height: 960, minWidth: 900, minHeight: 640, title: 'Lum · 影纪',
    icon: join(assetsRoot, 'lum.ico'), backgroundColor: '#181818', autoHideMenuBar: true, show: false, frame: false,
    webPreferences: { preload: join(app.getAppPath(), 'out', 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, webSecurity: true },
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => log(`Page load failed ${code} ${description} ${url.split('?')[0]}`));
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    pendingInstallSave?.finish('编辑窗口已停止，已取消安装');
    shellReady = false; quitRequested = false;
    log(`Renderer stopped ${details.reason} ${details.exitCode}`);
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) void dialog.showMessageBox(mainWindow, { type: 'error', title: 'Lum 界面已停止', message: '界面意外停止，已保存的数据仍保留。请退出后重新打开 Lum。', buttons: ['退出 Lum'] }).then(() => { quitting = true; mainWindow?.close(); });
  });
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.on('restore', sendWindowState);
  mainWindow.webContents.on('console-message', (_event, level, message) => { if (level >= 3) log(`Page error: ${message.slice(0, 1600)}`); });
  mainWindow.webContents.on('did-finish-load', () => log(`Page loaded ${mainWindow?.webContents.getURL().split('?')[0]}`));
  mainWindow.webContents.on('did-navigate', () => {
    shellReady = false; quitRequested = false;
    pendingInstallSave?.finish('编辑窗口已切换，已取消安装');
  });
  mainWindow.webContents.on('will-prevent-unload', () => {
    if (installerToLaunch) {
      installerToLaunch = undefined;
      mainWindow?.webContents.send('lum:releaseInstall');
    }
    quitting = false;
    if (shellReady) { quitRequested = true; mainWindow?.webContents.send('lum:quitRequest', 'unsaved'); }
    else void dialog.showMessageBox(mainWindow!, { type: 'warning', title: '尚有内容未保存', message: '已保留当前窗口，请等待保存完成，或先导出备份后再退出。' });
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!isShellUrl(url)) { event.preventDefault(); openInShell(url); } });
  mainWindow.webContents.on('will-frame-navigate', event => { if (event.isMainFrame ? !isShellUrl(event.url) : !allowed(event.url) && event.url !== 'about:blank') event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openInShell(url); return { action: 'deny' }; });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || input.control && input.shift && ['I', 'J', 'C'].includes(input.key.toUpperCase())) event.preventDefault();
    if (input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'F11') { event.preventDefault(); mainWindow?.setFullScreen(!mainWindow.isFullScreen()); }
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow?.isFullScreen()) mainWindow.setFullScreen(false);
  });
  mainWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (installInProgress) return;
    if (!ready) { void closeApplication(); return; }
    if (quitRequested) return;
    quitRequested = true;
    if (shellReady) mainWindow?.webContents.send('lum:quitRequest', 'confirm');
    else void dialog.showMessageBox(mainWindow!, { type: 'question', title: '退出 Lum', message: '退出后正在生成或渲染的任务会停止。', buttons: ['继续创作', '退出'], defaultId: 0, cancelId: 0 }).then(result => { quitRequested = false; if (result.response === 1) { quitting = true; mainWindow?.close(); } });
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '返回主页', click: () => { if (ready) void mainWindow?.loadURL(hostOrigin); } }, { type: 'separator' }, { label: '退出', click: () => mainWindow?.close() }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
  ]));
  splashWindow = new BrowserWindow({
    width: 620, height: 440, center: true, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, skipTaskbar: true,
    focusable: false, hasShadow: false, alwaysOnTop: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, webSecurity: true },
  });
  splashWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splashWindow.webContents.on('will-navigate', event => event.preventDefault());
  splashWindow.on('closed', () => { splashWindow = undefined; });
  await splashWindow.loadFile(join(assetsRoot, 'splash.html'));
  splashWindow.showInactive();
  try {
    await Promise.all([serveWriting(), startService(), new Promise(resolveDelay => setTimeout(resolveDelay, 2200))]);
    if (quitting) return;
    await mainWindow.loadURL(`${hostOrigin}/?desktopStartup=1`);
    if (quitting) return;
    ready = true;
    mainWindow.show(); mainWindow.focus();
    splashWindow?.close();
    log('Lum desktop ready');
  } catch (error) {
    log(String(error));
    splashWindow?.close();
    if (!quitting) mainWindow?.show();
    if (!quitting) await dialog.showMessageBox(mainWindow, { type: 'error', title: 'Lum 启动失败', message: error instanceof Error ? error.message : String(error), detail: `日志位置：${logFile}` });
    void closeApplication();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow && ready) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } else splashWindow?.showInactive(); });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); mainWindow ? mainWindow.close() : void closeApplication(); } });
  app.on('window-all-closed', () => void closeApplication());
  void app.whenReady().then(start).catch(error => { log(String(error)); void dialog.showErrorBox('Lum 启动失败', String(error)); void closeApplication(); });
}
