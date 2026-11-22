import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lumDesktop', {
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
