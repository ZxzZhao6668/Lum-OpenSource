import { computed, onMounted, onScopeDispose, ref, type Ref } from "vue";
import { ElMessage } from "element-plus";
import { useNodeAi, type NodeAiModel } from "@lum/nodes-scaffold/nodeAi";
import { groupNodeModels } from "./groupNodeModels";
import { useDefaultModel } from "./useDefaultModel";

export const thinkingLevelLabels: Record<string, string> = { off: "关闭", minimal: "最小", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" };

/** 文本模型选择：跟随默认模型，或记住节点自己选的模型（`data.model`）与推理档位（`data.thinkingLevel`）。 */
export function useTextModel(data: Ref<{ model?: string; followDefaultModel?: boolean; thinkingLevel?: string }>, busy: Ref<boolean>) {
  const ai = useNodeAi();
  const models = ref<NodeAiModel[]>([]);
  const loading = ref(false);
  useDefaultModel(data, models, busy);
  const selected = computed(() => models.value.find(item => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
  const groups = computed(() => groupNodeModels(models.value));
  const reasoningLevels = computed(() => selected.value?.reasoningLevels ?? []);
  // 换到不支持该档位的模型时按「默认」处理，保存的值留着，换回来仍然有效。
  const thinkingLevel = computed(() => data.value.thinkingLevel && reasoningLevels.value.includes(data.value.thinkingLevel) ? data.value.thinkingLevel : "");
  async function load() {
    if (loading.value) return;
    loading.value = true;
    try {
      models.value = await ai.getModels();
      if (!selected.value) {
        const first = groups.value[0]?.models[0];
        data.value.model = first ? JSON.stringify([first.providerId, first.modelId]) : "";
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") ElMessage.error(error.message);
    } finally { loading.value = false; }
  }
  function choose(value: string) { data.value.followDefaultModel = false; data.value.model = value; }
  function chooseThinking(value: string) { data.value.thinkingLevel = value || undefined; }
  /** 一次性生成文本；没有模型时给出明确提示。 */
  async function generate(prompt: string, systemPrompt?: string, onText?: (text: string) => void, signal?: AbortSignal) {
    if (!models.value.length) await load();
    const model = selected.value;
    if (!model) throw new Error("请先在设置中添加文本模型");
    let text = "";
    const result = await ai.generate({
      providerId: model.providerId, modelId: model.modelId, prompt, systemPrompt, signal,
      thinkingLevel: thinkingLevel.value || undefined,
      onEvent: onText ? event => { if (event.type === "text") onText(text += event.delta); } : undefined,
    });
    return result.text;
  }
  onMounted(() => { void load(); window.addEventListener("lum:provider-config-changed", load); });
  onScopeDispose(() => window.removeEventListener("lum:provider-config-changed", load));
  return { models, loading, selected, groups, reasoningLevels, thinkingLevel, load, choose, chooseThinking, generate };
}

/** 把一段话交给画布里的 Lum Agent；submit 为 false 时只填入输入框，由用户补充后发送。 */
export function sendToAgent(prompt: string, submit = true) {
  window.dispatchEvent(new CustomEvent("lum:agentDraft", { detail: { prompt, submit } }));
}
