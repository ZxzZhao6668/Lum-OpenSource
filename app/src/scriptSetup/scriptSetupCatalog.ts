import type { ChoiceSnapshot, GenreChoice, ScriptSetupPayload, ScriptSetupVisualStyle, StoryHook } from './scriptSetupModel';

export const CATALOG_REVISION = 1;
type GenreGroup = ChoiceSnapshot & { aliases: string[]; conflict: string; subtypes: (ChoiceSnapshot & {aliases: string[]})[] };
const genre = (id: string, label: string, description: string, conflict: string, subtypes: string, aliases: Record<string,string[]> = {}): GenreGroup => ({
  id, label, description, conflict, aliases: aliases[label] ?? [],
  subtypes: subtypes.split('｜').map((pair, index) => {
    const [label, description] = pair.split('：'); return {id: `${id}-${index+1}`, label, description, aliases: aliases[label] ?? []};
  }),
});
export const GENRES = [
  genre('urban','都市生活','从城市空间和日常选择观察人物。','小店经营与宏大危机融合时，先说明怎样影响店里的人。','都市群像：多人命运交汇｜邻里生活：街坊互助与摩擦｜返乡生活：重建家乡日常｜城市漂泊：扎根前的生计｜小店经营：街头小店的人情算盘'),
  genre('workplace','职场行业','以职业伦理、技能和行业变化推动剧情。','历史工业题材要交代材料、设备和知识来源。','工业制造：设备、工艺与工人｜医疗行业：诊疗中的职业判断｜法律职场：证据与规则｜互联网职场：产品与团队｜餐饮服务：餐桌背后的经营',{'工业制造':['机床','工厂','种田','车床','工坊','机械','工程','工业种田']}),
  genre('business','商战创业','人物在资源与利益冲突中建立事业。','大量商业说明可能遮蔽人物真正要付出的代价。','小本创业：从小规模试错起步｜家业振兴：接住并改造旧产业｜产业竞争：供应链与市场角力｜跨地域贸易：流通路线与差价｜企业转型：旧组织转向新业务'),
  genre('family','家庭伦理','亲密关系中的义务、误解与选择。','外部危机节奏过快，容易挤掉家人的关系变化。','代际关系：不同年代的价值观｜重组家庭：建立新的家庭关系｜手足关系：竞争、互助与分工｜婚姻生活：亲密关系的日常｜家族兴衰：几代人的共同命运'),
  genre('romance','爱情关系','以两人如何选择彼此为主线。','悬疑线应给感情选择留出足够因果空间。','都市爱情：城市环境中的亲密关系｜古装爱情：礼制背景下的选择｜久别重逢：旧情人与新处境｜双向奔赴：双方都主动迈步｜跨文化爱情：背景差异与理解'),
  genre('youth','青春成长','以青年寻找位置和建立自我为中心。','成人视角不能替青年做完所有决定。','校园生活：同学、老师与校园日常｜毕业抉择：离开学校时的去向｜青春群像：同龄人的不同道路｜艺术追梦：创作训练与取舍｜返乡青年：回到家乡寻找方向'),
  genre('history','历史传奇','在明确历史或架空时代中展开人物命运。','古人获取现代知识必须有来历和可用边界。','历史架空：虚构历史与制度｜工匠传奇：手艺、传承与生计｜市井传奇：普通人的传奇经历｜边地开拓：边疆建设与生存｜人物传记：围绕一段人物生涯'),
  genre('court','古装权谋','礼制、组织与权力之间的选择。','权术要符合人物实际掌握的信息。','朝堂博弈：朝臣之间的利益交换｜地方治理：制度落在民生现场｜家族权争：宗族内部的角力｜宫廷风云：宫廷秩序与个人命运｜王朝变局：大局变化中的立场'),
  genre('wuxia','武侠江湖','武艺、行路与侠义的代价。','玄幻力量不能突然抹去武艺的代价。','江湖群像：多路江湖人相遇｜门派风云：传承与派系｜镖局行旅：护送任务和路上冲突｜侠义公案：侠客辨明纠纷｜边塞武侠：边地规则与江湖选择'),
  genre('fantasy','仙侠玄幻','明确力量来源、边界与代价后展开奇遇。','选了无超自然机制时，应说明奇异现象是传说还是表象。','宗门修行：门派训练与进阶｜仙侠群像：不同修行道路｜神话传说：重述神话人物与规则｜东方玄幻：虚构术法与秩序｜异世大陆：陌生大陆的文明冲突'),
  genre('scifi','科幻未来','设定科技变化如何改变人的选择。','科技应有成本和适用边界。','近未来城市：技术改变城市日常｜太空探索：离开地球后的探索｜人工智能：人和机器的协作与冲突｜星际文明：不同文明的接触｜赛博社会：数码网络与社会分层'),
  genre('disaster','末世灾变','在资源受限时观察人和组织。','现代可以是主体时代，末世是世界状态。','灾后重建：灾后建立新的秩序｜避难所群像：避难空间中的人群｜生态灾变：环境变化与生存｜感染危机：隔离、传播风险与抉择｜极端天气：天气改变日常条件'),
  genre('mystery','悬疑探案','让问题、证据和揭晓构成同一条因果链。','超自然解释不能替代已铺陈的证据。','刑侦案件：循证调查｜古装探案：时代制度内的取证｜社会派悬疑：案件映照社会关系｜密室推理：封闭条件下找答案｜失踪追踪：追回人物和线索'),
  genre('horror','惊悚怪谈','控制未知与危险的揭示节奏。','如融合探案，明确怪谈是表象还是真实规则。','民俗怪谈：仪式与地方传说｜心理惊悚：心理压力与认知｜都市异闻：城市中的反常传闻｜封闭空间：行动受限的危险｜超自然谜团：解释异常现象'),
  genre('war','战争谍战','人在战争压力下的职责、伦理与选择。','保留人物代价，避免只剩事件列表。','战地群像：战地中不同人群｜隐蔽战线：公开身份后的秘密职责｜情报交锋：信息差改变局面｜战时民生：普通人的生活困境｜边防故事：边地人物与职责'),
  genre('comedy','喜剧轻喜','笑点来自人物反差、误会与行动结果。','不要以笑点抹去已建立的伤痛或风险。','家庭喜剧：家人生活中的幽默｜职场喜剧：工作情境的反差｜古装轻喜：古装背景的轻松故事｜荒诞喜剧：荒诞前提的连锁反应｜公路喜剧：旅途中的偶遇和意外'),
  genre('sports','体育竞技','由训练、比赛和团队关系产生推进力。','不必让所有角色都以夺冠证明成长。','团队球类：团队协作与位置｜个人竞技：运动员与自身极限｜校园运动：学生的训练与赛事｜职业电竞：战队与赛季的抉择｜群众体育：运动连接普通人'),
  genre('society','现实社会','从具体人物看社会和生活问题。','现实细节应服务选择，避免堆砌概念。','乡村发展：乡村生计与治理｜社区生活：基层关系与服务｜养老生活：照护与老龄处境｜教育现场：课堂及家庭的抉择｜城乡变迁：两种生活空间的变化',{'乡村发展':['种田','返乡','农业']}),
  genre('heritage','文旅非遗','把地方文化和技艺写进人物的实践。','工艺介绍应与剧情冲突有关。','传统技艺：师徒实践与传承｜地方美食：饮食记录和地方认同｜古建保护：建筑的修缮与使用｜戏曲传承：舞台内外的传承｜山河行旅：风土中的行路见闻'),
  genre('era','主旋律与时代人物','在公共事业和时代变化中观察人的选择。','重大主题仍要落到人物具体的行为与代价。','重大工程：建设组织与技术难题｜基层服务：具体服务对象与难题｜应急救援：协作、时机与责任｜科研报国：研究过程及其社会价值｜时代楷模：人物践行选择的过程'),
];
function choices(raw: string): ChoiceSnapshot[] {
  return raw.split('｜').map(pair => {const [id, label, description] = pair.split('：'); return {id, label, ...(description ? {description} : {})};});
}
export const DIRECTION_GROUPS = [
  ['成长与立足','survival：生存立足：先解决立足所需的资源与规则｜growth：普通人成长：从具体小事建立能力与自信｜mastery：专业突破：专业难题带来可验证的进步｜identity：身份认同：在行动中认识自己是谁'],
  ['建设与经营','industry：工业建设：工厂、机床与工艺落地，给时间与材料设限｜enterprise：创业经营：建立业务与分配资源｜revival：家业复兴：用新办法接续旧事业｜rebuild：灾后重建：在损失之后重建生活条件'],
  ['目标与竞争','comeback：逆境翻盘：因准备和取舍扭转败势｜champion：竞赛夺冠：训练目标进入结果明确的比赛｜defend：守护家园：在威胁中承担守护代价｜monopoly：打破垄断：用资源和协作打破排他秩序'],
  ['谜案与探索','truth：追查真相：按证据变化推进调查｜case：破解谜案：在规则内解释不可能事件｜search：寻人寻物：沿线索推进，找回目标之后仍有后果｜explore：探索未知：进入陌生环境，理解运行规则'],
  ['人际与情感','trust：建立信任：用共同选择累积互信｜reunion：破镜重圆：理解旧冲突后重新选择｜reconcile：代际和解：不同年代的人找共同立场｜salvation：双向救赎：双方都参与对方的改变'],
  ['利益与选择','commerce：商业博弈：明确价格、供给和双方筹码｜balance：权力制衡：不同势力在制度中互相牵制｜values：价值观冲突：不可兼得的价值造成选择｜duty：责任抉择：明确选择者承担的后果'],
  ['失去与归来','revenge：复仇与代价：追索旧债时付出新的代价｜atonement：赎罪补偿：用行动弥补旧错｜new-life：重建生活：从损失后重新安排生活｜homecoming：回归故乡：回来的人与变化的故乡互相审视'],
  ['群体与传承','teamwork：团队协作：任务必须借助不同人的能力｜legacy：薪火传承：传人与师者分别承担责任｜ensemble：群像命运：多个人物互相改变轨迹｜change：社会变迁：时代变化落实到具体生活'],
  ['节奏与体验','adventure：冒险闯关：关卡逐步增加行动难度｜slice：轻喜日常：日常互动产生温和幽默｜twists：悬念反转：新信息改变对旧事实的理解｜passion：热血奋斗：用行动和共同目标带来动力'],
].map(([name,raw]) => ({name, choices: choices(raw)}));
export const DIRECTIONS = DIRECTION_GROUPS.flatMap(group => group.choices);
export const HIGHLIGHTS = choices('fast-payoff：快速回报：明确短期行动的回响｜reversal：强反差：预期和现实之间拉开差距｜hands-on：过程爽点：展示操作细节和实际产出｜catharsis：情绪释放：压抑后安排有来由的释放｜companionship：陪伴感：形成稳定可感的日常关系｜suspense：强悬念：让观众期待关键问题的答案｜warmth：温暖治愈：困难中保留具体的关心');
export const MECHANISMS = choices('time-travel：穿越：填写来历、目的时空和两者关系｜rebirth：重生：交代记忆范围与改变的代价｜limited-system：有限系统：填写能力、奖励和禁区｜time-loop：时间循环：填写触发、保留信息和退出规则｜swap：身份互换：写清触发、可见范围与回归条件｜parallel：平行世界：确定相互影响的边界｜time-message：时空通信：说明媒介、延迟与限制｜foresight：预知片段：说明预测如何不可靠｜amnesia：记忆缺失：明确缺失范围与恢复条件｜dual-timeline：双线时空：标清两条时间线及剪接关系｜powers：异能觉醒：明确使用限制和代价｜none-supernatural：无超自然机制：可和记忆缺失、双线时空并用');
export const AUDIENCES = choices('male：男频｜female：女频｜general：泛人群｜senior：银发｜overseas：海外');
export const PERSONALITY_GROUPS = [
  ['待人方式','gentle：温和｜enthusiastic：热情｜aloof：疏离｜straight：直率｜tactful：圆融｜guarded：戒备'],
  ['处理事情','cautious：谨慎｜decisive：果断｜impulsive：冲动｜stubborn：执拗｜practical：务实｜idealistic：理想主义'],
  ['情绪表达','calm：沉稳｜sensitive：敏感｜optimistic：乐观｜pessimistic：悲观｜irritable：易怒｜restrained：克制'],
  ['意志与习惯','brave：勇敢｜risk-averse：避险｜disciplined：自律｜spontaneous：随性｜competitive：好胜｜easygoing：随和'],
].map(([name,raw]) => ({name, choices: choices(raw)}));

type VisualEntry = NonNullable<ScriptSetupVisualStyle['preset']> & { swatches: [string,string,string] };
const visual = (id: string, label: string, palette: string, light: string, texture: string, composition: string, ...swatches: VisualEntry['swatches']): VisualEntry =>
  ({id,label,palette,light,texture,composition,swatches});
export const VISUAL_STYLES = [
  visual('industrial-doc','工业纪实','铁灰、铜褐与克制的信号色','环境光辅以工位硬光','金属划痕、油渍、工作服纤维','中景交代工位关系，细节展示工序','#343f45','#887667','#d39052'),
  visual('historical-natural','古装自然光','天然染料色与温润木色','窗光、天光和烛光','织物、旧木与石材','利用门窗与廊柱形成景深','#504438','#927555','#dfc5a5'),
  visual('cold-court','冷峻宫廷','低饱和青灰与暗红','狭长侧光，暗部保留层次','冰冷石阶、厚重衣料','轴线对称，突出权力距离','#29343f','#647985','#834a4a'),
  visual('urban-real','都市写实','中性色，允许环境招牌色','保留街灯、荧光灯和自然光','水泥、玻璃、日常衣物','观察视角，留出生活空间','#4f5d60','#8e968e','#c1a98f'),
  visual('warm-life','暖色生活','暖白、淡黄与木色','柔光包裹人物','织物、陶器与木纹','近中景保留亲密距离','#755b3c','#d09959','#f0dac0'),
  visual('noir','黑色悬疑','黑灰为主，少量冷色信号','硬侧光，遮挡塑造暗部','雨渍、旧墙、粗颗粒','以前景和阴影隐藏信息','#181e24','#525c66','#aab5c4'),
  visual('bright-comedy','明亮轻喜','明快互补色','高调柔光，阴影浅','整洁道具与轻量布料','群体构图留出反应位置','#62a892','#f5c96a','#f5ece0'),
  visual('ink-wuxia','武侠水墨','墨黑、浅灰与留白','漫射天空光','纸纹、雾气与湿墨边缘','留白、远山和人物动势并置','#283331','#9ea8a2','#eee9de'),
  visual('cyber-neon','赛博霓虹','暗底与青粉、橙色霓虹','使用环境霓虹反射','玻璃、金属与潮湿路面','高反差轮廓与纵深街道','#181d34','#38aab0','#d45384'),
  visual('cel-2d','二维赛璐璐','清楚的平涂色块','明确明暗分层','干净线条与少量手绘颗粒','轮廓可读，背景服务动作','#476c8e','#e4967f','#efd692'),
  visual('animation-3d','三维动画','协调色组与明确背景对比','柔和主光辅以轮廓光','体积材质与局部高光','分镜明确层次与主体表情','#4f648b','#a17a59','#e3ccb0'),
  visual('stop-motion','定格质感','温暖手作材料色','模拟棚内小灯或窗光','黏土、毛毡、纸板与接缝','近看有模型舞台纵深','#755948','#ae7b61','#e2cba4'),
];
export const STRUCTURE_PATTERNS = ['三幕结构','起承转合','单元故事','连续短剧','双线并行','自定义'];
export const ERAS = ['古代','近代','现代','近未来','远未来','架空时代'];
export const toChoice = ({id, label, description}: ChoiceSnapshot): ChoiceSnapshot => ({id,label,...(description ? {description} : {})});
export const toVisual = ({swatches: _swatches, ...item}: VisualEntry) => item;
export type CustomDimension = 'genre' | 'audience' | 'direction' | 'highlight' | 'personality';
export interface CustomChoice extends ChoiceSnapshot { dimension: CustomDimension }
export interface CatalogPreferences { favorites: string[]; recent: string[]; custom: CustomChoice[] }
const prefsKey = 'lum:scriptSetup:catalog:v1';
const dimensions: CustomDimension[] = ['genre','audience','direction','highlight','personality'];
export function readCatalogPreferences(): CatalogPreferences {
  try {
    const data = JSON.parse(localStorage.getItem(prefsKey) ?? '{}');
    const ids = (values: unknown) => Array.isArray(values) ? [...new Set(values.filter((id): id is string => typeof id === 'string' && /^[\w-]{1,160}$/.test(id)))] : [];
    const custom: CustomChoice[] = [];
    if (Array.isArray(data?.custom)) for (const item of data.custom.slice(0, 1000)) {
      if (item && typeof item.id === 'string' && /^custom-[\w-]{1,150}$/.test(item.id) && typeof item.label === 'string' && item.label.trim() &&
          item.label.length <= 120 && (item.description === undefined || (typeof item.description === 'string' && item.description.length <= 1200)) &&
          dimensions.includes(item.dimension) && !custom.some(c => c.id === item.id)) custom.push({...toChoice(item), dimension: item.dimension});
    }
    return {favorites: ids(data?.favorites).slice(0, 1000), recent: ids(data?.recent).slice(0, 30), custom};
  } catch { return {favorites: [], recent: [], custom: []}; }
}
export function markCatalogRecent(id: string) {
  const data = readCatalogPreferences();
  data.recent = [id, ...data.recent.filter(item => item !== id)].slice(0, 30);
  localStorage.setItem(prefsKey, JSON.stringify(data));
}
export function toggleCatalogFavorite(id: string) {
  const data = readCatalogPreferences();
  data.favorites = data.favorites.includes(id) ? data.favorites.filter(i => i !== id) : [...data.favorites, id];
  localStorage.setItem(prefsKey, JSON.stringify(data));
}
export function saveCustomChoice(dimension: CustomDimension, label: string, description: string, id?: string): CustomChoice {
  const data = readCatalogPreferences();
  const previous = id ? data.custom.find(c => c.id === id && c.dimension === dimension) : undefined;
  if (id && !previous) throw Error('找不到要重命名的自定义选项。');
  const clean = label.trim(), detail = description.trim();
  if (!clean || clean.includes('\0') || clean.length > 120 || detail.includes('\0') || detail.length > 1200) throw Error('自定义名称需为 1—120 字，说明最多 1200 字。');
  if (data.custom.length >= 1000 && !previous) throw Error('自定义目录已达到 1000 项。');
  const entry = {id: previous?.id ?? `custom-${crypto.randomUUID()}`, dimension, label: clean, description: detail};
  data.custom = [...data.custom.filter(c => c.id !== entry.id), entry];
  localStorage.setItem(prefsKey, JSON.stringify(data));
  return entry;
}
export function matchesCatalog(query: string, ...fields: (string | undefined)[]) {
  const text = fields.filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
  return query.normalize('NFKC').toLowerCase().trim().split(/\s+/).every(part => text.includes(part));
}
export const INDUSTRY_ALIASES = ['机床','种田','工厂','工坊','机械','车床'];

const presets = [
  ['大明工坊','history-1','workplace-1',['industry','mastery','commerce'],['time-travel','limited-system'],'大明','历史传奇为世界，工业建设为成长主线。'],
  ['怪谈公案','mystery-2','horror-1',['truth','teamwork','values'],['none-supernatural'],'古代','怪谈作为案件表象，由真实线索解释。'],
  ['街角小店','urban-5','family',['enterprise','reconcile','new-life'],[],'现代','小店的经营选择牵动家庭关系。'],
  ['灾后新城','disaster-1','scifi-1',['survival','defend','duty'],[],'近未来','写清科技水平、物资约束和重建的代价。'],
  ['校园赛季','sports-3','youth-3',['growth','champion','trust'],[],'现代','重视团队关系，不要求每个角色都成为冠军。'],
  ['技艺与家业','heritage-1','business-2',['legacy','revival','commerce'],[],'','工艺过程服务人物与冲突。'],
] as const;
function genreBy(id: string): GenreChoice {
  for (const g of GENRES) {
    if (g.id === id) return toChoice(g);
    const subtype = g.subtypes.find(s => s.id === id);
    if (subtype) return {...toChoice(g), subtype: toChoice(subtype)};
  }
  throw Error('创作预设的题材找不到。');
}
export const CREATIVE_PRESETS = presets.map(([name, primary, secondary, hooks, mechanisms, mainEra, fusionNote]) => ({
  name, genre: {primary: genreBy(primary), secondary: genreBy(secondary), fusionNote, catalogRevision: CATALOG_REVISION},
  hooks: hooks.map(id => ({...toChoice(DIRECTIONS.find(choice => choice.id === id)!), dimension: 'direction'} satisfies StoryHook)),
  mechanisms: mechanisms.map(id => ({...toChoice(MECHANISMS.find(choice => choice.id === id)!), rules: ''})), mainEra,
}));
export function previewCreativePreset(payload: ScriptSetupPayload, index: number) {
  const preset = CREATIVE_PRESETS[index];
  if (!preset) throw Error('找不到创作预设。');
  const next = structuredClone(payload), locks = new Set(payload.constraints.lockedFields);
  if (!locks.has('genre')) next.genre = structuredClone(preset.genre);
  if (!locks.has('hooks')) next.hooks = structuredClone(preset.hooks);
  if (!locks.has('setting')) {
    if (preset.mainEra) next.setting.mainEra = preset.mainEra;
    next.setting.mechanisms = preset.mechanisms.map(item => ({...item, rules: payload.setting.mechanisms.find(old => old.id === item.id)?.rules ?? ''}));
  }
  return next;
}

