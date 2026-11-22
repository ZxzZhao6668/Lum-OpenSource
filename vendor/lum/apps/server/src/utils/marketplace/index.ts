import { createHash } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { readBounded } from "@/lib/readBounded";
import { t } from "@/lib/i18n";
import { isLocalWorkspaceRequest } from "@/utils/workspace";
import { repositoryName } from "../../../../../appMetadata";

const apiRoot = `https://api.github.com/repos/${repositoryName}`;
const rawAccept = "application/vnd.github.raw+json";
export const revisionSchema = z.string().length(40).regex(/^[a-f0-9]+$/);
export const fileSchema = z.string().max(512).regex(/^packages\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const refSchema = z.object({ object: z.object({ type: z.literal("commit"), sha: revisionSchema }) });
const pluginSchema = z.object({
  type: z.enum(["node", "tool", "ext", "skill"]),
  name: z.string().min(1).max(128),
  displayName: z.string().trim().min(1).max(256),
  description: z.string().max(8192),
  version: z.string().trim().min(1).max(256),
  author: z.string().trim().min(1).max(256),
  file: fileSchema,
  sha256: z.string().length(64).regex(/^[a-f0-9]+$/),
  readme: z.string().optional(),
}).refine(({ type, name, file }) => {
  const fileName = file.split("/").at(-1)!;
  if (fileName.length > 128) return false;
  if (type === "skill") return name.length <= 64 && /^[a-z0-9][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*$/.test(name) && /\.(md|zip|tar|tar\.gz|tgz)$/i.test(fileName);
  const validName = type === "ext" ? /^ext-[a-z][a-zA-Z0-9]*$/ : /^[a-z][a-zA-Z0-9]*$/;
  return validName.test(name) && fileName === `${name}.${type === "tool" ? "tool" : "umd"}.js`;
});
const catalogSchema = z.object({ version: z.literal(1), plugins: z.array(pluginSchema) }).refine(({ plugins }) =>
  new Set(plugins.map(item => `${item.type}:${item.name}`)).size === plugins.length && new Set(plugins.map(item => item.file)).size === plugins.length);
type Catalog = { revision: string; plugins: z.infer<typeof pluginSchema>[] };
let cached: Catalog | undefined;
let expiresAt = 0;
let pending: Promise<Catalog> | undefined;

function fail(message: string, status = 502): never {
  throw Object.assign(new Error(message), { status });
}

export function requireAccess(req: Request) {
  if (process.env.LUM_MARKET_GITHUB_TOKEN && !isLocalWorkspaceRequest(req)) fail("请在桌面端或服务器本机访问私有插件市场", 403);
}

async function readGithub(path: string, accept: string, limit: number, signal: AbortSignal) {
  const token = process.env.LUM_MARKET_GITHUB_TOKEN;
  const headers = { Accept: accept, "User-Agent": "Lum-Marketplace", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const connectionError = () => signal.aborted ? fail("GitHub 插件市场请求超时", 504) : fail("无法读取 GitHub 插件市场，请检查网络连接");
  const response = await fetch(`${apiRoot}/${path}`, { headers, signal, redirect: "error" }).catch(connectionError);
  const sizeError = "GitHub 插件市场文件超过大小限制";
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => {});
    if (!response.ok) fail(t`GitHub 插件市场请求失败（HTTP ${response.status}）`);
    if (!response.body) fail("GitHub 插件市场文件内容为空");
    fail(sizeError, 413);
  }
  return readBounded(response.body, limit, sizeError).catch(error => {
    if (error?.status === 413) fail(sizeError, 413);
    return connectionError();
  });
}

function parseJson<T>(bytes: Buffer, schema: z.ZodType<T>) {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail("GitHub 插件市场数据格式无效"); }
  const result = schema.safeParse(value);
  if (!result.success) fail("GitHub 插件市场数据格式无效");
  return result.data;
}

async function readCatalog(revision: string, signal: AbortSignal): Promise<Catalog> {
  if (cached?.revision === revision) return cached;
  const bytes = await readGithub(`contents/marketplace/catalog.json?ref=${revision}`, rawAccept, 2 * 1024 * 1024, signal);
  return { revision, plugins: parseJson(bytes, catalogSchema).plugins };
}

export async function getCatalog() {
  if (cached && Date.now() < expiresAt) return cached;
  if (!pending) pending = (async () => {
    const signal = AbortSignal.timeout(20_000);
    const ref = await readGithub("git/ref/heads/main", "application/vnd.github+json", 16 * 1024, signal);
    cached = await readCatalog(parseJson(ref, refSchema).object.sha, signal);
    expiresAt = Date.now() + 120_000;
    return cached;
  })().finally(() => { pending = undefined; });
  return pending;
}

export async function getPackage(revision: string, file: string) {
  const signal = AbortSignal.timeout(30_000);
  const { plugins } = await readCatalog(revisionSchema.parse(revision), signal);
  const entry = plugins.find(item => item.file === file);
  if (!entry) fail("插件文件未列入此版本的市场目录", 404);
  const bytes = await readGithub(`contents/marketplace/${entry.file}?ref=${revision}`, rawAccept, 20 * 1024 * 1024, signal);
  if (!bytes.byteLength || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) fail("插件包与市场目录中的 SHA-256 不一致");
  return bytes;
}
