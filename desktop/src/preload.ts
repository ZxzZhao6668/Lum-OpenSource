import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lumDesktop', {
  installerUpdate: (action: string) => {
    if (!['read', 'check', 'download', 'install'].includes(action)) return Promise.reject(Error('未知更新操作'));
    return ipcRenderer.invoke('lum:installerUpdate', action);
  },
  onPrepareInstall: (prepare: () => Promise<void>, release: () => void) => {
    const save = async (_event: Electron.IpcRendererEvent, id: string) => {
      try {
        await prepare();
        ipcRenderer.send('lum:installerSaved', id, null);
      } catch (error) {
        ipcRenderer.send('lum:installerSaved', id, error instanceof Error ? error.message : String(error));
      }
    };
    const unlock = () => release();
    ipcRenderer.on('lum:prepareInstall', save);
    ipcRenderer.on('lum:releaseInstall', unlock);
    return () => {
      ipcRenderer.removeListener('lum:prepareInstall', save);
      ipcRenderer.removeListener('lum:releaseInstall', unlock);
    };
  },
  saveWritingPdf: (html: string, name: string): Promise<boolean> => ipcRenderer.invoke('lum:saveWritingPdf', html, name),
  ready: () => ipcRenderer.send('lum:desktopReady'),
  windowAction: (action: string) => {
    if (['minimize', 'maximize', 'fullscreen', 'close'].includes(action)) ipcRenderer.send('lum:windowAction', action);
  },
  onWindowState: (callback: (state: { maximized: boolean; fullscreen: boolean }) => void) => {
    const listener = (_event: unknown, state: { maximized?: unknown; fullscreen?: unknown } | null) => {
      if (typeof callback === 'function' && state && typeof state.maximized === 'boolean' && typeof state.fullscreen === 'boolean') callback({ maximized: state.maximized, fullscreen: state.fullscreen });
    };
    ipcRenderer.on('lum:windowState', listener);
    return () => ipcRenderer.removeListener('lum:windowState', listener);
  },
  respondToQuit: (choice: string) => {
    if (choice === 'cancel' || choice === 'confirm') ipcRenderer.send('lum:quitResponse', choice);
  },
  onQuitRequest: (callback: (reason: 'confirm' | 'unsaved') => void) => {
    const listener = (_event: unknown, reason: unknown) => {
      if (typeof callback === 'function' && (reason === 'confirm' || reason === 'unsaved')) callback(reason);
    };
    ipcRenderer.on('lum:quitRequest', listener);
    return () => ipcRenderer.removeListener('lum:quitRequest', listener);
  },
});
