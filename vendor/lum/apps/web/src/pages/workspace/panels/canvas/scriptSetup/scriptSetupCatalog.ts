/** 剧本设定器的选项目录。题材、受众等选项沿用 Lum 写作端「剧本设定」的分类，精简为画布内弹窗使用。 */
export interface SetupOption { label: string; hint?: string }
export interface SetupStyle { label: string; prompt: string; swatches: [string, string, string] }
export interface SetupValue {
  genres: string[];
  audience: string[];
  roles: string[];
  era: string[];
  highlights: string[];
  style: string;
  episodes: number;
  episodeMinutes: number;
  structure: string;
}

export const genres: SetupOption[] = [
  { label: "玄幻修仙", hint: "宗门、灵根、法宝与修行代价" },
  { label: "都市现实", hint: "城市日常里的选择与成长" },
  { label: "古装言情", hint: "礼制背景下的情感抉择" },
  { label: "末世科幻", hint: "资源受限、科技改变生存规则" },
  { label: "历史传奇", hint: "真实或架空时代的人物命运" },
  { label: "悬疑探案", hint: "问题、证据与揭晓的因果链" },
  { label: "惊悚怪谈", hint: "未知与规则禁忌" },
  { label: "职场商战", hint: "行业规则、资源与利益冲突" },
  { label: "家庭伦理", hint: "亲密关系中的义务与误解" },
  { label: "青春成长", hint: "校园、毕业与自我寻找" },
  { label: "武侠江湖", hint: "武艺、行路与侠义的代价" },
  { label: "喜剧", hint: "人物反差、误会与连锁反应" },
  { label: "主旋律", hint: "公共事业中的具体人物" },
  { label: "体育竞技", hint: "训练、比赛和团队关系" },
  { label: "文旅非遗", hint: "地方文化与手艺传承" },
];

export const audiences: SetupOption[] = ["男频", "女频", "泛人群", "银发", "海外"].map(label => ({ label }));
export const roles: SetupOption[] = ["修士", "小人物", "腹黑", "大佬", "霸总", "萌宝", "龙王", "系统", "师徒", "反派", "神医", "将军", "千金", "打工人", "学生", "侦探"].map(label => ({ label }));
export const eras: SetupOption[] = ["古代", "近代", "现代", "近未来", "远未来", "架空时代"].map(label => ({ label }));
export const highlights: SetupOption[] = [
  "器物金手指", "收集升级", "基建生存", "专业碾压", "马甲大佬", "重生复仇", "穿越异世", "扮猪吃虎", "规则禁忌", "甜宠", "逆袭打脸", "悬念反转", "温暖治愈", "热血奋斗",
].map(label => ({ label }));
export const structures = ["三幕式", "起承转合", "单元故事", "连续短剧", "双线并行"];

export const styles: SetupStyle[] = [
  { label: "国风壁画", prompt: "古装仙侠题材，国风二次元动画风格，二维手绘媒介，壁画式色块与神祇质感，苍凉土褐与暗青主色调，整体低饱和", swatches: ["#5b4632", "#3f5a5c", "#c9a36a"] },
  { label: "二维赛璐璐", prompt: "二维赛璐璐动画风格，清楚的平涂色块，明确明暗分层，干净线条", swatches: ["#476c8e", "#e4967f", "#efd692"] },
  { label: "三维动画", prompt: "三维动画电影风格，体积材质与局部高光，柔和主光辅以轮廓光", swatches: ["#4f648b", "#a17a59", "#e3ccb0"] },
  { label: "都市写实", prompt: "都市写实摄影风格，中性色，保留街灯、荧光灯和自然光，水泥、玻璃与日常衣物质感", swatches: ["#4f5d60", "#8e968e", "#c1a98f"] },
  { label: "古装自然光", prompt: "古装写实影视风格，天然染料色与温润木色，窗光、天光和烛光", swatches: ["#504438", "#927555", "#dfc5a5"] },
  { label: "冷峻宫廷", prompt: "冷峻宫廷剧风格，低饱和青灰与暗红，狭长侧光，轴线对称构图", swatches: ["#29343f", "#647985", "#834a4a"] },
  { label: "暖色生活", prompt: "温暖生活剧风格，暖白、淡黄与木色，柔光包裹人物", swatches: ["#755b3c", "#d09959", "#f0dac0"] },
  { label: "黑色悬疑", prompt: "黑色电影悬疑风格，黑灰为主、少量冷色信号，硬侧光，粗颗粒", swatches: ["#181e24", "#525c66", "#aab5c4"] },
  { label: "明亮轻喜", prompt: "明亮轻喜剧风格，明快互补色，高调柔光，阴影浅", swatches: ["#62a892", "#f5c96a", "#f5ece0"] },
  { label: "武侠水墨", prompt: "武侠水墨风格，墨黑、浅灰与留白，漫射天空光，纸纹与雾气", swatches: ["#283331", "#9ea8a2", "#eee9de"] },
  { label: "赛博霓虹", prompt: "赛博朋克霓虹风格，暗底与青粉、橙色霓虹，玻璃、金属与潮湿路面", swatches: ["#181d34", "#38aab0", "#d45384"] },
  { label: "定格质感", prompt: "定格动画质感，黏土、毛毡、纸板材料，棚内小灯", swatches: ["#755948", "#ae7b61", "#e2cba4"] },
];

export const limits = { genres: 2, audience: 2, roles: 5, era: 2, highlights: 3 } as const;

export const presets: { label: string; value: SetupValue }[] = [
  { label: "玄幻修仙逆袭", value: { genres: ["玄幻修仙"], audience: ["男频"], roles: ["修士", "小人物"], era: ["古代"], highlights: ["穿越异世", "收集升级", "逆袭打脸"], style: "国风壁画", episodes: 5, episodeMinutes: 3, structure: "三幕式" } },
  { label: "现实职场成长", value: { genres: ["都市现实", "职场商战"], audience: ["泛人群"], roles: ["打工人", "大佬"], era: ["现代"], highlights: ["专业碾压", "热血奋斗"], style: "都市写实", episodes: 6, episodeMinutes: 3, structure: "连续短剧" } },
  { label: "末世生存基建", value: { genres: ["末世科幻"], audience: ["男频"], roles: ["小人物", "系统"], era: ["近未来"], highlights: ["基建生存", "收集升级", "器物金手指"], style: "三维动画", episodes: 6, episodeMinutes: 3, structure: "三幕式" } },
  { label: "非遗国潮视觉", value: { genres: ["文旅非遗"], audience: ["泛人群"], roles: ["师徒", "学生"], era: ["现代"], highlights: ["温暖治愈", "专业碾压"], style: "国风壁画", episodes: 4, episodeMinutes: 3, structure: "单元故事" } },
  { label: "古代女频甜宠", value: { genres: ["古装言情"], audience: ["女频"], roles: ["千金", "将军"], era: ["古代"], highlights: ["甜宠", "马甲大佬"], style: "古装自然光", episodes: 8, episodeMinutes: 2, structure: "连续短剧" } },
  { label: "规则怪谈悬疑", value: { genres: ["惊悚怪谈", "悬疑探案"], audience: ["泛人群"], roles: ["学生", "侦探"], era: ["现代"], highlights: ["规则禁忌", "悬念反转"], style: "黑色悬疑", episodes: 5, episodeMinutes: 3, structure: "三幕式" } },
  { label: "重生复仇爽剧", value: { genres: ["都市现实"], audience: ["女频"], roles: ["千金", "霸总", "反派"], era: ["现代"], highlights: ["重生复仇", "逆袭打脸", "马甲大佬"], style: "都市写实", episodes: 10, episodeMinutes: 2, structure: "连续短剧" } },
  { label: "仙门团宠日常", value: { genres: ["玄幻修仙", "喜剧"], audience: ["女频"], roles: ["萌宝", "修士", "师徒"], era: ["古代"], highlights: ["甜宠", "温暖治愈"], style: "二维赛璐璐", episodes: 6, episodeMinutes: 2, structure: "单元故事" } },
];

export function emptySetup(): SetupValue {
  return { genres: [], audience: [], roles: [], era: [], highlights: [], style: "", episodes: 5, episodeMinutes: 3, structure: "三幕式" };
}

/** 设定器 → 剧本节点的 setup 字段（与 @lum/node-shared/scriptDocument 的 ScriptSetup 一致）。 */
export function toScriptSetup(value: SetupValue, extra = "") {
  const style = styles.find(item => item.label === value.style);
  return {
    genres: value.genres, audience: value.audience, roles: value.roles, era: value.era, highlights: value.highlights,
    style: { label: value.style, prompt: style?.prompt ?? value.style },
    episodes: value.episodes, episodeMinutes: value.episodeMinutes, structure: value.structure,
    ...(extra.trim() ? { extra: extra.trim() } : {}),
  };
}

export function setupTags(value: SetupValue) {
  const auto = (items: string[]) => items.length ? items.join("、") : "自动";
  return [
    `题材：${value.genres.length ? value.genres.join(" + ") : "自动"}`,
    `目标受众：${auto(value.audience)}`,
    `角色设定：${auto(value.roles)}`,
    `时代背景：${auto(value.era)}`,
    `核心看点：${auto(value.highlights)}`,
    `画风：${value.style || "自动"}`,
    `剧本结构：${value.episodes} 集 × 每集 ${value.episodeMinutes} 分钟 · ${value.structure}`,
  ];
}
