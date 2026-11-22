<template>
  <div class="promptBoard">
    <header class="boardHeader">
      <el-checkbox :modelValue="allChecked" :indeterminate="checked.length > 0 && !allChecked" @change="toggleAll">全选</el-checkbox>
      <span class="count">{{ document.shots.filter(shot => shot.imagePrompt && shot.videoPrompt).length }}/{{ document.shots.length }} 已合成</span>
      <span class="spacer" />
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="smart">智能合成</el-radio-button>
        <el-radio-button value="concat">自动拼接</el-radio-button>
      </el-radio-group>
      <template v-if="mode === 'smart'">
        <el-select :modelValue="selectedKey" size="small" class="modelSelect" filterable placeholder="语言模型" aria-label="语言模型" noDataText="请先在设置中添加文本模型"
          :loading="textModel.loading.value" :disabled="running" @update:modelValue="textModel.choose($event)">
          <el-option-group v-for="provider in textModel.groups.value" :key="provider.id" :label="provider.label">
            <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
          </el-option-group>
        </el-select>
        <el-select :modelValue="textModel.thinkingLevel.value || 'auto'" size="small" class="thinkingSelect" aria-label="推理挡位"
          :disabled="running || !textModel.reasoningLevels.value.length" :title="textModel.reasoningLevels.value.length ? '推理挡位越高越慢、越贵，提示词通常更细' : '所选模型没有可调的推理挡位'"
          @update:modelValue="textModel.chooseThinking($event === 'auto' ? '' : $event)">
          <el-option value="auto" label="推理：默认" />
          <el-option v-for="level in textModel.reasoningLevels.value" :key="level" :label="`推理：${thinkingLevelLabels[level] ?? level}`" :value="level" />
        </el-select>
      </template>
      <el-button type="primary" :loading="running" :disabled="!checked.length" @click="emit('synthesize', [...checked], mode)">一键合成所选提示词（{{ checked.length }}）</el-button>
    </header>
    <p class="modeTip">{{ mode === "smart" ? "智能合成：由所选语言模型把剧本、分镜和资产写成完整提示词，更自然，会调用模型；模型和推理挡位与节点下方的文本模型是同一项设置。" : "自动拼接：本地按模板把角色、场景、道具、画面、光影、运镜和对白拼起来，即时完成，不调用模型。" }}</p>
    <article v-for="(shot, index) in document.shots" :id="`shotPrompt-${shot.id}`" :key="shot.id" class="shotPrompt" :class="{ focused: focusShot === shot.id }">
      <header>
        <el-checkbox :modelValue="checked.includes(shot.id)" @change="toggle(shot.id)" />
        <strong>第 {{ index + 1 }} 镜</strong>
        <small>{{ shot.duration }}s · {{ shot.shotSize }}</small>
        <span class="summary">{{ shot.description }}</span>
        <el-button size="small" :loading="busy.has(shot.id)" @click="emit('synthesize', [shot.id], mode)">重新合成提示词</el-button>
      </header>
      <div class="promptColumns">
        <label>
          <span>分镜提示词 <em v-if="shot.imagePrompt">已生成 · 自动保存</em></span>
          <el-input v-model="shot.imagePrompt" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }" placeholder="用于生成这一镜的分镜图" @input="emit('change')" />
        </label>
        <label>
          <span>视频运动提示词 <em v-if="shot.videoPrompt">已生成 · 自动保存</em></span>
          <el-input v-model="shot.videoPrompt" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }" placeholder="用于图生视频：出场角色、背景场景、动作、运镜、对白、参考图规则" @input="emit('change')" />
        </label>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElButton, ElCheckbox, ElInput, ElOption, ElOptionGroup, ElRadioButton, ElRadioGroup, ElSelect } from "element-plus";
import { thinkingLevelLabels, type useTextModel } from "@lum/node-shared/useTextModel";
import type { ShotDocument } from "./shotData";

const props = defineProps<{ document: ShotDocument; busy: Set<string>; running: boolean; focusShot?: string; textModel: ReturnType<typeof useTextModel> }>();
const selectedKey = computed(() => { const model = props.textModel.selected.value; return model ? JSON.stringify([model.providerId, model.modelId]) : ""; });
const emit = defineEmits<{ change: []; synthesize: [shotIds: string[], mode: "smart" | "concat"] }>();
const mode = ref<"smart" | "concat">("smart");
const checked = ref<string[]>(props.document.shots.filter(shot => !shot.imagePrompt || !shot.videoPrompt).map(shot => shot.id));
const allChecked = computed(() => props.document.shots.length > 0 && checked.value.length === props.document.shots.length);
function toggle(id: string) { checked.value = checked.value.includes(id) ? checked.value.filter(item => item !== id) : [...checked.value, id]; }
function toggleAll() { checked.value = allChecked.value ? [] : props.document.shots.map(shot => shot.id); }
watch(() => props.focusShot, async id => {
  if (!id) return;
  await nextTick();
  document.getElementById(`shotPrompt-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}, { immediate: true });
</script>

<style lang="scss" scoped>
.promptBoard {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .boardHeader {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    background: var(--el-bg-color);

    .count { color: var(--el-text-color-secondary); font-size: 13px; }
    .spacer { flex: 1; }
    .modelSelect { width: 210px; }
    .thinkingSelect { width: 120px; }
  }

  .modeTip { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; }

  .shotPrompt {
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;

    &.focused { border-color: var(--el-color-primary); }

    header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;

      small { color: var(--el-text-color-secondary); }
      .summary { flex: 1; min-width: 0; overflow: hidden; color: var(--el-text-color-regular); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    }

    .promptColumns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;

      label {
        display: flex;
        flex-direction: column;
        gap: 4px;

        span { color: var(--el-text-color-secondary); font-size: 12px; em { margin-left: 6px; color: var(--el-color-success); font-style: normal; } }
      }
    }
  }
}
</style>
