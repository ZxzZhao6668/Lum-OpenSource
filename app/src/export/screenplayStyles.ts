import type { IParagraphStyleOptions } from 'docx';
import type { BlockType } from '../script/editor';

interface ScreenplayStyle {
  label: string;
  before: number;
  after: number;
  inset?: number;
  align?: 'center' | 'right';
  keepNext?: boolean;
  bold?: boolean;
  italic?: boolean;
  muted?: boolean;
  size?: number;
}

// Measurements are in points so the two export formats share one manuscript layout.
const styles: Record<BlockType, ScreenplayStyle> = {
  scene: { label: '场次', before: 14, after: 6, bold: true, keepNext: true, size: 13 },
  action: { label: '动作', before: 0, after: 6 },
  character: { label: '角色', before: 8, after: 0, align: 'center', bold: true, keepNext: true },
  parenthetical: { label: '括号', before: 0, after: 0, inset: 54, keepNext: true, size: 11 },
  dialogue: { label: '对白', before: 0, after: 6, inset: 36 },
  transition: { label: '转场', before: 8, after: 8, align: 'right', bold: true },
  comment: { label: '注释', before: 4, after: 6, italic: true, muted: true, size: 10.5 },
  subtitle: { label: '字幕', before: 8, after: 8, align: 'center' },
};

export function screenplayStyleId(type: BlockType) {
  return 'Screenplay-' + (Object.hasOwn(styles, type) ? type : 'action');
}

export const screenplayCss = Object.entries(styles).map(([type, style]) => `
.${screenplayStyleId(type as BlockType)} {
  font: ${style.italic ? 'italic' : 'normal'} ${style.bold ? 'bold' : 'normal'} ${style.size ?? 12}pt/1.5
    ${style.bold ? '"Microsoft YaHei", sans-serif' : '"SimSun", "Songti SC", serif'};
  margin: ${style.before}pt ${style.inset ?? 0}pt ${style.after}pt;
  min-height: 1.5em;
  text-align: ${style.align ?? 'left'};
  color: #${style.muted ? '626262' : '1c1c1c'};
  ${style.keepNext ? 'break-after:avoid; break-inside:avoid;' : ''}
  orphans: 2; widows: 2;
}`).join('\n');

export const screenplayWordStyles: IParagraphStyleOptions[] = Object.entries(styles).map(([type, style]) => ({
  id: screenplayStyleId(type as BlockType),
  name: '剧本 · ' + style.label,
  basedOn: 'Normal',
  paragraph: {
    alignment: style.align ?? 'left',
    spacing: { before: style.before * 20, after: style.after * 20, line: 360 },
    indent: { left: (style.inset ?? 0) * 20, right: (style.inset ?? 0) * 20 },
    keepNext: style.keepNext, keepLines: style.keepNext, widowControl: true,
  },
  run: {
    font: { ascii: style.bold ? 'Microsoft YaHei' : 'SimSun', hAnsi: style.bold ? 'Microsoft YaHei' : 'SimSun', eastAsia: style.bold ? '微软雅黑' : '宋体' },
    size: (style.size ?? 12) * 2,
    bold: style.bold, italics: style.italic, color: style.muted ? '626262' : '1C1C1C',
  },
}));
