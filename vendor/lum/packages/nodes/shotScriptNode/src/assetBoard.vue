<template>
  <div class="assetBoard">
    <div class="styleRow">
      <el-tag size="small" effect="dark">全局风格</el-tag>
      <el-input v-model="document.style" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="所有资产和分镜共用的视觉风格" aria-label="全局风格" @change="emit('change')" />
    </div>
    <section v-for="kind in kinds" :key="kind" class="assetSection">
      <h4>{{ assetKindLabels[kind] }}</h4>
      <div class="assetGrid">
        <div v-for="asset in document.assets.filter(item => item.kind === kind)" :key="asset.id" class="assetCard">
          <div class="assetImage" @click="openSource(asset)">
            <assetThumb :image="asset.image" :alt="asset.name">生成或上传{{ assetKindLabels[kind] }}图</assetThumb>
            <span v-if="busy.has(asset.id)" class="assetBusy">生成中…</span>
          </div>
          <el-dropdown trigger="click" class="assetMenu" @command="(name: string) => runCommand(asset, name)">
            <el-button text size="small" :icon="IconDots" aria-label="资产操作" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="pick">选择图片</el-dropdown-item>
                <el-dropdown-item command="generate">AI 生{{ assetKindLabels[kind] }}</el-dropdown-item>
                <el-dropdown-item command="jump" :disabled="!asset.nodeId">跳转至节点</el-dropdown-item>
                <el-dropdown-item command="clear" :disabled="!asset.image">清除图片</el-dropdown-item>
                <el-dropdown-item command="library" :disabled="!asset.image">保存到共用资产库</el-dropdown-item>
                <el-dropdown-item command="edit" divided>编辑描述</el-dropdown-item>
                <el-dropdown-item command="delete">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <strong>{{ asset.name }}</strong>
          <small :title="asset.description">{{ asset.description || "暂无描述" }}</small>
        </div>
        <button type="button" class="assetCard addCard" @click="addAsset(kind)"><icon-plus :size="20" />新增</button>
      </div>
    </section>
    <footer class="assetFooter">
      <span v-if="missing.length" class="missingTip"><icon-alert-circle :size="16" />检测到 {{ missingSummary }} 没有设定图，可以手动上传或 AI 批量生成</span>
      <span v-else class="missingTip done"><icon-circle-check :size="16" />资产都已就绪</span>
      <span class="spacer" />
      <imageSettingsBar :settings="imageSettings" :models="imageModels" :fallback="defaultImageModel" />
      <el-button type="primary" :disabled="!missing.length" @click="emit('generateAll')">一键生成所有资产</el-button>
    </footer>

    <el-dialog v-model="source.visible" :title="`选择图片（${source.asset?.name ?? ''}）`" width="min(720px, calc(100vw - 32px))" appendToBody>
      <el-tabs v-model="source.tab">
        <el-tab-pane label="AI 生成" name="ai">
          <p class="sourceTip">在画布上创建一个图片生成节点，用下面的描述生成；生成后自动绑定为这个资产的设定图。</p>
          <el-input v-model="source.prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" />
          <div class="sourceActions">
            <imageSettingsBar :settings="imageSettings" :models="imageModels" :fallback="defaultImageModel" />
            <el-button type="primary" @click="generateOne">创建并生成</el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="从当前画布选择" name="canvas">
          <p v-if="!canvasImages.length" class="sourceTip">画布上还没有带图片输出的节点。</p>
          <div class="canvasImages">
            <button v-for="item in canvasImages" :key="item.nodeId" type="button" class="canvasImage" @click="pickCanvas(item)">
              <assetThumb :image="item.image" :alt="item.label" /><span>{{ item.label }}</span>
            </button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="本地上传" name="upload">
          <p class="sourceTip">选择本地图片，上传到这个脚本节点的文件夹。</p>
          <input type="file" accept="image/*" aria-label="选择本地图片" @change="upload" />
        </el-tab-pane>
        <el-tab-pane label="共用资产库" name="library">
          <p class="sourceTip">从画布左下角「资产管理」把共用资产拖到画布上，再到「从当前画布选择」里绑定。</p>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <el-dialog v-model="editor.visible" :title="editor.isNew ? `新增${assetKindLabels[editor.kind]}` : `编辑「${editor.name}」`" width="min(480px, calc(100vw - 32px))" appendToBody>
      <el-input v-model="editor.name" placeholder="名称（镜头里用 @名称 引用）" maxlength="80" />
      <el-input v-model="editor.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="外形、服装、材质或空间描述" style="margin-top: 8px" />
      <template #footer>
        <el-button @click="editor.visible = false">取消</el-button>
        <el-button type="primary" :disabled="!editor.name.trim()" @click="saveEditor">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { ElButton, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElMessage, ElMessageBox, ElTabPane, ElTabs, ElTag } from "element-plus";
import { IconAlertCircle, IconCircleCheck, IconDots, IconPlus } from "@tabler/icons-vue";
import type { NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import assetThumb from "./assetThumb.vue";
import imageSettingsBar from "./imageSettingsBar.vue";
import type { ImageSettings } from "./imageSettings";
import { assetKindLabels, type AssetKind, type ShotAsset, type ShotDocument } from "./shotData";

const props = defineProps<{
  document: ShotDocument;
  busy: Set<string>;
  canvasImages: { nodeId: string; label: string; image: { path: string; mimeType: string } }[];
  assetPrompt: (asset: ShotAsset) => string;
  imageSettings: ImageSettings;
  imageModels: NodeMediaModel[];
  defaultImageModel?: NodeMediaModel;
}>();
const emit = defineEmits<{
  change: [];
  generateAll: [];
  generate: [asset: ShotAsset, prompt: string];
  upload: [asset: ShotAsset, file: File];
  jump: [asset: ShotAsset];
  library: [asset: ShotAsset];
  remove: [asset: ShotAsset, stripMentions: boolean];
}>();
const kinds: AssetKind[] = ["character", "scene", "prop"];
const missing = computed(() => props.document.assets.filter(item => !item.image));
const missingSummary = computed(() => kinds.flatMap(kind => {
  const count = missing.value.filter(item => item.kind === kind).length;
  return count ? [`${count} 个${assetKindLabels[kind]}`] : [];
}).join("、"));
const source = reactive({ visible: false, tab: "ai", asset: undefined as ShotAsset | undefined, prompt: "" });
const editor = reactive({ visible: false, isNew: false, kind: "character" as AssetKind, name: "", description: "", asset: undefined as ShotAsset | undefined });

function openSource(asset: ShotAsset, tab = "canvas") {
  source.asset = asset;
  source.prompt = props.assetPrompt(asset);
  source.tab = tab;
  source.visible = true;
}
function generateOne() {
  if (!source.asset) return;
  emit("generate", source.asset, source.prompt);
  source.visible = false;
}
function pickCanvas(item: { nodeId: string; image: { path: string; mimeType: string } }) {
  const asset = source.asset;
  if (!asset) return;
  asset.image = { ...item.image };
  asset.nodeId = item.nodeId;
  emit("change");
  source.visible = false;
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !source.asset) return;
  if (!file.type.startsWith("image/")) { ElMessage.error("请选择图片文件"); return; }
  emit("upload", source.asset, file);
  source.visible = false;
}
async function runCommand(asset: ShotAsset, name: string) {
  if (name === "pick") openSource(asset, "canvas");
  else if (name === "generate") openSource(asset, "ai");
  else if (name === "jump") emit("jump", asset);
  else if (name === "library") emit("library", asset);
  else if (name === "clear") { asset.image = null; asset.nodeId = null; emit("change"); }
  else if (name === "edit") Object.assign(editor, { visible: true, isNew: false, kind: asset.kind, name: asset.name, description: asset.description, asset });
  else if (name === "delete") {
    const choice = await ElMessageBox.confirm(`删除资产「${asset.name}」后，镜头表里的 @${asset.name} 怎么处理？`, "删除资产", {
      distinguishCancelAndClose: true, confirmButtonText: "同时去掉镜头里的 @ 引用", cancelButtonText: "仅删除资产，保留文字", type: "warning",
    }).then(() => "strip", action => action === "cancel" ? "keep" : "");
    if (choice) emit("remove", asset, choice === "strip");
  }
}
function addAsset(kind: AssetKind) {
  Object.assign(editor, { visible: true, isNew: true, kind, name: "", description: "", asset: undefined });
}
function saveEditor() {
  const name = editor.name.trim().replace(/^@/, "").replace(/\s+/g, "");
  if (!name) return;
  if (props.document.assets.some(item => item.name === name && item !== editor.asset)) { ElMessage.error("已有同名资产"); return; }
  if (editor.asset) {
    const previous = editor.asset.name;
    editor.asset.name = name;
    editor.asset.description = editor.description;
    // 改名时同步镜头里的 @引用。
    if (previous !== name) for (const shot of props.document.shots) shot.description = shot.description.split(`@${previous}`).join(`@${name}`);
  } else props.document.assets.push({ id: crypto.randomUUID(), kind: editor.kind, name, description: editor.description, image: null, nodeId: null });
  editor.visible = false;
  emit("change");
}
</script>

<style lang="scss" scoped>
.assetBoard {
  display: flex;
  flex-direction: column;
  gap: 16px;

  .styleRow { display: flex; align-items: flex-start; gap: 10px; .el-tag { flex-shrink: 0; margin-top: 4px; } }

  .assetSection {
    h4 { margin: 0 0 8px; font-size: 14px; }

    .assetGrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;

      .assetCard {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;

        .assetImage {
          position: relative;
          aspect-ratio: 16 / 10;
          overflow: hidden;
          border: 1px solid var(--el-border-color-lighter);
          border-radius: 8px;
          background: var(--el-fill-color-light);
          cursor: pointer;

          .assetBusy { position: absolute; inset: auto 6px 6px auto; padding: 1px 6px; border-radius: 4px; background: rgb(0 0 0 / 60%); color: #fff; font-size: 11px; }
        }

        .assetMenu { position: absolute; top: 2px; right: 2px; }
        strong { font-size: 13px; }
        small { overflow: hidden; color: var(--el-text-color-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

        &.addCard {
          align-items: center;
          justify-content: center;
          aspect-ratio: 16 / 10;
          border: 1px dashed var(--el-border-color);
          border-radius: 8px;
          background: transparent;
          color: var(--el-text-color-secondary);
          font: inherit;
          cursor: pointer;
        }
      }
    }
  }

  .assetFooter {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    background: var(--el-bg-color);

    .spacer { flex: 1; }

    .missingTip { display: flex; align-items: center; gap: 6px; color: var(--el-color-warning); font-size: 13px; &.done { color: var(--el-color-success); } }
  }
}

.sourceTip { margin: 0 0 8px; color: var(--el-text-color-secondary); font-size: 13px; }
.sourceActions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
.canvasImages {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  max-height: 360px;
  overflow: auto;

  .canvasImage {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    :deep(.assetThumb) { aspect-ratio: 1; border-radius: 6px; }
    span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    &:hover { border-color: var(--el-color-primary); }
  }
}
</style>
