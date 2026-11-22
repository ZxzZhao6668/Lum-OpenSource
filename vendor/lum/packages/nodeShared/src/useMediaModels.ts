import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { useNodeAi, type NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import { groupNodeModels } from "./groupNodeModels";

export const modelKey = (model: Pick<NodeMediaModel, "providerId" | "modelId">) => JSON.stringify([model.providerId, model.modelId]);

/** 媒体模型清单（图片 / 视频），供需要替子节点预选模型和参数的节点使用。 */
export function useMediaModels() {
  const ai = useNodeAi();
  const models = shallowRef<NodeMediaModel[]>([]);
  const loading = ref(false);
  async function load() {
    if (loading.value) return;
    loading.value = true;
    try { models.value = await ai.getMediaModels(); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) console.warn("媒体模型读取失败", error); }
    finally { loading.value = false; }
  }
  const imageModels = computed(() => models.value.filter(item => item.type === "image"));
  const videoModels = computed(() => models.value.filter(item => item.type === "video"));
  /** 与生成节点一致：有全局默认用默认，否则取分组后的第一个。 */
  const defaultOf = (items: NodeMediaModel[]) => groupNodeModels(items)[0]?.models[0];
  const defaultImageModel = computed(() => defaultOf(imageModels.value));
  const defaultVideoModel = computed(() => defaultOf(videoModels.value));
  onMounted(() => { void load(); window.addEventListener("lum:provider-config-changed", load); });
  onScopeDispose(() => window.removeEventListener("lum:provider-config-changed", load));
  return { models, loading, load, imageModels, videoModels, defaultImageModel, defaultVideoModel };
}

/** 视频模型的参考生视频模式最多接受几张图片；不支持图片参考时为 0。 */
export function maxImageReferences(model?: NodeMediaModel) {
  return Math.max(0, ...(model?.mode ?? []).flatMap(mode => Array.isArray(mode)
    ? [Number(mode.find(item => item.startsWith("imageReference:"))?.split(":")[1] ?? 0)] : []));
}
