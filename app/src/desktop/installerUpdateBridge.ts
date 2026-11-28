import { canvasOrigin } from '../runtimeConfig';

export type InstallerUpdateAction = 'read' | 'check' | 'download' | 'install';
export type InstallerUpdateSnapshot = {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready';
  currentVersion: string;
  latestVersion: string;
  notes: string;
  received: number;
  total: number;
  error: string;
};

export function installInstallerUpdateBridge() {
  const update = window.lumDesktop?.installerUpdate;
  if (import.meta.env.VITE_LUM_DESKTOP !== '1' || window.parent !== window
    || location.origin !== 'http://127.0.0.1:6178' || canvasOrigin !== 'http://127.0.0.1:6181'
    || !update) return () => {};

  const receive = (event: MessageEvent) => {
    if (event.origin !== canvasOrigin || event.data?.type !== 'lum:installerUpdateRequest' || event.ports.length !== 1) return;
    const action: unknown = event.data.action;
    if (action !== 'read' && action !== 'check' && action !== 'download' && action !== 'install') return;
    const frame = document.querySelector<HTMLIFrameElement>('#root iframe[data-production-frame="true"]');
    if (!frame || !event.source || event.source !== frame.contentWindow) return;
    const source = new URL(frame.src);
    if (source.origin !== canvasOrigin || source.pathname !== '/' || source.hash !== '#/embeddedWorkspace') return;

    const port = event.ports[0];
    void Promise.resolve().then(() => update(action)).then(
      snapshot => port.postMessage({ snapshot }),
      error => {
        const message = error instanceof Error ? error.message : '';
        const detail = message.replace(/^Error invoking remote method 'lum:installerUpdate': (?:Error: )?/, '');
        port.postMessage({ error: detail || '桌面更新操作失败，请重试' });
      },
    ).finally(() => port.close());
  };

  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}
