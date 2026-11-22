<template>
  <aside class="workbenchSettings" aria-label="生成设置">
    <h3>生成设置</h3>
    <fieldset :disabled="disabled">
      <legend>生成模式</legend>
      <label class="settingsRadio"><input v-model="plan.mode" type="radio" value="quality" />逐格生成 · {{ plan.cells.filter(cell => !cell.candidates.length || cell.candidates.at(-1)?.status === "queued").length }} 次待发请求 / {{ template.cells.length }} 格</label>
      <label class="settingsRadio"><input v-model="plan.mode" type="radio" value="sheet" />快速整张 · {{ !plan.sheetCandidates.length || plan.sheetCandidates.at(-1)?.status === "queued" ? 1 : 0 }} 次待发请求</label>
      <p>{{ plan.mode === "quality" ? "每格独立出图，可只重做其中一格。" : "一次生成整张联系表，需核对裁剪区域后拆图。" }}</p>
    </fieldset>
    <label class="settingsField">
      制作要求
      <textarea v-model="plan.requirements" :maxlength="imageWorkbenchLimits.requirements" rows="3" :disabled="disabled" />
    </label>
    <fieldset :disabled="disabled">
      <legend>策划 Skill</legend>
      <select :value="plan.skill.mode" aria-label="策划 Skill" @change="setSkillMode">
        <option value="none">不调用</option>
        <option value="auto">AI 从图片 Skill 库选择</option>
        <option value="manual">手动选择</option>
      </select>
      <template v-if="plan.skill.mode === 'manual'">
        <select :value="plan.skill.id ?? ''" aria-label="项目图片 Skill" @change="setSkillId">
          <option value="">选择项目图片 Skill</option>
          <option v-if="plan.skill.id && !skills.some(item => item.id === plan.skill.id)" :value="plan.skill.id" disabled>{{ plan.skill.id }} · 待核对</option>
          <option v-for="item in skills" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <el-button size="small" :loading="skillsLoading" @click="emit('loadSkills')">读取图片 Skill</el-button>
      </template>
      <p v-if="skillError && plan.skill.mode === 'manual'" role="alert" class="settingsError">{{ skillError }}</p>
      <p v-if="plan.skill.reason">{{ skillLabel }} · {{ plan.skill.reason }}</p>
    </fieldset>
    <fieldset :disabled="disabled || modelsLoading">
      <legend>策划语言模型</legend>
      <select :value="plan.languageModel.followDefaultModel ? '' : plan.languageModel.model" aria-label="策划语言模型" @change="setModel(plan.languageModel, $event)">
        <option value="">跟随全局默认</option>
        <option v-if="!plan.languageModel.followDefaultModel && plan.languageModel.model && !languageModels.some(item => modelKey(item) === plan.languageModel.model)" :value="plan.languageModel.model" disabled>原有模型已不可用</option>
        <option v-for="item in languageModels" :key="modelKey(item)" :value="modelKey(item)">{{ item.label }} · {{ item.providerLabel }}</option>
      </select>
      <p v-if="plan.languageModel.followDefaultModel">{{ languageModel?.label ?? "暂无可用语言模型" }}</p>
    </fieldset>
    <fieldset :disabled="disabled || modelsLoading">
      <legend>普通图片生成模型</legend>
      <select :value="plan.imageModel.followDefaultModel ? '' : plan.imageModel.model" aria-label="普通图片生成模型" @change="setModel(plan.imageModel, $event)">
        <option value="">跟随全局默认</option>
        <option v-if="!plan.imageModel.followDefaultModel && plan.imageModel.model && !imageModels.some(item => modelKey(item) === plan.imageModel.model)" :value="plan.imageModel.model" disabled>原有模型已不可用</option>
        <option v-for="item in imageModels" :key="modelKey(item)" :value="modelKey(item)">{{ item.label }} · {{ item.providerLabel }}</option>
      </select>
      <p v-if="plan.imageModel.followDefaultModel">{{ imageModel?.label ?? "暂无可用图片模型" }}</p>
      <div class="settingsPair">
        <label>
          比例
          <select :value="plan.imageModel.ratio ?? ''" @change="setImageOption('ratio', $event)">
            <option value="">模型默认</option>
            <option v-if="plan.imageModel.ratio && !imageModel?.imageRatios?.includes(plan.imageModel.ratio)" :value="plan.imageModel.ratio" disabled>{{ plan.imageModel.ratio }} · 不可用</option>
            <option v-for="ratio in imageModel?.imageRatios" :key="ratio" :value="ratio">{{ ratio }}</option>
          </select>
        </label>
        <label>
          分辨率
          <select :value="plan.imageModel.size ?? ''" @change="setImageOption('size', $event)">
            <option value="">模型默认</option>
            <option v-if="plan.imageModel.size && !imageModel?.imageSizes?.includes(plan.imageModel.size)" :value="plan.imageModel.size" disabled>{{ plan.imageModel.size }} · 不可用</option>
            <option v-for="size in imageModel?.imageSizes" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
      </div>
    </fieldset>
    <p v-if="modelError" class="settingsError" role="alert">{{ modelError }}</p>
    <el-button size="small" :disabled="disabled" :loading="modelsLoading" @click="emit('loadModels')">刷新模型目录</el-button>
    <label class="settingsField">
      最大并发
      <el-input-number v-model="plan.concurrency" :min="1" :max="imageWorkbenchLimits.concurrency" :stepStrictly="true" :disabled="disabled" aria-label="最大并发" />
    </label>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElButton, ElInputNumber } from "element-plus";
import type { NodeAiModel, NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import type { MediaPromptSkill } from "@lum/node-shared/mediaPromptEditing";
import { imageWorkbenchLimits, type ImageWorkbenchState, type ImageWorkbenchModel, type ImageWorkbenchSkill } from "../imageWorkbench";
import type { ImageWorkbenchTemplate } from "../imageWorkbenchTemplates";

const props = defineProps<{
  plan: ImageWorkbenchState;
  template: ImageWorkbenchTemplate;
  disabled: boolean;
  modelsLoading: boolean;
  modelError: string;
  languageModels: readonly NodeAiModel[];
  imageModels: readonly NodeMediaModel[];
  languageModel?: NodeAiModel;
  imageModel?: NodeMediaModel;
  skills: readonly MediaPromptSkill[];
  skillsLoading: boolean;
  skillError: string;
}>();
const emit = defineEmits<{ loadSkills: []; loadModels: [] }>();
const skillLabel = computed(() => props.skills.find(item => item.id === props.plan.skill.id)?.name ?? props.plan.skill.id ?? "未采用 Skill");
const modelKey = (item: { providerId: string; modelId: string }) => JSON.stringify([item.providerId, item.modelId]);
const valueOf = (event: Event) => (event.target as HTMLSelectElement).value;

function setSkillMode(event: Event) {
  props.plan.skill = { mode: valueOf(event) as ImageWorkbenchSkill["mode"] };
}
function setSkillId(event: Event) {
  const id = valueOf(event);
  props.plan.skill = { mode: "manual", ...(id ? { id } : {}) };
}
function setModel(model: ImageWorkbenchModel, event: Event) {
  const id = valueOf(event);
  model.followDefaultModel = !id;
  model.model = id;
}
function setImageOption(option: "size" | "ratio", event: Event) {
  props.plan.imageModel[option] = valueOf(event) || undefined;
}
</script>

<style scoped lang="scss">
.workbenchSettings {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 16px;
  min-width: 0;
  h3, p { margin: 0; }
  p { color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
  .settingsError { color: var(--el-color-danger); }
  fieldset {
    border: 0;
    padding: 0;
    min-width: 0;
    width: 100%;
    display: grid;
    gap: 6px;
    margin: 0;
  }
  fieldset :deep(.el-button) { justify-self: start; }
  legend {
    margin-bottom: 6px;
    padding: 0;
    font-weight: 600;
  }
  .settingsRadio { display: flex; align-items: start; gap: 6px; }
  .settingsField { display: grid; gap: 6px; font-weight: 600; width: 100%; }
  .settingsPair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    label { display: grid; gap: 4px; min-width: 0; }
  }
  select, textarea {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 7px 8px;
    font: inherit;
    font-weight: 400;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    border: 1px solid var(--el-border-color);
    border-radius: var(--el-border-radius-base);
  }
  textarea { resize: vertical; }
}
</style>
