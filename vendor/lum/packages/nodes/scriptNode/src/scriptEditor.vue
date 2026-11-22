<template>
  <div class="scriptEditor">
    <aside class="tocPanel" aria-label="剧本目录">
      <el-input v-model="document.title" class="titleInput" :disabled="disabled" maxlength="120" aria-label="剧本标题" @input="emit('change')" />
      <nav class="tocTree">
        <template v-for="section in scriptSections" :key="section.key">
          <button type="button" class="tocItem" :class="{ active: isActive({ type: 'section', key: section.key }) }" @click="select({ type: 'section', key: section.key })">{{ section.label }}</button>
          <template v-if="isActive({ type: 'section', key: section.key })">
            <button v-for="heading in currentHeadings" :key="heading.line" type="button" class="tocChild" :class="`level${heading.level}`" @click="jumpTo(heading.text)">{{ heading.text }}</button>
          </template>
        </template>
        <div class="tocGroup">
          <span>{{ episodeLabel(document.kind) }}</span>
          <el-button text size="small" :icon="IconPlus" :disabled="disabled" title="新增一集" aria-label="新增一集" @click="addEpisode" />
        </div>
        <template v-for="(episode, index) in document.episodes" :key="episode.id">
          <button type="button" class="tocItem episode" :class="{ active: isActive({ type: 'episode', id: episode.id }) }" @click="select({ type: 'episode', id: episode.id })">
            <span>{{ episode.title || `第${index + 1}集` }}</span>
          </button>
          <template v-if="isActive({ type: 'episode', id: episode.id })">
            <button v-for="heading in currentHeadings" :key="heading.line" type="button" class="tocChild" :class="`level${heading.level}`" @click="jumpTo(heading.text)">{{ heading.text }}</button>
          </template>
        </template>
        <p v-if="!document.episodes.length" class="tocEmpty">暂无分集，可点「＋」新增，或让 Agent 逐集写作。</p>
      </nav>
    </aside>
    <section class="bodyPanel">
      <header v-if="activeEpisode" class="episodeHeader">
        <el-input v-model="activeEpisode.title" :disabled="disabled" maxlength="120" aria-label="本集标题" @input="emit('change')" />
        <el-button text type="danger" :icon="IconTrash" :disabled="disabled" @click="removeEpisode(activeEpisode.id)">删除本集</el-button>
      </header>
      <div ref="editorHost" class="editorHost" @mouseup="updateSelection" @keyup="updateSelection">
        <markdownEditor ref="markdown" :key="partKey" :modelValue="currentText" :active="active" :disabled="disabled || !!proposal" :ariaLabel="`编辑${partTitle}`" @update:modelValue="setCurrentText" />
        <div v-if="selection && !proposal" class="selectionBar nodrag" :style="{ top: `${selection.top}px` }" @mousedown.stop>
          <el-input v-model="instruction" size="small" placeholder="输入修改要求…" aria-label="选区修改要求" @keydown.enter.prevent="sendSelection" />
          <el-button size="small" :disabled="!addToChat" @click="sendToChat">添加到聊天</el-button>
          <el-button size="small" type="primary" :loading="rewriting" :disabled="!instruction.trim() || !rewrite" @click="sendSelection">发送</el-button>
        </div>
      </div>
      <div v-if="proposal" class="proposal" role="region" aria-label="修改对照">
        <div class="proposalColumns">
          <div><small>原文</small><p>{{ proposal.before }}</p></div>
          <div><small>修改后</small><el-input v-model="proposal.after" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" aria-label="修改后的文字" /></div>
        </div>
        <footer>
          <el-button @click="proposal = undefined">撤销</el-button>
          <el-button type="primary" @click="applyProposal">采用</el-button>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { ElButton, ElInput, ElMessage, ElMessageBox } from "element-plus";
import { IconPlus, IconTrash } from "@tabler/icons-vue";
import markdownEditor from "@lum/node-text/markdownEditor";
import { episodeLabel, headingsOf, scriptSections, type ScriptDocument, type ScriptSectionKey } from "@lum/node-shared/scriptDocument";

export type ScriptPart = { type: "section"; key: ScriptSectionKey } | { type: "episode"; id: string };

const props = withDefaults(defineProps<{
  document: ScriptDocument;
  active?: boolean;
  disabled?: boolean;
  /** 按要求只改写选中的文字，返回新文字。 */
  rewrite?: (input: { selected: string; instruction: string; context: string; partTitle: string }) => Promise<string>;
  /** 把选区作为引用带入 Agent 对话。 */
  addToChat?: (input: { selected: string; partTitle: string }) => void;
}>(), { active: true });
const emit = defineEmits<{ change: [] }>();
const part = defineModel<ScriptPart>("part", { default: () => ({ type: "section", key: "outline" }) });
const markdown = ref<{ editor?: import("@tiptap/core").Editor; sourceMode?: boolean }>();
const editorHost = ref<HTMLElement>();
const selection = ref<{ from: number; to: number; text: string; top: number }>();
const instruction = ref("");
const rewriting = ref(false);
const proposal = ref<{ from: number; to: number; before: string; after: string; partKey: string }>();

const activeEpisode = computed(() => part.value.type === "episode" ? props.document.episodes.find(item => item.id === (part.value as { id: string }).id) : undefined);
const partKey = computed(() => part.value.type === "section" ? part.value.key : `episode:${part.value.id}`);
const partTitle = computed(() => part.value.type === "section" ? scriptSections.find(item => item.key === (part.value as { key: string }).key)!.label : activeEpisode.value?.title ?? "本集");
const currentText = computed(() => part.value.type === "section" ? props.document.sections[part.value.key] : activeEpisode.value?.content ?? "");
const currentHeadings = computed(() => headingsOf(currentText.value, [2, 3]).slice(0, 80));

function isActive(target: ScriptPart) {
  return target.type === "section" ? part.value.type === "section" && part.value.key === target.key : part.value.type === "episode" && part.value.id === target.id;
}
function select(target: ScriptPart) {
  selection.value = undefined;
  proposal.value = undefined;
  part.value = target;
}
function setCurrentText(value: string) {
  if (part.value.type === "section") props.document.sections[part.value.key] = value;
  else if (activeEpisode.value) activeEpisode.value.content = value;
  props.document.updatedAt = new Date().toISOString();
  emit("change");
}
function addEpisode() {
  const index = props.document.episodes.length + 1;
  const title = props.document.kind === "novel" ? `第${index}章` : `第${index}集`;
  const episode = { id: crypto.randomUUID(), title, content: `# ${title}\n\n` };
  props.document.episodes.push(episode);
  emit("change");
  select({ type: "episode", id: episode.id });
}
async function removeEpisode(id: string) {
  const episode = props.document.episodes.find(item => item.id === id);
  if (!episode) return;
  const confirmed = await ElMessageBox.confirm(`删除「${episode.title}」后，本集正文会从剧本节点移除。`, "删除本集", { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }).then(() => true, () => false);
  if (!confirmed) return;
  props.document.episodes = props.document.episodes.filter(item => item.id !== id);
  emit("change");
  select({ type: "section", key: "outline" });
}
async function jumpTo(text: string) {
  await nextTick();
  const headings = editorHost.value?.querySelectorAll<HTMLElement>("h2, h3, h1");
  const target = [...headings ?? []].find(item => item.textContent?.trim() === text.trim());
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function updateSelection() {
  const editor = markdown.value?.editor;
  if (!editor || markdown.value?.sourceMode || proposal.value) { selection.value = undefined; return; }
  const { from, to, empty } = editor.state.selection;
  if (empty) { selection.value = undefined; return; }
  const text = editor.state.doc.textBetween(from, to, "\n").trim();
  if (!text) { selection.value = undefined; return; }
  const host = editorHost.value!.getBoundingClientRect();
  const coords = editor.view.coordsAtPos(to);
  selection.value = { from, to, text, top: Math.max(8, coords.bottom - host.top + 8) };
}
async function sendSelection() {
  const current = selection.value;
  if (!current || !props.rewrite || !instruction.value.trim() || rewriting.value) return;
  rewriting.value = true;
  try {
    const after = await props.rewrite({ selected: current.text, instruction: instruction.value.trim(), context: currentText.value, partTitle: partTitle.value });
    if (!after.trim()) throw new Error("模型没有返回修改内容");
    proposal.value = { from: current.from, to: current.to, before: current.text, after: after.trim(), partKey: partKey.value };
    selection.value = undefined;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "修改失败");
  } finally { rewriting.value = false; }
}
function applyProposal() {
  const value = proposal.value;
  const editor = markdown.value?.editor;
  if (!value || !editor || value.partKey !== partKey.value) { proposal.value = undefined; return; }
  editor.chain().focus().insertContentAt({ from: value.from, to: value.to }, value.after.split(/\n/).map(line => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] }))).run();
  proposal.value = undefined;
  instruction.value = "";
}
function sendToChat() {
  const current = selection.value;
  if (!current || !props.addToChat) return;
  props.addToChat({ selected: current.text, partTitle: partTitle.value });
  selection.value = undefined;
}
defineExpose({ select });
</script>

<style lang="scss" scoped>
.scriptEditor {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 0;

  .tocPanel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 220px;
    flex-shrink: 0;
    min-height: 0;

    .titleInput :deep(.el-input__inner) { font-weight: 600; }

    .tocTree {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;

      .tocItem, .tocChild {
        display: block;
        width: 100%;
        padding: 6px 10px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--el-text-color-regular);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        &:hover { background: var(--el-fill-color-light); }
        &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); font-weight: 600; }
      }

      .tocChild {
        padding: 3px 10px 3px 22px;
        color: var(--el-text-color-secondary);
        font-size: 12px;

        &.level3 { padding-left: 34px; }
      }

      .tocGroup {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 8px;
        padding: 4px 10px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }

      .tocEmpty { margin: 4px 10px; color: var(--el-text-color-placeholder); font-size: 12px; line-height: 1.6; }
    }
  }

  .bodyPanel {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    min-height: 0;

    .episodeHeader { display: flex; gap: 8px; flex-shrink: 0; }

    .editorHost {
      position: relative;
      flex: 1;
      min-height: 0;

      .selectionBar {
        position: absolute;
        left: 50%;
        z-index: 3;
        display: flex;
        gap: 6px;
        width: min(560px, 90%);
        padding: 8px;
        border: 1px solid var(--el-border-color);
        border-radius: 10px;
        background: var(--el-bg-color-overlay);
        box-shadow: var(--el-box-shadow);
        transform: translateX(-50%);

        .el-button { margin: 0; }
      }
    }

    .proposal {
      flex-shrink: 0;
      padding: 12px;
      border: 1px solid var(--el-color-primary-light-5);
      border-radius: 10px;
      background: var(--el-fill-color-lighter);

      .proposalColumns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;

        small { color: var(--el-text-color-secondary); }
        p { margin: 4px 0 0; white-space: pre-wrap; color: var(--el-text-color-secondary); text-decoration: line-through; }
      }

      footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    }
  }
}
</style>
