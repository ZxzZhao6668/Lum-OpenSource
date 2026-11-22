import { t } from "@/lib/i18n";
import { existsSync, mkdir, readFile, readFileSync, realpath, stat } from "@lum/file";
import { basename, dirname, join, relative, sep } from "node:path";
import { loadSkills, parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type { SkillContext, SkillLocation, SkillScope } from "@lum/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { directory, isEnabled } from "@/utils/skills/files";
import { isWithin, lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { lumSkillPaths, lumSkillsDirectory } from "./lumLibrary";

export function loadAgentSkills(cwd: string, scope?: SkillScope) {
  if (scope !== undefined && scope !== "workspace" && scope !== "global") throw new Error("技能范围无效");
  const result = loadSkills({
    cwd,
    agentDir: join(cwd, ".agent"),
    includeDefaults: false,
    // 同名技能由工作区优先，列表与运行时共用 SDK 的扫描规则。
    skillPaths: [
      ...(scope !== "global" ? [join(cwd, "skill")] : []),
      ...(scope !== "global" ? lumSkillPaths(cwd) : []),
      ...(scope !== "workspace" ? [join(dirname(conf.path), "skills")] : []),
    ].filter(existsSync),
  });
  result.skills = result.skills.filter(skill => !isWithin(directory(), skill.filePath) || isEnabled(skill.name));
  return result;
}

/** 排队入口不展开 SDK 模板；显式技能仍按当前目录读取正文，再同步入队。 */
export function expandQueuedSkill(cwd: string, prompt: string) {
  const match = /^\/skill:(\S+)(?:\s+([\s\S]*))?$/.exec(prompt);
  if (!match) return prompt;
  const skill = loadAgentSkills(cwd).skills.find(item => item.name === match[1]);
  if (!skill) throw new Error("所选 Skill 已移除，请重新选择");
  const body = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
  return `<skill name=${JSON.stringify(skill.name)} location=${JSON.stringify(skill.filePath)}>\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>\n\n${match[2] ?? ""}`;
}

export function createSkillContext(cwd: string): SkillContext {
  const isLumSkill = (filePath: string) => isWithin(lumSkillsDirectory(cwd), filePath);
  const skillScope = (filePath: string): SkillScope => isWithin(join(cwd, "skill"), filePath) || isLumSkill(filePath) ? "workspace" : "global";

  async function locate(request: SkillLocation, create = false, writing = false) {
    const scope = create ? request.scope ?? "workspace" : request.scope;
    const skill = loadAgentSkills(cwd, scope).skills.find(skill => skill.name === request.name);
    if (!skill && !create) throw new Error(t`技能不存在：${request.name}`);
    if (!skill && (request.name.length > 64 || !/^[a-z][a-zA-Z0-9]*$/.test(request.name))) throw new Error("新技能名称必须为不超过 64 字符的小驼峰");
    const targetScope = scope ?? skillScope(skill!.filePath);
    const lumSkill = !!skill && isLumSkill(skill.filePath);
    if (lumSkill && writing) throw new Error("此 Skill 由 Lum 技能库同步，请在技能页面编辑后重新发送");
    const root = await realpath(targetScope === "workspace" ? cwd : dirname(conf.path));
    const { path: scopeDirectory } = await resolveWorkspacePath(root, lumSkill ? ".agent/lumSkills" : targetScope === "workspace" ? "skill" : "skills", true);
    const baseDirectory = skill?.baseDir ?? join(scopeDirectory, request.name);
    if (!isWithin(scopeDirectory, baseDirectory)) throw new Error("技能目录超出指定范围");
    const { path: skillDirectory } = await resolveWorkspacePath(scopeDirectory, relative(scopeDirectory, baseDirectory), true);
    const path = lumSkill && (!request.path || request.path === "SKILL.md") ? basename(skill!.filePath) : request.path ?? (skill ? basename(skill.filePath) : "SKILL.md");
    const { path: target } = await resolveWorkspacePath(skillDirectory, path, true);
    const filePath = relative(skillDirectory, target).split(sep).join("/");
    if (!skill && filePath !== "SKILL.md") throw new Error("请先创建技能的 SKILL.md，再添加参考资料");
    return { name: request.name, scope: targetScope, path: filePath, target, manifest: basename(target).toLowerCase() === "skill.md" || target === skill?.filePath };
  }

  async function write(request: SkillLocation & { content: string }, create: boolean, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const { target, manifest, ...document } = await locate(request, create, true);
    if (manifest) {
      const { frontmatter } = parseFrontmatter(request.content);
      if (frontmatter.name !== request.name || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
        throw new Error("SKILL.md 必须包含匹配的 name 和非空 description");
      }
    }
    const release = lockWorkspaceFiles([target]);
    try {
      if (!create && !(await stat(target)).isFile()) throw new Error("只能修改已有的普通文件");
      signal?.throwIfAborted();
      if (create) await mkdir(dirname(target), { recursive: true });
      signal?.throwIfAborted();
      await writeWorkspaceFile(target, request.content, create);
      return document;
    } finally { release(); }
  }

  return {
    list: scope => loadAgentSkills(cwd, scope).skills.map(({ name, description, filePath, disableModelInvocation }) => ({
      name, description, filePath, disableModelInvocation, scope: skillScope(filePath),
    })),
    async read(request, signal) {
      signal?.throwIfAborted();
      const { target, manifest, ...document } = await locate(request);
      if (!(await stat(target)).isFile()) throw new Error("只能读取普通文件");
      return { ...document, content: await readFile(target, { encoding: "utf8", signal }) };
    },
    create: (request, signal) => write(request, true, signal),
    update: (request, signal) => write(request, false, signal),
  };
}
