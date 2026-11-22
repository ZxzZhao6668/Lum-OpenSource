import { createHash } from "node:crypto";
import { join } from "node:path";
import { existsSync, mkdir, readFile, readFileSync, realpathSync, writeAtomic } from "@lum/file";
import { z } from "zod";
import { isWithin, lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";

const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !value.includes("\0"));
export const lumSkillsSchema = z.array(z.object({
  id: z.string().regex(/^[\w-]{1,100}$/), name: text(120),
  description: z.string().max(4000).refine(value => !value.includes("\0")), instruction: text(60000),
})).max(500).refine(skills => new Set(skills.map(skill => skill.id)).size === skills.length, "Skill ID 重复")
  .refine(skills => skills.reduce((size, skill) => size + skill.instruction.length, 0) <= 20000000, "Skill 库过大");

const indexSchema = z.object({ version: z.literal(1), files: z.array(z.string().regex(/^lum[a-f0-9]{88}\.md$/)).max(500) });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export const lumSkillsDirectory = (cwd: string) => join(cwd, ".agent", "lumSkills");

export function lumSkillPaths(cwd: string): string[] {
  const root = lumSkillsDirectory(cwd), index = join(root, "index.json");
  if (!existsSync(index)) return [];
  if (!isWithin(realpathSync(cwd), realpathSync(index))) throw new Error("Lum 技能目录超出工作区");
  return indexSchema.parse(JSON.parse(readFileSync(index, "utf8"))).files.map(file => {
    const path = join(root, file);
    if (!isWithin(realpathSync(root), realpathSync(path))) throw new Error("Lum 技能文件超出技能目录");
    return path;
  });
}

export async function syncLumSkills(cwd: string, skills: z.infer<typeof lumSkillsSchema>) {
  const { path: root } = await resolveWorkspacePath(cwd, ".agent/lumSkills", true);
  const release = lockWorkspaceFiles([root]);
  try {
    await mkdir(root, { recursive: true });
    const files: string[] = [];
    for (const skill of skills) {
      const name = `lum${digest(skill.id).slice(0, 24)}`;
      // 元数据用 JSON 字符串编码为 YAML 标量；技能正文仅在被选中或读取时进入上下文。
      const content = `---\nname: ${name}\ndescription: ${JSON.stringify(`Lum · ${skill.name}：${skill.description || skill.name}`.slice(0, 1024))}\nmetadata:\n  displayName: ${JSON.stringify(`Lum · ${skill.name}`)}\n---\n\n${skill.instruction}\n`;
      const file = `${name}${digest(content)}.md`;
      const { path } = await resolveWorkspacePath(root, file);
      if (!existsSync(path)) await writeAtomic(path, content, { exclusive: true });
      files.push(file);
    }
    const snapshot = JSON.stringify({ version: 1, files });
    const { path: index } = await resolveWorkspacePath(root, "index.json");
    const previous = await readFile(index, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    // 只替换完整索引；旧内容留给正在运行的会话，取消/失败不会发布半份技能库。
    if (previous !== snapshot) await writeAtomic(index, snapshot);
    return { count: files.length };
  } finally { release(); }
}
