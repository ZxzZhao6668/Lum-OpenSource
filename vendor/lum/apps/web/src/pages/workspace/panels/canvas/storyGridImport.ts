import axios from "axios";
import type useWorkspaceFiles from "@/lib/workspaceFiles";
import { ensureFolder, imageMime } from "@/lib/storyboardBridge";
import {
  storyGridBatchBytes, storyGridImageBytes, storyGridImageLimit,
  type StoryGridImageInput, type StoryGridImageReceipt,
} from "@lum/node-shared/storyGridSources";
import { parseWritingMaterials, type WritingMaterial } from "./writingMaterials";

type FindImage = (key: string) => Omit<StoryGridImageReceipt, "id" | "sha256"> | undefined;

export async function importStoryGridImages(
  value: unknown, files: ReturnType<typeof useWorkspaceFiles>, findImage: FindImage,
  addImages: (items: WritingMaterial[]) => Promise<{ conflicts: string[] }>, check: () => void,
): Promise<{ images: StoryGridImageReceipt[] }> {
  if (!Array.isArray(value) || !value.length || value.length >= storyGridImageLimit) throw new Error("剧情原图导入数量无效");
  const ids = new Set<string>();
  let bytes = 0;
  for (const item of value) {
    if (typeof item?.id !== "string" || item.id.length > 1200 || ids.has(item.id) || !(item.blob instanceof Blob)
      || !item.blob.size || item.blob.size > storyGridImageBytes || typeof item.sourceKey !== "string"
      || !/^(entity|assetView):[\w:.-]{1,399}$/.test(item.sourceKey)
      || (item.legacyKey !== undefined && (typeof item.legacyKey !== "string" || !/^(entity|assetView):[\w:.-]{1,399}$/.test(item.legacyKey)))
      || !["location", "character", "prop"].includes(item.category)) throw new Error("剧情原图或来源标识无效");
    ids.add(item.id);
    bytes += item.blob.size;
  }
  if (bytes > storyGridBatchBytes) throw new Error("本次剧情素材原图超过 64 MiB");
  const staged = new Map<string, WritingMaterial>();
  const targets: { id: string; key: string; sha256: string; path: string; mimeType: string }[] = [];
  const verified = new Map<string, { sha256: string; size: number }>();
  const inspect = async (path: string) => {
    let result = verified.get(path);
    if (!result) {
      result = await files.inspectBinary(path);
      check();
      verified.set(path, result);
    }
    return result;
  };
  let initialized = false, preparedFiles = 0, imported = false;
  try {
    for (const item of value as StoryGridImageInput[]) {
      const buffer = await item.blob.arrayBuffer();
      check();
      const mimeType = imageMime(new Uint8Array(buffer));
      if (item.blob.type && item.blob.type !== mimeType) throw new Error("原图声明与实际格式不一致");
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      check();
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (item.imageSource && item.imageSource.mediaId !== "sha256:" + sha256) throw new Error("原图字节与已保存的视图版本不符");
      const key = item.sourceKey + ":image";
      const existing = findImage(key);
      const legacyKey = item.legacyKey && item.legacyKey + ":image";
      const legacy = !existing && legacyKey ? findImage(legacyKey) : undefined;
      const prior = existing || legacy || undefined;
      if (prior) {
        const actual = await inspect(prior.path).catch(error => {
          if (!existing && axios.isAxiosError(error) && error.response?.status === 404) return undefined;
          throw error;
        });
        check();
        if (actual?.sha256 === sha256 && prior.mimeType === mimeType) {
          targets.push({ id: item.id, key: existing ? key : legacyKey!, sha256, path: prior.path, mimeType });
          continue;
        }
        if (existing) throw new Error("画布中的「" + item.label + "」图片已修改，请先移除冲突引用或直接选择画布中当前的图片");
      }
      const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" })[mimeType];
      const path = "assets/storyGridSources/" + sha256 + "." + extension;
      const [material] = parseWritingMaterials([{
        key, sourceKey: item.sourceKey, kind: "image", label: item.label, entityKind: item.category,
        imageSource: item.imageSource, image: { path, mimeType },
      }]);
      if (staged.has(key) && staged.get(key)!.image!.path !== path) throw new Error("相同素材版本对应了不同图片");
      if (!initialized) {
        await ensureFolder(files, "", "assets"); check();
        await ensureFolder(files, "assets", "storyGridSources"); check();
        initialized = true;
      }
      if (!verified.has(path)) {
        await files.write(path, new Blob([buffer], { type: mimeType }), true).then(() => {
          preparedFiles++;
          verified.set(path, { sha256, size: buffer.byteLength });
        }, async error => {
          if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error;
          const actual = await inspect(path);
          if (actual.sha256 !== sha256) throw new Error("已存在同名原图，内容校验失败");
        });
        check();
      }
      staged.set(key, material!);
      targets.push({ id: item.id, key, sha256, path, mimeType });
    }
    if (staged.size) {
      imported = true;
      const report = await addImages([...staged.values()]);
      check();
      if (report.conflicts.length) throw new Error("部分画布节点存在素材冲突：" + report.conflicts.join("、"));
    }
    const images = targets.map(({ id, key, sha256, path, mimeType }) => {
      const actual = findImage(key);
      if (!actual || actual.path !== path || actual.mimeType !== mimeType) throw new Error("素材图片节点回执与实际输出不符");
      return { id, sha256, ...actual };
    });
    return { images };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (imported) throw new Error(detail + "。部分图片节点可能已导入，请查看画布，重试时会按来源复用");
    if (preparedFiles) throw new Error(detail + "。已写入的原图文件保留，重试时会复用");
    throw error;
  }
}
