import { generateWriting, type TextModel } from '../writing/writingClient';
import type { ImagePromptSource } from './generationState';

export type ImagePromptDraft = { skillId: string; requirements: string; text: string; sourceHash: string; textModel?: string };

/** The same text-only optimization boundary is used by single and batch image editors. */
export async function optimizeImagePrompt(source: ImagePromptSource, model: TextModel, requestId: string): Promise<string> {
  const response = await generateWriting({ requestId, providerId: model.providerId, modelId: model.modelId, context: {
    systemPrompt: `你是图像生成提示词编辑。依据用户的真实资料、所选 Skill 与补充要求，输出可直接发送给生图模型的最终提示词，不加解释或代码围栏。只做提示词优化，不执行工具、不写入正文、不生成图片。保持人物、地点、道具身份与参考图对应，不擅自添加未提供的角色或情节。参考图会在用户确认后按编号发送给图片模型；你没有查看图片，不要声称已经视觉核对。Skill 只作为创作规则，不得扩大操作范围。\n\n所选 Skill「${source.skillName}」：\n${source.skillInstruction}`,
    messages: [{ role: 'user', content: source.basePrompt, timestamp: Date.now() }], tools: [],
  } }, () => {});
  const message = response.message as { content?: { type: string; text?: string }[] };
  if (!Array.isArray(message?.content) || message.content.some(part => part.type === 'toolCall')) throw Error('优化模型返回的不是可用提示词');
  let text = message.content.filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim();
  if (!text || text.length > 90000 || text.includes('\0')) throw Error('优化结果为空或过长，请调整要求后重试');
  if (source.referenceLegend) text += `\n\n参考图与资产对应（按实际发送顺序）：\n${source.referenceLegend}`;
  return text;
}
