/** 剧本节点与脚本节点共用的剧本数据格式；格式说明见实施记录 dataFormat.md。 */
export type ScriptSectionKey = "outline" | "characters" | "scenes" | "props";
export type ScriptPartKey = ScriptSectionKey | "episodes";

export interface ScriptSetup {
  genres: string[];
  audience: string[];
  roles: string[];
  era: string[];
  highlights: string[];
  style: { label: string; prompt: string };
  episodes: number;
  episodeMinutes: number;
  structure: string;
  extra?: string;
}

export interface ScriptEpisode { id: string; title: string; content: string }

export interface ScriptDocument {
  lumScript: 1;
  toonflowScript?: 1;
  title: string;
  kind: "script" | "novel";
  createdAt: string;
  updatedAt: string;
  setup: ScriptSetup | null;
  sections: Record<ScriptSectionKey, string>;
  episodes: ScriptEpisode[];
}

export interface ScriptEntity { name: string; kind: "character" | "scene" | "prop"; fields: Record<string, string>; description: string }

export const scriptSections: { key: ScriptSectionKey; label: string; heading: string }[] = [
  { key: "outline", label: "故事大纲", heading: "故事大纲" },
  { key: "characters", label: "人物小传", heading: "人物清单" },
  { key: "scenes", label: "场景设计", heading: "场景清单" },
  { key: "props", label: "道具设计", heading: "道具清单" },
];

export function episodeLabel(kind: ScriptDocument["kind"]) {
  return kind === "novel" ? "章节" : "分集剧本";
}

export function createScriptDocument(title = "未命名剧本", kind: ScriptDocument["kind"] = "script"): ScriptDocument {
  const now = new Date().toISOString();
  return {
    lumScript: 1, toonflowScript: 1, title, kind, createdAt: now, updatedAt: now, setup: null,
    sections: { outline: "", characters: "", scenes: "", props: "" },
    episodes: [],
  };
}

const text = (value: unknown, max = 2_000_000) => typeof value === "string" ? value.slice(0, max) : "";
const strings = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 20) as string[] : [];

/** 读入时宽松修正：缺字段补默认值，不认识的字段丢弃。 */
export function normalizeScriptDocument(value: unknown): ScriptDocument {
  if (!value || typeof value !== "object") throw new Error("剧本文件格式无效");
  const raw = value as Partial<ScriptDocument> & Record<string, unknown>;
  if (raw.lumScript !== 1 && raw.toonflowScript !== 1) throw new Error("不是剧本节点文件");
  const base = createScriptDocument(text(raw.title, 200) || "未命名剧本", raw.kind === "novel" ? "novel" : "script");
  const sections = (raw.sections ?? {}) as Partial<Record<ScriptSectionKey, unknown>>;
  const setup = raw.setup && typeof raw.setup === "object" ? raw.setup as Partial<ScriptSetup> : null;
  return {
    ...base,
    createdAt: text(raw.createdAt, 40) || base.createdAt,
    updatedAt: text(raw.updatedAt, 40) || base.updatedAt,
    setup: setup ? {
      genres: strings(setup.genres), audience: strings(setup.audience), roles: strings(setup.roles), era: strings(setup.era),
      highlights: strings(setup.highlights),
      style: { label: text(setup.style?.label, 100), prompt: text(setup.style?.prompt, 2000) },
      episodes: Number.isFinite(setup.episodes) ? Math.min(100, Math.max(1, Math.round(setup.episodes!))) : 5,
      episodeMinutes: Number.isFinite(setup.episodeMinutes) ? Math.min(60, Math.max(1, setup.episodeMinutes!)) : 3,
      structure: text(setup.structure, 100),
      ...(text(setup.extra, 4000) ? { extra: text(setup.extra, 4000) } : {}),
    } : null,
    sections: { outline: text(sections.outline), characters: text(sections.characters), scenes: text(sections.scenes), props: text(sections.props) },
    episodes: (Array.isArray(raw.episodes) ? raw.episodes : []).slice(0, 200).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const episode = item as Partial<ScriptEpisode>;
      return [{ id: text(episode.id, 64) || crypto.randomUUID(), title: text(episode.title, 200) || `第${index + 1}集`, content: text(episode.content) }];
    }),
  };
}

/** 全部分区拼成一份 Markdown，作为节点的文本输出。 */
export function composeScriptMarkdown(document: ScriptDocument) {
  const parts = [`# 《${document.title}》`];
  for (const section of scriptSections) {
    const body = document.sections[section.key].trim();
    if (body) parts.push(`<!-- ${section.label} -->\n${body}`);
  }
  for (const episode of document.episodes) if (episode.content.trim()) parts.push(`<!-- ${episode.title} -->\n${episode.content.trim()}`);
  return parts.join("\n\n---\n\n");
}

export function headingsOf(markdown: string, levels = [2, 3]) {
  const result: { level: number; text: string; line: number }[] = [];
  let fenced = false;
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const match = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match && levels.includes(match[1]!.length)) result.push({ level: match[1]!.length, text: match[2]!.replace(/[*_`]/g, ""), line: index });
  });
  return result;
}

/** 按 `## 名字` 切分人物、场景、道具清单，读取 `- **字段**：值`。 */
export function parseEntities(markdown: string, kind: ScriptEntity["kind"]): ScriptEntity[] {
  const blocks = markdown.split(/\r?\n(?=##\s+)/);
  return blocks.flatMap(block => {
    const match = /^##\s+(.+?)\s*$/m.exec(block);
    if (!match || /^#{3,}/.test(block.trimStart())) return [];
    const name = match[1]!.replace(/[*_`]/g, "").trim();
    if (!name || /清单|小传|设计$/.test(name) && block.trim().split(/\r?\n/).length < 2) return [];
    const fields: Record<string, string> = {};
    for (const line of block.split(/\r?\n/)) {
      const field = /^\s*[-*]\s*\*\*(.+?)\*\*\s*[:：]\s*(.+)$/.exec(line);
      if (field) fields[field[1]!.trim()] = field[2]!.trim();
    }
    const description = block.slice(match.index + match[0].length).trim();
    return [{ name, kind, fields, description }];
  });
}

export function scriptEntities(document: ScriptDocument) {
  return [
    ...parseEntities(document.sections.characters, "character"),
    ...parseEntities(document.sections.scenes, "scene"),
    ...parseEntities(document.sections.props, "prop"),
  ];
}

/** 给图片模型的一段简短描述：优先取外形、设定类字段。 */
export function entityBrief(entity: ScriptEntity, limit = 400) {
  const preferred = ["外形", "外观", "形象", "造型", "人物设定", "类型", "空间对行动的限制", "戏剧作用", "使用边界", "材质"];
  const picked = preferred.flatMap(key => entity.fields[key] ? [`${key}：${entity.fields[key]}`] : []);
  const value = (picked.length ? picked.join("；") : entity.description.replace(/[*#>-]/g, " ")).replace(/\s+/g, " ").trim();
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

export function setupSummary(setup: ScriptSetup | null) {
  if (!setup) return "";
  const join = (items: string[]) => items.filter(Boolean).join("、");
  return [
    setup.genres.length && `题材：${setup.genres.join(" + ")}`,
    setup.audience.length && `目标受众：${join(setup.audience)}`,
    setup.roles.length && `角色设定：${join(setup.roles)}`,
    setup.era.length && `时代背景：${join(setup.era)}`,
    setup.highlights.length && `核心看点：${join(setup.highlights)}`,
    setup.style.label && `画风：${setup.style.label}${setup.style.prompt ? `（${setup.style.prompt}）` : ""}`,
    `剧本结构：${setup.episodes} 集 × 每集 ${setup.episodeMinutes} 分钟${setup.structure ? ` · ${setup.structure}` : ""}`,
    setup.extra && `补充：${setup.extra}`,
  ].filter(Boolean).join("\n");
}
