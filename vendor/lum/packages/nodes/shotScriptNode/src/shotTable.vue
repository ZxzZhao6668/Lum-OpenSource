<template>
  <div class="shotTable">
    <table>
      <colgroup>
        <col style="width: 52px" /><col style="width: 70px" /><col /><col style="width: 84px" /><col style="width: 150px" /><col style="width: 200px" /><col style="width: 140px" /><col style="width: 150px" /><col style="width: 104px" /><col style="width: 56px" />
      </colgroup>
      <thead>
        <tr><th>镜号</th><th>时长</th><th>画面描述</th><th>景别</th><th>光影氛围</th><th>对白·旁白</th><th>音效</th><th>运镜</th><th>最终提示词</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="(shot, index) in document.shots" :key="shot.id" :style="{ background: shot.color || undefined }">
          <td class="index">{{ index + 1 }}</td>
          <td class="editable" @click="edit($event, shot, 'duration')">{{ shot.duration }}s</td>
          <td class="editable description" @click="edit($event, shot, 'description')">
            <template v-for="(part, partIndex) in descriptionParts(shot.description)" :key="partIndex"><span v-if="part.asset" class="mention">@{{ part.text }}</span><template v-else>{{ part.text }}</template></template>
            <span v-if="!shot.description" class="placeholder">点击填写画面描述</span>
          </td>
          <td class="editable" @click="edit($event, shot, 'shotSize')">{{ shot.shotSize }}</td>
          <td class="editable" @click="edit($event, shot, 'lighting')">{{ shot.lighting || "—" }}</td>
          <td class="editable" @click="edit($event, shot, 'dialogues')">
            <p v-for="(line, lineIndex) in shot.dialogues" :key="lineIndex" class="dialogue"><b>{{ line.kind === "narration" ? "旁白" : line.speaker || "台词" }}：</b>{{ line.text }}</p>
            <span v-if="!shot.dialogues.length">—</span>
          </td>
          <td class="editable" @click="edit($event, shot, 'sound')">{{ shot.sound || "—" }}</td>
          <td class="editable" @click="edit($event, shot, 'camera')">{{ shot.camera || "—" }}</td>
          <td><el-button text size="small" :type="shot.imagePrompt ? 'primary' : 'info'" @click="emit('viewPrompt', shot.id)">{{ shot.imagePrompt ? "查看提示词" : "待生成提示词" }}</el-button></td>
          <td>
            <el-dropdown trigger="click" @command="(command: string) => rowCommand(command, shot, index)">
              <el-button text size="small" :icon="IconDots" aria-label="行操作" />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="above">上方插入镜头</el-dropdown-item>
                  <el-dropdown-item command="below">下方插入镜头</el-dropdown-item>
                  <el-dropdown-item v-for="color in rowColors" :key="color || 'none'" :command="`color:${color}`">
                    <span class="colorSwatch" :style="{ background: color || 'transparent' }" />{{ color ? "标注颜色" : "清除颜色" }}
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>删除该行</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </td>
        </tr>
      </tbody>
    </table>
    <el-button class="addShot" :icon="IconPlus" @click="addShot(document.shots.length)">添加镜头</el-button>

    <el-popover :visible="!!editing" :virtualRef="editing?.element" virtualTriggering placement="bottom-start" :width="editing?.field === 'description' ? 460 : editing?.field === 'dialogues' ? 420 : 320" :showArrow="false">
      <div v-if="editing" class="cellEditor" @keydown.esc.stop="close">
        <template v-if="editing.field === 'duration'">
          <el-input-number v-model="draft.duration" :min="1" :max="60" :step="1" size="small" /> 秒
        </template>
        <template v-else-if="editing.field === 'shotSize'">
          <div class="choiceList"><el-check-tag v-for="size in shotSizes" :key="size" :checked="draft.shotSize === size" @change="draft.shotSize = size; save()">{{ size }}</el-check-tag></div>
        </template>
        <template v-else-if="editing.field === 'dialogues'">
          <div v-for="(line, lineIndex) in draft.dialogues" :key="lineIndex" class="dialogueRow">
            <el-select v-if="line.kind === 'line'" v-model="line.speaker" size="small" filterable allowCreate placeholder="角色" style="width: 110px">
              <el-option v-for="name in characterNames" :key="name" :label="name" :value="name" />
            </el-select>
            <span v-else class="narrationTag">旁白</span>
            <el-input v-model="line.text" size="small" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="输入内容" />
            <el-button text size="small" :icon="IconX" aria-label="删除" @click="draft.dialogues.splice(lineIndex, 1)" />
          </div>
          <div class="editorActions">
            <el-button size="small" @click="draft.dialogues.push({ kind: 'line', speaker: '', text: '' })">＋ 台词</el-button>
            <el-button size="small" @click="draft.dialogues.push({ kind: 'narration', text: '' })">＋ 旁白</el-button>
          </div>
        </template>
        <template v-else>
          <el-input ref="textInput" v-model="draft[editing.field]" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" :placeholder="editing.field === 'description' ? '输入画面描述，点下方资产插入 @引用' : '输入内容'" />
          <div v-if="editing.field === 'description' && document.assets.length" class="assetChips">
            <el-tag v-for="asset in document.assets" :key="asset.id" size="small" effect="plain" class="assetChip" @click="insertMention(asset.name)">@{{ asset.name }}</el-tag>
          </div>
          <div v-if="editing.field === 'camera'" class="choiceList"><el-check-tag v-for="preset in cameraPresets" :key="preset" :checked="false" @change="draft.camera = draft.camera ? `${draft.camera}，${preset}` : preset">{{ preset }}</el-check-tag></div>
        </template>
        <div class="editorActions end">
          <el-button size="small" @click="close">取消</el-button>
          <el-button size="small" type="primary" @click="save">保存</el-button>
        </div>
      </div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from "vue";
import { ElButton, ElCheckTag, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElInputNumber, ElOption, ElPopover, ElSelect, ElTag } from "element-plus";
import { IconDots, IconPlus, IconX } from "@tabler/icons-vue";
import { cameraPresets, createShot, rowColors, shotSizes, type Shot, type ShotDocument } from "./shotData";

type Field = "duration" | "description" | "shotSize" | "lighting" | "dialogues" | "sound" | "camera";
const props = defineProps<{ document: ShotDocument }>();
const emit = defineEmits<{ change: []; viewPrompt: [shotId: string] }>();
const editing = ref<{ shot: Shot; field: Field; element: HTMLElement }>();
const draft = reactive<Pick<Shot, Field>>({ duration: 5, description: "", shotSize: "", lighting: "", dialogues: [], sound: "", camera: "" });
const textInput = ref<InstanceType<typeof ElInput>>();
const characterNames = computed(() => props.document.assets.filter(item => item.kind === "character").map(item => item.name));

function descriptionParts(text: string) {
  const names = props.document.assets.map(item => item.name).sort((a, b) => b.length - a.length);
  if (!names.length) return [{ text, asset: false }];
  const pattern = new RegExp(`@(${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts: { text: string; asset: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) parts.push({ text: text.slice(last, match.index), asset: false });
    parts.push({ text: match[1]!, asset: true });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), asset: false });
  return parts;
}
function edit(event: MouseEvent, shot: Shot, field: Field) {
  const element = (event.currentTarget as HTMLElement);
  Object.assign(draft, JSON.parse(JSON.stringify({ duration: shot.duration, description: shot.description, shotSize: shot.shotSize, lighting: shot.lighting, dialogues: shot.dialogues, sound: shot.sound, camera: shot.camera })));
  editing.value = { shot, field, element };
  void nextTick(() => textInput.value?.focus());
}
function close() { editing.value = undefined; }
function save() {
  const current = editing.value;
  if (!current) return;
  const field = current.field;
  if (field === "dialogues") current.shot.dialogues = draft.dialogues.filter(item => item.text.trim()).map(item => ({ ...item, text: item.text.trim() }));
  else (current.shot as Record<Field, unknown>)[field] = draft[field];
  emit("change");
  close();
}
function insertMention(name: string) {
  const textarea = textInput.value?.textarea;
  const at = textarea ? textarea.selectionStart : draft.description.length;
  draft.description = `${draft.description.slice(0, at)}@${name} ${draft.description.slice(at)}`;
}
function addShot(index: number) {
  props.document.shots.splice(index, 0, createShot());
  emit("change");
}
function rowCommand(command: string, shot: Shot, index: number) {
  if (command === "above") addShot(index);
  else if (command === "below") addShot(index + 1);
  else if (command === "delete") { props.document.shots.splice(index, 1); emit("change"); }
  else if (command.startsWith("color:")) { shot.color = command.slice(6); emit("change"); }
}
</script>

<style lang="scss" scoped>
.shotTable {
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 13px;

    th, td {
      padding: 8px;
      border-bottom: 1px solid var(--el-border-color-lighter);
      text-align: left;
      vertical-align: top;
    }

    th { position: sticky; top: 0; z-index: 1; background: var(--el-bg-color); color: var(--el-text-color-secondary); font-weight: 500; }
    td.index { color: var(--el-text-color-secondary); }
    td.editable { cursor: pointer; border-radius: 6px; &:hover { background: var(--el-fill-color-light); } }
    td.description { line-height: 1.7; }
    .mention { color: var(--el-color-primary); }
    .placeholder { color: var(--el-text-color-placeholder); }
    .dialogue { margin: 0 0 4px; }
  }

  .addShot { margin-top: 12px; }
}

.cellEditor {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .choiceList { display: flex; flex-wrap: wrap; gap: 6px; }
  .assetChips { display: flex; flex-wrap: wrap; gap: 4px; .assetChip { cursor: pointer; } }
  .dialogueRow { display: flex; align-items: flex-start; gap: 6px; .narrationTag { width: 110px; flex-shrink: 0; color: var(--el-text-color-secondary); line-height: 24px; } }
  .editorActions { display: flex; gap: 6px; &.end { justify-content: flex-end; } }
}

.colorSwatch { display: inline-block; width: 12px; height: 12px; margin-right: 6px; border: 1px solid var(--el-border-color); border-radius: 3px; vertical-align: -1px; }
</style>
