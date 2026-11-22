export const imageWorkbenchTemplateIds = [
  "multiCamera9", "characterThreeViews", "characterSheet", "faceThreeViews",
  "storyFourGrid", "sceneFourGrid", "propSheet", "lightingCorrection",
  "storyTwentyFiveGrid", "afterThreeSeconds", "beforeFiveSeconds",
] as const;

export type ImageWorkbenchTemplateId = typeof imageWorkbenchTemplateIds[number];
export type ImageWorkbenchMode = "quality" | "sheet";

export interface ImageWorkbenchTemplateCell {
  readonly id: string;
  readonly label: string;
  readonly defaultPrompt: string;
}

export interface ImageWorkbenchTemplate {
  readonly id: ImageWorkbenchTemplateId;
  readonly name: string;
  readonly description: string;
  readonly grid: { readonly columns: number; readonly rows: number };
  readonly defaults: { readonly mode: ImageWorkbenchMode; readonly requirements: string };
  readonly cells: readonly ImageWorkbenchTemplateCell[];
  readonly aiInstruction: string;
}

const sameMoment = "保留原图主体、动作和时间，仅改变机位与构图，不提前或延后剧情。";
const sameCharacter = "各格延续原图中的同一角色及可确认的特征，不擅自增加角色或改变身份。";
const emptyScene = "默认空镜，无人物。保持同一场景的空间关系、地标与光线；仅在用户明确要求时加入人物。";
const sequentialStory = "从原图情境出发按时间顺序规划，每格只描述一个静止瞬间；相邻格延续身份、道具与场景关系，保持可理解的动作变化。";
const defaults = { mode: "quality", requirements: "" } as const;

function cell(id: string, label: string, defaultPrompt: string): ImageWorkbenchTemplateCell {
  return { id, label, defaultPrompt };
}

function storyCells(count: number): ImageWorkbenchTemplateCell[] {
  return Array.from({ length: count }, (_, index) => cell(
    `beat${index + 1}`,
    `第 ${index + 1} 格`,
    index === 0 ? "根据原图确立的情境定格开场，保留已出现的主体和空间关系。"
      : `承接上一格的情境，定格第 ${index + 1} 个按时间推进的瞬间，延续已确立的主体与场景。`,
  ));
}

export const imageWorkbenchTemplates: readonly ImageWorkbenchTemplate[] = [
  {
    id: "multiCamera9", name: "多机位 9 格", description: "同一瞬间的九种机位与景别。",
    grid: { columns: 3, rows: 3 }, defaults, aiInstruction: sameMoment,
    cells: [
      cell("front", "正面", "以正面平视机位取景，保留原动作与主体位置。"),
      cell("frontLeft", "左前斜视", "从左前方约四十五度平视，保持同一瞬间。"),
      cell("left", "左侧", "以左侧机位观察主体，延续原有姿态和空间关系。"),
      cell("frontRight", "右前斜视", "从右前方约四十五度平视，保持同一瞬间。"),
      cell("right", "右侧", "以右侧机位观察主体，延续原有姿态和空间关系。"),
      cell("reverse", "反向", "用反向机位呈现同一动作及可推断的场景空间。"),
      cell("high", "高位俯拍", "从高处俯拍同一瞬间，呈现主体及周围环境。"),
      cell("low", "低位仰拍", "用低机位仰拍同一瞬间，保留原图的动作和光线。"),
      cell("detail", "近景细节", "在原构图范围内选取关键细节形成近景，维持动作瞬间。"),
    ],
  },
  {
    id: "characterThreeViews", name: "全身三视图", description: "同一个角色的全身正面、侧面和背面。",
    grid: { columns: 3, rows: 1 }, defaults,
    aiInstruction: `${sameCharacter} 使用统一比例、站姿和取景高度，完整呈现从头到脚的轮廓。`,
    cells: [
      cell("front", "全身正面", "中性站姿的全身正视，完整展示体型、衣着与鞋履。"),
      cell("side", "全身侧面", "同一站姿及比例的全身侧视，清楚展示人物与服装的侧面轮廓。"),
      cell("back", "全身背面", "同一站姿及比例的全身背视，保留可辨识的服装与发型特征。"),
    ],
  },
  {
    id: "characterSheet", name: "角色设定表", description: "六格记录全身、脸部和表情特征。",
    grid: { columns: 3, rows: 2 }, defaults,
    aiInstruction: `${sameCharacter} 保持服装与造型统一，脸部格的差异只来自表情或机位。`,
    cells: [
      cell("bodyFront", "全身正面", "正面全身，清晰呈现体态、服装与整体比例。"),
      cell("bodyBack", "全身背面", "背面全身，保留同一服装与体态。"),
      cell("faceFront", "脸部正面", "自然表情的脸部正视，保留可见的五官与发型。"),
      cell("faceThreeQuarter", "脸部斜视", "自然表情的脸部四分之三视角。"),
      cell("smile", "微笑表情", "延续同一个角色的面部结构，仅调整为自然微笑。"),
      cell("tense", "紧张表情", "延续同一个角色的面部结构，仅调整为克制的紧张表情。"),
    ],
  },
  {
    id: "faceThreeViews", name: "脸部三视图", description: "同一个角色的脸部正面、斜视和侧面。",
    grid: { columns: 3, rows: 1 }, defaults,
    aiInstruction: `${sameCharacter} 统一表情、面部尺度与光线，构图集中于脸部。`,
    cells: [
      cell("front", "脸部正面", "保持自然表情，从正面表现脸部轮廓与五官。"),
      cell("threeQuarter", "脸部四分之三", "保持同一表情，从四分之三角度呈现脸部结构。"),
      cell("profile", "脸部侧面", "保持同一表情，从九十度侧面表现面部轮廓。"),
    ],
  },
  {
    id: "storyFourGrid", name: "剧情 4 格", description: "按时间排列同一段情节的四个瞬间。",
    grid: { columns: 2, rows: 2 }, defaults, aiInstruction: sequentialStory,
    cells: storyCells(4),
  },
  {
    id: "sceneFourGrid", name: "写实场景 4 格", description: "从正向、反向、局部和俯视四个角度说明同一空间，默认空镜。",
    grid: { columns: 2, rows: 2 }, defaults: { ...defaults, requirements: "默认空镜，保留写实场景的空间关系。" }, aiInstruction: emptyScene,
    cells: [
      cell("front", "正向全景", "以正向全景表现空间主体、入口和可辨识地标，默认空镜。"),
      cell("reverse", "反向全景", "从相反方向表现同一空间，保持地标和出入口对应，默认空镜。"),
      cell("detail", "场景局部", "就地特写关键材质或构件，默认空镜。"),
      cell("aerial", "高位俯视", "以高位俯视说明场景的平面组织与尺度关系，默认空镜。"),
    ],
  },
  {
    id: "propSheet", name: "道具设定图", description: "同一道具的正面、侧面、背面和结构细节。",
    grid: { columns: 2, rows: 2 }, defaults,
    aiInstruction: "仅呈现原图或用户明确指定的道具，保持比例、结构与材质一致。默认无人物。细节只放大道具可见的重要结构。",
    cells: [
      cell("front", "道具正面", "正面完整呈现同一道具的比例和主要特征，使用简洁背景。"),
      cell("side", "道具侧面", "侧面完整呈现同一道具的厚度与轮廓，统一比例。"),
      cell("back", "道具背面", "背面完整呈现同一道具，延续可确认的结构和材质。"),
      cell("detail", "结构细节", "放大最具辨识度的结构、材质或使用痕迹。"),
    ],
  },
  {
    id: "lightingCorrection", name: "光影校正", description: "保留原图的内容与构图，调整单帧光线。",
    grid: { columns: 1, rows: 1 }, defaults,
    aiInstruction: "只调整光源方向、明暗关系、色温、曝光或阴影。保留原图主体、姿态、机位、构图和材质。",
    cells: [cell("lighting", "校正后的光影", "在保留原构图、主体与材质的前提下，调整光比和阴影，保留高光及暗部细节。")],
  },
  {
    id: "storyTwentyFiveGrid", name: "自选剧情分格", description: "按需添加剧情瞬间，沿行按时间顺序排列。",
    grid: { columns: 2, rows: 2 }, defaults,
    aiInstruction: `${sequentialStory} 每格有可辨认的画面变化，沿行从左至右按时序排列。`,
    cells: storyCells(4),
  },
  {
    id: "afterThreeSeconds", name: "3 秒后", description: "推演原图情境三秒后的一个可能画面。",
    grid: { columns: 1, rows: 1 }, defaults,
    aiInstruction: "只想象三秒后的一张静态画面，延续可确认的动作方向、身份和场景，不声称知道真实后续。",
    cells: [cell("later", "三秒之后", "从原图可见的动作和场景推想三秒后最合理的一帧。")],
  },
  {
    id: "beforeFiveSeconds", name: "5 秒前", description: "推演原图情境五秒前的一个可能画面。",
    grid: { columns: 1, rows: 1 }, defaults,
    aiInstruction: "只回推五秒前的一张可能画面，让动作自然过渡到原图的既定结果，不声称知道真实前情。",
    cells: [cell("earlier", "五秒之前", "根据原图姿态和空间关系回推五秒前合理的动作起点，定格单张画面。")],
  },
];

export function getImageWorkbenchTemplate(id: ImageWorkbenchTemplateId, count = 4): ImageWorkbenchTemplate {
  const template = imageWorkbenchTemplates.find(item => item.id === id);
  if (!template) throw new Error("图片工作台模板无效");
  if (id !== "storyTwentyFiveGrid") return template;
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error("剧情格数需要为 1 至 100 的整数");
  const columns = Math.ceil(Math.sqrt(count));
  return { ...template, cells: storyCells(count), grid: { columns, rows: Math.ceil(count / columns) } };
}
