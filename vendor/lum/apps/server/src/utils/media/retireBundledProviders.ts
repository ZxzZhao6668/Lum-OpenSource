import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { lstat, readFile, unlink } from "@lum/file";
import conf from "@/utils/conf";

// 仅匹配已发行的原始文件。同名供应商如已改写模型或实现，保留用户版本。
const releasedHashes: Record<string, string[]> = {
  apiMart: [
    "990ff330eb732a5498f6c56066157f33a93a1387aed89aa87da86b5418b8ef8b",
    "01fae9694867c008a919b4e6ce6e2afe592f283309894bf3c0f9a842fb8cfa74",
    "7f35ee391e85f44d2740f2a7473098943412e1f355a0e22d07c08a41a2b5f4ef",
  ],
  metaso: ["cc0f703ac7f0bcf814d44eef6d172a3413c65374cfd6bade9d38060ea0a9a154"],
  compshare: ["3275308ae45154cf6673e6bd667fa821080e93896a1308d9840109b6b26193ea"],
  officialTopaz: ["1ea484b3ca2296845a45ea0e6a2b12ac1131497a0f5245413bcbee61f3229610"],
};

function existing(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

export async function retireBundledProviders() {
  if (conf.get("retiredBundledMediaProviders")) return;
  const directory = join(dirname(conf.path), "providers");
  const info = await existing(directory);
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("供应商目录不能是符号链接或文件");
  const retired = new Set<string>();
  for (const id of [...Object.keys(releasedHashes), "toonflow", "tfrouter"]) {
    const file = join(directory, `${id}.ts`);
    const entry = info && await existing(file);
    if (entry) {
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 2 * 1024 * 1024) continue;
      const source = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
      const bundled = id === "toonflow" ? source.startsWith("// Toonflow account provider\n")
        : releasedHashes[id]?.includes(createHash("sha256").update(source).digest("hex"));
      if (!bundled) continue;
      await unlink(file);
    }
    // 上次中途退出时文件可能已经移除，继续收尾其连接配置和默认值。
    retired.add(id);
  }

  const settings = conf.get("settings", {});
  const configs = settings.mediaProviderConfigs;
  const archivedConfigs: Record<string, unknown> = {};
  if (configs && typeof configs === "object" && !Array.isArray(configs)) {
    for (const [id, config] of Object.entries(configs)) {
      if (!retired.has(id)) continue;
      archivedConfigs[id] = config;
      Reflect.deleteProperty(configs, id);
    }
  }
  const defaults = settings.modelDefaults;
  if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
    for (const [kind, model] of Object.entries(defaults)) {
      if (/^(image|video|audio)(Edit|Upscale)?$/.test(kind) && retired.has(model?.providerId)) Reflect.deleteProperty(defaults, kind);
    }
  }
  // 凭据留在受原权限保护的本地配置备份中，重用旧 ID 时不向新适配器提供旧凭据。
  conf.set({ settings, retiredBundledMediaProviders: true, ...(Object.keys(archivedConfigs).length ? { retiredMediaProviderConfigs: archivedConfigs } : {}) });
}
