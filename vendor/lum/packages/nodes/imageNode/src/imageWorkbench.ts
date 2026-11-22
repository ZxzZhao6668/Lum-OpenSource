import { z } from "@lum/nodes-scaffold/nodeTools";
import { storyGridImageLimit } from "@lum/node-shared/storyGridSources";
import { getImageWorkbenchTemplate, imageWorkbenchTemplateIds, type ImageWorkbenchTemplateId } from "./imageWorkbenchTemplates";

export const imageWorkbenchLimits = {
  requirements: 10000,
  cellPrompt: 3000,
  reason: 1000,
  referenceIds: 32,
  concurrency: 8,
  attempts: 30,
  persistedLength: 2000000,
} as const;

function boundedText(max: number) {
  return z.string().max(max).refine(value => !value.includes("\0"), "不允许空字符");
}

function requiredText(max: number) {
  return boundedText(max).refine(value => !!value.trim(), "字段不能为空");
}

function boundedArray<T extends z.ZodType>(item: T, max: number) {
  return z.custom<unknown[]>(value => Array.isArray(value) && value.length <= max, `最多允许 ${max} 项`).pipe(z.array(item));
}

const identifier = requiredText(512);
const referenceId = requiredText(1200);
const mimeType = z.string().max(128).regex(/^image\/[a-zA-Z0-9.+-]+$/);
const mediaPath = requiredText(4096).refine(value => !/^[\\/]/.test(value) && !/[<>:"|?*\x00-\x1f]/.test(value)
  && !value.split(/[\\/]/).includes(".."), "需要工作区内的相对图片路径");
const sourceFingerprint = requiredText(6000);
const skillId = z.string().regex(/^[\w-]{1,100}$/);
const sourceSchema = z.strictObject({
  nodeId: identifier,
  handleId: identifier,
  path: mediaPath,
});
export type ImageWorkbenchSource = z.infer<typeof sourceSchema>;

const modelKey = boundedText(3400).refine(value => {
  if (!value) return true;
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && parts.length === 2 && parts.every(part => identifier.safeParse(part).success);
  } catch {
    return false;
  }
}, "模型标识无效");

const modelSetting = z.strictObject({
  model: modelKey,
  followDefaultModel: z.boolean(),
});
const imageModelSchema = modelSetting.extend({
  size: boundedText(128).optional(),
  ratio: boundedText(128).optional(),
});
export type ImageWorkbenchModel = z.infer<typeof modelSetting>;
export type ImageWorkbenchImageModel = z.infer<typeof imageModelSchema>;

const skillSchema = z.strictObject({
  mode: z.enum(["none", "auto", "manual"]),
  id: skillId.optional(),
  reason: boundedText(imageWorkbenchLimits.reason).optional(),
}).refine(value => value.mode !== "none" || (!value.id && !value.reason), "未启用 Skill 时不能保留选择结果");
export type ImageWorkbenchSkill = z.infer<typeof skillSchema>;

const outputSchema = sourceSchema.omit({ nodeId: true }).extend({ mimeType });
const referenceSchema = sourceSchema.extend({ id: referenceId, mimeType }).readonly();
const attachmentSchema = sourceSchema.extend({ id: referenceId, mimeType, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export type ImageWorkbenchReference = z.infer<typeof referenceSchema>;
export type ImageWorkbenchCandidateOutput = z.infer<typeof outputSchema>;

const candidateSnapshotSchema = z.strictObject({
  prompt: requiredText(100000),
  references: boundedArray(referenceSchema, imageWorkbenchLimits.referenceIds + 1)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, "尝试中的参考素材重复").readonly(),
  imageModel: z.strictObject({
    providerId: identifier,
    modelId: identifier,
    size: boundedText(128).optional(),
    ratio: boundedText(128).optional(),
  }).readonly(),
  sourceMimeType: mimeType.optional(),
  sourceShotId: referenceId.optional(),
  attachmentDigests: boundedArray(attachmentSchema.readonly(), storyGridImageLimit).readonly().optional(),
  sheetCells: boundedArray(z.strictObject({
    id: identifier,
    prompt: requiredText(imageWorkbenchLimits.cellPrompt),
    referenceIds: boundedArray(referenceId, imageWorkbenchLimits.referenceIds).readonly(),
    sourceShotId: referenceId.optional(),
  }).readonly(), 100).readonly().optional(),
  sourceFingerprint,
  createdAt: z.int().nonnegative(),
}).readonly();
export type ImageWorkbenchCandidateSnapshot = z.infer<typeof candidateSnapshotSchema>;

const candidateSchema = z.strictObject({
  id: identifier,
  childNodeId: identifier,
  attempt: z.int().min(1),
  status: z.enum(["queued", "submitting", "running", "succeeded", "failed", "cancelled", "unknown"]),
  taskId: identifier.optional(),
  abandonedLocally: z.literal(true).optional(),
  output: outputSchema.optional(),
  error: boundedText(2000).optional(),
  snapshot: candidateSnapshotSchema,
}).refine(candidate => (candidate.status === "succeeded") === !!candidate.output, "候选完成状态与图片输出不一致")
  .refine(candidate => !candidate.abandonedLocally || candidate.status === "cancelled", "已放弃本地等待的候选须处于放弃状态");
export type ImageWorkbenchCandidate = z.infer<typeof candidateSchema>;
export type ImageWorkbenchCandidateStatus = ImageWorkbenchCandidate["status"];

const candidateList = boundedArray(candidateSchema, imageWorkbenchLimits.attempts);
const cellPlanSchema = z.strictObject({
  id: identifier,
  prompt: boundedText(imageWorkbenchLimits.cellPrompt),
  referenceIds: boundedArray(referenceId, imageWorkbenchLimits.referenceIds)
    .refine(items => new Set(items).size === items.length, "参考素材 ID 重复"),
  reason: boundedText(imageWorkbenchLimits.reason),
  sourceShotId: referenceId.optional(),
});
export type ImageWorkbenchCellPlan = z.infer<typeof cellPlanSchema>;

const cellSchema = cellPlanSchema.extend({
  candidates: candidateList,
  selectedCandidateId: identifier.optional(),
});
export type ImageWorkbenchCellState = z.infer<typeof cellSchema>;

const storyAssetSchema = z.strictObject({
  id: referenceId, version: requiredText(6000), label: boundedText(512),
  category: z.enum(["location", "character", "prop", "image"]), scope: z.enum(["project", "shared", "canvas"]),
});
const storyShotSchema = z.strictObject({
  id: referenceId, shotId: identifier, version: requiredText(180), label: boundedText(200),
  scene: boundedText(450), summary: boundedText(240), order: z.int().nonnegative(),
});
const storySelectionSchema = z.strictObject({
  context: z.strictObject({ directory: requiredText(4096), canvasPath: mediaPath }),
  projectId: identifier.optional(),
  assets: boundedArray(storyAssetSchema, storyGridImageLimit - 1).refine(items => new Set(items.map(item => item.id)).size === items.length),
  shots: boundedArray(storyShotSchema, 100).refine(items => new Set(items.map(item => item.id)).size === items.length),
});
const storyPlanningSchema = z.strictObject({
  shots: boundedArray(storyShotSchema.extend({ text: boundedText(40000) }), 100),
  attachments: boundedArray(attachmentSchema, storyGridImageLimit),
});
export type ImageWorkbenchStoryPlanning = z.infer<typeof storyPlanningSchema>;

const planSchema = z.strictObject({
  version: z.literal(1),
  templateId: z.enum(imageWorkbenchTemplateIds),
  source: sourceSchema,
  sourceFingerprint,
  mode: z.enum(["quality", "sheet"]),
  requirements: boundedText(imageWorkbenchLimits.requirements),
  languageModel: modelSetting,
  imageModel: imageModelSchema,
  skill: skillSchema,
  storySources: storySelectionSchema.optional(),
  storyPlanning: storyPlanningSchema.optional(),
  cells: boundedArray(cellSchema, 100),
  dormantCells: boundedArray(cellSchema, 100).optional(),
  concurrency: z.int().min(1).max(imageWorkbenchLimits.concurrency),
  sheetCandidates: candidateList,
  selectedSheetCandidateId: identifier.optional(),
});
const stateSchema = planSchema.extend({
  previousPlans: boundedArray(planSchema, 50).optional(),
});
export type ImageWorkbenchStoredPlan = z.infer<typeof planSchema>;
export type ImageWorkbenchState = z.infer<typeof stateSchema>;

/** 调用方可附上已取得的文件版本号或更新时间，避免读取整张图来计算指纹。 */
export function getImageWorkbenchSourceFingerprint(source: ImageWorkbenchSource, revision?: string): string {
  return JSON.stringify([source.nodeId, source.handleId, source.path, revision ?? ""]);
}

export function createImageWorkbenchState(
  templateId: ImageWorkbenchTemplateId,
  source: ImageWorkbenchSource,
  fingerprint = getImageWorkbenchSourceFingerprint(source),
): ImageWorkbenchState {
  const template = getImageWorkbenchTemplate(templateId);
  return loadImageWorkbenchState({
    version: 1,
    templateId,
    source,
    sourceFingerprint: fingerprint,
    mode: template.defaults.mode,
    requirements: template.defaults.requirements,
    languageModel: { model: "", followDefaultModel: true },
    imageModel: { model: "", followDefaultModel: true },
    skill: { mode: "none" },
    cells: template.cells.map(({ id, defaultPrompt }) => ({
      id, prompt: defaultPrompt, referenceIds: [], reason: "", candidates: [],
    })),
    concurrency: 4,
    sheetCandidates: [],
  });
}

/** 校验并返回独立的普通对象。任务恢复和重新提交由调用方按已保存状态处理。 */
export function loadImageWorkbenchState(value: unknown): ImageWorkbenchState {
  let raw = value;
  if (typeof raw === "string") {
    if (raw.length > imageWorkbenchLimits.persistedLength) throw new Error("图片工作台存档过大");
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("图片工作台存档不是有效的 JSON");
    }
  }

  const result = stateSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`图片工作台存档无效（${issue.path.join(".") || "根对象"}）`);
  }
  const state = result.data;
  const candidateIds = new Set<string>();
  const childIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const plan of [state, ...state.previousPlans ?? []]) {
    const template = getImageWorkbenchTemplate(plan.templateId, plan.cells.length);
    if (plan.cells.length !== template.cells.length || plan.cells.some((cell, index) => cell.id !== template.cells[index]?.id)) {
      throw new Error("图片工作台存档的格数或格位与模板不一致");
    }
    const allCells = [...plan.cells, ...plan.dormantCells ?? []];
    const fullTemplate = getImageWorkbenchTemplate(plan.templateId, allCells.length);
    if ((plan.dormantCells?.length && plan.templateId !== "storyTwentyFiveGrid")
      || allCells.some((cell, index) => cell.id !== fullTemplate.cells[index]?.id)) throw new Error("休眠格位与剧情顺序不一致");
    if (plan.storySources && !isStoryGridTemplate(plan.templateId)) throw new Error("剧情素材与模板不一致");
    if (plan.storyPlanning) {
      const selected = new Map(plan.storySources?.shots.map(shot => [shot.id, shot.version]));
      const shots = plan.storyPlanning.shots;
      if (!plan.storySources || shots.length !== selected.size || shots.some(shot => selected.get(shot.id) !== shot.version)) throw new Error("剧情分镜快照与所选分镜不一致");
      const [source] = plan.storyPlanning.attachments;
      if (!source || source.nodeId !== plan.source.nodeId || source.handleId !== plan.source.handleId || source.path !== plan.source.path
        || new Set(plan.storyPlanning.attachments.map(item => item.id)).size !== plan.storyPlanning.attachments.length) {
        throw new Error("剧情素材快照与当前原图或参考图不一致");
      }
      validateStoryShotMapping(plan.cells, shots.map(shot => shot.id));
    }
    for (const { candidates, selectedCandidateId, id: cellId } of [
      ...allCells,
      { candidates: plan.sheetCandidates, selectedCandidateId: plan.selectedSheetCandidateId, id: undefined },
    ]) {
      let previousAttempt = 0;
      for (const candidate of candidates) {
        const sheetCells = candidate.snapshot.sheetCells;
        if (sheetCells) {
          const referenceIds = new Set(candidate.snapshot.references.map(reference => reference.id));
          const cellReferences = new Set(sheetCells.flatMap(cell => cell.referenceIds));
          if (cellId !== undefined || sheetCells.length !== template.cells.length
            || sheetCells.some((cell, index) => cell.id !== template.cells[index].id || new Set(cell.referenceIds).size !== cell.referenceIds.length)
            || cellReferences.size !== referenceIds.size || [...cellReferences].some(id => !referenceIds.has(id))) {
            throw new Error("整张候选的格位提示词或素材快照与模板不一致");
          }
        }
        if (candidate.attempt <= previousAttempt || candidateIds.has(candidate.id) || childIds.has(candidate.childNodeId)
          || (candidate.taskId && taskIds.has(candidate.taskId))) {
          throw new Error("图片工作台存档中存在重复或次序异常的候选尝试");
        }
        previousAttempt = candidate.attempt;
        candidateIds.add(candidate.id);
        childIds.add(candidate.childNodeId);
        if (candidate.taskId) taskIds.add(candidate.taskId);
      }
      if (selectedCandidateId && !candidates.some(candidate => candidate.id === selectedCandidateId && candidate.status === "succeeded")) {
        throw new Error("图片工作台存档的已选候选没有可用图片");
      }
    }
  }

  if (JSON.stringify(state).length > imageWorkbenchLimits.persistedLength) throw new Error("图片工作台存档过大");
  return state;
}

export function isStoryGridTemplate(id?: ImageWorkbenchTemplateId) {
  return id === "storyFourGrid" || id === "storyTwentyFiveGrid";
}

export function validateStoryShotMapping(cells: { sourceShotId?: string }[], orderedShotIds: readonly string[]) {
  const positions = new Map(orderedShotIds.map((id, index) => [id, index]));
  let previous = -1;
  for (const [index, cell] of cells.entries()) {
    if (!orderedShotIds.length && cell.sourceShotId === undefined) continue;
    const position = cell.sourceShotId === undefined ? undefined : positions.get(cell.sourceShotId);
    if (position === undefined || position < previous || position > previous + 1) throw new Error("第 " + (index + 1) + " 格的来源分镜无效、跳过镜头或顺序不符");
    previous = position;
  }
  if (previous !== orderedShotIds.length - 1) throw new Error("剧情规划未覆盖全部所选分镜");
}
