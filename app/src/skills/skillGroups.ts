import type { WritingSkill } from './skillStore';

const categoryOrder = [
  '剧本创作', '改编与叙事', '文风与润色', '创作顾问', '资产提取', '封面创作', '叙事插画',
  '人物资产', '场景资产', '道具资产', '通用生图', '分镜图资产', '文字分镜', '白模预演 · 动作风格', '白模预演 · 镜头描述',
  'Seedance 2.0', 'Seedance 2.5', 'MiniMax H3', '视频提示词', '视频风格库', '视频一致性', '写作 Agent',
];
const imageCategories = {
  'cover-image': '封面创作',
  'character-image': '人物资产', 'location-image': '场景资产',
  'prop-image': '道具资产', 'storyboard-image': '分镜图资产',
} as const;

export function skillCategory(skill: WritingSkill): string {
  if (skill.collection?.trim()) return skill.collection.trim();
  if (skill.advisor) return '创作顾问';
  if (skill.uses.includes('previs-action')) return '白模预演 · 动作风格';
  if (skill.uses.includes('previs-camera')) return '白模预演 · 镜头描述';
  const images = Object.entries(imageCategories).filter(([use]) => skill.uses.includes(use as keyof typeof imageCategories));
  if (images.length > 1) return '通用生图';
  if (images.length === 1) return images[0][1];
  if (skill.uses.includes('storyboard-plan')) return '文字分镜';
  if (skill.uses.includes('video-continuity')) return '视频一致性';
  if (skill.uses.includes('video-style')) return '视频风格库';
  if (skill.uses.includes('video-prompt')) return '视频提示词';
  if (skill.uses.some(use => use === 'rewrite' || use === 'expand' || use === 'describe')) return '文风与润色';
  return '写作 Agent';
}

export function groupSkills(skills: WritingSkill[]) {
  const groups = new Map<string, WritingSkill[]>();
  for (const skill of skills) {
    const category = skillCategory(skill);
    const group = groups.get(category) ?? [];
    group.push(skill);
    groups.set(category, group);
  }
  const rank = (category: string) => {
    const index = categoryOrder.indexOf(category);
    return index < 0 ? categoryOrder.length : index;
  };
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'zh-CN'));
}

const expandedKey = 'lum:skillLibrary:expandedGroups:v1';
export function readExpandedSkillGroups(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(expandedKey) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : []);
  } catch { return new Set(); }
}
export function rememberExpandedSkillGroups(groups: Set<string>) {
  try { localStorage.setItem(expandedKey, JSON.stringify([...groups])); } catch { /* Folding still works when storage is unavailable. */ }
}
