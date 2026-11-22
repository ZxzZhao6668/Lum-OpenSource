import http from "@/lib/http";
import type { Plugin } from "@/components/settings/panels/pluginMarket/types";
import catalog from "../../../../../../marketplace/catalog.json";

const packageUrls = import.meta.glob<string>("../../../../../../marketplace/packages/**/*", {
  eager: true, query: "?url&no-inline", import: "default",
});
const marketRoot = `${import.meta.env.repositoryUrl}/tree/main/marketplace`;
export const marketLinks = {
  catalog: marketRoot,
  guide: `${import.meta.env.repositoryUrl}/blob/main/marketplace/README.md`,
  submit: `${import.meta.env.repositoryUrl}/upload/main/marketplace/packages`,
  submissions: `${import.meta.env.repositoryUrl}/pulls?q=is%3Apr+author%3A%40me`,
};

type Entry = (typeof catalog.plugins)[number] & { readme?: string };
function listing(entries: Entry[], revision?: string): Plugin[] {
  return entries.map(entry => {
    const type = entry.type;
    if (type !== "node" && type !== "tool" && type !== "skill" && type !== "ext") throw new Error("插件类型无效");
    const url = revision
      ? `/api/marketplace/package?${new URLSearchParams({ revision, file: entry.file })}`
      : packageUrls[`../../../../../../marketplace/${entry.file}`];
    if (!url || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("插件目录中的文件信息无效");
    return {
      key: `${type}:${entry.name}`, type, name: entry.name, displayName: entry.displayName, author: entry.author,
      description: entry.description, version: entry.version, readme: entry.readme, url, fileName: entry.file.split("/").pop(),
      sha256: entry.sha256,
    };
  });
}

export const bundledPlugins = listing(catalog.plugins);

export async function fetchMarketPlugins(signal: AbortSignal) {
  const data = await http<{ revision: string; plugins: Entry[] }>({ method: "GET", url: "/api/marketplace/catalog", signal });
  if (!/^[a-f0-9]{40}$/.test(data.revision) || !Array.isArray(data.plugins)) throw new Error("插件目录格式无效");
  return listing(data.plugins, data.revision);
}

export async function downloadMarketFile(plugin: Plugin) {
  if (!plugin.url || !plugin.fileName || !plugin.sha256) throw new Error("缺少插件文件信息");
  const response = await fetch(plugin.url, { headers: { "x-lum-workspace": "1" } });
  if (!response.ok) throw new Error(`下载插件失败（HTTP ${response.status}）`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error("插件包大小无效");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  if (hex !== plugin.sha256) throw new Error("插件包与目录中的 SHA-256 不一致，请刷新市场后重试");
  return new File([bytes], plugin.fileName);
}
