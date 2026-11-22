<template>
  <section class="shootingAgent" role="dialog" aria-label="拍摄 Agent" @pointerdown.stop @wheel.stop @keydown.stop @keydown.esc.stop.prevent="close">
    <header>
      <strong><icon-sparkles :size="15" aria-hidden="true" /> 拍摄 Agent</strong>
      <button type="button" aria-label="关闭拍摄 Agent" title="关闭" @click="close"><icon-x :size="16" /></button>
    </header>
    <textarea ref="input" v-model="prompt" rows="2" maxlength="1600" :readonly="listening" aria-label="运镜要求" placeholder="描述运镜，例如：用 35 mm 云台跟拍，放慢移动速度" @keydown.ctrl.enter.prevent="generate" @keydown.meta.enter.prevent="generate" />
    <div class="agentTools">
      <agentModelPicker :modelValue="modelKey" :models="pickerModels" :disabled="listening" @update:modelValue="emit('update:modelKey', $event)" @open="!models.length && emit('loadModels')" />
      <button type="button" :aria-pressed="listening" :title="listening ? '结束听写' : '语音输入'" aria-label="语音输入" @click="toggleVoice">
        <component :is="listening ? IconPlayerStop : IconMicrophone" :size="16" />
      </button>
      <button v-if="generating" type="button" class="primary" @click="cancelGeneration">取消生成</button>
      <button v-else type="button" class="primary" :disabled="!canGenerate" @click="generate">预览指令</button>
    </div>
    <p v-if="message || hint" role="status">{{ message || hint }}</p>
    <template v-if="proposal">
      <dl aria-label="待采用的参数">
        <div v-for="field in proposedFields" :key="field.key">
          <dt>{{ field.label }}</dt><dd>{{ field.before }} → <b>{{ field.after }}</b></dd>
        </div>
      </dl>
      <footer><button type="button" @click="proposal = undefined">放弃</button><button type="button" class="primary" :disabled="!proposedFields.length" @click="apply">应用到机位</button></footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { IconMicrophone, IconPlayerStop, IconSparkles, IconX } from "@tabler/icons-vue";
import { createBrowserAsr, isBrowserAsrSupported, type NodeAiModel } from "@lum/nodes-scaffold/runtime";
import agentModelPicker from "./agentConversation/agentModelPicker.vue";
import { shootingApertureValues, shootingLensValues, shootingMethodNames, shootingSettingsSchema } from "./shootingTakes";
import type { ShootingCameraSettings } from "./shootingCamera";

type GenerateText = (input: { modelKey: string; systemPrompt: string; prompt: string; signal: AbortSignal }) => Promise<string>;
const props = defineProps<{ generateText?: GenerateText; models: NodeAiModel[]; modelKey: string; state: ShootingCameraSettings }>();
const emit = defineEmits<{ apply: [patch: Partial<ShootingCameraSettings>]; close: []; "update:modelKey": [value: string]; loadModels: [] }>();
const input = ref<HTMLTextAreaElement>();
const prompt = ref("");
const message = ref("");
const proposal = shallowRef<Partial<ShootingCameraSettings>>();
const request = shallowRef<AbortController>();
const generating = computed(() => !!request.value);
const listening = ref(false);
let voice: ReturnType<typeof createBrowserAsr> | undefined;
let disposed = false;
const pickerModels = computed(() => props.models.map(model => ({ ...model, reasoningLevels: [] })));
const selected = computed(() => props.models.some(model => JSON.stringify([model.providerId, model.modelId]) === props.modelKey));
const canGenerate = computed(() => !!props.generateText && selected.value && !!prompt.value.trim() && !listening.value && !generating.value);
const hint = computed(() => {
  if (listening.value) return "正在听写，点麦克风结束。";
  if (generating.value) return "正在生成机位参数…";
  if (!props.generateText) return "当前工作区未连接文本生成服务。";
  if (!props.models.length) return "请先在 Lum 设置中配置文本模型。";
  if (!selected.value) return "选择用于生成取景指令的文本模型。";
  return "";
});
const patchSchema = shootingSettingsSchema.partial();
const labels: Record<keyof ShootingCameraSettings, string> = { method: "拍法", focalLength: "焦距", format: "画幅", speed: "移动速度", shake: "晃动", random: "随机变化", aperture: "光圈", height: "视角高度", follow: "跟拍" };
function formatValue(key: keyof ShootingCameraSettings, value: string | boolean | number | undefined) {
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (value === undefined) return "默认";
  if (key === "focalLength") return value + " mm";
  if (key === "aperture") return "f/" + value;
  if (key === "height") return value + " m";
  if (key === "shake" || key === "random") return Math.round(Number(value) * 100) + "%";
  return String(value);
}
const proposedFields = computed(() => (Object.keys(proposal.value ?? {}) as (keyof ShootingCameraSettings)[])
  .filter(key => props.state[key] !== proposal.value?.[key])
  .map(key => ({ key, label: labels[key], before: formatValue(key, props.state[key]), after: formatValue(key, proposal.value?.[key]) })));
const systemPrompt = [
  "你是 Lum 白模片场摄影助理。根据导演的运镜要求与当前机位参数，仅返回一个 JSON 对象，包含需要改变的字段。不要输出说明或指令代码。",
  "可用字段：method 只能取 " + shootingMethodNames.join("、") + "。focalLength（mm）可选 " + shootingLensValues.join("、") + "。aperture 可选 " + shootingApertureValues.join("、") + "。",
  "format 可取 16:9、9:16、1:1、21:9。speed 取 0.12 至 8。height（米）取 0.25 至 100。shake、random 为 0 至 1。follow 是布尔值，跟随操作者当前锁定的主体。",
  "不得宣称移动演员或创建指定路线。仅当请求可通过上述参数表达时返回参数，否则返回空对象。不要输出未被要求的字段。",
].join("\n");

function cancelGeneration() {
  request.value?.abort();
  request.value = undefined;
}
async function generate() {
  if (!canGenerate.value || !props.generateText) return;
  cancelGeneration();
  const controller = new AbortController();
  request.value = controller;
  message.value = "";
  proposal.value = undefined;
  try {
    const reply = await props.generateText({
      modelKey: props.modelKey, systemPrompt, signal: controller.signal,
      prompt: JSON.stringify({ current: props.state, direction: prompt.value.trim() }),
    });
    if (controller.signal.aborted || disposed) return;
    const raw = reply.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new Error("模型没有返回可读的机位参数，请重新生成。"); }
    const result = patchSchema.safeParse(json);
    if (!result.success) throw new Error("模型返回的机位参数超出可用范围，请调整要求后重试。");
    proposal.value = result.data;
    if (!proposedFields.value.length) { proposal.value = undefined; message.value = "这条要求没有生成需要调整的机位参数。"; }
  } catch (error) {
    if (!controller.signal.aborted && !disposed) message.value = error instanceof Error ? error.message : "生成机位参数失败。";
  } finally {
    if (request.value === controller) request.value = undefined;
  }
}
function destroyVoice() {
  const current = voice;
  voice = undefined;
  listening.value = false;
  current?.destroy();
}
function startVoice() {
  if (disposed || listening.value || generating.value) return;
  message.value = "";
  if (!isBrowserAsrSupported()) { message.value = "此浏览器不支持语音识别，可以直接输入运镜要求。"; input.value?.focus(); return; }
  const prefix = prompt.value ? prompt.value.trimEnd() + " " : "";
  try {
    const asr = createBrowserAsr({
      lang: "zh-CN", continuous: true,
      onStateChange(state) { if (voice === asr && state === "idle") destroyVoice(); },
      onResult(result) { if (voice === asr) prompt.value = (prefix + result.text).slice(0, 1600); },
      onError(error) {
        if (voice !== asr) return;
        destroyVoice();
        const reasons: Record<string, string> = { "not-allowed": "未获得麦克风权限。", "no-speech": "没有检测到语音。", network: "语音识别服务连接失败。", "audio-capture": "无法读取麦克风。" };
        message.value = reasons[error.code] ?? "当前语音识别不可用，可改用文字输入。";
      },
    });
    voice = asr;
    listening.value = true;
    asr.start();
  } catch (error) { destroyVoice(); message.value = error instanceof Error ? error.message : "无法启动语音识别。"; }
}
function toggleVoice() { if (listening.value) voice?.stop(); else startVoice(); }
function close() { cancelGeneration(); destroyVoice(); emit("close"); }
function apply() {
  if (!proposal.value || !proposedFields.value.length) return;
  emit("apply", proposal.value);
  proposal.value = undefined;
  close();
}
function pageChanged() { if (document.hidden) destroyVoice(); }
watch([prompt, () => props.modelKey], () => { cancelGeneration(); proposal.value = undefined; message.value = ""; }, { flush: "sync" });
onMounted(() => {
  if (!props.models.length) emit("loadModels");
  void nextTick(() => input.value?.focus());
  document.addEventListener("visibilitychange", pageChanged);
});
onBeforeUnmount(() => { disposed = true; cancelGeneration(); destroyVoice(); document.removeEventListener("visibilitychange", pageChanged); });
defineExpose({ startVoice });
</script>

<style scoped lang="scss">
.shootingAgent {
  position: absolute; z-index: 48; top: 58px; left: 50%; transform: translateX(-50%); width: min(375px, calc(100% - 20px));
  max-height: calc(100% - 78px); overflow: auto; padding: 15px; border: 1px solid rgba(255,255,255,.38); border-radius: 16px;
  background: rgba(40,51,60,.92); color: #fff; box-shadow: 0 9px 36px rgba(20,30,40,.16); backdrop-filter: blur(16px);
  header, footer, .agentTools, strong { display: flex; align-items: center; gap: 8px; }
  header { justify-content: space-between; margin-bottom: 10px; }
  strong { font-size: 14px; }
  button, textarea { color: inherit; font: inherit; }
  button { border: 0; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 4px 9px; background: rgba(255,255,255,.12); cursor: pointer; }
  button:hover:not(:disabled) { background: rgba(255,255,255,.23); }
  button:disabled { opacity: .55; cursor: default; }
  button.primary { background: #edcf81; color: #342a16; font-weight: 650; }
  button.primary:hover:not(:disabled) { background: #f5dea2; }
  textarea { display: block; box-sizing: border-box; width: 100%; min-height: 60px; resize: vertical; padding: 9px; border: 1px solid rgba(255,255,255,.38); border-radius: 8px; background: rgba(12,20,27,.38); line-height: 1.5; font-size: 13px; }
  textarea::placeholder { color: #c1c8ce; }
  :focus-visible { outline: 2px solid #edcf81; outline-offset: 2px; }
  .agentTools { margin-top: 8px; font-size: 12px; }
  .agentTools :deep(.agentModelPicker) { margin-right: auto; min-width: 0; color: inherit; }
  .agentTools :deep(.modelButton) { color: inherit; }
  p { font-size: 12px; margin: 9px 0 0; color: #e5e8eb; }
  dl { margin: 11px 0 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.22); font-size: 12px; }
  dl div { display: flex; justify-content: space-between; padding: 3px 1px; }
  dd { margin: 0; }
  footer { justify-content: flex-end; font-size: 12px; }
}
</style>
