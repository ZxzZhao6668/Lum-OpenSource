import { db, loadDoc, saveDoc } from "../data/db";

/**
 * 点章节 → 在正文区域下方拉出这一章的文本，可直接编辑，改动存本地。
 */

export interface ChapterRecord {
  id: string;
  title: string;
  content?: string;
  episodeId?: string;
}

interface EpisodeDoc {
  collapsed: boolean;
  chapters: ChapterRecord[];
}

const DOC_KEY = "episode:ep_001";
const VIEW_ID = "dsh-chapter-view";

let activeClose: (() => Promise<void>) | undefined;
let openSequence=0;
export async function closeChapterDraft() {
  openSequence++;
  await activeClose?.();
  if (document.getElementById(VIEW_ID)) throw new Error('章节草稿尚未保存，请先处理保存错误');
}

export async function openChapterView(chapterId: string) {
  await closeChapterDraft();
  const sequence=++openSequence;
  const doc = await loadDoc<EpisodeDoc>(DOC_KEY);
  if(sequence!==openSequence)return;
  const chapter = doc?.chapters.find((c) => c.id === chapterId);
  if (!chapter) return;


  // 取最宽的那块面板（= 正文区），别拿到左栏
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".bg-panel"));
  const anchor =
    panels.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] ??
    (document.querySelector(".laper-host") as HTMLElement | null);
  const rect = anchor?.getBoundingClientRect();

  const view = document.createElement("div");
  view.id = VIEW_ID;
  view.dataset.chapterId = chapterId;
  view.className = "dsh-chapter-view";
  view.style.cssText = rect
    ? `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`
    : "";

  const head = document.createElement("div");
  head.className = "dsh-chapter-head";

  const back = document.createElement("button");
  back.className = "dsh-chapter-back";
  back.textContent = "← 返回剧本";


  const title = document.createElement("div");
  title.className = "dsh-chapter-title";
  title.textContent = chapter.title;

  const count = document.createElement("div");
  count.className = "dsh-chapter-count";

  const headRight = document.createElement("div");
  headRight.className = "dsh-chapter-head-right";
  headRight.append(title, count);

  head.append(back, headRight);

  const body = document.createElement("div");
  body.className = "dsh-chapter-body";

  const paper = document.createElement("div");
  paper.className = "dsh-chapter-paper";
  paper.contentEditable = "true";
  paper.spellcheck = false;
  paper.textContent = chapter.content ?? "";
  paper.dataset.placeholder = "这一章还没有内容，直接在这里写…";

  const sync = () => {
    const len = (paper.textContent ?? "").replace(/\s/g, "").length;
    count.textContent = `${len} 字`;
    paper.classList.toggle("is-empty", len === 0);
  };
  sync();

  // Capture text while attached. IndexedDB serializes these updates with sidebar edits.
  let pending = Promise.resolve();
  let editNumber = 0;
  let committedText = chapter.content ?? "";
  let failed = false;
  paper.addEventListener("input", () => {
    sync();
    const content = paper.innerText;
    const change = ++editNumber;
    pending = pending.then(() => db.transaction("rw", db.docs, async () => {
      const current = await loadDoc<EpisodeDoc>(DOC_KEY);
      const target = current?.chapters.find(item => item.id === chapterId);
      if (!current || !target) throw new Error("章节已不存在");
      if ((target.content ?? "") !== committedText) throw new Error("章节已在其他窗口修改");
      target.content = content;
      await saveDoc(DOC_KEY, current);
    })).then(() => {
      committedText = content;
      if (change === editNumber) { failed = false; sync(); }
    }).catch(error => {
      failed = true;
      count.textContent = `保存失败，请保留草稿：${error instanceof Error ? error.message : String(error)}`;
    });
  });

  body.appendChild(paper);
  view.append(head, body);
  document.body.appendChild(view);

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (view.isConnected && (failed || paper.innerText !== committedText)) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);

  const close = async () => {
    paper.contentEditable = "false";
    await pending;
    if (failed) { paper.contentEditable = "true"; return; }
    document.removeEventListener("keydown", onKey);
    window.removeEventListener('beforeunload', beforeUnload);
    view.remove();
    if (activeClose === close) activeClose = undefined;
  };
  activeClose = close;
  back.onclick = () => void close();
  if (chapter.episodeId) {
    const script = document.createElement("button");
    script.className = "dsh-chapter-back";
    script.textContent = "打开本集剧本";
    headRight.append(script);
    script.onclick = async () => {
      await close();
      if (view.isConnected) return;
      window.dispatchEvent(new CustomEvent("dsh:open-script", {
        detail: { episodeId: chapter.episodeId, title: chapter.title },
      }));
    };
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      void close();
    }
  };
  document.addEventListener("keydown", onKey);

  paper.focus();
  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(paper);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}
