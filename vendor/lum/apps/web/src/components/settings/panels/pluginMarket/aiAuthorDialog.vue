<template>
  <el-dialog v-model="visible" :title="isSkill ? 'AI Skill 制作' : 'AI 插件开发'" width="min(820px, calc(100vw - 24px))"
    alignCenter appendToBody :closeOnClickModal="false" :beforeClose="close" @closed="emit('closed')">
    <div class="authorForm">
      <label for="authorModel">文本模型</label>
      <div class="modelRow">
        <el-select id="authorModel" v-model="modelKey" filterable :loading="loadingModels" :disabled="busy" aria-label="文本模型">
          <el-option v-for="model in models" :key="keyOf(model)" :value="keyOf(model)" :label="model.providerLabel + ' · ' + (model.label || model.modelId)" />
        </el-select>
        <el-button :disabled="busy || loadingModels" @click="loadModels(true)">刷新模型</el-button>
      </div>
      <el-alert v-if="!loadingModels && !models.length && !error" type="info" title="请先在模型设置中配置文本模型，再刷新列表。" :closable="false" />
      <label for="authorPrompt">{{ draft ? "修改要求" : isSkill ? "技能需求" : "工具插件需求" }}</label>
      <el-input id="authorPrompt" v-model="prompt" type="textarea" :rows="2" :disabled="busy"
        :placeholder="draft ? '描述要调整的内容，也可以在源码中选中一段后修改。' : isSkill ? '说明技能的适用场景、步骤和期望输出。' : '描述工具的用途、输入和期望返回的结果。'" />
      <div class="generateRow">
        <el-button type="primary" :loading="generating" :disabled="busy || !selectedModel || !prompt.trim()" @click="generate">
          {{ !draft ? "生成草稿" : hasSelection ? "修改选中内容" : "修改草稿" }}
        </el-button>
        <el-button v-if="generating" @click="controller?.abort()">停止生成</el-button>
        <span v-if="generating" role="status">{{ received }} 字符</span>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" showIcon />
      <template v-if="editorOpen">
        <div class="draftHeader">
          <label v-if="!preview" for="authorSource">{{ isSkill ? "SKILL.md 源码" : "工具插件源码 · .tool.js" }}</label>
          <span v-else>SKILL.md 预览</span>
          <el-button v-if="isSkill" size="small" :disabled="busy" @click="preview = !preview; hasSelection = false">{{ preview ? "编辑源码" : "预览正文" }}</el-button>
        </div>
        <messageMarkdown v-if="preview" :content="draft.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')" />
        <textarea v-else id="authorSource" ref="sourceInput" v-model="draft" :readonly="busy" spellcheck="false"
          @select="readSelection" @click="readSelection" @keyup="readSelection" @input="readSelection"></textarea>
        <small v-if="!isSkill">工具将在 Lum 服务端执行。安装前请检查源码及其读写操作。</small>
      </template>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="close()">关闭</el-button>
      <el-button v-if="editorOpen" :disabled="busy || !draft.trim()" @click="save(false)">{{ isSkill ? "下载 SKILL.md" : "下载 .tool.js" }}</el-button>
      <el-button v-if="editorOpen" type="primary" :disabled="busy || !draft.trim() || installedDraft === draft" @click="save(true)">
        {{ installedDraft && installedDraft === draft ? "已安装" : "安装到本机" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, shallowRef } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { invalidateNodeModels, useNodeAi, type NodeAiModel } from "@lum/nodes-scaffold/nodeAi";
import { toolMetadataSchema } from "@lum/tools-scaffold/runtime";
import saveFile from "@/lib/saveFile";
import { installPluginFile } from "../../installPluginFile";

const props = defineProps<{ type: "tool" | "skill" }>();
const emit = defineEmits<{ closed: [] }>();
const ai = useNodeAi();
const isSkill = computed(() => props.type === "skill");
const visible = ref(true);
const prompt = ref("");
const draft = ref("");
const savedDraft = ref("");
const installedDraft = ref("");
const editorOpen = ref(false);
const preview = ref(false);
const messageMarkdown = defineAsyncComponent(() => import("@/components/messageMarkdown.vue"));
const models = shallowRef<NodeAiModel[]>([]);
const modelKey = ref("");
const loadingModels = ref(true);
const generating = ref(false);
const saving = ref(false);
const busy = computed(() => generating.value || saving.value);
const received = ref(0);
const controller = shallowRef<AbortController>();
const sourceInput = ref<HTMLTextAreaElement>();
const hasSelection = ref(false);
const error = ref("");
const keyOf = (model: NodeAiModel) => JSON.stringify([model.providerId, model.modelId]);
const selectedModel = computed(() => models.value.find(model => keyOf(model) === modelKey.value));

const skillPrompt = `制作一个可直接安装的 Lum 单文件 SKILL.md。第一行是 ---，YAML 前言必须有 name（不超过64字符的小写短横线英文标识）和 description（1至1024字符，说明何时使用），建议在 metadata 中提供 displayName 和字符串 version "1.0.0"。以 --- 结束前言，Markdown 正文包含可操作步骤和输出约定。不要依赖未提供的附件。`;
const toolPrompt = `编写可直接安装的 Lum 服务端单文件 ESM JavaScript 工具插件。首行必须严格为 /*! lumTool:<单行 JSON 对象> */。元数据示例：
/*! lumTool:{"name":"countWords","displayName":"字数统计","description":"统计输入文本的字数","version":"1.0.0","author":"Local","github":"","configRules":[]} */
工具标识使用不超过 64 字符的小驼峰英文，不得冒用内置工具名。输出纯 JavaScript。协议示例：
export default {
  validateConfig() { return {}; },
  createTools(context) {
    return [{ name: "countWords", label: "字数统计", description: "统计输入文本的字数",
      parameters: {type:"object",properties:{text:{type:"string"}},required:["text"]},
      async execute(id, args, signal) {
        signal?.throwIfAborted();
        if (typeof args.text !== "string") throw new Error("需要文本");
        const count = Array.from(args.text).length;
        return {content:[{type:"text",text:String(count)}],details:{count}};
      }
    }];
  }
};
按实际需求实现完整功能，工具名称与本包 name 保持一致。工具不需要外部依赖或客户端组件。工作区文件使用 context.files.readFile(path) 或 context.files.writeFile(path, content, true)。只在 execute 内进行所需操作，模块加载及注册工具时不要执行任务。`;

function errorText(reason: unknown) {
  if (axios.isAxiosError(reason) && typeof reason.response?.data?.message === "string") return reason.response.data.message;
  return reason instanceof Error ? reason.message : "操作失败，请重试";
}

async function loadModels(refresh = false) {
  loadingModels.value = true;
  error.value = "";
  try {
    if (refresh) invalidateNodeModels("language");
    models.value = await ai.getModels();
    const model = selectedModel.value ?? models.value.find(item => item.isDefault) ?? models.value[0];
    modelKey.value = model ? keyOf(model) : "";
  } catch (reason) {
    models.value = [];
    error.value = errorText(reason);
  } finally {
    loadingModels.value = false;
  }
}
onMounted(() => loadModels());

function readSelection() {
  const input = sourceInput.value;
  hasSelection.value = !!input && input.selectionEnd > input.selectionStart;
}

async function generate() {
  const model = selectedModel.value;
  if (busy.value || !model || !prompt.value.trim()) return;
  const current = draft.value;
  const start = sourceInput.value?.selectionStart ?? 0;
  const end = sourceInput.value?.selectionEnd ?? 0;
  const partial = end > start;
  const request = new AbortController();
  controller.value = request;
  generating.value = true;
  error.value = "";
  received.value = 0;
  try {
    const instruction = partial ? "只返回选区的替换文本，保留所需缩进及换行。" : "返回完整文件，不要外层代码围栏或解释。";
    const result = await ai.generate({
      providerId: model.providerId, modelId: model.modelId, signal: request.signal, requireComplete: true,
      systemPrompt: [isSkill.value ? skillPrompt : toolPrompt, instruction].join("\n"),
      prompt: JSON.stringify({ request: prompt.value.trim(), ...(current ? { currentFile: current } : {}),
        ...(partial ? { selection: current.slice(start, end), start, end } : {}) }),
      onEvent(event) { if (event.type === "text") received.value += event.delta.length; },
    });
    request.signal.throwIfAborted();
    if (!result.text.trim()) throw new Error("模型没有返回文件内容，请调整要求后重试");
    const full = result.text.trim().replace(/^```(?:javascript|js|markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i, "$1");
    draft.value = partial ? current.slice(0, start) + result.text + current.slice(end) : full + "\n";
    editorOpen.value = true;
    preview.value = false;
    hasSelection.value = false;
    sourceInput.value?.setSelectionRange(0, 0);
    prompt.value = "";
  } catch (reason) {
    if (!request.signal.aborted) error.value = errorText(reason);
  } finally {
    generating.value = false;
    controller.value = undefined;
  }
}

function draftFile() {
  if (isSkill.value) return new File([draft.value], "SKILL.md", { type: "text/markdown" });
  const header = draft.value.match(/^\/\*! lumTool:([^\r\n]*) \*\/(?:\r?\n|$)/);
  let metadata;
  try { metadata = toolMetadataSchema.parse(JSON.parse(header?.[1] ?? "")); }
  catch { throw new Error("请检查工具首行 lumTool 元数据，包括英文 name、displayName、description、author、github 和 configRules。"); }
  return new File([draft.value], metadata.name + ".tool.js", { type: "text/javascript" });
}

async function save(install: boolean) {
  if (busy.value || !draft.value.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    const file = draftFile();
    if (install) {
      await installPluginFile(props.type, file, "createOnly");
      installedDraft.value = draft.value;
      ElMessage.success("已安装到本机");
    } else if (!await saveFile(file, file.name)) return;
    savedDraft.value = draft.value;
  } catch (reason) {
    error.value = errorText(reason);
  } finally { saving.value = false; }
}

async function close() {
  if (saving.value) return;
  if (draft.value !== savedDraft.value) {
    try {
      await ElMessageBox.confirm("当前草稿还有未保存的修改，确定关闭？", "关闭草稿", { confirmButtonText: "关闭", cancelButtonText: "继续编辑" });
    } catch { return; }
  }
  controller.value?.abort();
  visible.value = false;
}
</script>

<style scoped lang="scss">
.authorForm {
  display: grid;
  gap: 9px;
  max-height: 65dvh;
  overflow-y: auto;
  label { margin-top: 6px; color: var(--el-text-color-primary); font-weight: 600; }
  .modelRow, .generateRow, .draftHeader { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .draftHeader { justify-content: space-between; }
  .modelRow .el-select { flex: 1 1 200px; }
  .generateRow .el-button { margin-left: 0; }
  .generateRow span, small { color: var(--el-text-color-secondary); font-size: 12px; }
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 180px;
    height: 28vh;
    resize: vertical;
    padding: 10px 12px;
    background: var(--el-fill-color-blank);
    border: 1px solid var(--el-border-color);
    border-radius: var(--el-border-radius-base);
    color: var(--el-text-color-primary);
    font: 13px/1.55 ui-monospace, Consolas, monospace;
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
  }
}
</style>
