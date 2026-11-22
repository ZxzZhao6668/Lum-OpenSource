import { copyFile, cp, mkdir, readFile, readdir, rename, unlink, writeAtomic, writeFile } from "@lum/file";
import { resolve } from "node:path";

export default async function initializePlugins(targetDirectory: string, sourceDirectory: string, fileFilter?: RegExp | readonly string[], revision?: string) {
  const marker = resolve(targetDirectory, "initialized");
  const initialized = await readFile(marker, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (initialized !== null && (revision === undefined || initialized === revision)) return;

  const entries = await readdir(sourceDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entries) return;
  await mkdir(targetDirectory, { recursive: true });
  const files = entries.filter(file => fileFilter
    ? file.isFile() && (fileFilter instanceof RegExp ? fileFilter.test(file.name) : fileFilter.includes(file.name))
    : file.isDirectory());
  if (!files.length && revision === undefined) return;
  for (const file of files) {
    const source = resolve(sourceDirectory, file.name);
    const target = resolve(targetDirectory, file.name);
    if (revision === undefined) {
      await cp(source, target, { recursive: true, force: false });
      continue;
    }
    // ACT: 版本同步仅覆盖匹配的内置单文件；同目录 rename 保留失败时的旧文件。
    const temporary = resolve(targetDirectory, `.pluginSync${crypto.randomUUID()}`);
    try {
      await copyFile(source, temporary);
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch((cleanupError: NodeJS.ErrnoException) => {
        if (cleanupError.code !== "ENOENT") console.warn(`插件同步临时文件清理失败：${temporary}`, cleanupError);
      });
      throw error;
    }
  }
  // 同一构建只同步一次；安装器移除标记以支持同版本重装，构建变化支持升级和降级。
  await (revision === undefined ? writeFile(marker, "", { flag: "wx" }) : writeAtomic(marker, revision, { mode: 0o666 })).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

/**
 * 内置技能目录按「首次安装」处理；之后新增的内置技能（如剧本创作）也要补装给老用户。
 * 用 `.builtinSeen` 记住装过的名字：只补从未装过的目录，不覆盖用户修改，用户删掉的也不再补回。
 */
export async function installNewBuiltinDirectories(targetDirectory: string, sourceDirectory: string) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entries) return;
  const seenPath = resolve(targetDirectory, ".builtinSeen");
  const seen = new Set<string>(await readFile(seenPath, "utf8").then(text => JSON.parse(text) as string[], (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  }).catch(() => []));
  const names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  let changed = false;
  for (const name of names) {
    if (seen.has(name)) continue;
    await cp(resolve(sourceDirectory, name), resolve(targetDirectory, name), { recursive: true, force: false, errorOnExist: false });
    seen.add(name);
    changed = true;
  }
  if (changed) await writeAtomic(seenPath, JSON.stringify([...seen].sort()), { mode: 0o666 });
}
