import './desktopShell.css';
import type { InstallerUpdateAction, InstallerUpdateSnapshot } from './installerUpdateBridge';
import { prepareWorkspaceNavigation } from '../canvas/productionBridge';
import { flushWorkspaceEditors } from '../writing/workspaceFeedback';

declare global {
  interface Window {
    lumDesktop?: {
      installerUpdate?(action: InstallerUpdateAction): Promise<InstallerUpdateSnapshot>;
      onPrepareInstall?(prepare: () => Promise<void>, release: () => void): () => void;
      saveWritingPdf(html: string, name: string): Promise<boolean>;
      ready(): void;
      windowAction(action: 'minimize' | 'maximize' | 'fullscreen' | 'close'): void;
      onWindowState(callback: (state: { maximized: boolean; fullscreen: boolean }) => void): () => void;
      respondToQuit(choice: 'cancel' | 'confirm'): void;
      onQuitRequest(callback: (reason: 'confirm' | 'unsaved') => void): () => void;
    };
  }
}

export function installDesktopShell() {
  const bridge = window.lumDesktop;
  if (!bridge) return () => {};
  document.documentElement.dataset.lumDesktop = 'true';
  const titlebar = document.createElement('header');
  titlebar.className = 'lumDesktopTitlebar';
  const icon = (path: string) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const maximizeIcon = icon('<rect x="5" y="5" width="10" height="10" rx="1.5"/>');
  const restoreIcon = icon('<path d="M8 5V3.5h8.5V12H15"/><rect x="3.5" y="7" width="9.5" height="9.5" rx="1.5"/>');
  const fullscreenIcon = icon('<path d="M7 3.5H3.5V7M13 3.5h3.5V7M3.5 13v3.5H7M13 16.5h3.5V13"/>');
  const exitFullscreenIcon = icon('<path d="M3.5 7H7V3.5M16.5 7H13V3.5M7 16.5V13H3.5M13 16.5V13h3.5"/>');
  titlebar.innerHTML = `<div class="lumDesktopWindowBrand"><img src="/brand/lumLogo.png" alt="" draggable="false"><span></span></div>
    <div class="lumDesktopWindowActions" role="group" aria-label="窗口控制">
    <button type="button" data-window-action="minimize" aria-label="最小化" title="最小化">${icon('<path d="M5 10h10"/>')}</button>
    <button type="button" data-window-action="maximize" aria-label="最大化" title="最大化">${maximizeIcon}</button>
    <button type="button" data-window-action="fullscreen" aria-label="全屏" title="全屏（F11）">${fullscreenIcon}</button>
    <button type="button" data-window-action="close" aria-label="关闭窗口" title="关闭窗口">${icon('<path d="m5.5 5.5 9 9m0-9-9 9"/>')}</button></div>`;
  const windowTitle = titlebar.querySelector<HTMLSpanElement>('.lumDesktopWindowBrand span')!;
  const updateTitle = () => { windowTitle.textContent = document.title || 'Lum · 影纪'; };
  updateTitle();
  const titleObserver = new MutationObserver(updateTitle);
  titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  titlebar.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-window-action]');
    if (button && !button.disabled) bridge.windowAction(button.dataset.windowAction as 'minimize' | 'maximize' | 'fullscreen' | 'close');
  });
  const maximize = titlebar.querySelector<HTMLButtonElement>('[data-window-action="maximize"]')!;
  const fullscreen = titlebar.querySelector<HTMLButtonElement>('[data-window-action="fullscreen"]')!;
  const unsubscribeWindow = bridge.onWindowState(state => {
    maximize.disabled = state.fullscreen;
    maximize.innerHTML = state.maximized ? restoreIcon : maximizeIcon;
    maximize.title = state.fullscreen ? '请先退出全屏' : state.maximized ? '还原窗口' : '最大化';
    maximize.setAttribute('aria-label', maximize.title);
    fullscreen.innerHTML = state.fullscreen ? exitFullscreenIcon : fullscreenIcon;
    const label = state.fullscreen ? '退出全屏' : '全屏';
    fullscreen.title = `${label}（F11）`;
    fullscreen.setAttribute('aria-label', label);
    fullscreen.setAttribute('aria-pressed', String(state.fullscreen));
  });
  document.body.append(titlebar);
  const dialog = document.createElement('dialog');
  dialog.className = 'lumDesktopQuit';
  dialog.setAttribute('aria-labelledby', 'lumDesktopQuitTitle');
  dialog.setAttribute('aria-describedby', 'lumDesktopQuitDescription');
  dialog.innerHTML = `<div class="lumDesktopQuitBrand"><img src="/brand/lumLogo.png" alt="Lum 影纪" draggable="false"><span>Lum · 影纪</span></div>
    <h2 id="lumDesktopQuitTitle">结束这次创作？</h2>
    <p id="lumDesktopQuitDescription">退出后，正在生成或渲染的任务会停止。</p>
    <div class="lumDesktopQuitActions"><button type="button" data-action="cancel" autofocus>继续创作</button><button type="button" data-action="confirm">退出 Lum <span aria-hidden="true">↗</span></button></div>`;
  const title = dialog.querySelector('h2')!;
  const description = dialog.querySelector('p')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;
  let previousFocus: HTMLElement | undefined;
  const respond = (choice: 'cancel' | 'confirm') => {
    dialog.close();
    bridge.respondToQuit(choice);
    if (choice === 'cancel' && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  cancel.addEventListener('click', () => respond('cancel'));
  confirm.addEventListener('click', () => respond('confirm'));
  dialog.addEventListener('cancel', event => { event.preventDefault(); respond('cancel'); });
  document.body.append(dialog);
  let releaseEditing: (() => void) | undefined;
  const unsubscribeInstall = bridge.onPrepareInstall?.(async () => {
    const root = document.getElementById('root');
    if (!root || releaseEditing) throw Error('工作区正在切换，请稍后再试');
    const previousInert = root.inert;
    root.inert = true;
    releaseEditing = () => { root.inert = previousInert; releaseEditing = undefined; };
    const frame = root.querySelector('iframe[data-production-frame]');
    if (frame && frame.closest('[data-connection]')?.getAttribute('data-connection') !== 'ready') {
      throw Error('画布连接尚未就绪，无法确认已保存。请重新连接后安装');
    }
    await flushWorkspaceEditors();
    if (frame) await prepareWorkspaceNavigation('leave', true);
  }, () => releaseEditing?.());
  const unsubscribe = bridge.onQuitRequest(reason => {
    const unsaved = reason === 'unsaved';
    title.textContent = unsaved ? '还有内容未保存' : '结束这次创作？';
    description.textContent = unsaved ? '窗口已为你保留。请等待保存完成，或先导出备份后再退出。' : '退出后，正在生成或渲染的任务会停止。';
    cancel.textContent = unsaved ? '返回编辑' : '继续创作';
    confirm.hidden = unsaved;
    if (!dialog.open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      dialog.showModal();
    }
    cancel.focus({ preventScroll: true });
  });
  bridge.ready();
  return () => {
    unsubscribe(); unsubscribeWindow(); unsubscribeInstall?.(); releaseEditing?.(); titleObserver.disconnect();
    titlebar.remove(); dialog.remove(); delete document.documentElement.dataset.lumDesktop;
  };
}
