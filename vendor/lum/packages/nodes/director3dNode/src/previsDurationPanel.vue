<template>
  <details class="durationSettings">
    <summary>时长设置 · {{ duration }} 秒</summary>
    <div class="durationBody">
      <form class="durationForm" @submit.prevent="apply">
        <label>总时长（秒）<input v-model.number="seconds" aria-label="时间线总时长秒数" type="number" min="0.2" max="300" step="0.1" required :disabled="disabled" /></label>
        <label>调整方式<select v-model="mode" aria-label="时长调整方式" :disabled="disabled"><option value="scale">按比例调整镜头、动作与路线</option><option value="extend">保留原节奏，延长末尾停留</option></select></label>
        <button type="submit" :disabled="disabled || !valid || seconds===duration">应用时长</button>
      </form>
      <div class="scriptDuration">
        <label>剧本文案<select v-model="sourceId" aria-label="时长依据文案" :disabled="disabled"><option value="all">已关联分镜 / 场次</option><option v-for="source in sources" :key="source.id" :value="source.id">{{ source.label }}</option><option value="manual">粘贴剧本或分镜文案</option></select></label>
        <textarea v-if="sourceId==='manual'" v-model="manualText" aria-label="时长估算剧本文案" placeholder="粘贴分镜文案；有“时长 5 秒”等标注会优先采用。" rows="3" :disabled="disabled" />
        <button type="button" :disabled="disabled || !suggestion.count || suggestion.seconds<.2 || suggestion.seconds>300" @click="seconds=suggestion.seconds; mode='scale'">按剧本填入时长</button>
        <span v-if="suggestion.count" role="status">{{ suggestion.seconds }} 秒 · {{ suggestion.explicitCount }} 段使用标注时长<span v-if="suggestion.estimatedCount">，{{ suggestion.estimatedCount }} 段按文案估算</span><span v-if="suggestion.seconds>300">；超过 300 秒，请选择较短场次或拆分</span></span>
        <span v-else>从项目素材加入分镜 / 场次，或在这里粘贴文案。</span>
      </div>
      <p>{{ mode==='scale' ? '按比例同步切镜、动作、路线和关键帧；锁定内容需先解锁。' : '原片段的时间保持不变，最后一镜延续到新的结束时间。' }} 应用后自动保存，可 Ctrl+Z 撤销；播放和视频导出共用此时长。</p>
      <p v-if="mode==='extend' && seconds<duration" role="alert">缩短时长请选择“按比例调整”。</p>
    </div>
  </details>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PrevisScriptSource } from "./previsSkills";
import { suggestPrevisDuration } from "./previsDuration";
const props = defineProps<{ duration: number; sources: PrevisScriptSource[]; disabled: boolean }>();
const emit = defineEmits<{ apply: [seconds: number, mode: "scale" | "extend"] }>();
const seconds = ref(props.duration), mode = ref<"scale" | "extend">("scale"), sourceId = ref("all"), manualText = ref("");
watch(() => props.duration, value => { seconds.value = value; });
const suggestion = computed(() => suggestPrevisDuration(sourceId.value === "manual" ? [{ id: "manual", label: "粘贴文案", text: manualText.value }] : sourceId.value === "all" ? props.sources : props.sources.filter(source => source.id === sourceId.value)));
const valid = computed(() => Number.isFinite(seconds.value) && seconds.value >= .2 && seconds.value <= 300 && (mode.value === "scale" || seconds.value >= props.duration));
function apply() { if (!props.disabled && valid.value) emit("apply", seconds.value, mode.value); }
</script>
<style scoped>
.durationSettings { margin: 8px 0; border-radius: 12px; }
.durationSettings summary { cursor: pointer; width: fit-content; padding: 7px 10px; border: 1px solid #ffffff40; border-radius: 10px; background: #ffffff0b; font-weight: 650; }
.durationSettings summary:hover { background: #ffffff20; }
.durationBody { padding: 10px 2px 4px; display: grid; gap: 10px; }
.durationForm, .scriptDuration { display: flex; align-items: end; flex-wrap: wrap; gap: 8px 12px; }
label { display: grid; gap: 5px; min-width: 0; }
input, select, textarea, button { color: inherit; font: inherit; text-shadow: inherit; border: 1px solid #ffffff50; border-radius: 10px; background: #17212d30; padding: 7px 10px; box-sizing: border-box; }
input { width: 125px; } select { max-width: min(380px, 70vw); } textarea { flex: 1 1 100%; width: 100%; min-height: 76px; resize: vertical; }
button { cursor: pointer; } button:hover:enabled { background: #ffffff22; } button:disabled { opacity: .55; cursor: default; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid #acd4ff; outline-offset: 2px; }
p { margin: 0; font-size: 12px; line-height: 1.6; } .scriptDuration > span { font-size: 12px; padding-bottom: 7px; }
</style>
