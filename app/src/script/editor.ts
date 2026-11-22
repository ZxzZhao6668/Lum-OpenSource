import { linkAsset } from '../entities/assetLinkStore';
export { parseScene } from "./sceneIdentity";
import { db, ensureSeed, listEntities, type EntityRow } from "../data/db";
import { createEpisodeDocument, readDocument, saveDocument } from "../writing/documentStore";
import { openScriptMenu } from "./scriptMenu";
import { decodeText } from "./fileText";
import { showToast } from "../ui/toast";
import { showImportNotice, showImportPreview } from "./importPreview";
import { renderSceneList } from "./sceneListSync";
import { mountParagraphControls } from './paragraphControls';
import { mountScriptFind } from './scriptFind';
import type { TextSelection } from '../writing/selectionWriting';

export type BlockType =
  | "scene"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "comment"
  | "subtitle";

export interface ScriptBlock {
  id: string;
  type: BlockType;
  text: string;
}

export interface SceneRef {
  index: number;
  intExt: string;
  location: string;
  timeOfDay: string;
  blockId: string;
}

const ORDER: BlockType[] = [
  "scene",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "comment",
  "subtitle",
];

export type WritingSnapshot = Awaited<ReturnType<typeof readDocument>>;
export interface WritingEditorHandle {
  flush(): Promise<WritingSnapshot>;
  reload(): Promise<void>;
  selectedBlockIds(): string[];
  selectedText(): TextSelection | null;
}
let activeEditor: { element: HTMLElement; handle: WritingEditorHandle } | null = null;
export function getActiveWritingEditor(): WritingEditorHandle | null {
  return activeEditor?.element.isConnected ? activeEditor.handle : null;
}
const ZWSP = "\u200B";

const typeOf = (block: HTMLElement): BlockType => block.dataset.blockType as BlockType;
const applyType = (block: HTMLElement, type: BlockType) => { block.dataset.blockType = type; };

const makeBlock = (data: ScriptBlock): HTMLElement => {
  const block = document.createElement("div");
  block.dataset.blockId = data.id;
  applyType(block, data.type);
  block.textContent = data.text || ZWSP;
  return block;
};

const clean = (s: string) => s.replace(/\u200B/g, "");

function caretOffset(block: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return clean(block.textContent ?? "").length;
  const r = sel.getRangeAt(0);
  if (!block.contains(r.startContainer)) return clean(block.textContent ?? "").length;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(r.startContainer, r.startOffset);
  return clean(pre.toString()).length;
}

function setCaret(block: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let left = offset;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (left <= len) {
      const r = document.createRange();
      r.setStart(node, left);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      return;
    }
    left -= len;
    node = walker.nextNode();
  }
}

const setText = (block: HTMLElement, value: string) => {
  // Native input may split a paragraph into several text nodes.
  block.textContent = value || ZWSP;
};

const currentBlock = (): HTMLElement | null => {
  const sel = window.getSelection();
  const anchor = sel?.anchorNode;
  const el = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
  return el?.closest<HTMLElement>('[data-block-id]') ?? null;
};

/** 把纯文本剧本切成块：场次 / 角色 / 括号 / 对白 / 动作 / 转场 */
export function parseTxt(raw: string): ScriptBlock[] {
  const normalized = raw.replace(/\uFEFF/g, "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  const rawLines = normalized.split("\n");
  // 整篇挤成一行（或个别段落特别长）时，按句号切开，至少能分段
  let lines: string[] = [];
  for (const line of rawLines) {
    if (line.trim().length > 120) {
      const parts = line.split(/(?<=[。！？!?…])/).map((x) => x.trim()).filter(Boolean);
      if (parts.length > 1) lines.push(...parts);
      else lines.push(line);
    } else {
      lines.push(line);
    }
  }
  // 全文只有一两行（比如整段复制粘贴）时，按句号再切一次
  if (lines.filter((l) => l.trim()).length <= 2 && normalized.trim().length > 24) {
    lines = normalized.split(/(?<=[。！？!?…])/).map((x) => x.trim()).filter(Boolean);
  }
  const out: ScriptBlock[] = [];
  let prev: BlockType | null = null;

  const push = (type: BlockType, text: string) => {
    const t = text.trim();
    if (!t) return;
    out.push({ id: crypto.randomUUID(), type, text: t });
    prev = type;
  };

  const isScene = (s: string) =>
    /^\s*\d+\s*[.、]?\s*(内|外|内外)\s*\S/.test(s) ||
    /^\s*(内景|外景)\s*[：:]/.test(s) ||
    /^\s*场景\s*[一二三四五六七八九十\d]+/.test(s) ||
    /^\s*第\s*[一二三四五六七八九十\d]+\s*场/.test(s);
  const isParen = (s: string) => /^[（(].*[）)]$/.test(s.trim());
  const isTransition = (s: string) => /^(切至|淡出|淡入|转场|字幕|FADE|CUT TO)/i.test(s.trim());
  const looksName = (s: string) => {
    const t = s.trim();
    if (!t || t.length > 14) return false;
    if (/[，。！？；：、“”‘’]$/.test(t)) return false;
    if (/^[【\[]/.test(t)) return false;
    return true;
  };
  const nextNonEmpty = (from: number) => {
    for (let i = from + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t) return t;
    }
    return "";
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue; // 空行不打断上下文
    if (isScene(t)) { push("scene", t); continue; }
    if (isParen(t)) { push("parenthetical", t); continue; }
    if (isTransition(t)) { push("transition", t); continue; }

    // 行内写法：朱清：台词
    const inline = /^([^\s：:（(]{1,12})[：:]\s*(.+)$/.exec(t);
    if (inline && !/^(内|外|内景|外景|场景|第|序号|时间|地点)$/.test(inline[1])) {
      push("character", inline[1]);
      const rest = inline[2].trim();
      if (/^[（(].*[）)]$/.test(rest)) push("parenthetical", rest);
      else push("dialogue", rest);
      continue;
    }

    const next = nextNonEmpty(i);
    const nameLike = looksName(t) && t.length <= 8 && !!next && !isScene(next) && !isTransition(next);
    const inSpeech = prev === "character" || prev === "parenthetical" || prev === "dialogue";

    if (prev === "character") { push("dialogue", t); continue; }
    if (inSpeech) {
      // 一段对话里出现的短名字 = 换人说话
      if (nameLike && !/[。！？，、；：]$/.test(t)) { push("character", t); continue; }
      push("dialogue", t);
      continue;
    }
    if (nameLike) { push("character", t); continue; }
    push("action", t);
  }
  return out;
}

export function upgradeScript(root: HTMLElement, episodeId = "ep_001") {
  const editor = root.querySelector<HTMLElement>("[data-script-editor]");
  const toolbar = root.querySelector<HTMLElement>("[data-script-toolbar]");
  if (!editor || !toolbar || editor.dataset.dshUpgraded === "1") return;
  editor.dataset.dshUpgraded = "1";

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let mentionBox: HTMLElement | null = null;
  const pageEvents = new AbortController();

  const blocksNow = () =>
    Array.from(editor.querySelectorAll<HTMLElement>('[data-block-id]'));

  const serialize = (): ScriptBlock[] => {
    const ids = new Set<string>();
    return blocksNow().map((el) => {
      let id = el.getAttribute("data-block-id");
      if (!id || ids.has(id)) {
        id = crypto.randomUUID();
        el.setAttribute("data-block-id", id);
      }
      ids.add(id);
      return { id, type: typeOf(el), text: clean(el.textContent ?? "") };
    });
  };

  let snapshot: WritingSnapshot | null = null;
  let savedJSON = "";
  let composing = false;
  let loading = true;
  let saveFailure: unknown = null;
  let queue: Promise<unknown> = Promise.resolve();
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.className = "lumScriptSaveStatus";
  status.textContent = "正在加载剧本…";
  editor.before(status);
  const alive = () => editor.isConnected && activeEditor?.element === editor;
  const assertAlive = () => { if (!alive()) throw new Error("编辑器已离开页面，请重新获取当前编辑器"); };
  const dirty = () => !!snapshot && JSON.stringify(serialize()) !== savedJSON;
  const reportFailure = (error: unknown) => {
    saveFailure = error;
    if (!alive()) return;
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `保存失败，草稿仍保留在编辑器中；请先导出备份，不会自动覆盖新版本。${message}`;
    status.dataset.error = "";
    showToast("剧本保存失败：草稿已保留，请勿离开页面");
  };
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const task = queue.then(work);
    queue = task.catch(() => undefined);
    return task;
  };
  let ready: Promise<void> = Promise.resolve();
  const flush = (): Promise<WritingSnapshot> => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return enqueue(async () => {
      await ready;
      assertAlive();
      if (loading || composing) throw new Error("请完成中文输入或等待加载后再操作");
      if (!snapshot) throw new Error("剧本尚未加载");
      try {
        // 用户可在保存等待期间继续输入；逐次使用成功返回的 revision。
        while (dirty()) {
          assertAlive();
          if (composing) throw new Error("请完成中文输入后再保存");
          const blocks = serialize();
          const json = JSON.stringify(blocks);
          status.textContent = "正在保存…";
          snapshot = await saveDocument(episodeId, blocks, snapshot.revision);
          savedJSON = json;
          if (!alive()) throw new Error("编辑器已离开页面，停止后续保存");
          window.dispatchEvent(new CustomEvent("dsh:script-saved", { detail: blocks.length }));
        }
        saveFailure = null;
        status.textContent = "已保存";
        delete status.dataset.error;
        renderScenes();
        return structuredClone(snapshot);
      } catch (error) {
        if (composing && error instanceof Error && error.message === "请完成中文输入后再保存") {
          status.textContent = "输入中，尚未保存";
        } else {
          reportFailure(error);
        }
        throw error;
      }
    });
  };
  const save = () => {
    if (loading || !alive()) return;
    status.textContent = saveFailure ? "未保存草稿（上次保存失败，请先导出备份）" : "未保存";
    if (saveTimer) clearTimeout(saveTimer);
    // 失败后不自动重试或更新 revision，避免静默覆盖并发修改。
    if (composing || saveFailure) return;
    saveTimer = setTimeout(() => { saveTimer = null; void flush().catch(() => undefined); }, 400);
  };

  // History is document transactions, never selectionchange events. Native typing
  // keeps its DOM (especially IME); structural edits patch only affected blocks.
  type Point = { id: string; offset: number };
  type SelectionState = { anchor: Point; focus: Point };
  type EditState = { blocks: ScriptBlock[]; selection: SelectionState | null };
  type HistoryEntry = { before: EditState; after: EditState; kind: string; time: number };
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let pendingInput: EditState | null = null;
  let inputKind = "";
  let mergeAllowed = false;
  const pointAt = (node: Node, offset: number): Point | null => {
    if (!editor.contains(node)) return null;
    const blocks = blocksNow();
    for (const block of blocks) {
      const range = document.createRange();
      range.selectNodeContents(block);
      const relation = range.comparePoint(node, offset);
      if (relation < 0) return { id: block.dataset.blockId!, offset: 0 };
      if (relation === 0) {
        range.setEnd(node, offset);
        return { id: block.dataset.blockId!, offset: clean(range.toString()).length };
      }
    }
    const last = blocks.at(-1);
    return last ? { id: last.dataset.blockId!, offset: clean(last.textContent ?? "").length } : null;
  };
  const selectionState = (): SelectionState | null => {
    const sel = window.getSelection();
    if (!sel?.anchorNode || !sel.focusNode) return null;
    const anchor = pointAt(sel.anchorNode, sel.anchorOffset);
    const focus = pointAt(sel.focusNode, sel.focusOffset);
    return anchor && focus ? { anchor, focus } : null;
  };
  const capture = (): EditState => ({ blocks: serialize(), selection: selectionState() });
  const pointInBlock = (block: HTMLElement, offset: number): [Node, number] => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = offset;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      for (let i = 0; i <= text.length; i++) {
        if (!left) return [node, i];
        if (text[i] && text[i] !== ZWSP) left--;
      }
    }
    return [block, block.childNodes.length];
  };
  const domPoint = (point: Point): [Node, number] | null => {
    const block = blocksNow().find(el => el.dataset.blockId === point.id);
    return block ? pointInBlock(block, point.offset) : null;
  };
  const restoreSelection = (selection: SelectionState | null) => {
    if (!selection) return;
    const anchor = domPoint(selection.anchor);
    const focus = domPoint(selection.focus);
    if (anchor && focus) {
      editor.focus();
      window.getSelection()?.setBaseAndExtent(...anchor, ...focus);
    }
  };
  const commit = (before: EditState, kind: string) => {
    const after = capture();
    if (JSON.stringify(before.blocks) === JSON.stringify(after.blocks)) return;
    const previous = undoStack.at(-1);
    const now = Date.now();
    if (mergeAllowed && previous && /^(insertText|deleteContentBackward|deleteContentForward)$/.test(kind)
      && previous.kind === kind && now - previous.time < 1000
      && JSON.stringify(previous.after) === JSON.stringify(before)) {
      previous.after = after;
      previous.time = now;
    } else {
      undoStack.push({ before, after, kind, time: now });
      if (undoStack.length > 200) undoStack.shift();
    }
    redoStack.length = 0;
    syncHistory();
    mergeAllowed = true;
    save();
  };
  const transact = (kind: string, edit: () => void) => {
    const before = capture();
    edit();
    commit(before, kind);
    syncToolbar();
  };
  const history = (redo: boolean) => {
    if (loading || composing) return;
    const entry = (redo ? redoStack : undoStack).pop();
    if (!entry) return;
    const state = redo ? entry.after : entry.before;
    applyBlocks(state.blocks);
    restoreSelection(state.selection);
    (redo ? undoStack : redoStack).push(entry);
    pendingInput = null;
    mergeAllowed = false;
    closeMention();
    syncToolbar();
    save();
  };
  const resetHistory = () => {
    undoStack.length = redoStack.length = 0;
    pendingInput = null;
    mergeAllowed = false;
    writingSelection = [];
    writingTextSelection = null;
    closeMention();
  };
  const orderedSelection = () => {
    const selection = selectionState();
    if (!selection) return null;
    const blocks = serialize();
    let start = selection.anchor;
    let end = selection.focus;
    let first = blocks.findIndex(b => b.id === start.id);
    let last = blocks.findIndex(b => b.id === end.id);
    if (first > last || (first === last && start.offset > end.offset)) {
      [start, end] = [end, start];
      [first, last] = [last, first];
    }
    return { blocks, start, end, first, last, collapsed: first === last && start.offset === end.offset };
  };
  // Replace exactly [start,end], preserving the first block's identity/type and
  // the end block's unselected suffix. No other paragraph is copied or deleted.
  const replaceSelection = (text: string) => {
    const selected = orderedSelection();
    if (!selected) return;
    const { blocks, start, end, first, last } = selected;
    const elements = blocksNow();
    const head = elements[first];
    const prefix = blocks[first].text.slice(0, start.offset);
    const suffix = blocks[last].text.slice(end.offset);
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    setText(head, prefix + lines[0] + (lines.length === 1 ? suffix : ""));
    for (let i = first + 1; i <= last; i++) elements[i].remove();
    let tail = head;
    for (let i = 1; i < lines.length; i++) {
      const block = makeBlock({ id: crypto.randomUUID(), type: blocks[first].type,
        text: lines[i] + (i === lines.length - 1 ? suffix : "") });
      tail.after(block);
      tail = block;
    }
    const point = { id: tail.dataset.blockId!, offset: lines.length === 1 ? prefix.length + lines[0].length : lines.at(-1)!.length };
    restoreSelection({ anchor: point, focus: point });
  };
  const deleteBoundary = (backward: boolean): boolean => {
    const selected = orderedSelection();
    if (!selected) return false;
    if (!selected.collapsed) { replaceSelection(""); return true; }
    const { blocks, start, first } = selected;
    if (backward && start.offset === 0 && first > 0) {
      const anchor = { id: blocks[first - 1].id, offset: blocks[first - 1].text.length };
      restoreSelection({ anchor, focus: start });
      replaceSelection("");
      return true;
    }
    if (!backward && start.offset === blocks[first].text.length && first < blocks.length - 1) {
      restoreSelection({ anchor: start, focus: { id: blocks[first + 1].id, offset: 0 } });
      replaceSelection("");
      return true;
    }
    return false;
  };

  // ---------- 场次列表同步 ----------
  const renderScenes = () => {
    const list = root.querySelector<HTMLElement>("[data-scene-list]");
    if (list) renderSceneList(list, serialize());
  };
  root.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-scene-list] button[data-scene-block-id]') : null;
    if (!button || !alive() || loading || composing) return;
    const target = blocksNow().find(block => block.dataset.blockId === button.dataset.sceneBlockId);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    editor.focus({ preventScroll: true });
    setCaret(target, 0);
  }, { signal: pageEvents.signal });

  // ---------- 格式工具栏 ----------
  const historyButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-script-history]'));
  const syncHistory = () => {
    for (const button of historyButtons) button.disabled = !(button.dataset.scriptHistory === 'redo' ? redoStack : undoStack).length;
  };
  for (const button of historyButtons) {
    button.addEventListener('mousedown', event => event.preventDefault(), { signal: pageEvents.signal });
    button.addEventListener('click', () => { if (alive()) history(button.dataset.scriptHistory === 'redo'); }, { signal: pageEvents.signal });
  }
  const syncToolbar = () => {
    syncHistory();
    const cur = currentBlock();
    const t = cur ? typeOf(cur) : null;
    root.querySelectorAll<HTMLElement>("[data-format-id]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.formatId === t));
    });
  };

  root.querySelectorAll<HTMLElement>("[data-format-id]").forEach((btn) => {
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (loading || composing || !alive()) return;
        const type = btn.dataset.formatId as BlockType;
        if (!ORDER.includes(type)) return;
        const cur = currentBlock() ?? blocksNow()[0];
        if (!cur) return;
        transact("format", () => {
          const selection = selectionState();
          const selected = orderedSelection();
          const targets = selected ? blocksNow().slice(selected.first, selected.last + 1) : [cur];
          targets.forEach(el => applyType(el, type));
          restoreSelection(selection);
        });
      },
      true,
    );
  });

  let writingSelection: string[] = [];
  let writingTextSelection: TextSelection | null = null;
  const rememberSelection = () => {
    if (!alive() || loading) return;
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        serialize();
        writingSelection = blocksNow().filter(el => range.intersectsNode(el)).map(el => el.dataset.blockId!);
        const selected=orderedSelection();
        writingTextSelection=selected&&!selected.collapsed?structuredClone({start:selected.start,end:selected.end,blocks:selected.blocks}):null;
      }
    }
    if (document.activeElement === editor || editor.contains(document.activeElement)) syncToolbar();
  };
  document.addEventListener("selectionchange", rememberSelection, { signal: pageEvents.signal });

  // ---------- 编辑行为 ----------
  editor.setAttribute("contenteditable", "false");
  editor.setAttribute("spellcheck", "false");
  editor.addEventListener("beforeinput", (e) => {
    if (loading || !alive()) { e.preventDefault(); return; }
    if (composing || e.isComposing) return;
    const kind = e.inputType;
    if (kind === "historyUndo" || kind === "historyRedo") {
      e.preventDefault(); history(kind === "historyRedo"); return;
    }
    if (kind === "insertParagraph" || kind === "insertLineBreak") {
      e.preventDefault(); transact("paragraph", () => replaceSelection("\n")); return;
    }
    const selected = orderedSelection();
    if (!selected) { e.preventDefault(); return; }
    if (kind.startsWith("delete")) {
      const atBoundary = kind.endsWith("Backward") ? selected.start.offset === 0
        : selected.start.offset === selected.blocks[selected.first].text.length;
      if (!selected.collapsed || atBoundary) {
        e.preventDefault();
        transact(kind, () => { deleteBoundary(kind.endsWith("Backward")); });
        return;
      }
    }
    if (kind === "insertFromDrop" || kind === "deleteByDrag" || kind.startsWith("format")) {
      // Native drag/rich-text commands can move wrappers and duplicate stable IDs.
      e.preventDefault(); return;
    }
    if (kind.startsWith("insert") && (!selected.collapsed || e.data?.includes("\n"))) {
      const text = e.dataTransfer?.getData("text/plain") ?? e.data;
      if (text !== null && text !== undefined) {
        e.preventDefault(); transact(kind, () => replaceSelection(text));
        void maybeMention(root); return;
      }
    }
    pendingInput = capture();
    inputKind = kind;
  });
  editor.addEventListener("compositionstart", () => {
    pendingInput = capture();
    // Collapse a cross-paragraph selection ourselves before the IME owns DOM.
    // The original selection/content stays in pendingInput for one atomic undo.
    const selected = orderedSelection();
    if (selected && !selected.collapsed) replaceSelection("");
    composing = true;
    mergeAllowed = false;
    closeMention();
  });
  editor.addEventListener("compositionend", () => {
    composing = false;
    if (pendingInput) commit(pendingInput, "composition");
    pendingInput = null;
    mergeAllowed = false;
    save();
  });
  editor.addEventListener("input", () => {
    if (loading || composing) return;
    if (pendingInput) commit(pendingInput, inputKind);
    pendingInput = null;
    save();
    void maybeMention(root);
  });
  editor.addEventListener("paste", e => {
    if (loading || composing) { e.preventDefault(); return; }
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain");
    if (text !== undefined) transact("paste", () => replaceSelection(text));
    closeMention();
  });
  editor.addEventListener("cut", e => {
    if (loading || composing) { e.preventDefault(); return; }
    const selected = orderedSelection();
    if (!selected || selected.collapsed) return;
    e.preventDefault();
    if (!e.clipboardData) return;
    const { blocks, first, last, start, end } = selected;
    const text = blocks.slice(first, last + 1).map((b, i) => {
      const from = i === 0 ? start.offset : 0;
      const to = i === last - first ? end.offset : b.text.length;
      return b.text.slice(from, to);
    }).join("\n");
    e.clipboardData.setData("text/plain", text);
    transact("cut", () => replaceSelection(""));
  });
  editor.addEventListener("drop", e => e.preventDefault());
  editor.addEventListener("pointerdown", () => { mergeAllowed = false; });

  // 场次卡点「查看剧本片段」时定位到对应场次
  window.addEventListener("dsh:scroll-scene", ((e: CustomEvent) => {
    const key = String(e.detail ?? "").trim();
    if (!key) return;
    const norm = (v: string) => v.replace(/\s+/g, "");
    const target = blocksNow().find(
      (el) => typeOf(el) === "scene" && norm(clean(el.textContent ?? "")).includes(norm(key)),
    );
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    editor.focus();
    setCaret(target, 0);
    target.animate(
      [{ background: "rgba(26,74,53,.16)" }, { background: "transparent" }],
      { duration: 1000 },
    );
  }) as EventListener, { signal: pageEvents.signal });

  // 正文怎么变（删除、剪切、撤销、粘贴）都同步一次场次列表
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => renderScenes(), 120);
  });
  observer.observe(editor, { childList: true, subtree: true, characterData: true });

  editor.addEventListener(
    "keydown",
    (e) => {
      if (loading || !alive()) { e.preventDefault(); return; }
      if (composing || e.isComposing || e.keyCode === 229) return;
      if (mentionBox && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape")) {
        if (handleMentionKey(e)) return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          history(key === "y" || e.shiftKey);
          return;
        }
      }
      if (/^(Arrow|Home|End|Page)/.test(e.key)) mergeAllowed = false;
      const target = currentBlock();
      if (e.key === "Tab" && target && editor.contains(target)) {
        e.preventDefault();
        transact("format", () => {
          const selection = selectionState();
          const selected = orderedSelection();
          const targets = selected ? blocksNow().slice(selected.first, selected.last + 1) : [target];
          targets.forEach(el => {
            const cur = ORDER.indexOf(typeOf(el));
            applyType(el, ORDER[(cur + (e.shiftKey ? ORDER.length - 1 : 1)) % ORDER.length]);
          });
          restoreSelection(selection);
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        transact("paragraph", () => replaceSelection("\n"));
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const selected = orderedSelection();
        if (!selected) return;
        const backward = e.key === "Backspace";
        const boundary = backward ? selected.start.offset === 0
          : selected.start.offset === selected.blocks[selected.first].text.length;
        if (!selected.collapsed || boundary) {
          e.preventDefault();
          transact(backward ? "deleteContentBackward" : "deleteContentForward", () => { deleteBoundary(backward); });
        }
      }
    },
    true,
  );

  // ---------- @ 关联人物 ----------
  let mentionItems: EntityRow[] = [];
  let mentionActive = 0;

  async function openMention(anchorRect: DOMRect) {
    await ensureSeed();
    mentionItems = await listEntities();
    if (!alive() || loading || composing) return;
    const block = currentBlock();
    if (!block || !editor?.contains(block) || !/@([^\s@]{0,8})$/.test(clean(block.textContent ?? "").slice(0, caretOffset(block)))) return;
    if (!mentionBox) {
      mentionBox = document.createElement("div");
      mentionBox.className = "dsh-mention";
      document.body.appendChild(mentionBox);
      mentionBox.addEventListener("mousedown", (ev) => {
        const t = (ev.target as HTMLElement).closest("[data-mention]");
        if (!t) return;
        ev.preventDefault();
        insertMention((t as HTMLElement).dataset.mention!);
      });
    }
    mentionActive = 0;
    mentionBox.replaceChildren(...mentionItems.map((entity,i)=>{
      const row=document.createElement('div');row.className='dsh-mention-item';row.dataset.mention=entity.id;row.dataset.i=String(i);
      const name=document.createElement('span');name.className='dsh-mention-name';name.textContent=entity.name;
      const meta=document.createElement('span');meta.className='dsh-mention-meta';meta.textContent=`${{character:'人物',location:'地点',prop:'道具'}[entity.kind]} · ${entity.meta}`;
      row.append(name,meta);return row;
    }));
    mentionBox.style.display = "block";
    mentionBox.style.left = `${anchorRect.left}px`;
    mentionBox.style.top = `${anchorRect.bottom + 6}px`;
    markMentionActive();
  }

  function closeMention() {
    if (mentionBox) mentionBox.style.display = "none";
  }

  function markMentionActive() {
    mentionBox?.querySelectorAll("[data-mention]").forEach((el, i) => {
      el.classList.toggle("active", i === mentionActive);
    });
  }

  function handleMentionKey(e: KeyboardEvent): boolean {
    if (!mentionBox || mentionBox.style.display === "none") return false;
    const items = mentionBox.querySelectorAll("[data-mention]");
    if (e.key === "Escape") {
      closeMention();
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      mentionActive =
        (mentionActive + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      markMentionActive();
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const name = (items[mentionActive] as HTMLElement | undefined)?.dataset.mention;
      if (name) insertMention(name);
      return true;
    }
    return false;
  }

  function insertMention(entityId: string) {
    const entity=mentionItems.find(item=>item.id===entityId);if(!entity)return;const name=entity.name;
    const block = currentBlock();
    if (!block) return;
    const text = clean(block.textContent ?? "");
    const off = caretOffset(block);
    const match = /@([^\s@]{0,8})$/.exec(text.slice(0, off));
    if (!match) return;
    const at = off - match[0].length;
    const next = `${text.slice(0, at)}@${name} ${text.slice(off)}`;
    if (loading || composing || !alive()) return;
    transact("mention", () => {
      setText(block, next);
      const point = { id: block.dataset.blockId!, offset: at + name.length + 2 };
      restoreSelection({ anchor: point, focus: point });
    });
    void flush().then(()=>linkAsset(episodeId,block.dataset.blockId!,entityId)).catch(error=>showToast(String(error)));
    closeMention();
  }

  async function maybeMention(host: HTMLElement) {
    const block = currentBlock();
    if (!block) return closeMention();
    const text = clean(block.textContent ?? "");
    const off = caretOffset(block);
    const before = text.slice(0, off);
    const m = /@([^\s@]{0,8})$/.exec(before);
    if (!m) return closeMention();
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect) return closeMention();
    await openMention(rect);
    void host;
  }

  document.addEventListener("mousedown", (e) => {
    if (mentionBox && !mentionBox.contains(e.target as Node)) closeMention();
  }, { signal: pageEvents.signal });


  // ---------- 导入 txt 剧本 ----------
  const applyBlocks = (next: ScriptBlock[]) => {
    if (!next.length) next = [{ id: crypto.randomUUID(), type: "action", text: "" }];
    editor.replaceChildren(...next.map(makeBlock));
  };

  const applyImported = async (blocks: ScriptBlock[]) => {
    try {
      const prev = await flush();
      assertAlive();
      if (dirty() || composing) throw new Error("内容已变化，请重新导入");
      transact("import", () => applyBlocks(blocks));
      const imported = await flush();
      syncToolbar();
      showToast(`已导入 ${blocks.length} 段`, {
        undo: async () => {
          try {
            assertAlive();
            if (composing || dirty() || snapshot?.revision !== imported.revision) {
              throw new Error("导入后已有编辑，不能直接撤销导入");
            }
            // flush 仍以导入时的 revision 执行 CAS；外部变更不会被撤销覆盖。
            transact("restore-import", () => applyBlocks(prev.blocks));
            await flush();
            syncToolbar();
            showToast("已撤销导入");
          } catch (error) {
            showToast(`撤销失败：${error instanceof Error ? error.message : String(error)}`);
          }
        },
      });
    } catch (error) {
      showToast(`导入失败，未保存草稿保留：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const importTxt = async (raw: string, fileName = "") => {
    const blocks = parseTxt(raw);
    if (!blocks.length) {
      showToast("没识别到内容，检查一下文件是不是空的");
      return;
    }
    showImportPreview(fileName || "txt", blocks, applyImported);
  };

  const scriptSeg = root.querySelector<HTMLButtonElement>("[data-script-menu]");
  if (scriptSeg) {
    scriptSeg.setAttribute("aria-haspopup", "menu");
    scriptSeg.setAttribute("aria-expanded", "false");
    scriptSeg.title = "导入或保存本章 TXT";
    const saveTxt = async () => {
      const lines: string[] = [];
      blocksNow().forEach((el) => {
        const text = clean(el.textContent ?? "").trim();
        if (!text) return;
        if (typeOf(el) === "scene" && lines.length) lines.push("");
        lines.push(text);
      });
      const content = lines.join("\n");
      const fileName = "剧本.txt";
      const w = window as unknown as {
        showSaveFilePicker?: (o: unknown) => Promise<{
          createWritable: () => Promise<{ write: (t: string) => Promise<void>; close: () => Promise<void> }>;
        }>;
      };
      if (w.showSaveFilePicker) {
        try {
          const handle = await w.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: "纯文本", accept: { "text/plain": [".txt"] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(content);
          await writable.close();
          return;
        } catch (err) {
          if ((err as { name?: string })?.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    };

    const pickTxt = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".txt,text/plain";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("cancel", () => input.remove(), { once: true });
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        const buf = await file.arrayBuffer();
        const raw = decodeText(buf);
        const stripped = raw.replace(/[\s\u0000\uFEFF]/g, "");
        const bad = (raw.match(/\uFFFD/g) ?? []).length;
        if (!stripped) {
          showImportNotice("这个文件里没有文字", [
            `文件：${file.name}`,
            `大小：${file.size} 字节`,
            `读出来开头：「${raw.slice(0, 60).replace(/\n/g, " ")}」`,
            "如果是空文件，或者其实是从 Word/PDF 改后缀来的，请另存为 .txt 再来。",
          ]);
          return;
        }
        if (bad > raw.length * 0.05) {
          showImportNotice("这个文件可能不是纯文本", [
            `文件：${file.name}`,
            `大小：${file.size} 字节`,
            `乱码比例：${Math.round((bad / raw.length) * 100)}%`,
            `读出来开头：「${raw.slice(0, 60).replace(/\n/g, " ")}」`,
            "内容像二进制（Word / PDF / 图片）。请用记事本打开后「另存为」纯文本，再导入。",
          ]);
          return;
        }
        await importTxt(raw, file.name);
      });
      input.click();
    };

    scriptSeg.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openScriptMenu(scriptSeg, [
        { label: "上传 txt 剧本", hint: "会替换当前内容", onPick: pickTxt },
        { label: "保存为 txt", hint: "选择位置导出", onPick: saveTxt },
      ], pageEvents.signal);
    }, { signal: pageEvents.signal });
  }

  const renderSnapshot = (next: WritingSnapshot) => {
    applyBlocks(next.blocks.length ? next.blocks : [{ id: crypto.randomUUID(), type: "action", text: "" }]);
    snapshot = next;
    savedJSON = JSON.stringify(serialize());
    resetHistory();
    saveFailure = null;
    status.textContent = "已保存";
    delete status.dataset.error;
    renderScenes();
    syncToolbar();
  };
  const handle: WritingEditorHandle = {
    flush,
    selectedText: () => {
      if(!alive()||loading||composing)return null;
      rememberSelection();
      if(writingTextSelection&&JSON.stringify(serialize())===JSON.stringify(writingTextSelection.blocks))return structuredClone(writingTextSelection);
      return null;
    },
    reload: () => enqueue(async () => {
      await ready;
      assertAlive();
      if (composing || dirty()) throw new Error("有未保存草稿，拒绝覆盖；请先导出或保存草稿");
      const before = JSON.stringify(serialize());
      const next = await readDocument(episodeId);
      assertAlive();
      if (composing || JSON.stringify(serialize()) !== before) throw new Error("读取期间发生编辑，保留当前草稿");
      renderSnapshot(next);
    }),
    selectedBlockIds: () => {
      if (!alive() || loading) return [];
      rememberSelection();
      const present = new Set(blocksNow().map(el => el.dataset.blockId));
      return writingSelection.filter(id => present.has(id));
    },
  };
  activeEditor = { element: editor, handle };
  mountScriptFind({
    editor, toolbar, scope: root, signal: pageEvents.signal,
    canOpen: () => alive() && !loading && !composing && !root.inert,
    blocks: blocksNow, text: block => clean(block.textContent ?? ''), isDialogue: block => typeOf(block) === 'dialogue',
    rangeFor: (block, start, end) => {
      const range = document.createRange();
      range.setStart(...pointInBlock(block, start));
      range.setEnd(...pointInBlock(block, end));
      return range;
    },
  });
  const cleanupParagraphControls = mountParagraphControls(editor, () => alive() && !loading && !composing && !root.inert, (sourceId, targetId, after) => {
    const source = blocksNow().find(block => block.dataset.blockId === sourceId);
    const target = blocksNow().find(block => block.dataset.blockId === targetId);
    if (!source || !target || source === target || !alive() || loading || composing) return;
    transact('move-paragraph', () => {
      const selection = selectionState();
      if (after) target.after(source); else target.before(source);
      restoreSelection(selection);
    });
  });
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (alive() && (dirty() || composing)) { e.preventDefault(); e.returnValue = ""; }
  };
  window.addEventListener("beforeunload", beforeUnload, { signal: pageEvents.signal });
  // 脱离 DOM 后清理定时器，不从旧 editor serialize 后续写入。
  const lifecycle = new MutationObserver(() => {
    if (alive()) return;
    if (saveTimer) clearTimeout(saveTimer);
    if (syncTimer) clearTimeout(syncTimer);
    observer.disconnect();
    lifecycle.disconnect();
    mentionBox?.remove();
    cleanupParagraphControls();
    status.remove();
    pageEvents.abort();
    if (activeEditor?.element === editor) activeEditor = null;
  });
  lifecycle.observe(document.body, { childList: true, subtree: true });

  // 加载完成前锁定正文和格式操作，防止迟到的加载覆盖用户输入。
  ready = (async () => {
    await ensureSeed();
    assertAlive();
    // 在同一事务确认缺失并初始化；真实 [] 绝不替换为示例。
    const next = await db.transaction("rw", db.docs, async () => {
      const exists = await db.docs.get(`script:${episodeId}`);
      return exists ? readDocument(episodeId) : createEpisodeDocument(episodeId);
    });
    assertAlive();
    renderSnapshot(next);
    loading = false;
    editor.setAttribute("contenteditable", "true");
  })();
  void ready.catch((error) => {
    reportFailure(error);
    if (alive()) status.textContent = `加载失败，编辑已锁定以保护数据：${error instanceof Error ? error.message : String(error)}`;
  });
}
