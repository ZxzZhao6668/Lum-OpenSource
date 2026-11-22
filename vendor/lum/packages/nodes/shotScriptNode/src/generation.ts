import { entityBrief, scriptEntities, type ScriptDocument, type ScriptEntity } from "@lum/node-shared/scriptDocument";
import { createShot, normalizeShot, parseJsonReply, shotSizes, type Shot, type ShotAsset, type ShotDocument } from "./shotData";

export const shotSystemPrompt = `你是短剧分镜导演，把剧本拆成可直接生成图片和视频的镜头表。
只输出一个 JSON 对象，不要任何解释或代码块标记，结构：
{"style":"全局视觉风格一句话","assets":[{"kind":"character|scene|prop","name":"名字","description":"外形或空间描述，用于生成设定图"}],"shots":[{"duration":6,"description":"画面描述","shotSize":"景别","lighting":"光影氛围","dialogues":[{"kind":"line","speaker":"角色名","text":"台词"},{"kind":"narration","text":"旁白"}],"sound":"音效","camera":"运镜"}]}
规则：
1. description 只写这一镜看得见的画面：谁、在哪、做什么、表情动作；出现的角色、场景、道具一律写成「@名字」，名字必须与 assets 中的 name 完全一致；每镜至少引用一个场景。
2. 一镜一个动作重点，时长 2–12 秒；按剧本顺序，不跳戏、不自创剧情；台词照抄剧本，长台词拆到相邻镜头。
3. shotSize 只用：${shotSizes.join("、")}。
4. lighting 写时间、内外景、氛围和主色调；sound 写环境声和动作声；camera 写运镜方式与目的。
5. assets 列出本集用到的全部角色、场景、道具，description 取自剧本设定，写外形、服装、材质、空间结构这类可画的信息，不写剧情。
6. 镜头总时长尽量贴近目标时长。`;

export function entityAssets(entities: ScriptEntity[]): Pick<ShotAsset, "kind" | "name" | "description">[] {
  return entities.map(entity => ({ kind: entity.kind, name: entity.name, description: entityBrief(entity, 240) }));
}

export function buildShotPrompt(script: ScriptDocument, options: { mode: "script" | "character"; episodeIndex: number; characters?: string[]; request?: string; seconds?: number }) {
  const episode = script.episodes[options.episodeIndex];
  const entities = scriptEntities(script);
  const style = script.setup?.style.prompt || script.setup?.style.label || "";
  const target = options.seconds ?? (script.setup ? script.setup.episodeMinutes * 60 : 180);
  const lists = entities.map(entity => `- [${entity.kind}] ${entity.name}：${entityBrief(entity, 160)}`).join("\n");
  if (options.mode === "character") {
    const names = options.characters?.length ? options.characters : entities.filter(item => item.kind === "character").slice(0, 1).map(item => item.name);
    return [
      `剧本《${script.title}》。请为角色 ${names.join("、")} 做一组角色展示分镜（约 ${Math.min(target, 60)} 秒），突出外形、性格与标志动作，可取材剧本中的经典桥段。`,
      style && `画风：${style}`,
      `【设定清单】\n${lists}`,
      episode && `【参考剧本：${episode.title}】\n${episode.content.slice(0, 12000)}`,
      options.request && `【补充要求】${options.request}`,
    ].filter(Boolean).join("\n\n");
  }
  if (!episode) throw new Error("剧本节点里还没有分集剧本，请先写好至少一集");
  return [
    `剧本《${script.title}》，把下面这一集拆成镜头表，目标总时长约 ${target} 秒。`,
    style && `画风：${style}`,
    `【设定清单】\n${lists}`,
    `【本集剧本：${episode.title}】\n${episode.content}`,
    options.request && `【补充要求】${options.request}`,
  ].filter(Boolean).join("\n\n");
}

export function applyShotReply(document: ShotDocument, reply: string, fallbackAssets: Pick<ShotAsset, "kind" | "name" | "description">[]) {
  const value = parseJsonReply(reply) as { style?: unknown; assets?: unknown; shots?: unknown };
  const shots = (Array.isArray(value.shots) ? value.shots : []).map(normalizeShot).filter(shot => shot.description.trim());
  if (!shots.length) throw new Error("模型没有返回镜头");
  const named = new Map(fallbackAssets.map(item => [item.name, item]));
  const assets = (Array.isArray(value.assets) ? value.assets : []).flatMap(item => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
    if (!name) return [];
    const kind = raw.kind === "scene" || raw.kind === "prop" ? raw.kind : "character";
    const known = named.get(name);
    return [{ kind: known?.kind ?? kind, name, description: known?.description || (typeof raw.description === "string" ? raw.description.slice(0, 1000) : "") }];
  });
  // 镜头里出现但模型漏列的 @名字，从剧本清单补上。
  for (const shot of shots) for (const known of fallbackAssets) {
    if (shot.description.includes(`@${known.name}`) && !assets.some(item => item.name === known.name)) assets.push({ ...known });
  }
  mergeAssets(document, assets);
  document.shots = shots;
  if (typeof value.style === "string" && value.style.trim() && !document.style) document.style = value.style.trim().slice(0, 600);
}

export function mergeAssets(document: ShotDocument, assets: Pick<ShotAsset, "kind" | "name" | "description">[]) {
  for (const asset of assets) {
    const existing = document.assets.find(item => item.name === asset.name);
    if (existing) { if (!existing.description) existing.description = asset.description; continue; }
    document.assets.push({ id: crypto.randomUUID(), kind: asset.kind, name: asset.name, description: asset.description, image: null, nodeId: null });
  }
}

export const promptSystemPrompt = `你是 AI 影像提示词工程师。根据分镜表的一行、出场资产和全局风格，为这一镜写两段提示词，只输出 JSON：{"imagePrompt":"…","videoPrompt":"…"}
imagePrompt（分镜图提示词，用于文生图/图生图）：先写景别与构图，再写场景空间、光线与主色调，再写画面中每个角色的外形要点、动作、表情和站位（角色、场景、道具保留「@名字」写法），最后以「【视觉风格：…】」结尾；只写这一瞬间的静态画面，不写镜头运动，不出现文字。
videoPrompt（视频运动提示词，用于图生视频）：按行写——出场角色：@名字 身高体型要点；背景场景：@场景 光线；画面：起始画面 → 动作过程 → 结束画面（按秒说明节奏）；运镜：…；对白：角色：台词（口型同步）；音效：…；最后一行写「参考图使用规则：角色参考图只参考形象，不参考角度、构图、姿势、表情；场景参考图只参考空间结构与光线；首帧图决定构图与起始姿态。」
不得编造分镜表里没有的剧情或台词。`;

export function buildPromptRequest(shot: Shot, document: ShotDocument, index: number) {
  const used = document.assets.filter(asset => shot.description.includes(`@${asset.name}`));
  return [
    document.style && `全局风格：${document.style}`,
    `第 ${index + 1} 镜（${shot.duration} 秒）`,
    `画面描述：${shot.description}`,
    `景别：${shot.shotSize}`,
    shot.lighting && `光影氛围：${shot.lighting}`,
    shot.dialogues.length && `对白·旁白：${shot.dialogues.map(item => item.kind === "narration" ? `旁白：${item.text}` : `${item.speaker ?? ""}：${item.text}`).join("；")}`,
    shot.sound && `音效：${shot.sound}`,
    shot.camera && `运镜：${shot.camera}`,
    used.length && `出场资产：\n${used.map(asset => `- @${asset.name}（${asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}）：${asset.description}`).join("\n")}`,
  ].filter(Boolean).join("\n");
}

export function applyPromptReply(shot: Shot, reply: string) {
  const value = parseJsonReply(reply) as { imagePrompt?: unknown; videoPrompt?: unknown };
  if (typeof value.imagePrompt !== "string" || typeof value.videoPrompt !== "string") throw new Error("模型返回的提示词格式不对");
  shot.imagePrompt = value.imagePrompt.trim();
  shot.videoPrompt = value.videoPrompt.trim();
}

export function manualShots() {
  return [createShot({ description: "", duration: 5 })];
}
