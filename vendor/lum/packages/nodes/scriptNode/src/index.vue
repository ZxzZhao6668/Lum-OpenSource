<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :bottomWidth="560"
    :style="{ width: '580px' }">
    <template #top>
      <el-card class="scriptToolbar" shadow="never" :bodyStyle="{ padding: '6px' }">
        <el-dropdown trigger="click" :disabled="!file.ready.value" @command="openEntityDialog">
          <el-button text :icon="IconUserScan">生成设定图<icon-chevron-down :size="14" /></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="character" :icon="IconUser">生成角色图</el-dropdown-item>
              <el-dropdown-item command="scene" :icon="IconPhoto">生成场景图</el-dropdown-item>
              <el-dropdown-item command="prop" :icon="IconDiamond">生成道具图</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button text :icon="IconSparkles" :disabled="!file.ready.value" @click="omniCreate">全能创作</el-button>
        <el-divider direction="vertical" />
        <el-button text :icon="IconMaximize" title="展开编辑" aria-label="展开编辑" :disabled="!file.ready.value" @click="editing = true" />
        <el-button :tag="downloadUrl ? 'a' : 'button'" :href="downloadUrl || undefined" :download="`${script.title || '剧本'}.md`" text :icon="IconDownload" title="下载 Markdown" aria-label="下载" :disabled="!downloadUrl" @click.stop />
      </el-card>
    </template>
    <div class="scriptCard" :class="{ empty: isEmpty }">
      <el-alert v-if="file.state.error" :title="file.state.error" type="error" :closable="false" showIcon>
        <el-button text size="small" @click="file.reload()">重新读取</el-button>
      </el-alert>
      <header class="cardHeader">
        <div class="cardTitle">
          <strong>{{ script.title || "未命名剧本" }}</strong>
          <small>{{ formattedDate }}</small>
        </div>
        <el-button class="editButton nodrag nopan" size="small" :icon="IconEdit" :disabled="!file.ready.value" @dblclick.stop @click.stop="editing = true">编辑</el-button>
      </header>
      <div v-if="previewReady" class="cardBody">
        <nav class="cardNav nodrag nopan" aria-label="剧本分区">
          <button v-for="item in navItems" :key="item.key" type="button" :class="{ active: cardPart === item.key, filled: item.filled }" @pointerdown.stop @click.stop="cardPart = item.key">{{ item.label }}</button>
        </nav>
        <div class="cardPreview nopan nowheel">
          <template v-if="cardPart === 'episodes'">
            <p v-if="!script.episodes.length" class="placeholder">暂无分集剧本</p>
            <ol v-else class="episodeList">
              <li v-for="episode in script.episodes" :key="episode.id" @pointerdown.stop @click.stop="openEpisode(episode.id)">{{ episode.title }}<small>{{ episode.content.length }} 字</small></li>
            </ol>
          </template>
          <template v-else>
            <markdownPreview v-if="script.sections[cardPart].trim()" :modelValue="previewText" :active="previewReady" />
            <p v-else class="placeholder">{{ file.loading.value ? "正在读取…" : "暂无内容" }}</p>
          </template>
        </div>
      </div>
    </div>
    <template #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '10px 12px' }">
        <div class="promptRow">
          <el-input v-model="request" type="textarea" :autosize="{ minRows: 1, maxRows: 5 }" resize="none" placeholder="告诉 Agent 怎么写或怎么改这个剧本…" aria-label="剧本创作要求" @keydown.enter.exact.prevent="sendRequest" />
          <el-button class="sendButton" :icon="IconArrowUp" :disabled="!request.trim() || !file.ready.value" title="发送给 Agent" aria-label="发送给 Agent" @click="sendRequest" />
        </div>
      </el-card>
    </template>
  </nodeSkeleton>

  <el-dialog v-model="editing" :title="`剧本 - ${script.title || '未命名剧本'}`" fullscreen appendToBody class="scriptEditorDialog" @closed="file.touch(true).catch(() => {})">
    <template #header>
      <div class="dialogHeader">
        <span>剧本 - {{ script.title || "未命名剧本" }}</span>
        <el-select :modelValue="textModel.selected.value ? data.model : ''" class="modelSelect" filterable size="small" placeholder="局部修改用的文本模型" :loading="textModel.loading.value" @update:modelValue="textModel.choose($event)">
          <el-option-group v-for="provider in textModel.groups.value" :key="provider.id" :label="provider.label">
            <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
          </el-option-group>
        </el-select>
        <el-dropdown trigger="click" @command="exportScript">
          <el-button size="small" :icon="IconDownload">导出</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="md">Markdown（.md）</el-dropdown-item>
              <el-dropdown-item command="doc">Word 可打开（.doc）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <span class="saveState">{{ file.state.error ? "保存失败" : file.state.dirty ? "保存中…" : "已保存" }}</span>
      </div>
    </template>
    <scriptEditor v-if="editing && file.ready.value" ref="editorRef" v-model:part="editorPart" :document="script" :active="editing" :rewrite="rewriteSelection" :addToChat="addSelectionToChat" @change="changed" />
  </el-dialog>

  <el-dialog v-model="entityDialog.visible" :title="`生成${entityKindLabel}`" width="min(560px, calc(100vw - 32px))" appendToBody alignCenter>
    <p class="entityTip">从「{{ entitySectionLabel }}」读到 {{ entityDialog.items.length }} 项，将创建 {{ checkedEntities.length }} 个图片生成节点，收进一个分组。</p>
    <p v-if="!entityDialog.items.length" class="entityEmpty">这个分区还没有 `## 名字` 形式的条目。先让 Agent 写好{{ entitySectionLabel }}，或在编辑器里补上。</p>
    <el-checkbox-group v-model="entityDialog.checked" class="entityList">
      <el-checkbox v-for="item in entityDialog.items" :key="item.name" :value="item.name">
        <strong>{{ item.name }}</strong><small>{{ item.fields["类型"] || entityBrief(item, 40) }}</small>
      </el-checkbox>
    </el-checkbox-group>
    <el-input v-model="entityDialog.style" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="全局画风（会写进每张图的提示词）" aria-label="全局画风" />
    <div class="entityOptions">
      <span>比例</span>
      <el-select v-model="entityDialog.ratio" size="small" style="width: 100px"><el-option v-for="ratio in ['16:9', '9:16', '1:1', '4:3', '3:4']" :key="ratio" :label="ratio" :value="ratio" /></el-select>
      <el-checkbox v-model="entityDialog.generate">创建后立即生成（会调用图片模型）</el-checkbox>
    </div>
    <template #footer>
      <el-button @click="entityDialog.visible = false">取消</el-button>
      <el-button type="primary" :loading="entityDialog.busy" :disabled="!checkedEntities.length" @click="createEntityImages">{{ entityDialog.generate ? "创建并生成" : "创建节点" }} ({{ checkedEntities.length }})</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElAlert, ElButton, ElCard, ElCheckbox, ElCheckboxGroup, ElDialog, ElDivider, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElMessage, ElOption, ElOptionGroup, ElSelect } from "element-plus";
import { IconArrowUp, IconChevronDown, IconDiamond, IconDownload, IconEdit, IconMaximize, IconPhoto, IconScript, IconSparkles, IconUser, IconUserScan } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@lum/nodes-scaffold/runtime";
import markdownPreview from "@lum/node-text/markdownPreview";
import { useNodeJsonFile } from "@lum/node-shared/useNodeJsonFile";
import { sendToAgent, useTextModel } from "@lum/node-shared/useTextModel";
import { addGroupedNodes, useNodeCaller } from "@lum/node-shared/canvasBatch";
import {
  composeScriptMarkdown, createScriptDocument, entityBrief, normalizeScriptDocument, parseEntities, scriptSections, setupSummary,
  type ScriptDocument, type ScriptEntity, type ScriptSectionKey, type ScriptSetup,
} from "@lum/node-shared/scriptDocument";
import scriptEditor, { type ScriptPart } from "./scriptEditor.vue";

defineOptions({
  inheritAttrs: false,
  icon: IconScript,
  handles: [
    { id: "in", type: "target", dataType: ["STRING", "IMAGE", "FILE"], label: "参考资料输入" },
    { id: "text", type: "source", dataType: "STRING", label: "剧本输出" },
  ] satisfies NodeHandle[],
});

const { id, node, nodeProps, outputs, previewReady } = useNode({
  label: "剧本",
  outputs: { text: { dataType: "STRING", value: "" } },
});
const data = computed(() => node.data as typeof node.data & { model?: string; followDefaultModel?: boolean; initialTitle?: string; initialSetup?: ScriptSetup });
const file = useNodeJsonFile<ScriptDocument>("script.json", {
  create: () => {
    const document = createScriptDocument(data.value.initialTitle || String(node.data.label ?? "") || "未命名剧本");
    if (data.value.initialSetup) document.setup = normalizeScriptDocument({ ...document, setup: data.value.initialSetup }).setup;
    return document;
  },
  normalize: normalizeScriptDocument,
});
const script = computed(() => file.value.value);
const busy = ref(false);
const textModel = useTextModel(data, busy);
const callNode = useNodeCaller();
const flow = useVueFlow();
const editing = ref(false);
const editorRef = ref<InstanceType<typeof scriptEditor>>();
const editorPart = ref<ScriptPart>({ type: "section", key: "outline" });
const cardPart = ref<ScriptSectionKey | "episodes">("outline");
const request = ref("");

// 输出只读内存值；正文在 script.json，画布 JSON 不重复保存。
if (!Object.hasOwn(outputs.value, "toJSON")) Object.defineProperty(outputs.value, "toJSON", { value: () => ({}) });
watch(() => file.ready.value && composeScriptMarkdown(script.value), value => {
  if (value === false) return;
  outputs.value.text = { dataType: "STRING", value };
  if (script.value.title && node.data.label !== script.value.title) node.data.label = script.value.title;
}, { immediate: true });

const isEmpty = computed(() => !scriptSections.some(item => script.value.sections[item.key].trim()) && !script.value.episodes.length);
const navItems = computed(() => [
  ...scriptSections.map(item => ({ key: item.key, label: item.label, filled: !!script.value.sections[item.key].trim() })),
  { key: "episodes" as const, label: script.value.kind === "novel" ? "章节" : "分集剧本", filled: !!script.value.episodes.length },
]);
const previewText = computed(() => cardPart.value === "episodes" ? "" : script.value.sections[cardPart.value].slice(0, 3000));
const formattedDate = computed(() => new Date(script.value.updatedAt || script.value.createdAt).toLocaleDateString("zh-CN"));
const downloadUrl = ref("");
watch([() => outputs.value.text?.value ?? "", () => node.selected || editing.value], ([text, visible], _old, onCleanup) => {
  downloadUrl.value = "";
  if (!visible || !text) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  downloadUrl.value = url;
  onCleanup(() => URL.revokeObjectURL(url));
}, { immediate: true });

function changed() {
  script.value.updatedAt = new Date().toISOString();
  void file.touch().catch(error => ElMessage.error(error instanceof Error ? error.message : "剧本保存失败"));
}
function openEpisode(episodeId: string) {
  editorPart.value = { type: "episode", id: episodeId };
  editing.value = true;
}
function nodeReference() {
  return `画布上的剧本节点「${script.value.title || "未命名剧本"}」（节点 ID：${id}）`;
}
function omniCreate() {
  sendToAgent(`/skill:scriptWriting 请读取${nodeReference()}，接着上次的进度继续创作；先告诉我你打算做什么。`, false);
}
function sendRequest() {
  const text = request.value.trim();
  if (!text || !file.ready.value) return;
  sendToAgent(`/skill:scriptWriting 针对${nodeReference()}：${text}`);
  request.value = "";
}
function addSelectionToChat({ selected, partTitle }: { selected: string; partTitle: string }) {
  sendToAgent(`针对${nodeReference()}的「${partTitle}」中这段文字：\n> ${selected.replace(/\n/g, "\n> ")}\n\n修改要求：`, false);
}
async function rewriteSelection({ selected, instruction, context, partTitle }: { selected: string; instruction: string; context: string; partTitle: string }) {
  const system = "你是剧本编辑。只改写用户选中的那段文字，保持原有格式、人物和设定一致。只输出改写后的文字本身，不要解释，不要加引号或代码块。";
  const prompt = `剧本《${script.value.title}》·${partTitle}\n\n【上下文（只读，供参考）】\n${context.slice(0, 12000)}\n\n【选中的文字】\n${selected}\n\n【修改要求】\n${instruction}`;
  busy.value = true;
  try { return (await textModel.generate(prompt, system)).trim(); }
  finally { busy.value = false; }
}
function exportScript(type: "md" | "doc") {
  const markdown = composeScriptMarkdown(script.value);
  const name = `${script.value.title || "剧本"}.${type}`;
  const blob = type === "md" ? new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    : new Blob([`<html><head><meta charset="utf-8"></head><body>${markdownToHtml(markdown)}</body></html>`], { type: "application/msword" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function markdownToHtml(markdown: string) {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return markdown.split(/\r?\n/).map(line => {
    if (/^<!--.*-->$/.test(line.trim()) || line.trim() === "---") return "";
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const inline = (value: string) => escape(value).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\\$/, "");
    if (heading) return `<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`;
    return line.trim() ? `<p>${inline(line.replace(/^\s*[-*>]\s?/, ""))}</p>` : "";
  }).join("\n");
}

// —— 生成角色 / 场景 / 道具图 ——
const entityDialog = reactive({ visible: false, kind: "character" as ScriptEntity["kind"], items: [] as ScriptEntity[], checked: [] as string[], style: "", ratio: "16:9", generate: false, busy: false });
const entityKindLabel = computed(() => ({ character: "角色图", scene: "场景图", prop: "道具图" })[entityDialog.kind]);
const entitySectionLabel = computed(() => ({ character: "人物小传", scene: "场景设计", prop: "道具设计" })[entityDialog.kind]);
const checkedEntities = computed(() => entityDialog.items.filter(item => entityDialog.checked.includes(item.name)));
function openEntityDialog(kind: ScriptEntity["kind"]) {
  const section = ({ character: "characters", scene: "scenes", prop: "props" } as const)[kind];
  entityDialog.kind = kind;
  entityDialog.items = parseEntities(script.value.sections[section], kind);
  entityDialog.checked = entityDialog.items.map(item => item.name);
  entityDialog.style ||= script.value.setup?.style.prompt || script.value.setup?.style.label || "";
  entityDialog.ratio = kind === "character" ? "16:9" : kind === "scene" ? "16:9" : "1:1";
  entityDialog.visible = true;
}
function entityPrompt(entity: ScriptEntity, style: string) {
  const brief = entityBrief(entity);
  const head = style.trim() ? `${style.trim()}。` : "";
  if (entity.kind === "character") return `${head}角色设定图：${entity.name}。${brief}。角色三视图（正面、侧面、背面）加面部特写，全身站姿，纯白背景，造型清晰，无文字。`;
  if (entity.kind === "scene") return `${head}场景概念图：${entity.name}。${brief}。不出现人物，广角全景，交代空间结构与光线氛围，无文字。`;
  return `${head}道具设定图：${entity.name}。${brief}。单个道具多角度展示，纯白背景，材质细节清晰，无文字。`;
}
async function createEntityImages() {
  if (entityDialog.busy || !checkedEntities.value.length) return;
  entityDialog.busy = true;
  try {
    const self = flow.findNode(id);
    if (!self) throw new Error("剧本节点已不在画布上");
    const style = entityDialog.style;
    const items = checkedEntities.value.map(entity => {
      const prompt = entityPrompt(entity, style);
      return {
        type: "remote-imageGenerationNode",
        label: `${entityKindLabel.value} · ${entity.name}`,
        width: 360, height: 300,
        data: { prompt, promptModel: prompt.split("\n").map(text => [{ type: "Write", text }]), ratio: entityDialog.ratio, scriptSource: { nodeId: id, kind: entity.kind, name: entity.name } },
      };
    });
    const { ids } = addGroupedNodes(flow, self, `${entityKindLabel.value} · ${script.value.title}`, items, { columns: 4, groupData: { scriptSource: { nodeId: id, kind: entityDialog.kind } } });
    entityDialog.visible = false;
    if (entityDialog.generate) {
      let failed = 0;
      for (const nodeId of ids) await callNode(nodeId, "node:generateImage").catch(() => { failed++; });
      if (failed) ElMessage.warning(`${failed} 个节点未能开始生成，请检查图片模型设置后在节点上重试`);
      else ElMessage.success(`已开始生成 ${ids.length} 张${entityKindLabel.value}`);
    } else ElMessage.success(`已创建 ${ids.length} 个图片生成节点`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "创建失败");
  } finally { entityDialog.busy = false; }
}

// —— 给 Agent 的节点函数 ——
const sectionEnum = z.enum(["outline", "characters", "scenes", "props"]);
function ensureReady() {
  if (!file.ready.value) throw new Error(file.state.error || "剧本尚未加载");
}
nodeTools.register({
  name: "getScript",
  description: "读取此剧本节点。不传 part 返回目录概览（标题、设定、各分区字数、分集列表）；part 为 outline/characters/scenes/props 返回该分区 Markdown；part 为 episode 时用 episodeIndex（从 1 开始）读取某一集",
  parameters: z.strictObject({ part: z.enum(["outline", "characters", "scenes", "props", "episode"]).optional(), episodeIndex: z.number().int().positive().optional() }),
  execute({ part, episodeIndex }) {
    ensureReady();
    const value = script.value;
    if (!part) return {
      title: value.title, kind: value.kind, setup: setupSummary(value.setup) || null,
      sections: Object.fromEntries(scriptSections.map(item => [item.key, { label: item.label, characters: value.sections[item.key].length }])),
      episodes: value.episodes.map((item, index) => ({ index: index + 1, title: item.title, characters: item.content.length })),
    };
    if (part === "episode") {
      const episode = value.episodes[(episodeIndex ?? 1) - 1];
      if (!episode) throw new Error(`第 ${episodeIndex ?? 1} 集不存在，共 ${value.episodes.length} 集`);
      return { index: episodeIndex ?? 1, title: episode.title, content: episode.content };
    }
    return { part, content: value.sections[part] };
  },
});
nodeTools.register({
  name: "setTitle",
  description: "修改剧本标题（同时作为节点名称）",
  parameters: z.strictObject({ title: z.string().min(1).max(120) }),
  async execute({ title }) {
    ensureReady();
    script.value.title = title;
    changed();
    await file.flush();
    return { title };
  },
});
nodeTools.register({
  name: "writeSection",
  description: "写入剧本的固定分区：outline 故事大纲、characters 人物小传（每人一个「## 名字」，字段写成「- **字段**：值」）、scenes 场景设计（每个场景一个「## 名字」）、props 道具设计（每个道具一个「## 名字」）。mode=replace 覆盖整个分区，append 追加到末尾",
  parameters: z.strictObject({ section: sectionEnum, content: z.string(), mode: z.enum(["replace", "append"]).default("replace") }),
  async execute({ section, content, mode }) {
    ensureReady();
    const previous = script.value.sections[section];
    script.value.sections[section] = mode === "append" && previous.trim() ? `${previous.trimEnd()}\n\n${content.trim()}\n` : content;
    changed();
    await file.flush();
    return { section, characters: script.value.sections[section].length };
  },
});
nodeTools.register({
  name: "writeEpisode",
  description: "写入一集剧本（小说为一章）。index 从 1 开始；index 等于现有集数 + 1 时新增一集。content 为完整的本集 Markdown（以「# 第N集：标题」开头，场次用「### N-M｜地点 日/夜 / 内/外」，动作行以「△」开头，台词写成「**角色：**」换行后接台词）。mode=append 时追加到本集末尾",
  parameters: z.strictObject({ index: z.number().int().positive(), title: z.string().min(1).max(120), content: z.string(), mode: z.enum(["replace", "append"]).default("replace") }),
  async execute({ index, title, content, mode }) {
    ensureReady();
    const episodes = script.value.episodes;
    if (index > episodes.length + 1) throw new Error(`只能写第 1 到第 ${episodes.length + 1} 集`);
    const existing = episodes[index - 1];
    if (existing) {
      existing.title = title;
      existing.content = mode === "append" && existing.content.trim() ? `${existing.content.trimEnd()}\n\n${content.trim()}\n` : content;
    } else episodes.push({ id: crypto.randomUUID(), title, content });
    changed();
    await file.flush();
    return { index, title, characters: episodes[index - 1]!.content.length, totalEpisodes: episodes.length };
  },
});
nodeTools.register({
  name: "replaceText",
  description: "在某个分区或某一集里把一段原文替换为新文字（原文必须完整出现且只出现一次），用于局部修改",
  parameters: z.strictObject({ part: z.enum(["outline", "characters", "scenes", "props", "episode"]), episodeIndex: z.number().int().positive().optional(), find: z.string().min(1), replace: z.string() }),
  async execute({ part, episodeIndex, find, replace }) {
    ensureReady();
    const episode = part === "episode" ? script.value.episodes[(episodeIndex ?? 1) - 1] : undefined;
    if (part === "episode" && !episode) throw new Error("指定的集不存在");
    const source = episode ? episode.content : script.value.sections[part as ScriptSectionKey];
    const count = source.split(find).length - 1;
    if (count !== 1) throw new Error(count ? `原文出现了 ${count} 次，请提供更长、唯一的原文` : "没有找到原文，请先用 getScript 读取最新内容");
    const next = source.replace(find, replace);
    if (episode) episode.content = next; else script.value.sections[part as ScriptSectionKey] = next;
    changed();
    await file.flush();
    return { part, episodeIndex, replaced: true };
  },
});
nodeTools.register({
  name: "deleteEpisode",
  description: "删除某一集（index 从 1 开始），后面的集序号前移",
  parameters: z.strictObject({ index: z.number().int().positive() }),
  async execute({ index }) {
    ensureReady();
    if (!script.value.episodes[index - 1]) throw new Error("指定的集不存在");
    const [removed] = script.value.episodes.splice(index - 1, 1);
    changed();
    await file.flush();
    return { removed: removed!.title, totalEpisodes: script.value.episodes.length };
  },
});
</script>

<style lang="scss" scoped>
.scriptCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;

  .cardHeader {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: center;

    .cardTitle {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      max-width: 72%;

      strong { font-size: 18px; line-height: 1.4; text-align: center; overflow-wrap: anywhere; }
      small { color: var(--el-text-color-secondary); font-size: 12px; }
    }

    .editButton { position: absolute; top: 0; right: 0; }
  }

  .cardBody {
    display: flex;
    gap: 12px;
    min-height: 140px;

    .cardNav {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 76px;
      flex-shrink: 0;

      button {
        padding: 5px 6px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--el-text-color-placeholder);
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;

        &.filled { color: var(--el-text-color-regular); }
        &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); font-weight: 600; }
      }
    }

    .cardPreview {
      flex: 1;
      min-width: 0;
      max-height: 240px;
      overflow: auto;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--el-fill-color-lighter);
      font-size: 12px;
      user-select: none;

      :deep(.textNodeMarkdown) { font-size: 12px; line-height: 1.7;
        h1, h2, h3, h4 { margin: 8px 0 4px; font-size: 13px; }
        p, ul, ol, blockquote { margin: 4px 0; }
      }
      .placeholder { margin: 40px 0; color: var(--el-text-color-placeholder); text-align: center; }

      .episodeList {
        margin: 0;
        padding-left: 18px;

        li { padding: 4px 0; cursor: pointer;
          small { margin-left: 8px; color: var(--el-text-color-secondary); }
          &:hover { color: var(--el-color-primary); }
        }
      }
    }
  }
}

.scriptToolbar :deep(.el-card__body) { display: flex; align-items: center; gap: 2px; }
.scriptToolbar .el-button { margin: 0; }

.promptCard {
  .promptRow {
    display: flex;
    align-items: flex-end;
    gap: 8px;

    .sendButton {
      width: 32px;
      height: 32px;
      margin: 0;
      padding: 0;
      --el-button-bg-color: var(--el-text-color-primary);
      --el-button-border-color: transparent;
      --el-button-text-color: var(--el-bg-color);
    }
  }
}

.dialogHeader {
  display: flex;
  align-items: center;
  gap: 12px;

  > span:first-child { font-weight: 600; margin-right: auto; }
  .modelSelect { width: 220px; }
  .saveState { color: var(--el-text-color-secondary); font-size: 12px; }
}

.entityTip { margin: 0 0 8px; color: var(--el-text-color-secondary); }
.entityEmpty { color: var(--el-color-warning); }
.entityList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  margin-bottom: 12px;
  overflow: auto;

  :deep(.el-checkbox__label) { display: flex; gap: 8px; align-items: baseline; }
  small { color: var(--el-text-color-secondary); }
}
.entityOptions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
</style>

<style lang="scss">
.scriptEditorDialog {
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color) !important;
  backdrop-filter: none !important;

  .el-dialog__body { flex: 1; min-height: 0; padding-top: 0; }
}
</style>
