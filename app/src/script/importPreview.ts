/** 导入 txt 前的预览：看清分段再替换剧本，可点类型标签改分类 */

import type { BlockType, ScriptBlock } from "./editor";

const LABEL: Record<BlockType, string> = {
  scene: "场次",
  action: "动作",
  character: "角色",
  parenthetical: "括号",
  dialogue: "对白",
  transition: "转场",
  comment: "注释",
  subtitle: "字幕",
};

const CYCLE: BlockType[] = [
  "scene",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "comment",
  "subtitle",
];


/** 读不出内容时的说明窗：把文件名、大小、开头几个字都列出来，方便定位 */
export function showImportNotice(title: string, lines: string[]) {
  document.getElementById("dsh-import-notice")?.remove();

  const mask = document.createElement("div");
  mask.id = "dsh-import-notice";
  mask.className = "dsh-pv-mask";

  const dialog = document.createElement("div");
  dialog.className = "dsh-pv-dialog is-notice";

  const head = document.createElement("div");
  head.className = "dsh-pv-head";
  const t = document.createElement("div");
  t.className = "dsh-pv-title";
  t.textContent = title;
  const close = document.createElement("button");
  close.className = "dsh-pv-close";
  close.type = "button";
  close.textContent = "✕";
  close.onclick = () => mask.remove();
  head.append(t, close);

  const body = document.createElement("div");
  body.className = "dsh-notice-body";
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "dsh-notice-line";
    row.textContent = line;
    body.appendChild(row);
  }

  dialog.append(head, body);
  mask.appendChild(dialog);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) mask.remove();
  });
  document.body.appendChild(mask);
}

export function showImportPreview(
  fileName: string,
  blocks: ScriptBlock[],
  onConfirm: (blocks: ScriptBlock[]) => void | Promise<void>,
) {
  document.getElementById("dsh-import-preview")?.remove();

  const mask = document.createElement("div");
  mask.id = "dsh-import-preview";
  mask.className = "dsh-pv-mask";

  const dialog = document.createElement("div");
  dialog.className = "dsh-pv-dialog";

  const head = document.createElement("div");
  head.className = "dsh-pv-head";
  const title = document.createElement("div");
  title.className = "dsh-pv-title";
  title.textContent = `导入预览 · ${fileName}`;
  const close = document.createElement("button");
  close.className = "dsh-pv-close";
  close.type = "button";
  close.textContent = "✕";
  close.onclick = () => mask.remove();
  head.append(title, close);

  const summary = document.createElement("div");
  summary.className = "dsh-pv-summary";

  const list = document.createElement("div");
  list.className = "dsh-pv-list";

  const renderSummary = () => {
    const count = (t: BlockType) => blocks.filter((b) => b.type === t).length;
    const parts = [`共 ${blocks.length} 段`];
    if (count("scene")) parts.push(`场次 ${count("scene")}`);
    if (count("character")) parts.push(`角色 ${count("character")}`);
    if (count("dialogue")) parts.push(`对白 ${count("dialogue")}`);
    if (count("action")) parts.push(`动作 ${count("action")}`);
    summary.textContent = parts.join(" · ");
  };

  blocks.forEach((block, index) => {
    const row = document.createElement("div");
    row.className = "dsh-pv-row";

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = `dsh-pv-badge is-${block.type}`;
    badge.textContent = LABEL[block.type];
    badge.title = "点一下换类型";
    badge.onclick = () => {
      const next = CYCLE[(CYCLE.indexOf(block.type) + 1) % CYCLE.length];
      blocks[index] = { ...block, type: next };
      badge.textContent = LABEL[next];
      badge.className = `dsh-pv-badge is-${next}`;
      row.dataset.type = next;
      renderSummary();
    };

    const text = document.createElement("div");
    text.className = "dsh-pv-text";
    text.textContent = block.text;
    text.title = block.text;

    row.append(badge, text);
    list.appendChild(row);
  });

  renderSummary();

  const foot = document.createElement("div");
  foot.className = "dsh-pv-foot";

  const tip = document.createElement("span");
  tip.className = "dsh-pv-tip";
  tip.textContent = "点左侧标签可改类型；导入会替换当前剧本";

  const actions = document.createElement("div");
  actions.className = "dsh-pv-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "dsh-pv-btn";
  cancel.textContent = "取消";
  cancel.onclick = () => mask.remove();

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "dsh-pv-btn dsh-pv-btn-primary";
  ok.textContent = "导入并替换剧本";
  ok.onclick = async () => {
    ok.disabled = true;
    mask.remove();
    await onConfirm(blocks);
  };

  actions.append(cancel, ok);
  foot.append(tip, actions);

  dialog.append(head, summary, list, foot);
  mask.appendChild(dialog);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) mask.remove();
  });
  document.addEventListener(
    "keydown",
    function onKey(e) {
      if (e.key === "Escape") {
        mask.remove();
        document.removeEventListener("keydown", onKey);
      }
    },
  );

  document.body.appendChild(mask);
}
