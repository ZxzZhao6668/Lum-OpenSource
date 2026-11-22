/** 底部轻提示，可关闭；「撤销」始终由用户单独触发。 */

const TOAST_ID = "dsh-toast";
let dismissCurrent: (() => void) | undefined;

export function showToast(message: string, opts?: { undo?: () => void | Promise<void> }) {
  dismissCurrent?.();
  document.getElementById(TOAST_ID)?.remove();
  const previousFocus = document.activeElement;
  // A body-level toast is inert underneath a native modal, regardless of z-index.
  const host = [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")].at(-1) ?? document.body;

  const box = document.createElement("div");
  box.id = TOAST_ID;
  box.className = "dsh-toast";

  const text = document.createElement("span");
  text.className = "dsh-toast-text";
  text.setAttribute("role", "status");
  text.setAttribute("aria-live", "polite");
  text.setAttribute("aria-atomic", "true");
  text.textContent = message;
  box.appendChild(text);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pointerInside = false;
  const pause = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const close = () => {
    const restoreFocus = box.contains(document.activeElement);
    pause();
    box.remove();
    host.removeEventListener("close", close);
    if (dismissCurrent === close) dismissCurrent = undefined;
    if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const schedule = () => {
    pause();
    if (box.isConnected && !pointerInside && !box.contains(document.activeElement)) timer = setTimeout(close, opts?.undo ? 6000 : 2600);
  };
  dismissCurrent = close;

  if (opts?.undo) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "dsh-toast-undo";
    undo.textContent = "撤销";
    undo.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      try { await opts.undo?.(); }
      catch (error) { showToast(`撤销失败：${error instanceof Error ? error.message : String(error)}`); }
    });
    box.appendChild(undo);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "dsh-toast-close";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", "关闭提示");
  dismiss.title = "关闭提示";
  dismiss.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); close(); });
  box.appendChild(dismiss);
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  box.addEventListener("pointerenter", () => { pointerInside = true; pause(); });
  box.addEventListener("pointerleave", () => { pointerInside = false; schedule(); });
  box.addEventListener("focusin", pause);
  box.addEventListener("focusout", () => queueMicrotask(schedule));
  if (typeof box.showPopover === "function") box.setAttribute("popover", "manual");
  host.appendChild(box);
  if (host !== document.body) host.addEventListener("close", close, { once: true });
  if (typeof box.showPopover === "function") box.showPopover();
  schedule();
}
