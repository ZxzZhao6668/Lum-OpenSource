import './writeFeedback.css';
import { getActiveWritingEditor } from '../script/editor';
import { getActiveContentEditor } from './contentEditor';
import { applyProposal, type WriteAuthorization } from './documentStore';
import { applyContentProposal } from './contentProposals';

async function showScriptEditor(episodeId: string) {
  const current=document.querySelector<HTMLElement>('.laper-host');
  if (current?.dataset.screen === '01-script' && current.dataset.episodeId===episodeId) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(Error('剧本页面尚未就绪，请重新打开剧本后重试')), 10000);
    window.dispatchEvent(new CustomEvent('dsh:prepare-script-write', { detail: {
      episodeId,
      resolve: () => { clearTimeout(timeout); resolve(); },
      reject: (error: unknown) => { clearTimeout(timeout); reject(error); },
    } }));
  });
}

/** A short write lock flushes manual edits before the store's revision check. */
export async function commitWritingChange(kind: 'script' | 'content', id: string, episodeId: string, authorization: WriteAuthorization, cancelled = () => false) {
  if (cancelled()) throw Error('已停止，未写入此项修改');
  if (kind === 'script') await showScriptEditor(episodeId);
  const host = document.querySelector<HTMLElement>('.laper-host');
  const previousInert = host?.inert ?? false;
  const editor = getActiveWritingEditor(), content = getActiveContentEditor();
  if (host) host.inert = true;
  try {
    await editor?.flush(); await content?.flush();
    if (cancelled()) throw Error('已停止，未写入此项修改');
    if (kind === 'script') {
      const result = await applyProposal(episodeId, id, authorization);
      let warning: string | undefined;
      try { await editor?.reload(); } catch { warning = '正文已保存；页面有新的编辑，请重新打开剧本查看。'; }
      const before = new Map(result.proposal.before.map(b => [b.id, b.text]));
      const blockIds = result.proposal.after.filter(b => before.get(b.id) !== b.text).map(b => b.id);
      if (!warning) await animateScriptWrite(blockIds, cancelled);
      highlightScriptWrite(blockIds, false);
      window.dispatchEvent(new CustomEvent('dsh:script-written', { detail: { episodeId, blockIds } }));
      return { status: 'applied' as const, episodeId, blockIds, snapshot: result.document, warning };
    }
    const result = await applyContentProposal(id, authorization);
    let warning: string | undefined;
    try { await content?.reload(); } catch { warning = '内容已保存；页面有新的编辑，请重新打开对应页面查看。'; }
    window.dispatchEvent(new CustomEvent('dsh:content-updated', { detail: result.proposal.target }));
    return { status: 'applied' as const, episodeId, blockIds: [] as string[], warning };
  } finally { if (host) host.inert = previousInert; }
}

/** Reveal a committed change. Animation never mutates text or saves partial characters. */
export async function animateScriptWrite(blockIds: string[], cancelled: () => boolean) {
  const host = document.querySelector<HTMLElement>('.laper-host[data-screen="01-script"]');
  if (!host || cancelled() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ids = new Set(blockIds);
  const nodes = Array.from(host.querySelectorAll<HTMLElement>('.slate-editor [data-block-id]')).filter(node => ids.has(node.dataset.blockId!));
  const parts = nodes.map(node => {
    const text = node.textContent ?? '';
    const offsets = [0]; for (const character of Array.from(text)) offsets.push(offsets.at(-1)! + character.length);
    return { node, offsets, length: offsets.length - 1, clip: node.style.clipPath };
  });
  const total = parts.reduce((sum, part) => sum + part.length, 0); if (!total) return;
  const cursor = document.createElement('div'); cursor.className = 'agentTypingCursor'; cursor.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.textContent = 'Agent'; cursor.append(label); document.body.append(cursor);
  const notice = document.createElement('div'); notice.className = 'agentTypingStatus'; notice.setAttribute('role', 'status'); notice.textContent = '正在写入剧本正文…'; document.body.append(notice);
  const stop = () => { cancelledLocally = true; };
  let cancelledLocally = false;
  window.addEventListener('pagehide', stop, { once: true });
  try {
    parts.forEach(part => { part.node.style.clipPath = 'inset(0 100% 0 0)'; });
    nodes[0]?.scrollIntoView({ block: 'center', behavior: 'instant' });
    const duration = Math.min(6500, Math.max(500, total * 22));
    await new Promise<void>(resolve => {
      let start: number | undefined, previous = -1, active = -1;
      let scheduled = 0;
      const finish = () => { cancelAnimationFrame(scheduled); clearTimeout(timeout); document.removeEventListener('visibilitychange', visibility); resolve(); };
      const visibility = () => { if (document.hidden) finish(); };
      const timeout = window.setTimeout(finish, duration + 1000);
      document.addEventListener('visibilitychange', visibility);
      const frame = (now: number) => {
        if (cancelledLocally || cancelled() || document.hidden || !host.isConnected || nodes.some(node => !node.isConnected)) { finish(); return; }
        start ??= now;
        const count = Math.min(total, Math.floor((now - start) / duration * total));
        if (count !== previous) {
          previous = count; let remaining = count;
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (remaining >= part.length) { part.node.style.clipPath = part.clip; remaining -= part.length; continue; }
            if (active !== i) {
              active = i;
              const box = part.node.getBoundingClientRect();
              if (box.top < 160 || box.bottom > innerHeight - 140) part.node.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
            let offset = part.offsets[remaining], point: Node = part.node;
            const walker = document.createTreeWalker(part.node, NodeFilter.SHOW_TEXT);
            let textNode: Node | null;
            while ((textNode = walker.nextNode())) {
              const length = textNode.textContent?.length ?? 0;
              if (offset <= length) { point = textNode; break; } offset -= length;
            }
            const range = document.createRange(); range.setStart(point, Math.min(offset, point.nodeType === Node.TEXT_NODE ? point.textContent!.length : point.childNodes.length)); range.collapse(true);
            const caret = range.getBoundingClientRect(), box = part.node.getBoundingClientRect();
            if (box.width && box.height && caret.height) {
              const x = Math.max(0, Math.min(100, (caret.left - box.left) / box.width * 100));
              // Include the full line's ascent/descent: hiding only to the glyph box
              // leaves tiny tops of later characters visible in CJK fonts.
              const top = Math.max(0, (caret.top - box.top - caret.height * .35) / box.height * 100);
              const bottom = Math.min(100, (caret.bottom - box.top + caret.height * .2) / box.height * 100);
              part.node.style.clipPath = `polygon(0 0,100% 0,100% ${top}%,${x}% ${top}%,${x}% ${bottom}%,0 ${bottom}%)`;
              cursor.style.cssText = `left:${caret.left}px;top:${caret.top}px;height:${caret.height}px`;
            }
            break;
          }
        }
        if (count === total) finish(); else scheduled = requestAnimationFrame(frame);
      };
      scheduled = requestAnimationFrame(frame);
    });
  } finally {
    parts.forEach(part => { part.node.style.clipPath = part.clip; }); cursor.remove(); notice.remove(); window.removeEventListener('pagehide', stop);
  }
}

export function highlightScriptWrite(blockIds: string[], scrollToStart = true) {
  const host = document.querySelector<HTMLElement>('.laper-host[data-screen="01-script"]');
  if (!host) return;
  const ids = new Set(blockIds);
  const nodes = Array.from(host.querySelectorAll<HTMLElement>('.slate-editor [data-block-id]')).filter(node => ids.has(node.dataset.blockId!));
  host.querySelectorAll('.agentWritten,.agentWriteCaret').forEach(node => node.classList.remove('agentWritten', 'agentWriteCaret'));
  nodes.forEach(node => node.classList.add('agentWritten'));
  const last = nodes.at(-1);
  last?.classList.add('agentWriteCaret');
  if (scrollToStart) nodes[0]?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  window.setTimeout(() => nodes.forEach(node => node.classList.remove('agentWritten', 'agentWriteCaret')), 5500);
}
