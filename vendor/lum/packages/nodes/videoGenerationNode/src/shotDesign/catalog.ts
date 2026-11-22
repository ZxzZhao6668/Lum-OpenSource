/** 视频生成节点的镜头设定目录：风格、配色、构图、节奏、相机。名称、提示词和示意图均为 Lum 自建。 */
export type SceneKey = "peaks" | "city" | "room" | "dunes" | "forest" | "sea" | "corridor";
/** 示意图用色，依次为：天空上、天空下、远景、中景、近景、光源。 */
export type SceneColors = [string, string, string, string, string, string];
export type StyleTreatment = "grain" | "ink" | "cel" | "glow" | "neon";
/** 取景：放大倍数、对准的横坐标、对准的纵坐标（示意图坐标 320×180）。 */
export type Framing = [number, number, number];

export interface ScenePreset { id: string; label: string; prompt: string; scene: SceneKey; colors: SceneColors }
export interface StylePreset extends ScenePreset { treatment?: StyleTreatment }
export interface CompositionPreset extends ScenePreset { guide: string; subject?: [number, number] }
export interface RhythmShot { span: number; from: Framing; to?: Framing; scene?: SceneKey; flip?: boolean; rate?: number }
export interface RhythmPreset extends ScenePreset { shots: RhythmShot[]; frameRate?: number; trail?: boolean }
export interface CameraOption { id: string; label: string; prompt: string }
export interface CameraBody extends CameraOption { grain?: number; tone?: string; lines?: boolean; stamp?: boolean }
export interface CameraLens extends CameraOption { effect?: "anamorphic" | "vintage" | "macro" | "tiltShift" | "fisheye" | "softFocus" }
export interface CameraFocal extends CameraOption { zoom: number }
export interface CameraAperture extends CameraOption { stop: number }
export interface CameraDesign { body?: string; lens?: string; focal?: string; aperture?: string }
export interface ShotDesign { style?: string; palette?: string; composition?: string; rhythm?: string; camera?: CameraDesign }
export type PresetKind = "style" | "palette" | "composition" | "rhythm";

export const styles: StylePreset[] = [
  { id: "guzhuangXianxia", label: "古装仙侠", scene: "peaks", colors: ["#cfe3e6", "#f3ead2", "#9fbcc0", "#6f9499", "#3f5a60", "#fff3c9"], treatment: "glow",
    prompt: "古装仙侠影视质感：云雾缭绕的山门与殿宇，衣袂飘逸，丝绸与轻纱材质细腻，柔和逆光勾出发丝与衣缘，清透的青白与淡金色调，浅景深，画面干净空灵" },
  { id: "wuxiaJianghu", label: "武侠江湖", scene: "peaks", colors: ["#8fa3a6", "#c9c2ad", "#6d7f80", "#4b5a58", "#262e2c", "#e9e2c8"], treatment: "grain",
    prompt: "写实武侠电影质感：苍茫山水与风沙客栈，粗布麻衣与斗笠，侧逆光与硬朗阴影，低饱和青灰与土褐色调，衣摆与尘土随动作扬起，带轻微胶片颗粒" },
  { id: "xinZhongshi", label: "新中式美学", scene: "sea", colors: ["#dfe7e2", "#f2efe6", "#9eb3ad", "#5e7d79", "#2f4644", "#c8553d"],
    prompt: "新中式美学：对称与留白的构图，园林、屏风、漆器与瓷器等东方元素，低饱和黛青、月白并点缀朱红，柔和漫射光，质感克制雅致" },
  { id: "minguoDiezhan", label: "民国谍战", scene: "room", colors: ["#2b2620", "#3d342a", "#57493a", "#3a3128", "#1b1713", "#e0b46a"], treatment: "grain",
    prompt: "民国谍战剧质感：洋楼、弄堂与旧式办公室，呢子大衣与礼帽，百叶窗切割出的硬光与浓重阴影，暗棕、墨绿与昏黄钨丝灯色调，烟雾弥漫，气氛紧张克制" },
  { id: "gangfengFugu", label: "港风复古", scene: "city", colors: ["#2a1830", "#5a2238", "#3b2a4a", "#221a33", "#120d1c", "#ff6a5a"], treatment: "neon",
    prompt: "港风复古电影质感：霓虹招牌与潮湿街巷，高对比的浓郁色彩，红绿撞色与暖黄灯光，轻微柔焦与光晕，胶片颗粒，带有旧港片的怀旧情绪" },
  { id: "niandaiHuaijiu", label: "年代怀旧", scene: "room", colors: ["#cdb590", "#e6d3ad", "#b0946a", "#8a6f4b", "#4f3d28", "#fff0c2"],
    prompt: "年代怀旧剧质感：旧院落、厂区与老家具，棉布服装，温暖泛黄的自然光，低对比、略微褪色的暖棕色调，生活气息浓厚" },
  { id: "dushiJingying", label: "都市精英", scene: "city", colors: ["#b9c7d3", "#e3e8ec", "#8c9cab", "#5d6c7b", "#2b343f", "#ffffff"],
    prompt: "都市精英剧质感：玻璃幕墙写字楼与现代室内，剪裁利落的正装，冷静的中性灰蓝色调，干净的高调布光与柔和反射，画面锐利通透" },
  { id: "minsuGuaitan", label: "中式民俗怪谈", scene: "forest", colors: ["#0d1a17", "#16302a", "#1f4038", "#12261f", "#070f0c", "#d8362a"],
    prompt: "中式民俗怪谈氛围：老宅、祠堂、纸扎与红灯笼，幽暗环境里以浓烈朱红和惨绿点缀，低照度，局部顶光或烛光，薄雾与缓慢推进的镜头，诡谲而克制" },
  { id: "gaojiRenxiang", label: "高级质感人像", scene: "room", colors: ["#6b5a4a", "#a08a72", "#c9b79d", "#8b7560", "#3d3128", "#ffe9c4"], treatment: "glow",
    prompt: "高级质感人像：棚拍级柔光与细腻肤质，窗边逆光勾边，奶油色与香槟金的低饱和暖调，浅景深与柔美的焦外光斑，优雅精致" },
  { id: "moriFeitu", label: "末日废土", scene: "dunes", colors: ["#8d8a78", "#c7bf9f", "#8f8566", "#6a6149", "#35301f", "#f1e6b8"], treatment: "grain",
    prompt: "末日废土电影质感：荒芜的沙尘与废墟，破损的装备与金属锈迹，灰黄色调与漂白效果，强风扬尘与体积光，手持跟拍的紧迫感" },
  { id: "guomanSanwei", label: "3D 国漫", scene: "peaks", colors: ["#3b4f8a", "#a56fa8", "#5a6fb0", "#3c4a85", "#1e2550", "#ffd9a0"], treatment: "glow",
    prompt: "3D 国漫动画风格：精致的三维角色与场景建模，东方幻想建筑，通透的体积光与粒子特效，色彩饱满，材质带有次表面散射与细腻高光" },
  { id: "guofengErwei", label: "2D 国风动画", scene: "forest", colors: ["#0e1e3a", "#173a5c", "#1f4d6b", "#123148", "#08182a", "#ffe27a"], treatment: "cel",
    prompt: "2D 国风动画风格：手绘质感的线条与平涂色块，水墨晕染的背景，以青绿与靛蓝为主的夜色，点缀暖色光点，画面富有诗意" },
  { id: "saiboNihong", label: "赛博朋克", scene: "city", colors: ["#0c1030", "#2b1150", "#1a2a66", "#101a44", "#060918", "#ff3fa4"], treatment: "neon",
    prompt: "赛博朋克风格：雨夜的高密度都市，全息广告与霓虹灯牌，青蓝与品红的强烈对比，潮湿路面反光，金属与玻璃质感，体积雾" },
  { id: "rixiQingxin", label: "日系清新", scene: "sea", colors: ["#bfe0ee", "#f4f8f2", "#a8d2d8", "#7fb8b0", "#4d8a7e", "#ffffff"],
    prompt: "日系清新影像：明亮通透的自然光，略微过曝的高调画面，低对比的浅蓝与嫩绿，干净的生活场景，轻微胶片感，安静温柔" },
  { id: "heiseDianying", label: "黑色电影", scene: "corridor", colors: ["#1a1a1a", "#3a3a3a", "#555555", "#2a2a2a", "#0a0a0a", "#f2f2f2"], treatment: "grain",
    prompt: "黑色电影风格：高反差的黑白影像，硬侧光与百叶窗阴影，剪影与烟雾，湿漉的夜街，构图倾斜，氛围冷峻" },
  { id: "shuimoXieyi", label: "水墨写意", scene: "peaks", colors: ["#efece3", "#e2ded2", "#b9b8b0", "#7d7f7b", "#2c2e2d", "#c9553d"], treatment: "ink",
    prompt: "水墨写意风格：宣纸质感与墨色浓淡晕染，大面积留白，山石与人物以简练笔触勾勒，以黑白灰为主，偶有淡赭与花青" },
];

export const palettes: ScenePreset[] = [
  { id: "anyeMolv", label: "暗夜墨绿", scene: "forest", colors: ["#07140d", "#0f2a1a", "#17402a", "#0d2416", "#040b07", "#5fbf6a"],
    prompt: "暗夜墨绿色调：近乎黑色的深绿阴影配少量翠绿高光，低照度、低饱和，气氛压抑神秘" },
  { id: "lengdiaoQinglan", label: "冷调青蓝", scene: "corridor", colors: ["#061016", "#0b2230", "#12394a", "#0a2633", "#03090d", "#4fb6c9"],
    prompt: "清冷的青蓝色调：深海蓝阴影、青灰中间调与冷白高光，低饱和，疏离安静" },
  { id: "yueguangLan", label: "月光蓝", scene: "sea", colors: ["#07122b", "#0f2d5e", "#17479a", "#0d2f6b", "#040b1c", "#bcd9ff"],
    prompt: "月光蓝色调：夜色中的钴蓝与靛蓝，水面与轮廓泛着冷白月光，宁静深邃" },
  { id: "nuanyangJin", label: "暖阳金", scene: "dunes", colors: ["#3a3a2a", "#c9963f", "#a7783a", "#7a5a2e", "#3a2a16", "#ffd27a"],
    prompt: "暖阳金色调：日落时分的琥珀、麦金与暖棕，逆光轮廓，温暖怀旧" },
  { id: "huangmoCheng", label: "荒漠燃橙", scene: "dunes", colors: ["#b8431a", "#ee7a2c", "#c9521f", "#8f3515", "#3a140a", "#ffb054"],
    prompt: "荒漠燃橙色调：炽烈的橙与赭红铺满天空和地面，深褐色剪影，带热浪与尘土感" },
  { id: "anhongYemu", label: "暗红夜幕", scene: "city", colors: ["#1a0508", "#4a0d14", "#6b121c", "#3a0a10", "#120305", "#ff3b3b"],
    prompt: "暗红夜幕色调：以酒红与黑色为主，窗灯和霓虹呈现朱红光晕，暧昧而危险" },
  { id: "fenziMuse", label: "粉紫暮色", scene: "city", colors: ["#3b3558", "#a77a9c", "#6b5a85", "#453d63", "#1f1b30", "#ffcf8a"],
    prompt: "粉紫暮色调：黄昏后的丁香紫、灰粉与雾蓝，街灯以暖黄点缀，柔和感伤" },
  { id: "nuanshaHe", label: "暖沙褐", scene: "sea", colors: ["#d9c4a5", "#f1e3cc", "#b89878", "#8a6a4e", "#3f2e22", "#fff5e0"],
    prompt: "暖沙褐色调：米白、浅驼与可可棕的大地色系，光线柔和，质朴沉静" },
  { id: "heibaiGuangying", label: "黑白光影", scene: "corridor", colors: ["#0a0a0a", "#2b2b2b", "#4a4a4a", "#1c1c1c", "#000000", "#f5f5f5"],
    prompt: "黑白影像：纯粹的黑白灰阶，高反差硬光与清晰的影子，以剪影造型" },
  { id: "hongjinHuali", label: "红金华丽", scene: "room", colors: ["#3a0c0c", "#8f1d1d", "#b83a22", "#6b1414", "#1f0606", "#f2b25a"],
    prompt: "红金色调：浓郁的朱红与暗金，丝绒与灯火的华丽质感，高饱和，纸醉金迷" },
  { id: "fuguHonglv", label: "复古红绿", scene: "room", colors: ["#12301f", "#8a2a1c", "#1f4a30", "#5a1c14", "#0a1a10", "#e8b860"],
    prompt: "复古红绿撞色：砖红与墨绿互补对比，辅以暖黄灯光，带有旧胶片的浓郁年代感" },
  { id: "menglongNihong", label: "朦胧霓虹", scene: "city", colors: ["#0c1f1f", "#1f4a45", "#2f6b62", "#17332f", "#070f0f", "#5ed6c0"],
    prompt: "朦胧霓虹色调：青绿霓虹在雾气和雨幕中晕开，暗部偏墨绿，慵懒迷离" },
  { id: "qingchengDuibi", label: "青橙对比", scene: "dunes", colors: ["#0f3a4a", "#f09a4a", "#1f6a7a", "#124a58", "#06202a", "#ffc98a"],
    prompt: "青橙对比色调：阴影偏青蓝，肤色与高光偏橙，层次立体通透" },
  { id: "molandiHui", label: "莫兰迪灰", scene: "room", colors: ["#b9b3ab", "#d9d2c8", "#a3a89c", "#8b8f8a", "#55585a", "#f2ece2"],
    prompt: "莫兰迪灰调：带灰度的雾粉、灰绿与灰蓝，低饱和、低对比，安静克制" },
  { id: "jiaopianTuise", label: "胶片褪色", scene: "sea", colors: ["#5f7a80", "#d9cfae", "#7f9a92", "#566f6a", "#2a3838", "#f6ecc6"],
    prompt: "胶片褪色色调：黑位上浮，阴影偏青，高光偏暖黄，整体轻微褪色并带颗粒" },
  { id: "tangguoFencai", label: "糖果粉彩", scene: "peaks", colors: ["#ffd3e0", "#fff1c9", "#bfe7d8", "#8fc9e8", "#6a8fd0", "#ffffff"],
    prompt: "糖果粉彩色调：粉、薄荷绿与天蓝等明亮粉彩，高调布光，轻松童趣" },
];

const warm: SceneColors = ["#3d4a63", "#e8b27a", "#9a7a66", "#6b5348", "#2b2220", "#ffe2a8"];
const dusk: SceneColors = ["#1c2740", "#56608a", "#3c4a6e", "#27314f", "#10172a", "#f4d58a"];
const jade: SceneColors = ["#16302d", "#3f6b5f", "#2a5148", "#1b3832", "#0a1a17", "#d9f2c4"];
const sand: SceneColors = ["#6a4a3a", "#f0a868", "#c98652", "#96603a", "#3d2418", "#ffe0a0"];

// 对数螺线：由画面右下向左上的视觉中心收拢。
const spiral = Array.from({ length: 61 }, (_, index) => {
  const angle = index * 0.19, radius = 196 * Math.exp(-0.32 * angle);
  return `${index ? "L" : "M"}${(104 + radius * Math.cos(angle)).toFixed(1)} ${(74 + radius * Math.sin(angle) * 0.62).toFixed(1)}`;
}).join("");

export const compositions: CompositionPreset[] = [
  { id: "thirds", label: "三分法构图", scene: "dunes", colors: sand, guide: "M107 0V180M213 0V180M0 60H320M0 120H320", subject: [107, 126],
    prompt: "三分法构图：主体放在画面三分线的交点上，地平线贴合上或下三分线，在视线方向留出空间" },
  { id: "centerSymmetry", label: "中心对称构图", scene: "corridor", colors: dusk, guide: "M160 0V180", subject: [160, 131],
    prompt: "中心对称构图：主体位于画面正中，左右环境严格对称，庄重稳定" },
  { id: "diagonal", label: "对角线构图", scene: "peaks", colors: warm, guide: "M0 180L320 0", subject: [96, 128],
    prompt: "对角线构图：主体与主要线条沿画面对角线展开，带来动势与纵深" },
  { id: "cross", label: "十字形构图", scene: "sea", colors: warm, guide: "M160 0V180M0 104H320", subject: [160, 114],
    prompt: "十字形构图：竖直的主体与水平的地平线在画面中心交叉成十字，稳定而肃穆" },
  { id: "lShape", label: "L 形构图", scene: "forest", colors: jade, guide: "M30 14V158H306", subject: [200, 154],
    prompt: "L 形构图：一侧的竖向元素与底部的横向元素组成 L 形，围出留白，把视线引向主体" },
  { id: "sCurve", label: "S 形构图", scene: "dunes", colors: dusk, guide: "M56 180C210 152 36 116 168 100S246 62 300 34", subject: [168, 110],
    prompt: "S 形构图：道路、河流或队列以 S 形曲线贯穿画面，引导视线由近及远" },
  { id: "circle", label: "圆形构图", scene: "forest", colors: dusk, guide: "M176 62a62 62 0 1 0 .1 0Z", subject: [176, 150],
    prompt: "圆形构图：主体被环形元素包围，或众多元素排列成圆，视线聚向圆心" },
  { id: "pyramid", label: "金字塔构图", scene: "peaks", colors: sand, guide: "M38 166L160 34L282 166Z", subject: [160, 150],
    prompt: "金字塔构图：主体与陪体构成稳固的三角形，底宽顶尖，重心稳定" },
  { id: "radial", label: "放射线构图", scene: "corridor", colors: warm, guide: "M160 90L0 0M160 90L320 0M160 90L0 180M160 90L320 180M160 90H0M160 90H320", subject: [160, 131],
    prompt: "放射线构图：线条从画面中的消失点向四周放射，纵深强烈，主体置于汇聚处" },
  { id: "goldenSpiral", label: "黄金螺旋构图", scene: "dunes", colors: sand, guide: spiral, subject: [104, 96],
    prompt: "黄金螺旋构图：画面元素沿螺旋线由外向内收拢，主体落在螺旋中心" },
  { id: "frame", label: "框架构图", scene: "room", colors: dusk, guide: "M72 34h176a10 10 0 0 1 10 10v92a10 10 0 0 1-10 10h-176a10 10 0 0 1-10-10v-92a10 10 0 0 1 10-10Z", subject: [150, 196],
    prompt: "框架构图：利用门窗、洞口等前景形成画框，主体位于框内，增强层次与窥视感" },
  { id: "horizon", label: "水平线构图", scene: "sea", colors: dusk, guide: "M0 104H320", subject: [226, 116],
    prompt: "水平线构图：一条平直的地平线横贯画面，主体小而孤立，开阔宁静" },
];

const wide: Framing = [1, 160, 90];
export const rhythms: RhythmPreset[] = [
  { id: "oneTake", label: "一镜到底", scene: "dunes", colors: sand, shots: [{ span: 1, from: [1.5, 96, 118], to: [1.5, 196, 118] }],
    prompt: "一镜到底：全片为一个不间断的长镜头，镜头平稳跟随主体连续运动，不做任何剪辑切换" },
  { id: "gentle", label: "舒缓平稳", scene: "sea", colors: warm, shots: [{ span: 0.5, from: wide, to: [1.12, 160, 96] }, { span: 0.5, from: [1.7, 128, 108], to: [1.82, 136, 108] }],
    prompt: "舒缓平稳的节奏：镜头数量少，单个镜头时间长，以缓慢推拉或固定机位为主，切换柔和" },
  { id: "multiScale", label: "多景别交替", scene: "dunes", colors: warm,
    shots: [{ span: 0.28, from: wide }, { span: 0.24, from: [1.9, 110, 116], to: [1.9, 130, 116] }, { span: 0.24, from: [3.4, 130, 108], to: [3.4, 144, 108] }, { span: 0.24, from: [1.3, 170, 104] }],
    prompt: "多景别交替：远景、中景、近景与特写交替切换，同一动作从不同景别呈现，节奏明快有层次" },
  { id: "montage", label: "蒙太奇快切", scene: "dunes", colors: sand,
    shots: [
      { span: 0.14, from: [2.2, 120, 112] }, { span: 0.11, from: [1.4, 200, 100], scene: "peaks" }, { span: 0.13, from: [3, 228, 76] }, { span: 0.11, from: [1.8, 150, 150], scene: "city" },
      { span: 0.13, from: [2.6, 100, 120], flip: true }, { span: 0.12, from: [1.6, 180, 110], scene: "sea" }, { span: 0.12, from: [3.2, 126, 110] }, { span: 0.14, from: [1.2, 160, 96], scene: "forest" },
    ],
    prompt: "蒙太奇快切：多个短促镜头快速切换，每个镜头不超过一秒，以画面碰撞压缩时间、堆叠情绪" },
  { id: "speedRamp", label: "升格变速", scene: "dunes", colors: dusk,
    shots: [{ span: 0.26, from: [1.7, 96, 116], to: [1.7, 122, 116], rate: 2 }, { span: 0.5, from: [2.3, 122, 114], to: [2.3, 134, 114], rate: 0.22 }, { span: 0.24, from: [1.7, 134, 116], to: [1.7, 166, 116], rate: 2 }],
    prompt: "升格变速：以正常速度进入，在动作高点转为慢动作升格，随后恢复常速，突出关键瞬间" },
  { id: "stutter", label: "抽帧拖影", scene: "city", colors: ["#0c1030", "#2b1150", "#1a2a66", "#101a44", "#060918", "#ff3fa4"], frameRate: 5, trail: true,
    shots: [{ span: 1, from: [1.8, 110, 140], to: [1.8, 200, 140] }],
    prompt: "抽帧拖影：降低帧率并保留运动残影，动作带顿挫感与拖尾，营造迷幻或紧张的情绪" },
  { id: "reverseShot", label: "正反交替", scene: "room", colors: warm,
    shots: [{ span: 0.26, from: [1.5, 130, 110] }, { span: 0.24, from: [1.5, 130, 110], flip: true }, { span: 0.26, from: [1.9, 124, 104] }, { span: 0.24, from: [1.9, 124, 104], flip: true }],
    prompt: "正反打交替：在两个相对的机位之间来回切换，交替呈现双方的表情与反应，节奏随对话推进" },
  { id: "accelerate", label: "渐进加速", scene: "dunes", colors: ["#b8431a", "#ee7a2c", "#c9521f", "#8f3515", "#3a140a", "#ffb054"],
    shots: [
      { span: 0.3, from: wide }, { span: 0.22, from: [1.6, 120, 112] }, { span: 0.16, from: [2.2, 220, 80] }, { span: 0.12, from: [2.8, 124, 110] },
      { span: 0.08, from: [1.4, 200, 110], flip: true }, { span: 0.06, from: [3.2, 228, 74] }, { span: 0.04, from: [2, 130, 112] }, { span: 0.02, from: [3.6, 126, 108] },
    ],
    prompt: "渐进加速：开头的镜头较长，之后每个镜头越来越短，切换越来越快，把情绪推向高潮" },
  { id: "freeze", label: "定格停顿", scene: "sea", colors: dusk,
    shots: [{ span: 0.38, from: [1.8, 112, 108], to: [1.8, 140, 108], rate: 1.6 }, { span: 0.3, from: [2.4, 140, 106], rate: 0 }, { span: 0.32, from: [1.8, 140, 108], to: [1.8, 168, 108], rate: 1.6 }],
    prompt: "定格停顿：运动进行到关键瞬间突然定格一拍，再继续运动，形成强调与呼吸感" },
];

export const cameraBodies: CameraBody[] = [
  { id: "digitalCinema", label: "数字电影机", prompt: "全画幅数字电影摄影机拍摄，宽容度高，画面干净细腻" },
  { id: "film35", label: "35mm 胶片", prompt: "35mm 电影胶片拍摄，颗粒细腻，高光过渡柔和", grain: 0.28, tone: "sepia(.18) saturate(1.08)" },
  { id: "film16", label: "16mm 胶片", prompt: "16mm 胶片拍摄，颗粒较粗，色彩浓郁，画面带轻微抖动", grain: 0.5, tone: "sepia(.25) saturate(1.2) contrast(1.06)" },
  { id: "largeFormat", label: "大画幅胶片", prompt: "70mm 大画幅胶片拍摄，解析力极高，视野宏大，层次丰富", tone: "saturate(1.1) contrast(1.05)" },
  { id: "super8", label: "超 8 毫米", prompt: "超 8 毫米家用摄影机质感，暖色偏黄，暗角明显，颗粒粗糙", grain: 0.75, tone: "sepia(.5) saturate(1.25) contrast(.95)" },
  { id: "handheldDv", label: "手持 DV", prompt: "手持 DV 摄像机质感，清晰度偏低，带隔行扫描感与轻微手抖", lines: true, stamp: true, tone: "saturate(.85) contrast(.92)" },
  { id: "phone", label: "手机", prompt: "手机随手拍摄的记录质感，小底广角，景深大，画面锐利" },
  { id: "actionCam", label: "运动相机", prompt: "运动相机第一视角，超广角，边缘拉伸明显", tone: "saturate(1.2) contrast(1.1)" },
  { id: "surveillance", label: "监控画面", prompt: "监控摄像头画面，固定的俯视机位，解析度低并带时间戳", lines: true, stamp: true, grain: 0.35, tone: "grayscale(1) sepia(.35) hue-rotate(60deg) contrast(1.1)" },
];

export const cameraLenses: CameraLens[] = [
  { id: "spherical", label: "球面定焦", prompt: "球面定焦镜头，画面锐利通透，焦外圆润" },
  { id: "anamorphic", label: "变形宽银幕", prompt: "变形宽银幕镜头，横向拉丝炫光，椭圆形焦外光斑", effect: "anamorphic" },
  { id: "vintage", label: "复古老镜头", prompt: "复古老镜头，中心锐利、边缘柔化，带光晕与暗角", effect: "vintage" },
  { id: "macro", label: "微距", prompt: "微距镜头，在极近距离呈现细节，景深极浅", effect: "macro" },
  { id: "tiltShift", label: "移轴", prompt: "移轴镜头，焦平面倾斜，画面上下虚化，形成微缩模型感", effect: "tiltShift" },
  { id: "fisheye", label: "鱼眼", prompt: "鱼眼镜头，强烈的桶形畸变与超大视角", effect: "fisheye" },
  { id: "softFocus", label: "柔焦", prompt: "柔焦镜头，高光弥散，整体带柔和光晕", effect: "softFocus" },
];

export const cameraFocals: CameraFocal[] = [
  { id: "14mm", label: "14mm", prompt: "14mm 超广角视角，空间纵深夸张", zoom: 1 },
  { id: "24mm", label: "24mm", prompt: "24mm 广角视角，环境信息丰富", zoom: 1.25 },
  { id: "35mm", label: "35mm", prompt: "35mm 人文视角，人物与环境兼顾", zoom: 1.55 },
  { id: "50mm", label: "50mm", prompt: "50mm 标准视角，透视接近人眼", zoom: 1.95 },
  { id: "85mm", label: "85mm", prompt: "85mm 人像视角，背景压缩，主体突出", zoom: 2.7 },
  { id: "135mm", label: "135mm", prompt: "135mm 中长焦视角，空间明显压缩", zoom: 3.5 },
  { id: "200mm", label: "200mm", prompt: "200mm 长焦视角，背景被强烈压缩并拉近", zoom: 4.4 },
];

export const cameraApertures: CameraAperture[] = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16].map(stop => ({
  id: `f${stop}`, label: `f/${stop}`, stop,
  prompt: `f/${stop} 光圈，${stop <= 2 ? "景深极浅，背景大幅虚化" : stop <= 4 ? "浅景深，背景柔和虚化" : stop <= 8 ? "景深适中，主体与环境都较清晰" : "大景深，前后景都清晰"}`,
}));

export const presetKinds: { kind: PresetKind; label: string; title: string; items: ScenePreset[] }[] = [
  { kind: "style", label: "风格", title: "影视风格库", items: styles },
  { kind: "palette", label: "配色", title: "配色库", items: palettes },
  { kind: "composition", label: "构图", title: "构图库", items: compositions },
  { kind: "rhythm", label: "节奏", title: "节奏库", items: rhythms },
];

export const cameraFields = [
  { key: "body", label: "相机", options: cameraBodies },
  { key: "lens", label: "镜头", options: cameraLenses },
  { key: "focal", label: "焦距", options: cameraFocals },
  { key: "aperture", label: "光圈", options: cameraApertures },
] as const satisfies readonly { key: keyof CameraDesign; label: string; options: CameraOption[] }[];

export function findPreset(kind: PresetKind, id?: string) {
  return presetKinds.find(item => item.kind === kind)!.items.find(item => item.id === id);
}

export function cameraSummary(camera?: CameraDesign) {
  return cameraFields.flatMap(field => field.options.find(item => item.id === camera?.[field.key])?.label ?? []).join(" · ");
}

/** 生成时附加到提示词末尾的镜头设定；未选择任何一项时返回空字符串。 */
export function shotDesignPrompt(design?: ShotDesign) {
  const lines = presetKinds.flatMap(({ kind, label }) => {
    const preset = findPreset(kind, design?.[kind]);
    return preset ? [`${label}：${preset.prompt}`] : [];
  });
  const camera = cameraFields.flatMap(field => field.options.find(item => item.id === design?.camera?.[field.key])?.prompt ?? []);
  if (camera.length) lines.push(`相机：${camera.join("；")}`);
  return lines.length ? `镜头设定（本次生效）：\n${lines.join("\n")}` : "";
}
