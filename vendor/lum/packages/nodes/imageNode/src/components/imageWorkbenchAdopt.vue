<template>
  <section class="adoption" aria-label="采用到资产或分镜">
    <h3>采用到资产或分镜</h3>
    <p>逐格明确选择目标。生成和保存拼版不会自动采用。共用库采用将新增不可变造型版本。</p>
    <el-button :disabled="disabled || working" @click="loadTargets">读取当前项目采用目标</el-button>
    <template v-if="catalog">
      <p>项目 {{ catalog.projectId }} · {{ context?.canvasPath }}</p>
      <div v-for="cell in plan.cells" :key="cell.id" class="adoptionRow">
        <label><input v-model="choices[cell.id].selected" type="checkbox" :disabled="disabled || working" /> {{ labels.get(cell.id) }}</label>
        <template v-if="choices[cell.id].selected">
          <label v-if="plan.mode === 'sheet'">已保存裁剪结果
            <select v-model="choices[cell.id].resultNodeId" :disabled="disabled || working">
              <option value="">选择当前候选的裁剪节点</option>
              <option v-for="node in crops(cell.id)" :key="node.id" :value="node.id">{{ node.data.label || node.id }} · {{ node.id }}</option>
            </select>
          </label>
          <label>明确目标
            <el-select v-model="choices[cell.id].targetId" filterable :disabled="disabled || working" aria-label="采用目标">
              <el-option v-for="target in catalog.targets" :key="target.id" :value="target.id" :label="target.label" />
            </el-select>
          </label>
          <p>{{ targetFor(cell.id)?.expected }}</p>
          <label>视图 / 新镜头名称 <input v-model="choices[cell.id].name" maxlength="120" :disabled="disabled || working" /></label>
          <label v-if="targetFor(cell.id)?.kind !== 'shot'">共用资产组名称 / 造型名称（相同目标保存为一个造型，最多25视图）<input v-model="groupNames[choices[cell.id].targetId]" maxlength="120" :disabled="disabled || working" /></label>
          <label v-if="targetFor(cell.id)?.kind !== 'shot'"><input v-model="choices[cell.id].importProject" type="checkbox" :disabled="disabled || working" /> 同时明确导入当前项目（同组仅首格为主视图，独立角色资料快照）</label>
        </template>
      </div>
      <el-button :disabled="disabled || working" @click="previewChanges">预览采用变更</el-button>
    </template>
    <div v-if="preview" class="adoptionPreview">
      <h4>待确认变更 · {{ preview.choices.length }} 格</h4>
      <ul><li v-for="choice in preview.choices" :key="choice.cellId">{{ labels.get(choice.cellId) }} → {{ catalog?.targets.find(item => item.id === choice.targetId)?.label }} · {{ choice.name }} · {{ choice.appearanceName }}<br />{{ catalog?.targets.find(item => item.id === choice.targetId)?.expected }}{{ choice.importProject ? ' · 同时导入项目' : '' }}</li></ul>
      <el-button type="primary" :disabled="disabled || working" @click="adopt">确认采用以上变更</el-button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul v-if="receipts.length" aria-label="实际存储回执"><li v-for="(receipt, index) in receipts" :key="index">已保存 {{ receipt.cellId }} → {{ receipt.destination }} · 原图 {{ receipt.mediaId }}<span v-if="receipt.revision"> · 造型版本 {{ receipt.revision }}</span><span v-if="receipt.entityId"> · 项目实体 {{ receipt.entityId }}</span><span v-if="receipt.shotId"> · 镜头 {{ receipt.shotId }}</span></li></ul>
  </section>
</template>
<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { useVueFlow } from '@vue-flow/core';
import { ElButton, ElOption, ElSelect } from 'element-plus';
import type { ImageWorkbenchState } from '../imageWorkbench';
import { getImageWorkbenchTemplate } from '../imageWorkbenchTemplates';
import type { ImageWorkbenchAdoption, ImageWorkbenchAdoptionSelection } from '../useImageWorkbenchResults';
const props = defineProps<{ plan: ImageWorkbenchState; context?: { directory: string; canvasPath: string }; disabled: boolean;
  buildAdoption: (selection: readonly ImageWorkbenchAdoptionSelection[]) => Promise<ImageWorkbenchAdoption> }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const flow = useVueFlow();
type Target = { id: string; kind: string; label: string; expected: string };
type Choice = { cellId: string; selected: boolean; targetId: string; name: string; resultNodeId: string; importProject: boolean; appearanceName?: string };
type Catalog = { token: string; projectId: string; targets: Target[] };
const catalog = shallowRef<Catalog>();
const choices = reactive<Record<string, Choice>>({});
const groupNames = reactive<Record<string, string>>({});
const working = ref(false), error = ref('');
const receipts = ref<{cellId: string; destination: string; mediaId: string; revision?: number; entityId?: string; shotId?: string}[]>([]);
const preview = shallowRef<{ adoption: ImageWorkbenchAdoption; choices: Choice[]; signature: string }>();
const labels = computed(() => new Map(getImageWorkbenchTemplate(props.plan.templateId, props.plan.cells.length).cells.map(cell => [cell.id, cell.label])));
const signature = () => JSON.stringify([props.plan, choices, groupNames, props.context?.directory, props.context?.canvasPath]);
let alive = true;
const pending = new Map<string, { reject(error: Error): void; cleanup(): void }>();
onScopeDispose(() => { alive = false; for (const entry of pending.values()) { entry.cleanup(); entry.reject(Error('工作台已关闭')); } pending.clear(); });
watch(() => props.plan, () => { catalog.value = undefined; preview.value = undefined; }, { flush: 'sync' });
watch(signature, () => { preview.value = undefined; }, { flush: 'sync' });
function targetFor(cellId: string) { return catalog.value?.targets.find(target => target.id === choices[cellId]?.targetId); }
function crops(cellId: string) {
  return flow.getNodes.value.filter(node => {
    const crop = node.data.imageWorkbenchCrop;
    return crop?.cellId === cellId && crop.sourceFingerprint === props.plan.sourceFingerprint && crop.templateId === props.plan.templateId && crop.candidateId === props.plan.selectedSheetCandidateId;
  });
}
/** The bridge only receives primitive DTO fields, never persistence methods or Vue proxies. */
function adoptionDto(value: ImageWorkbenchAdoption): ImageWorkbenchAdoption {
  const media = (item: ImageWorkbenchAdoption['source']) => ({ nodeId: item.nodeId, handleId: item.handleId, path: item.path, mimeType: item.mimeType });
  return {
    version: value.version, directory: value.directory, canvasPath: value.canvasPath,
    source: media(value.source), sourceFingerprint: value.sourceFingerprint,
    ...(value.sourceRevision === undefined ? {} : { sourceRevision: value.sourceRevision }),
    templateId: value.templateId, mode: value.mode,
    cells: value.cells.map(cell => ({
      cellId: cell.cellId, name: cell.name, prompt: cell.prompt, candidateId: cell.candidateId, childNodeId: cell.childNodeId,
      candidateOutput: media(cell.candidateOutput), output: media(cell.output),
      references: cell.references.map(item => ({ id: item.id, ...media(item) })),
      ...(cell.crop ? { crop: { x: cell.crop.x, y: cell.crop.y, width: cell.crop.width, height: cell.crop.height } } : {}),
    })),
  };
}
function request<T>(method: string, params: object): Promise<T> {
  let origin = '';
  try { origin = new URL(document.referrer).origin; } catch { /* Standalone canvas has no host authority. */ }
  if (window.parent === window || !['http://127.0.0.1:5178','http://localhost:5178','http://127.0.0.1:6178'].includes(origin)) return Promise.reject(Error('请从 Lum 项目内打开画布后采用'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); pending.delete(id); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== origin || event.data?.type !== 'lum:adoptionResponse' || event.data.id !== id) return;
      cleanup(); if (event.data.error) reject(Error(String(event.data.error))); else resolve(event.data.result);
    };
    const timer = setTimeout(() => { cleanup(); reject(Error('采用回执超时，请先核对目标，不要重复采用')); }, 180000);
    pending.set(id, { reject, cleanup }); window.addEventListener('message', receive);
    try { window.parent.postMessage({ type: 'lum:adoptionRequest', id, method, ...params }, origin); }
    catch (failure) { cleanup(); reject(failure instanceof Error ? failure : Error(String(failure))); }
  });
}
async function run(action: () => Promise<void>) {
  if (props.disabled || working.value) return;
  working.value = true; emit('busy', true); error.value = '';
  try { await action(); } catch (failure) { if (alive) error.value = failure instanceof Error ? failure.message : String(failure); }
  finally { working.value = false; emit('busy', false); }
}
function loadTargets() { void run(async () => {
  const plan = props.plan;
  const directory = props.context?.directory, canvasPath = props.context?.canvasPath;
  if (!directory || !canvasPath) throw Error('请打开来源画布后读取采用目标');
  const result = await request<Catalog & { error?: string }>('catalog', { directory, canvasPath });
  if (result.error) throw Error(result.error);
  if (!alive || plan !== props.plan || directory !== props.context?.directory || canvasPath !== props.context?.canvasPath || !Array.isArray(result.targets)) throw Error('计划或画布已变化，请重新读取目标');
  for (const cell of plan.cells) choices[cell.id] = { cellId: cell.id, selected: false, targetId: '', name: labels.value.get(cell.id) ?? cell.id, resultNodeId: '', importProject: false };
  preview.value = undefined; catalog.value = result;
}); }
function previewChanges() { void run(async () => {
  const selected = props.plan.cells.map(cell => choices[cell.id]).filter(choice => choice.selected);
  if (!selected.length || selected.some(choice => !choice.targetId || !choice.name.trim() || (props.plan.mode === 'sheet' && !choice.resultNodeId))) throw Error('请选择格位，并为每格明确目标、名称和裁剪结果');
  if (selected.some(choice => targetFor(choice.cellId)?.kind !== 'shot' && !groupNames[choice.targetId]?.trim())) throw Error('请填写共用资产组的造型名称');
  const frozen = selected.map(choice => ({ cellId: choice.cellId, selected: choice.selected, targetId: choice.targetId,
    name: choice.name, resultNodeId: choice.resultNodeId, importProject: choice.importProject, appearanceName: groupNames[choice.targetId] ?? '' })), before = signature();
  const adoption = await props.buildAdoption(frozen.map(choice => ({ cellId: choice.cellId, ...(props.plan.mode === 'sheet' ? { resultNodeId: choice.resultNodeId } : {}) })));
  if (!alive || signature() !== before) throw Error('候选或目标已变化，请重新预览');
  preview.value = { adoption: adoptionDto(adoption), choices: frozen, signature: before };
}); }
function adopt() { void run(async () => {
  const saved = preview.value, token = catalog.value?.token;
  if (!saved || !token || saved.signature !== signature()) throw Error('采用预览已变化，请重新核对');
  const result = await request<{ receipts: typeof receipts.value; error?: string }>('adopt', { token, adoption: adoptionDto(saved.adoption),
    choices: saved.choices.map(choice => ({ cellId: choice.cellId, targetId: choice.targetId, name: choice.name,
      appearanceName: choice.appearanceName, importProject: choice.importProject })) });
  if (!alive) return;
  receipts.value = result.receipts ?? []; preview.value = undefined; catalog.value = undefined;
  if (result.error) throw Error(result.error + (receipts.value.length ? '；以上已提交项保留，请只重选其余项。' : '；候选已保留。'));
}); }
</script>
<style scoped>
.adoption { display: grid; gap: 10px; border-top: 1px solid var(--el-border-color); padding-top: 14px; }
.adoptionRow { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--el-border-color-lighter); }
label { display: grid; gap: 4px; } label:has(input[type=checkbox]) { display: block; }
p, h3, h4 { margin: 0; } select, input:not([type=checkbox]) { min-width: 0; width: 100%; }
li { overflow-wrap: anywhere; margin: 5px 0; } [role=alert] { color: var(--el-color-danger); }
</style>
