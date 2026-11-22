import { listSkills, captureAgentSkillSnapshot, type WritingSkill } from '../skills/skillStore';
import type { ExtractionRange, ScriptSetupTaskKind } from './scriptSetupTasks';
import { taskObject, taskText } from './scriptSetupAi';

export type TaskSkillChoice = { mode: 'none' | 'auto' } | { mode: 'manual'; skillId: string };
export interface TaskSkillSelection { mode: TaskSkillChoice['mode']; reason: string }

export async function selectScriptSetupTaskSkill(
  choice: TaskSkillChoice,
  task: { kind: ScriptSetupTaskKind; range: ExtractionRange; request: string },
): Promise<{ skillSelection: TaskSkillSelection; skill?: WritingSkill }> {
  if (choice.mode === 'none') return { skillSelection: { mode: 'none', reason: '本次不使用 Skill。' } };

  const skills = await listSkills('agent');
  if (choice.mode === 'manual') {
    const selected = skills.find(skill => skill.id === choice.skillId);
    if (!selected) throw Error('请选择当前可用的写作 Skill。');
    return { skillSelection: { mode: 'manual', reason: '本次预览使用你手动选定的目录 Skill。' }, skill: captureAgentSkillSnapshot(selected) };
  }

  // Use task type and bounded, visible text cues. Never consult a model during preview.
  const request = task.request.slice(0, 12000);
  const idea = task.range.kind === 'idea' ? task.range.text.slice(0, 12000) : '';
  const worldCue = /世界观|世界规则|历史时间线|时空规则|能力边界/.test(idea);
  const shortDramaCue = /短剧|单集.{0,8}分钟/.test(request);
  const rule = task.kind === 'outline'
    ? { id: 'advisor-structure', reason: '总纲候选匹配故事结构与阶段转折。' }
    : task.kind === 'episodePlan'
      ? { id: 'advisor-short-drama', reason: shortDramaCue ? '集纲要求包含短剧或单集分钟数线索，匹配分集目标与悬念方法。' : '集纲候选匹配分集目标、冲突和结尾悬念方法。' }
      : worldCue
        ? { id: 'advisor-world', reason: '粘贴想法的前 12000 字符含世界规则相关词，匹配世界观与连续性方法。' }
        : undefined;
  if (!rule) return { skillSelection: { mode: 'auto', reason: '本地规则未匹配当前提取范围或想法中的明确线索，本次不使用 Skill。' } };
  const selected = skills.find(skill => skill.id === rule.id);
  if (!selected) return { skillSelection: { mode: 'auto', reason: '本地规则命中的 Skill 当前未分配给写作 Agent，本次不使用 Skill。' } };
  return { skillSelection: { mode: 'auto', reason: '本地规则 · ' + rule.reason }, skill: captureAgentSkillSnapshot(selected) };
}

export function validateTaskSkillSelection(value: unknown, skill: unknown) {
  const selection = taskObject(value, ['mode', 'reason']);
  const { mode } = selection;
  if ((mode !== 'none' && mode !== 'auto' && mode !== 'manual') || mode === 'manual' && skill === undefined
    || mode === 'none' && skill !== undefined) throw Error('候选 Skill 的选择模式与实际快照不一致。');
  taskText(selection.reason, 500);
}

