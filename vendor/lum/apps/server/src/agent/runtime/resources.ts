import { t } from "@/lib/i18n";
import { readFile } from "@lum/file";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt } from "@/agent/runtime/prompt";
import { loadAgentSkills } from "@/agent/skills";
import { isWithin, resolveWorkspacePath } from "@/utils/workspace/files";
import { lumSkillsDirectory } from "@/agent/skills/lumLibrary";
import { isMemoryEnabled, readDocument } from "@/utils/personalization";
import conf from "@/utils/conf";
import { getRuntimePlatform } from "@/lib/platform";

export async function createAgentResources(cwd: string, tools: ToolDefinition[], settings = SettingsManager.inMemory(), instructions = "", useSkills = true) {
  const savedPrompt = conf.get("settings", {}).agentSystemPrompt;
  const systemPrompt = typeof savedPrompt === "string" ? savedPrompt : undefined;
  const agentDir = join(cwd, ".agent");
  const { path: agentsPath } = await resolveWorkspacePath(cwd, "AGENTS.md");
  const agentsContent = await readFile(agentsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw new Error(t`读取工作区 AGENTS.md 失败：${error.message}`, { cause: error });
  });
  const [globalAgents, memory] = await Promise.all([readDocument("agents"), isMemoryEnabled() ? readDocument("memory") : { content: "" }]);
  const skills = useSkills ? loadAgentSkills(cwd) : { skills: [], diagnostics: [] };
  const defaultSkillGuidance = useSkills ? "" : "## 当前技能模式：默认（不调用 Skill）\n本次请求不使用任何 Skill。直接依据用户要求和可用的非技能工具处理，不查询技能目录、不读取技能文件、不套用历史已读 Skill，也不让子任务代为调用 Skill。忽略其他提示中的自动查找技能流程；不因未读取 Skill 而中断正常工作。";
  const lumSkillGuidance = skills.skills.some(skill => isWithin(lumSkillsDirectory(cwd), skill.filePath)) ? `## Lum Skill 自动匹配
收到用户的问题或制作要求，先理解目标、媒介、对象和风格，再查找当前项目技能目录。用户不需要手动选择 Skill，也不需要知道技能名。
有 skillOperator 时先 list，根据 name 和 description 选择最少的相关技能并 read 正文；例如场景四宫格、人物设定、文字分镜、视频提示词和视频一致性分别匹配相应任务。没有 skillOperator 时，只在有读取工具和 available_skills 时按目录读取；读取权限关闭时不绕过权限。
应用前用一句话说明采用的技能，不把选择任务退回用户。已在当前上下文完整读取且仍适用的规则可复用；用户换任务时重新判断。不相关的技能、人物描写和资产引用不要加入，普通聊天或没有匹配项时直接回答。
手动指定的 Skill 与用户本次明确要求优先，冲突时以本次要求为准。遵守现有工具权限和生成确认规则；读取 Skill 不等于获得额外生成或修改授权。只有实际读取了正文才说已使用，缺失或读取失败要说明。` : "";
  const sdkSkills = tools.some(tool => tool.name === "skillOperator")
    ? { ...skills, skills: skills.skills.map(skill => ({ ...skill, disableModelInvocation: true })) }
    : skills;
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    // ACT: 仅自动载入工作区根目录的 AGENTS.md，关闭 SDK 向父目录和其他指令文件的自动扫描。
    noContextFiles: true,
    agentsFilesOverride: () => ({ agentsFiles: agentsContent.trim() ? [{ path: agentsPath, content: agentsContent.replace(/^\uFEFF/, "") }] : [] }),
    // ACT: 技能正文按需读取；每个会话独立创建 loader，避免 SDK 的会话绑定互相覆盖。
    skillsOverride: () => sdkSkills,
    systemPrompt: "",
    systemPromptOverride: () => [buildSystemPrompt({ systemPrompt, tools, skills: skills.skills, platform: getRuntimePlatform().os }), lumSkillGuidance, instructions, defaultSkillGuidance].filter(Boolean).join("\n\n"),
    appendSystemPrompt: [
      globalAgents.content.trim() ? `## 全局协作规范（AGENTS.md）\n${globalAgents.content}` : "",
      memory.content.trim() ? `## 全局长期记忆\n以下是跨对话保存的偏好与事实，使用前核对适用项目，以用户本轮要求为准。\n<global_memory>\n${memory.content}\n</global_memory>` : "",
    ].filter(Boolean),
  });
  await resourceLoader.reload();
  return { agentDir, settingsManager: settings, resourceLoader };
}
