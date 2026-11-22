<template>
  <details class="previsSkillPanel" :open="form.open" @toggle="toggle">
    <summary>预演 Skill</summary>
    <div class="skillContent">
      <p>文案 → 预演提示词 → AI 编排预览</p>
      <label>文案来源<select v-model="form.sourceMode" :disabled="generating"><option value="linked">关联分镜 / 剧本</option><option value="manual">自己填写文案</option></select></label>
      <template v-if="form.sourceMode === 'linked'">
        <label>选择文案<select v-model="form.sourceId" :disabled="generating || !sources.length"><option value="">全部关联文案（{{ sources.length }}）</option><option v-for="source in sources" :key="source.id" :value="source.id">{{ source.label }}</option></select></label>
        <textarea v-if="sourceText" :value="sourceText" readonly rows="4" aria-label="关联剧本与分镜文案" />
        <p v-else>此节点尚未关联文案。可从制片工作台送入分镜，或选择“自己填写文案”。</p>
      </template>
      <label v-else>文案<textarea v-model="form.manualText" :disabled="generating" rows="5" maxlength="20000" placeholder="填写要预演的剧情、人物动作与场面" /></label>
      <label>动作风格 Skill<select v-model="form.actionId" :disabled="generating || loading"><option value="">按原文动作</option><option v-for="skill in actionSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</option></select></label>
      <label>镜头描述 Skill<select v-model="form.cameraId" :disabled="generating || loading"><option value="">按原分镜机位</option><option v-for="skill in cameraSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</option></select></label>
      <details v-if="selectedSkills.length" class="skillRules"><summary>查看所选规则</summary><section v-for="skill in selectedSkills" :key="skill.id"><strong>{{ skill.name }}</strong><pre>{{ skill.instruction }}</pre></section></details>
      <label>补充要求<textarea v-model="form.requirements" :disabled="generating" maxlength="6000" rows="3" placeholder="例如：保留现有角色，侧面跟拍，先对峙后交锋" /></label>
      <label>提示词模型<select v-model="form.model" :disabled="generating || loading"><option value="">{{ models.length ? '选择文本模型' : '请在项目设置配置文本模型' }}</option><option v-for="model in models" :key="modelKey(model)" :value="modelKey(model)">{{ model.providerLabel }} · {{ model.label || model.modelId }}</option></select></label>
      <button :disabled="loading || generating" @click="loadCatalog">{{ loading ? '读取中…' : '刷新技能与模型' }}</button>
      <p class="skillHint">共 {{ actionSkills.length }} 个动作技能、{{ cameraSkills.length }} 个镜头技能。可在技能页导入并分配“预演动作 / 预演镜头”。</p>
      <button :disabled="disabled || loading || generating || !sourceText.trim() || !form.model" @click="generate">{{ generating ? 'AI 正在生成提示词…' : 'AI 生成白模预演提示词' }}</button>
      <button v-if="generating" @click="cancelGeneration">停止生成</button>
      <p v-if="status" role="status">{{ status }}</p><p v-if="error" class="skillError" role="alert">{{ error }}</p>
      <label>预演提示词（可编辑）<textarea v-model="form.output" :disabled="generating" maxlength="30000" rows="7" placeholder="生成后可修改，再送入 AI 文案编排" /></label>
      <div class="skillActions"><button :disabled="generating || !form.output.trim()" @click="copyPrompt">复制提示词</button><button :disabled="disabled || generating || !form.output.trim()" @click="emit('use', form.output)">用于 AI 文案编排</button></div>
      <p class="skillHint">提示词生成仅调用文本模型。送入编排后仍需生成预览、检查并应用。</p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { requestPrevisSkill, type PrevisPromptDraft, type PrevisScriptSource, type PrevisSkillCatalog } from "./previsSkills";

const props = defineProps<{ sources: PrevisScriptSource[]; context: string; duration: number; disabled: boolean; initialDraft?: PrevisPromptDraft }>();
const emit = defineEmits<{ save: [draft: PrevisPromptDraft]; use: [text: string]; expanded: [open: boolean] }>();
const saved = props.initialDraft;
const bounded = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const form = ref<PrevisPromptDraft>({ open: saved?.open === true, sourceMode: saved?.sourceMode === "manual" || !props.sources.length ? "manual" : "linked", sourceId: bounded(saved?.sourceId,200), manualText: bounded(saved?.manualText,20000), requirements: bounded(saved?.requirements,6000), actionId: saved?.actionId === undefined ? "previs-action-grounded" : bounded(saved.actionId,100), cameraId: saved?.cameraId === undefined ? "previs-camera-continuity" : bounded(saved.cameraId,100), model: bounded(saved?.model,700), output: bounded(saved?.output,30000) });
const skills = ref<PrevisSkillCatalog["skills"]>([]), models = ref<PrevisSkillCatalog["models"]>([]);
const loading = ref(false), generating = ref(false), status = ref(""), error = ref("");
const actionSkills = computed(() => skills.value.filter(skill => skill.uses.includes("previs-action")));
const cameraSkills = computed(() => skills.value.filter(skill => skill.uses.includes("previs-camera")));
const selectedSkills = computed(() => skills.value.filter(skill => skill.id === form.value.actionId || skill.id === form.value.cameraId));
const sourceText = computed(() => form.value.sourceMode === "manual" ? form.value.manualText : props.sources.filter(source => !form.value.sourceId || source.id === form.value.sourceId).map(source => `${source.label}\n${source.text}`).join("\n\n"));
const modelKey = (model: PrevisSkillCatalog["models"][number]) => JSON.stringify([model.providerId,model.modelId]);
const inputs = () => ({ sourceText: sourceText.value, requirements: form.value.requirements, actionId: form.value.actionId, cameraId: form.value.cameraId, context: props.context, duration: props.duration, model: form.value.model });
let alive = true, catalogController: AbortController | undefined, generationController: AbortController | undefined;
watch(form,value => { emit("save",JSON.parse(JSON.stringify(value))); },{deep:true});
function toggle(event: Event) { form.value.open = (event.target as HTMLDetailsElement).open; emit("expanded",form.value.open); }
async function loadCatalog() {
  if(loading.value || generating.value)return;
  loading.value=true;error.value="";catalogController = new AbortController();
  try {
    const catalog = await requestPrevisSkill<PrevisSkillCatalog>("catalog",{},catalogController.signal);
    if(!alive)return;
    skills.value=catalog.skills;models.value=catalog.models;
    if(!actionSkills.value.some(skill=>skill.id===form.value.actionId))form.value.actionId="";
    if(!cameraSkills.value.some(skill=>skill.id===form.value.cameraId))form.value.cameraId="";
    if(!models.value.some(model=>modelKey(model)===form.value.model))form.value.model=models.value.some(model=>modelKey(model)===catalog.preferredModel)?catalog.preferredModel:models.value.length===1?modelKey(models.value[0]!):"";
    if(catalog.modelError)error.value=catalog.modelError;
  } catch(reason) { if(alive)error.value=reason instanceof Error?reason.message:String(reason); }
  finally { if(alive)loading.value=false; }
}
async function generate() {
  if(generating.value || props.disabled)return;
  const model=models.value.find(model=>modelKey(model)===form.value.model);
  if(!model || !sourceText.value.trim()){error.value="请选择文本模型并提供文案";return;}
  if(sourceText.value.length>20000){error.value="文案超过20000字，请选择单个场次 / 分镜，或精简文案";return;}
  const request=inputs(),stamp=JSON.stringify(request),controller=new AbortController();generationController=controller;
  generating.value=true;error.value="";status.value="正在按所选技能编写预演提示词，原场景保持不变…";
  try {
    const result=await requestPrevisSkill<{text:string}>("generate",{...request,providerId:model.providerId,modelId:model.modelId},controller.signal);
    if(!alive || controller.signal.aborted)return;
    if(stamp!==JSON.stringify(inputs()))throw new Error("文案或场景已变化，本次结果未覆盖原提示词，请重新生成");
    form.value.output=result.text;status.value="提示词已生成，可编辑后送入 AI 文案编排。";
  } catch(reason) { if(alive&&!controller.signal.aborted){error.value=reason instanceof Error?reason.message:String(reason);status.value="生成失败，原提示词保留。";} }
  finally { if(alive&&generationController===controller){generating.value=false;generationController=undefined;} }
}
function cancelGeneration() { generationController?.abort(); status.value="已停止，原提示词保留。"; }
async function copyPrompt() { try { await navigator.clipboard.writeText(form.value.output);status.value="提示词已复制"; } catch { error.value="未能复制，请在提示词文本框中手动复制"; } }
onMounted(()=>{emit("expanded",form.value.open);void loadCatalog();});
onBeforeUnmount(()=>{alive=false;catalogController?.abort();generationController?.abort();});
</script>

<style scoped lang="scss">
.previsSkillPanel {
  border: 1px solid #46516a; border-radius: 8px; margin: 10px 0; min-width: 0; overflow-wrap: anywhere;
  > summary { padding: 10px 8px; cursor: pointer; font-weight: 600; user-select: none; }
  .skillContent { display: grid; gap: 10px; padding: 0 10px 12px; min-width: 0; }
  label { display: grid; gap: 6px; min-width: 0; font-size: 12px; }
  button, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; border: 1px solid #46516a; border-radius: 6px; padding: 7px; color: #e3e8f2; background: #242d3d; font: inherit; }
  button { min-height: 34px; white-space: normal; overflow-wrap: anywhere; cursor: pointer; }
  button:hover { background: #344560; } button:disabled { opacity: .45; cursor: default; }
  textarea { resize: vertical; line-height: 1.6; font-size: 12px; overflow-wrap: anywhere; }
  p { margin: 0; color: #b9c7de; font-size: 12px; line-height: 1.6; }
  .skillHint { color: #a7b6ce; }.skillError { color: #ffc9cd; white-space: pre-wrap; }
  .skillRules { min-width: 0; font-size: 12px; summary { cursor: pointer; padding: 6px 0; } pre { margin: 6px 0 12px; padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow: auto; background: #171d29; font: inherit; line-height: 1.6; } }
  .skillActions { display: grid; gap: 8px; }
  :is(button,select,textarea,summary):focus-visible { outline: 2px solid #8dc3ff; outline-offset: 2px; }
}
</style>
