import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { lstat, mkdir, readdir, readFile, writeAtomic } from "@lum/file";
import conf from "@/utils/conf";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { isStageLibraryEntry, isStageLibraryModel, stageMeshDimensions, type StageLibraryEntry, type StageLibraryModel } from "@lum/node-shared/stageLibrary";

let seedPromise: Promise<void> | undefined;
async function seedBundledLibrary(root: string) {
  const resources = process.env.LUM_RESOURCE_ROOT;
  if (!resources) return;
  const source = join(resources, "stageLibrary");
  let names: string[];
  try { names = await readdir(source); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const existing = new Set(await readdir(root));
  // Add bundled assets once. Never replace user imports or modified local models.
  for (const name of names) {
    if (existing.has(name) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}\.(json|png|txt)$/.test(name)) continue;
    const path = join(source,name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 12 * 1024 * 1024) continue;
    const target = await resolveWorkspacePath(root,name,true);
    try { await writeAtomic(target.path,await readFile(path),{exclusive:true}); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
}
async function libraryDirectory() {
  const root = dirname(conf.path);
  const resolved = await resolveWorkspacePath(root, "stageLibrary");
  await mkdir(resolved.path, { recursive: true });
  await (seedPromise ??= seedBundledLibrary(resolved.path).catch(error => { seedPromise = undefined; throw error; }));
  return (await resolveWorkspacePath(root, "stageLibrary")).path;
}

export async function list(query = "", category = "", offset = 0, limit = 40) {
  const root = await libraryDirectory(), words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  // ACT: Metadata is separate from geometry; at most 10,000 entries are read, meshes only on demand.
  const names = (await readdir(root)).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.meta\.json$/.test(name)).sort().slice(0, 10000);
  const entries: StageLibraryEntry[] = [];
  let invalid = 0;
  for (const name of names) {
    try {
      const resolved = await resolveWorkspacePath(root, name), info = await lstat(resolved.path);
      if (!info.isFile() || info.size > 16384) { invalid++; continue; }
      const item: unknown = JSON.parse(await readFile(resolved.path, "utf8"));
      if (!isStageLibraryEntry(item) || name !== `${item.id}.meta.json`) { invalid++; continue; }
      const text = `${item.name} ${item.category} ${item.tags.join(" ")}`.toLocaleLowerCase();
      if ((!category || item.category === category) && words.every(word => text.includes(word))) entries.push(item);
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") { invalid++; continue; }
      throw error;
    }
  }
  return { items: entries.slice(offset, offset + limit), total: entries.length, invalid, directory: root };
}

export async function read(id: string): Promise<StageLibraryModel> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) throw Object.assign(new Error("无效的模型标识"), { status: 400 });
  const root = await libraryDirectory(), resolved = await resolveWorkspacePath(root, `${id}.json`), info = await lstat(resolved.path);
  if (!info.isFile() || info.size > 12 * 1024 * 1024) throw new Error("模型文件过大或不是普通文件");
  const model: unknown = JSON.parse(await readFile(resolved.path, "utf8"));
  if (!isStageLibraryModel(model) || model.id !== id) throw new Error("本地模型文件无效，请重新导入");
  return { ...model, dimensions: stageMeshDimensions(model.meshParts), triangles: model.meshParts.reduce((n, part) => n + part.indices.length / 3, 0) };
}

export async function preview(id: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) throw Object.assign(new Error("无效的模型标识"), { status: 400 });
  const root = await libraryDirectory(), resolved = await resolveWorkspacePath(root, `${id}.png`), info = await lstat(resolved.path);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("预览图无效或过大");
  return resolved.path;
}

export async function save(input: unknown) {
  if (!isStageLibraryModel(input)) throw Object.assign(new Error("模型格式无效或超过 2 万三角面"), { status: 400 });
  const root = await libraryDirectory(), id = `user${randomUUID().replaceAll("-", "")}`;
  const model: StageLibraryModel = { version: 1, id, name: input.name.trim(), category: input.category, tags: [...new Set(input.tags)], source: input.source, license: input.license, meshParts: input.meshParts, dimensions: stageMeshDimensions(input.meshParts), triangles: input.meshParts.reduce((sum, part) => sum + part.indices.length / 3, 0) };
  const path = join(root, `${id}.json`), release = lockWorkspaceFiles([path]);
  try {
    await writeAtomic(path, JSON.stringify(model));
    const { meshParts, version, ...entry } = model;
    await writeAtomic(join(root, `${id}.meta.json`), JSON.stringify(entry));
    return entry;
  } finally { release(); }
}
