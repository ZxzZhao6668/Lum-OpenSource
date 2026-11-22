export interface WritingStyle { id: string; label: string; instruction: string }
/** Local writing guidance; independent wording, not a claim to recover private advisor prompts. */
export const writingStyles: WritingStyle[] = [
  { id: 'unchanged', label: '保持原文风格', instruction: '保持原文的叙述视角、人物口吻和语言密度，不改变既有事实。' },
  { id: 'minimalist', label: '极简冷峻', instruction: '采用简洁明确的句子，用动作和具体物件承载情绪，减少解释与修饰，保留潜台词。' },
  { id: 'lyrical', label: '诗意文学', instruction: '重视意象、感官细节和句子节奏，让情绪自然显现，避免辞藻堆积。' },
  { id: 'noir', label: '冷硬黑色', instruction: '语气克制而锋利，强化人物困境、道德冲突与冷幽默，避免无关的阴暗描写。' },
  { id: 'thriller', label: '悬疑快节奏', instruction: '用紧凑动作、清晰因果和递进阻力推动故事，适度留出悬念，不凭空篡改线索。' },
  { id: 'cozy', label: '温暖治愈', instruction: '关注日常互动和具体关怀，语言自然温和，避免说教与过度煽情。' },
  { id: 'epic', label: '史诗奇幻', instruction: '体现环境的尺度与历史感，同时保留人物具体目标；新设定只能作为建议，不当作已确认事实。' },
  { id: 'romance', label: '浪漫深情', instruction: '通过微小动作、关系张力和未说出口的话表达情感，不改变既定人物关系。' },
  { id: 'youngAdult', label: '青春成长', instruction: '使用鲜活自然的表达，突出自我认知、同伴关系和成长选择，避免刻板青春口吻。' },
];
export const writingStarters = [
  '先阅读当前场次，指出对白和动作中最值得改进的地方，暂不修改。',
  '检查当前场次与已有人物设定是否矛盾，并引用依据。',
  '给选中段落提出一个更克制、更有潜台词的修改方案。',
  '帮我分析这一场的目标、阻力和转折，不直接改写。',
  '保留剧情信息，为这一场提供三种不同的收尾方向。',
];
