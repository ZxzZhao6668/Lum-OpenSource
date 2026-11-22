import './localUi.css';
import { closeLumDialog } from '../appearance/lumMotion';
export const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const n = document.createElement(tag); n.textContent = text; n.className = cls; return n;
};
export function action(text: string, run: () => void | Promise<void>) {
  const b = node('button', text, 'localButton'); b.type = 'button';
  b.onclick = async e => { e.preventDefault(); e.stopPropagation(); b.disabled = true; try { await run(); } catch (error) { alert(error instanceof Error ? error.message : String(error)); } finally { b.disabled = false; } }; return b;
}
export function modal(title: string) {
  const d = node('dialog', '', 'localDialog'); d.setAttribute('aria-label', title);
  const head = node('header'); head.append(node('h2', title), action('关闭', () => closeLumDialog(d)));
  const body = node('div', '', 'localDialogBody'); d.append(head, body);
  d.addEventListener('cancel', event => { event.preventDefault(); closeLumDialog(d); });
  d.addEventListener('close', () => d.remove(), { once: true }); document.body.append(d); d.showModal(); return { dialog: d, body };
}
export function field(label: string, value: string, multiline = false) {
  const wrap = node('label', '', 'localField'); const input = multiline ? node('textarea') : node('input');
  input.value = value; input.setAttribute('aria-label', label); wrap.append(node('span', label), input); return { wrap, input };
}
export function mainPanel(root: HTMLElement, title: string) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-content]');
  if (!panel) throw new Error('内容区域尚未就绪');
  const page = node('section', '', 'localPage'); const header = node('header'); header.append(node('h2', title));
  const body = node('div', '', 'localPageBody'); page.append(header,body); panel.replaceChildren(page); return { page, header, body };
}
export function downloadText(filename: string, text: string, mime='text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text],{type:mime})); const a=node('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
