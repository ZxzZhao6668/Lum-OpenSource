import { validateAgentSkillSnapshot, type WritingSkill } from '../skills/skillStore';

export interface WritingRequestSource {
  providerId: string;
  modelId: string;
  styleId: string;
  /** Missing in old records. Null explicitly records a request without a Skill. */
  skill?: WritingSkill | null;
  skillId?: string;
  scope: 'selection' | 'scene' | 'episode';
  episodeId: string;
  revision: number;
  workflowId?: string;
}

function sourceId(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max && !value.includes('\0');
}
export function validateWritingRequestSource(value: unknown): WritingRequestSource {
  const fields = ['providerId', 'modelId', 'styleId', 'skillId', 'skill', 'scope', 'episodeId', 'revision', 'workflowId'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw Error('写作请求来源格式无效。');
  const source = value as Record<string, unknown>;
  if (!sourceId(source.providerId, 1000) || !sourceId(source.modelId, 1000) || !sourceId(source.styleId, 100)
    || !sourceId(source.episodeId, 200) || /[:\s]/.test(source.episodeId)
    || source.scope !== 'selection' && source.scope !== 'scene' && source.scope !== 'episode' || !Number.isSafeInteger(source.revision) || Number(source.revision) < 0
    || source.workflowId !== undefined && !sourceId(source.workflowId, 200)
    || source.skillId !== undefined && (typeof source.skillId !== 'string' || !/^[\w-]{1,100}$/.test(source.skillId)))
    throw Error('写作请求来源版本或标识无效。');
  if (source.skill !== undefined && source.skill !== null) {
    const skill = validateAgentSkillSnapshot(source.skill);
    if (source.skillId !== undefined && source.skillId !== skill.id) throw Error('写作请求的 Skill 标识与快照不一致。');
    return { ...source, skill } as unknown as WritingRequestSource;
  }
  if (source.skill === null && source.skillId !== undefined) throw Error('写作请求未使用 Skill，不能附带 Skill 标识。');
  return source as unknown as WritingRequestSource;
}

