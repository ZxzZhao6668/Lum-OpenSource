import type { NodeMediaModel } from "@lum/nodes-scaffold/nodeAi";
import { modelKey } from "@lum/node-shared/useMediaModels";

/** 资产生图设置，存在节点数据里；"auto" 表示跟随默认模型 / 按资产类型定比例 / 用模型默认分辨率。 */
export interface ImageSettings { model: string; ratio: string; size: string }
export const createImageSettings = (): ImageSettings => ({ model: "auto", ratio: "auto", size: "auto" });

export function pickedImageModel(settings: ImageSettings, models: NodeMediaModel[]) {
  return models.find(item => modelKey(item) === settings.model);
}
export const ratiosOf = (model?: NodeMediaModel) => model?.imageRatios?.length ? model.imageRatios : ["16:9"];
/** 与图片生成节点一致：按数值从小到大，未知名称排在后面。 */
export const sizesOf = (model?: NodeMediaModel) => (model?.imageSizes?.length ? model.imageSizes : ["2K"])
  .toSorted((left, right) => (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity));

/** 新建图片生成节点时带上的模型、比例和分辨率；模型不支持的值交给节点自己回落。 */
export function imageNodeSettings(settings: ImageSettings, models: NodeMediaModel[], fallback: NodeMediaModel | undefined, autoRatio: string) {
  const picked = pickedImageModel(settings, models);
  const model = picked ?? fallback;
  return {
    ratio: settings.ratio !== "auto" && ratiosOf(model).includes(settings.ratio) ? settings.ratio : autoRatio,
    ...(picked ? { model: settings.model, followDefaultModel: false } : {}),
    ...(settings.size !== "auto" && sizesOf(model).includes(settings.size) ? { size: settings.size } : {}),
  };
}
