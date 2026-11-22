import { db, loadDoc, saveDoc } from "../data/db";
import { showToast } from "../ui/toast";
import { registerContentEditor } from "../writing/contentEditor";
import { action,downloadText,node } from '../ui/localUi';
import type { Chapter } from '../episode/episodePanel';

type Doc = { id: string; title: string; html: string };
type State = { docs: Doc[]; active: number };



const DEFAULT_DOCS = (fallback: string): Doc[] => [
  {
    id: "world",
    title: "总世界观",
    html: "<h3>总世界观</h3><p>还没有内容。写下这个世界的规矩：朝代、地理、势力、技术上限。</p>",
  },
  { id: "outline", title: "大纲", html: fallback },
];

const COMMAND: Record<string, { cmd: string; arg?: string }> = {
  paragraph: { cmd: "formatBlock", arg: "p" },
  h1: { cmd: "formatBlock", arg: "h1" },
  h2: { cmd: "formatBlock", arg: "h2" },
  h3: { cmd: "formatBlock", arg: "h3" },
  quote: { cmd: "formatBlock", arg: "blockquote" },
  bold: { cmd: "bold" },
  italic: { cmd: "italic" },
  hr: { cmd: "insertHorizontalRule" },
};

export async function upgradeOutline(root: HTMLElement, episodeId = "ep_001", navigation?: {chapters: Chapter[]; docId?: string}) {
  const KEY = `outline:${episodeId}`;
  const editor = root.querySelector<HTMLElement>("[data-outline-editor]");
  if (!editor) return;
  if (editor.dataset.dshOutline === "1") return;
  editor.dataset.dshOutline = "1";

  const storedRow = await db.docs.get(KEY);
  const stored = storedRow?.payload as State|undefined;
  const storedSerialized = stored ? JSON.stringify(stored) : '';
  const legacy = db.name === 'laper-data' && episodeId === 'ep_001';
  const defaults = () => legacy ? DEFAULT_DOCS(editor.innerHTML) : [{id:'outline',title:'大纲',html:'<p></p>'}];
  let state: State = stored ?? {
    docs: defaults(),
    active: legacy ? 1 : 0,
  };
  if (!root.isConnected || !editor.isConnected) return;
  if (!state.docs?.length) state.docs = defaults();
  state.active = Math.max(0, Math.min(state.docs.length - 1, state.active | 0));
  const requestedDoc = state.docs.findIndex(doc=>doc.id===navigation?.docId);
  if(requestedDoc>=0)state.active=requestedDoc;
  const chapters = navigation?.chapters.filter(chapter=>!chapter.draft);
  const episodeIndex = chapters?.findIndex(chapter=>(chapter.episodeId??chapter.id)===episodeId) ?? -1;
  const pageIndex = () => chapters ? Math.max(0,episodeIndex) : state.active;
  const pageCount = () => chapters ? Math.max(1,chapters.length) : state.docs.length;

  const pager = root.querySelector<HTMLElement>('[data-outline-pager]');
  const pageInput = pager?.querySelector<HTMLInputElement>('input[aria-label="页码"]');
  const pageTotal = pager?.querySelector<HTMLElement>("[data-page-total]");
  const prevBtn = pager?.querySelector<HTMLButtonElement>('button[aria-label="上一页"]');
  const nextBtn = pager?.querySelector<HTMLButtonElement>('button[aria-label="下一页"]');
  const sectionTitle = root.querySelector<HTMLElement>("[data-outline-title]");
  const projectTitle = editor.parentElement?.querySelector<HTMLElement>('[data-project-name]');
  if(projectTitle){projectTitle.dataset.projectName='true';projectTitle.textContent=(await loadDoc<{name:string}>('project:meta'))?.name??'我的写作项目';}
  if(!root.isConnected||!editor.isConnected)return;
  const documentDate = root.querySelector<HTMLElement>('[data-outline-date]');
  const dateText=(time:number)=>new Date(time).toLocaleDateString('zh-CN');
  if(documentDate)documentDate.textContent=dateText(storedRow?.updatedAt??Date.now());
  const toc = root.querySelector<HTMLElement>('[data-page-index]');
  toc?.setAttribute('role','navigation');
  toc?.setAttribute('aria-label','大纲目录');
  function renderToc() {
    if (!toc) return;
    const headings = [...editor!.querySelectorAll<HTMLElement>('h1,h2,h3')].filter(heading => heading.textContent?.trim());
    toc.replaceChildren(...headings.map(heading => action(heading.textContent!, () => {
      heading.scrollIntoView({block:'center', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      editor!.focus({preventScroll:true});
    })));
    if (!headings.length) toc.append(node('p','暂无大纲标题','localMuted'));
  }
  const actions = root.querySelector<HTMLElement>('[data-outline-actions]');
  const saveBtn = actions?.querySelector<HTMLButtonElement>('[data-outline-save]');
  const picker = node('label','','outlineDocumentPicker'); picker.append(node('span','大纲文档'));
  const documentSelect=node('select'); documentSelect.setAttribute('aria-label','大纲文档'); picker.append(documentSelect);
  actions?.prepend(picker);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let saved = storedSerialized;
  const initialState = JSON.stringify(state);
  let reloading = false;
  let isActive = () => false;
  const assertActive = () => {
    if (!isActive()) throw new Error("大纲页面已离开，不能保存旧页面内容");
  };
  const capture = () => { state.docs[state.active].html = editor.innerHTML; };
  const cancelTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  const save = (): Promise<void> => {
    cancelTimer();
    if (!isActive() || reloading) return Promise.reject(new Error("大纲页面不可保存"));
    capture();
    const snapshot = structuredClone(state);
    const serialized = JSON.stringify(snapshot);
    const operation = queue.catch(() => {}).then(async () => {
      assertActive();
      if (serialized === saved) return;
      await saveDoc(KEY, snapshot);
      saved = serialized;
      if(documentDate)documentDate.textContent=dateText(Date.now());
    });
    queue = operation;
    return operation;
  };
  const saveInBackground = () => {
    void save().catch(() => { if (isActive()) showToast("大纲保存失败，草稿已保留，请重试"); });
  };

  const syncChrome = () => {
    const doc = state.docs[state.active];
    if (sectionTitle) sectionTitle.textContent = doc.title;
    if (pageInput) pageInput.value = String(pageIndex() + 1);
    if (pageTotal) pageTotal.textContent = `/ ${pageCount()}`;
    if (prevBtn) prevBtn.disabled = pageIndex() === 0;
    if (nextBtn) nextBtn.disabled = pageIndex() === pageCount() - 1;
    picker.hidden = state.docs.length < 2;
    documentSelect.replaceChildren(...state.docs.map(d=>{const option=node('option',d.title);option.value=d.id;return option;}));
    documentSelect.value=doc.id;
  };

  const render = () => {
    editor.innerHTML = state.docs[state.active].html;
    syncChrome();
    renderToc();
  };

  // 就地编辑 → 自动保存
  editor.addEventListener("input", () => {
    if (!isActive() || reloading) return;
    renderToc();
    cancelTimer();
    timer = setTimeout(saveInBackground, 600);
  });

  // 格式工具条
  root.querySelectorAll<HTMLButtonElement>("button[data-format-id]").forEach((btn) => {
    const id = btn.dataset.formatId ?? "";
    const conf = COMMAND[id];
    if (!conf) return;
    btn.addEventListener("mousedown", event => event.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      editor.focus();
      try {
        document.execCommand(conf.cmd, false, conf.arg);
      } catch {
        /* ignore */
      }
      renderToc();
      saveInBackground();
    });
  });

  // 翻页
  const gotoDoc = (index: number) => {
    if (!isActive() || reloading || index < 0 || index >= state.docs.length) return;
    capture();
    state.active = index;
    render();
    saveInBackground();
  };
  documentSelect.addEventListener('change',()=>gotoDoc(state.docs.findIndex(doc=>doc.id===documentSelect.value)));
  const goto = (index: number) => {
    if(!isActive()||reloading||!Number.isInteger(index)||index<0||index>=pageCount())return;
    if(!chapters){gotoDoc(index);return;}
    const chapter=chapters[index];
    if(chapter)window.dispatchEvent(new CustomEvent('dsh:open-outline',{detail:{episodeId:chapter.episodeId??chapter.id,title:chapter.title}}));
  };
  pageInput?.addEventListener("change", () => {
    const n = Number(pageInput.value);
    if (Number.isInteger(n) && n >= 1 && n <= pageCount()) goto(n - 1);
    else pageInput.value = String(pageIndex() + 1);
  });
  prevBtn?.addEventListener("click", () => goto(pageIndex() - 1));
  nextBtn?.addEventListener("click", () => goto(pageIndex() + 1));

  saveBtn?.addEventListener("click", () => {
    void save().then(() => { if (isActive()) showToast("大纲已保存"); })
      .catch(() => { if (isActive()) showToast("大纲保存失败，草稿已保留，请重试"); });
  });

  render();
  isActive = registerContentEditor(editor, {
    hasUnsavedChanges() { capture(); return JSON.stringify(state) !== (saved || initialState); },
    async flush() {
      assertActive();
      do { await save(); capture(); } while (JSON.stringify(state) !== saved);
      assertActive();
    },
    async reload() {
      assertActive();
      capture();
      if (JSON.stringify(state) !== saved) throw new Error("大纲仍有未保存草稿，请先保存再刷新");
      cancelTimer();
      reloading = true;
      try {
        await queue;
        const latest = await loadDoc<State>(KEY);
        assertActive();
        capture();
        if (JSON.stringify(state) !== saved) throw new Error("刷新期间大纲发生编辑，已保留草稿");
        if (!latest?.docs?.length) throw new Error("大纲数据不存在或无效，已保留当前内容");
        state = latest;
        state.active = Math.max(0, Math.min(state.docs.length - 1, state.active | 0));
        saved = JSON.stringify(state);
        render();
      } finally { reloading = false; }
    },
  });
  const exportButton=action('导出大纲 TXT',async()=>{await save();const text=state.docs.map(doc=>`${doc.title}\n\n${new DOMParser().parseFromString(doc.html,'text/html').body.textContent}`).join('\n\n');downloadText('大纲.txt',text);});
  actions?.append(exportButton);
}
