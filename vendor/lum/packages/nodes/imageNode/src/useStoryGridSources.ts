import { computed, shallowRef, type Ref } from "vue";
import { requestStoryGridSources, storyGridBatchBytes, storyGridHost, storyGridImageBytes, storyGridImageLimit, type StoryGridAsset, type StoryGridPrepared, type StoryGridSelection, type StoryGridShot } from "@lum/node-shared/storyGridSources";
import type { WorkspaceFiles } from "@lum/nodes-scaffold/workspaceFiles";
import type { ImageWorkbenchNamedReference } from "./imageWorkbenchChildren";
import { imageWorkbenchReferenceId } from "./imageWorkbenchChildren";
import type { ImageWorkbenchPlanningAttachment } from "./imageWorkbenchPlanning";
import { isStoryGridTemplate, type ImageWorkbenchState, type ImageWorkbenchStoryPlanning } from "./imageWorkbench";

type StorySourceBinding = {
  context: StoryGridSelection["context"];
  plan?: ImageWorkbenchState;
  reference: ImageWorkbenchNamedReference;
  check(): void;
};

const canvasVersion = (reference: ImageWorkbenchNamedReference, sha256: string) => JSON.stringify([reference.path, reference.mimeType, sha256]);
const matchesContext = (left: StoryGridSelection["context"], right: StoryGridSelection["context"]) =>
  left.directory === right.directory && left.canvasPath === right.canvasPath;

export const storyGridCategories = { location: "场景", character: "人物", prop: "道具", image: "画布图片" } as const;

export function clearStoryShotMapping(plan: ImageWorkbenchState) {
  delete plan.storyPlanning;
  for (const cell of [...plan.cells, ...plan.dormantCells ?? []]) delete cell.sourceShotId;
}

export function storySourcePlanError(plan: ImageWorkbenchState) {
  if (!plan.storySources) return "";
  if (plan.storySources.shots.length > plan.cells.length) return "所选分镜多于格数，请增加格数或减少所选分镜";
  return plan.storyPlanning ? "" : "剧情素材或格数已更新，请先重新 AI 规划";
}

export function useStoryGridSources(
  state: Ref<ImageWorkbenchState | undefined>,
  references: Ref<ImageWorkbenchNamedReference[]>,
  bind: () => StorySourceBinding,
  getFiles: () => WorkspaceFiles,
  signal: AbortSignal,
) {
  const host = storyGridHost();
  const selection = computed(() => state.value?.storySources);
  const previews = shallowRef(new Map<string, ImageWorkbenchNamedReference>());
  const availableReferences = () => new Map(references.value.map(reference => [reference.id, reference]));

  function assertSelection(binding: StorySourceBinding, selected: StoryGridSelection) {
    binding.check();
    if (!matchesContext(selected.context, binding.context) || selected.projectId !== host?.projectId) {
      throw new Error("剧情素材属于其他项目或画布，请在当前画布重新选择素材");
    }
  }

  function stableBinding(binding: StorySourceBinding, selected: StoryGridSelection) {
    assertSelection(binding, selected);
    const fingerprint = JSON.stringify(binding.plan?.storySources);
    return () => {
      assertSelection(binding, selected);
      if (fingerprint !== JSON.stringify(binding.plan?.storySources)) throw new Error("所选剧情素材或分镜已变化，请重新准备");
    };
  }

  async function setSelection(assets: StoryGridAsset[], shots: StoryGridShot[]) {
    const binding = bind(), { plan, context } = binding;
    if (!plan || !isStoryGridTemplate(plan.templateId)) throw new Error("当前模板不可使用剧情素材");
    if (assets.length >= storyGridImageLimit || shots.length > 100) throw new Error("所选剧情素材或分镜数量超过上限");
    const previous = plan.storySources;
    const retained = new Map(previous?.assets.map(item => [item.id, item.version]));
    const check = () => {
      binding.check();
      if (plan.storySources !== previous) throw new Error("所选剧情素材已变化，请重新选择");
    };
    const live = availableReferences();
    const files = getFiles();
    const nextAssets: StoryGridAsset[] = [];
    for (const item of assets) {
      if (item.scope !== "canvas" || item.version === retained.get(item.id)) { nextAssets.push(item); continue; }
      const reference = live.get(item.id);
      if (!reference) throw new Error("所选画布图片已变化，请刷新并重新选择");
      const { sha256 } = await files.inspectBinary(reference.path, signal);
      check();
      const current = availableReferences().get(item.id);
      if (!current || current.path !== reference.path || current.mimeType !== reference.mimeType) throw new Error("所选画布图片已变化，请刷新并重新选择");
      nextAssets.push({ ...item, version: canvasVersion(reference, sha256) });
    }
    check();
    clearStoryShotMapping(plan);
    plan.storySources = {
      context: { directory: context.directory, canvasPath: context.canvasPath },
      projectId: host?.projectId, assets: nextAssets, shots: [...shots].sort((left, right) => left.order - right.order),
    };
    previews.value = new Map([...previews.value].filter(([id]) => nextAssets.some(asset => asset.id === id && asset.version === retained.get(id))));
  }

  async function prepare(binding: StorySourceBinding) {
    const selected = binding.plan?.storySources ?? {
      context: { directory: binding.context.directory, canvasPath: binding.context.canvasPath },
      projectId: host?.projectId, assets: [], shots: [],
    };
    const check = stableBinding(binding, selected);
    const assets = selected.assets.filter(item => item.scope !== "canvas");
    const payload = {
      assets: assets.map(({ id, version }) => ({ id, version })),
      shots: selected.shots.map(({ id, version }) => ({ id, version })),
    };
    const files = getFiles();
    const result = host ? await requestStoryGridSources<StoryGridPrepared>("prepare", binding.context, payload, signal)
      : { shots: [], images: [], session: "" };
    check();
    if (result.shots.length !== selected.shots.length || result.shots.some((shot, index) =>
      shot.id !== selected.shots[index].id || shot.version !== selected.shots[index].version)) throw new Error("实际分镜与选择的顺序或版本不符");
    const receipts = new Map(result.images.map(item => [item.id, item]));
    const actual = availableReferences();
    const inspected = new Map<string, { sha256: string; size: number }>();
    const inspect = async (reference: ImageWorkbenchNamedReference) => {
      let info = inspected.get(reference.path);
      if (!info) {
        info = await files.inspectBinary(reference.path, signal);
        check();
        if (!info.size || info.size > storyGridImageBytes) throw new Error("「" + reference.name + "」的原图为空或超过 32 MiB");
        inspected.set(reference.path, info);
      }
      return info;
    };
    const { reference } = binding;
    const root = await inspect(reference);
    let totalBytes = root.size;
    const { name: rootName, ...rootReference } = reference;
    const snapshots: ImageWorkbenchStoryPlanning["attachments"] = [{ ...rootReference, sha256: root.sha256 }];
    const attachments: ImageWorkbenchPlanningAttachment[] = [{
      id: actual.has(reference.id) ? reference.id : undefined, version: root.sha256,
      name: rootName.replaceAll("\0", "").slice(0, 512), category: "当前原图", url: reference.path, mimeType: reference.mimeType,
    }];
    const selectedReferenceIds = new Set([reference.id]);
    const thumbnails = new Map<string, ImageWorkbenchNamedReference>();
    for (const asset of selected.assets) {
      const receipt = receipts.get(asset.id);
      const item = asset.scope === "canvas" ? actual.get(asset.id)
        : receipt && actual.get(imageWorkbenchReferenceId(receipt.nodeId, receipt.handleId));
      if (!item || (receipt && (item.path !== receipt.path || item.mimeType !== receipt.mimeType))) {
        throw new Error("「" + asset.label + "」的图片节点或输出已失效，请重新准备素材");
      }
      const { sha256, size } = await inspect(item);
      if (asset.scope === "canvas" ? asset.version !== canvasVersion(item, sha256) : sha256 !== receipt?.sha256) {
        throw new Error("「" + asset.label + "」的原图已变化，请刷新并重新选择");
      }
      thumbnails.set(asset.id, item);
      if (selectedReferenceIds.has(item.id)) continue;
      totalBytes += size;
      if (totalBytes > storyGridBatchBytes) throw new Error("原图和所选参考图合计超过 64 MiB，请减少素材");
      selectedReferenceIds.add(item.id);
      const { name: _name, ...snapshot } = item;
      snapshots.push({ ...snapshot, sha256 });
      attachments.push({ id: item.id, sourceId: asset.id, version: sha256, name: asset.label,
        category: storyGridCategories[asset.category], url: item.path, mimeType: item.mimeType });
    }
    const snapshot = { shots: result.shots, attachments: snapshots };
    const assertInputs = () => validateStorySources(binding, selected, snapshot, result.session, check, files);
    previews.value = thumbnails;
    return { story: { shots: result.shots, attachments }, selected, snapshot, assertInputs };
  }

  async function validateStorySources(
    binding: StorySourceBinding, selected: StoryGridSelection, snapshot: ImageWorkbenchStoryPlanning,
    session?: string, check = stableBinding(binding, selected), files = getFiles(),
  ) {
    if (host) await requestStoryGridSources<StoryGridPrepared>("validate", binding.context, {
      session: session || undefined,
      assets: selected.assets.filter(item => item.scope !== "canvas").map(({ id, version }) => ({ id, version })),
      shots: selected.shots.map(({ id, version }) => ({ id, version })),
    }, signal);
    check();
    const seen = new Map<string, string>();
    for (const item of snapshot.attachments) {
      let value = seen.get(item.path);
      if (!value) {
        ({ sha256: value } = await files.inspectBinary(item.path, signal));
        check();
        seen.set(item.path, value);
      }
      if (item.sha256 !== value) throw new Error("剧情素材原图文件已变化，请重新规划");
    }
    const actual = availableReferences();
    actual.set(binding.reference.id, binding.reference);
    for (const item of snapshot.attachments) {
      const current = actual.get(item.id);
      if (current?.path !== item.path || current?.mimeType !== item.mimeType) throw new Error("剧情素材在画布中的输出已变化，请重新规划");
    }
  }

  async function validatePlan(binding: StorySourceBinding) {
    const { plan } = binding;
    if (!plan?.storySources) return;
    const issue = storySourcePlanError(plan);
    if (issue) throw new Error(issue);
    await validateStorySources(binding, plan.storySources, plan.storyPlanning!);
  }

  return { selection, previews, setSelection, prepare, validatePlan };
}
