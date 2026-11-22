import { db, loadDoc, saveDoc } from '../data/db';
import type { EpisodeIndex } from '../episode/episodeManager';
import type { ProjectMeta } from '../projects/projectWriting';
import { readWorldview, validateWorldEntries, type WorldEntry } from '../worldview/worldviewModel';
import { readDocument, type DocumentSnapshot, type ScriptBlock } from '../writing/documentStore';
import { readCharacterProfile, scriptSetupFingerprint } from './characterProfiles';
import {
  emptyScriptSetup, PROFILE_FIELDS, SETUP_FIELDS, setupFingerprint, setupInteger, validateCharacterProfile, validateScriptSetupPayload,
  type CharacterProfile, type GrowthStage, type ScriptSetupPayload, type ScriptSetupVisualStyle, type SetupField, type WorldRef,
} from './scriptSetupModel';
import { assertScriptSetupProject, readScriptSetup, readScriptSetupWorkspaceEpoch, scriptSetupProjectId, ScriptSetupConflict } from './scriptSetupStore';

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ScriptSetupPurpose = 'writing' | 'outline' | 'episodePlan' | 'storyboard' | 'visual';
export interface ScriptSetupContextOptions {
  purpose: ScriptSetupPurpose;
  episodeId: string;
  entityIds?: readonly string[];
  sceneId?: string;
  document?: DocumentSnapshot;
  scopeBlocks?: readonly ScriptBlock[];
  requestText?: string;
  overrideFields?: readonly SetupField[];
}
export interface SourceVersion { key: string; fingerprint: string; revision?: number }
interface ProfileVersion { entityId: string; revision: number; fingerprint: string }
interface CharacterContext {
  entityId?: string;
  draftProfileId?: string;
  name: string;
  profile?: CharacterProfile;
  assetDescription?: string;
  adoptedAppearance?: { assetId: string; appearanceId: string; version: number; mediaId: string };
}
interface ContextIdentity {
  projectId: string;
  workspaceEpoch: string;
  episodeId: string;
  sceneId?: string;
  setupRevision: number;
  setupVersionId: string;
  sourceVersions: SourceVersion[];
  profileVersions: ProfileVersion[];
  worldVersions: WorldRef[];
}
export type ScriptSetupVisualSnapshot = DeepReadonly<ContextIdentity & { style: ScriptSetupVisualStyle }>;
export type ScriptSetupSnapshot = DeepReadonly<ContextIdentity & {
  schemaVersion: 1;
  purpose: ScriptSetupPurpose;
  payload: ScriptSetupPayload;
  project: { name: string; synopsis: string };
  episodeTitle: string;
  episodeOutline: string;
  canon: WorldEntry[];
  overview: string;
  characters: CharacterContext[];
  omittedSetupFields: SetupField[];
  overrideFields: SetupField[];
  visual: ScriptSetupVisualSnapshot;
}>;
export interface CompiledScriptSetup { snapshot: ScriptSetupSnapshot | null; text: string }

const PURPOSES: readonly ScriptSetupPurpose[] = ['writing', 'outline', 'episodePlan', 'storyboard', 'visual'];
export const SCRIPT_SETUP_CANON_KEY = 'project:scriptSetupCanonResolution';
export interface CanonResolution {
  schemaVersion: 1;
  projectId: string;
  workspaceEpoch: string;
  setupRevision: number;
  setupVersionId: string;
  setupFingerprint: string;
  worldFingerprint: string;
  profileFingerprint?: string;
  omittedFields: SetupField[];
  updatedAt: number;
}
export const setupFactFields = ['genre', 'characters', 'setting', 'hooks', 'structure', 'mustKeep', 'mustAvoid'] as const satisfies readonly SetupField[];
export function setupFieldValue(payload: DeepReadonly<ScriptSetupPayload>, field: SetupField) {
  return field === 'mustKeep' || field === 'mustAvoid' ? payload.constraints[field] : payload[field];
}
function clearSetupField(payload: ScriptSetupPayload, field: SetupField) {
  const blank = emptyScriptSetup();
  if (field === 'mustKeep' || field === 'mustAvoid') payload.constraints[field] = [];
  else Object.assign(payload, { [field]: blank[field] });
}

export interface CanonReview {
  projectId: string;
  workspaceEpoch: string;
  worldFingerprint: string;
  setupFingerprint: string;
  overview: string;
  canon: WorldEntry[];
  staleRefs: string[];
  missingRefs: string[];
  profileFingerprint: string;
  profiles: CharacterContext[];
  fields: SetupField[];
}
export class ScriptSetupCanonConflict extends Error {
  readonly review: CanonReview;
  readonly payload: ScriptSetupPayload;
  readonly revision: number;
  readonly versionId: string;
  constructor(review: CanonReview, payload: ScriptSetupPayload, revision: number, versionId: string) {
    super('请先核对已确认世界观和这版剧本设定，再发送模型请求。');
    this.name = 'ScriptSetupCanonConflict';
    this.review = review;
    this.payload = payload;
    this.revision = revision;
    this.versionId = versionId;
  }
}
export function freezeSetupValue<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSetupValue(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
function sceneScope(blocks: readonly ScriptBlock[], sceneId: string) {
  const start = blocks.findIndex(block => block.type === 'scene' && block.id === sceneId);
  if (start < 0) throw Error('所选场次已不存在，请重新选择。');
  const next = blocks.findIndex((block, index) => index > start && block.type === 'scene');
  return blocks.slice(start, next < 0 ? undefined : next);
}
function stageMatches(stage: GrowthStage, episodeNumber: number) {
  const scope = stage.scope.trim();
  if (!scope) return true;
  const interval = /^(?:第\s*)?(\d+)\s*(?:集|章)?(?:\s*[-–—～至到]\s*(?:第\s*)?(\d+)\s*(?:集|章)?)?$/.exec(scope);
  return !!interval && episodeNumber >= Number(interval[1]) && episodeNumber <= Number(interval[2] ?? interval[1]);
}
function projectProfile(profile: CharacterProfile, purpose: ScriptSetupPurpose, episode: number, selected: Set<string>, hasAdoptedAppearance: boolean) {
  if (purpose === 'visual') {
    return { ...emptyProfileForVisual(profile), appearance: hasAdoptedAppearance ? '' : profile.appearance };
  }
  const allStages = purpose === 'outline' || purpose === 'episodePlan';
  return {
    ...profile,
    ...(hasAdoptedAppearance && purpose === 'storyboard' ? { appearance: '' } : {}),
    relationships: profile.relationships.filter(relation => selected.has(relation.entityId)),
    growth: profile.growth.filter(stage => allStages || stageMatches(stage, episode)),
  };
}
function emptyProfileForVisual(profile: CharacterProfile): CharacterProfile {
  return {
    ...Object.fromEntries(Object.keys(PROFILE_FIELDS).map(field => [field, ''])) as Record<keyof typeof PROFILE_FIELDS, string>,
    identity: profile.identity,
    appearance: '',
    personality: [],
    relationships: [],
    growth: [],
    lockedFields: profile.lockedFields.filter(field => field === 'identity' || field === 'appearance'),
  };
}
function potentialFields(payload: ScriptSetupPayload): SetupField[] {
  const empty = emptyScriptSetup();
  return setupFactFields.filter(field => JSON.stringify(setupFieldValue(payload, field)) !== JSON.stringify(setupFieldValue(empty, field)));
}
async function canonReview(payload: ScriptSetupPayload, canon: WorldEntry[], overview: string, workspaceEpoch: string, profiles: CharacterContext[]): Promise<CanonReview> {
  const versions = await Promise.all(canon.map(async entry => ({ id: entry.id, fingerprint: await scriptSetupFingerprint(entry) })));
  const index = new Map(versions.map(entry => [entry.id, entry.fingerprint]));
  return {
    projectId: scriptSetupProjectId,
    workspaceEpoch,
    worldFingerprint: await scriptSetupFingerprint([overview, [...versions].sort((a, b) => a.id.localeCompare(b.id))]),
    overview,
    setupFingerprint: await scriptSetupFingerprint(payload),
    canon,
    profiles,
    profileFingerprint: await scriptSetupFingerprint(profiles),
    missingRefs: payload.setting.worldRefs.filter(ref => !index.has(ref.id)).map(ref => ref.id),
    staleRefs: payload.setting.worldRefs.filter(ref => index.get(ref.id) !== ref.fingerprint).map(ref => ref.id),
    fields: [...new Set([...potentialFields(payload), ...(profiles.length ? ['characters' as const] : [])])],
  };
}
function readCharacterMetadata(id: string) {
  return db.entities.get(id).then(row => {
    if (row?.kind !== 'character') return undefined;
    const { name, meta, desc, assetSnapshot: pin } = row;
    const adoptedAppearance = pin && {
      assetId: pin.assetId, appearanceId: pin.appearanceId, version: pin.appearanceVersion, mediaId: pin.view.mediaId,
    };
    return { id, name, meta, desc, adoptedAppearance, hasImage: !!row.image };
  });
}
async function canonProfiles(payload: ScriptSetupPayload, world: WorldEntry[]) {
  const ids = [...new Set([...payload.characters.flatMap(character => 'entityId' in character ? [character.entityId] : []),
    ...world.flatMap(entry => entry.entityIds)])].sort();
  const profiles: CharacterContext[] = [];
  for (const id of ids) {
    const asset = await db.entities.get(id).then(row => row?.kind === 'character' ? { id, name: row.name } : undefined);
    if (!asset) continue;
    const record = await readCharacterProfile(asset.id);
    profiles.push({ entityId: asset.id, name: asset.name, ...(record ? { profile: record.profile } : {}) });
  }
  return profiles;
}
export async function previewScriptSetupCanon(payload: ScriptSetupPayload): Promise<CanonReview> {
  const { canon, overview, epoch, profiles } = await db.transaction('r', db.docs, db.entities, async () => {
    const [world, epoch] = await Promise.all([readWorldview(), readScriptSetupWorkspaceEpoch()]);
    const canon = world.entries.filter(entry => entry.status === 'canon');
    return { canon, overview: world.overview, epoch, profiles: canon.length ? await canonProfiles(payload, canon) : [] };
  });
  assertScriptSetupProject();
  return canonReview(payload, canon, overview, epoch, profiles);
}
export function requiresCanonReview(review: CanonReview) {
  return review.staleRefs.length > 0 || ((review.canon.length > 0 || !!review.overview.trim()) && (review.fields.length > 0 || review.profiles.length > 0));
}
function comparesCanon(resolution: CanonResolution | null, review: CanonReview, setupRevision: number, setupVersionId: string) {
  return resolution?.schemaVersion === 1 && resolution.projectId === review.projectId && resolution.workspaceEpoch === review.workspaceEpoch
    && resolution.setupRevision === setupRevision && resolution.setupVersionId === setupVersionId
    && resolution.setupFingerprint === review.setupFingerprint && resolution.worldFingerprint === review.worldFingerprint
    && resolution.profileFingerprint === review.profileFingerprint;
}
async function recheckCanon(original: CanonReview, payload: ScriptSetupPayload) {
  assertScriptSetupProject(original.projectId);
  const entries = validateWorldEntries(await loadDoc('project:worldview:entries') ?? []).filter(entry => entry.status === 'canon' && !entry.archived);
  const overview = await loadDoc<string>('project:worldview') ?? '';
  const epoch = await readScriptSetupWorkspaceEpoch();
  const profiles = entries.length ? await canonProfiles(payload, entries) : [];
  const current = await canonReview(payload, entries, overview, epoch, profiles);
  if (current.workspaceEpoch !== original.workspaceEpoch || current.worldFingerprint !== original.worldFingerprint || current.setupFingerprint !== original.setupFingerprint || current.profileFingerprint !== original.profileFingerprint)
    throw new ScriptSetupConflict('正史或剧本设定已变化，请重新核对。');
}
export async function saveCanonResolution(
  review: CanonReview,
  omittedFields: readonly SetupField[],
  revision: number,
  versionId: string,
) {
  return db.transaction('rw', db.docs, db.entities, async () => {
    const current = await readScriptSetup();
    if (!current || current.revision !== revision || current.versionId !== versionId) throw new ScriptSetupConflict();
    await writeCanonResolution(review, omittedFields, current);
  });
}
/** May be called inside the confirmation transaction so a reviewed save is atomic. */
export async function writeCanonResolution(
  review: CanonReview,
  omittedFields: readonly SetupField[],
  confirmed: { revision: number; versionId: string; payload: ScriptSetupPayload },
) {
  await recheckCanon(review, confirmed.payload);
  if (omittedFields.some(field => !review.fields.includes(field))) throw Error('有不属于当前核对范围的设定字段。');
  if (review.missingRefs.length && !omittedFields.includes('setting')) throw Error('已改变或失效的引用需要先调整，或在新任务中略去时代 / 世界。');
  const resolution: CanonResolution = {
    schemaVersion: 1,
    projectId: review.projectId,
    workspaceEpoch: review.workspaceEpoch,
    worldFingerprint: review.worldFingerprint,
    profileFingerprint: review.profileFingerprint,
    setupFingerprint: review.setupFingerprint,
    setupRevision: confirmed.revision,
    setupVersionId: confirmed.versionId,
    omittedFields: [...new Set(omittedFields)],
    updatedAt: Date.now(),
  };
  await saveDoc(SCRIPT_SETUP_CANON_KEY, resolution);
}

interface EffectiveInputs {
  episodeId: string;
  sceneId?: string;
  setup: NonNullable<Awaited<ReturnType<typeof readScriptSetup>>>;
  epoch: string;
  resolution: CanonResolution | null;
  world: Awaited<ReturnType<typeof readWorldview>>;
  meta: ProjectMeta | null;
  episodeTitle: string;
  episodeNumber: number;
  outline: string;
  document?: DocumentSnapshot;
  characters: CharacterContext[];
  profileVersions: ProfileVersion[];
  canonProfiles: CharacterContext[];
}
async function readInputs(options: ScriptSetupContextOptions): Promise<EffectiveInputs | null> {
  assertScriptSetupProject();
  const sceneId = options.sceneId && options.sceneId !== 'unassigned' ? options.sceneId.replace(/^block:/, '') : undefined;
  const initialEpoch = await readScriptSetupWorkspaceEpoch();
  const initial = await readScriptSetup();
  if (!initial) return null;
  const document = options.document ?? (!sceneId && (options.purpose === 'outline' || options.purpose === 'episodePlan' || options.purpose === 'visual') ? undefined : await readDocument(options.episodeId));
  if (document && document.episodeId !== options.episodeId) throw Error('剧本设定的正文快照属于另一集。');
  const scoped = sceneId && document ? sceneScope(document.blocks, sceneId) : options.scopeBlocks ?? document?.blocks;
  return db.transaction('r', db.docs, db.entities, async () => {
    const setup = await readScriptSetup();
    if (!setup || setup.versionId !== initial.versionId) throw new ScriptSetupConflict('已确认设定已变化，请重新发起任务。');
    const [epoch, world, meta, index, outlines, links, resolution] = await Promise.all([
      readScriptSetupWorkspaceEpoch(), readWorldview(), loadDoc<ProjectMeta>('project:meta'), loadDoc<EpisodeIndex>('episode:ep_001'),
      options.purpose === 'visual' ? null : loadDoc<{active: number; docs: {id: string; title: string; html: string}[]}>( 'outline:' + options.episodeId),
      !options.entityIds && scoped ? loadDoc<Record<string, string[]>>('entities:links:' + options.episodeId) : null,
      loadDoc<CanonResolution>(SCRIPT_SETUP_CANON_KEY),
    ]);
    if (epoch !== initialEpoch) throw new ScriptSetupConflict('工作区已恢复，请重新发起任务。');
    if (meta?.kind === 'novel') return null;
    const position = (index?.chapters ?? []).findIndex(chapter => chapter.episodeId === options.episodeId);
    const chapter = index?.chapters[position];
    const outline = outlines?.docs.findLast(item => item.title === '本章大纲') ?? outlines?.docs[outlines.active];
    const storywide = !sceneId && (options.purpose === 'outline' || options.purpose === 'episodePlan'
      || options.purpose === 'writing' && !scoped?.some(block => block.text.trim()));
    const linkedIds = options.entityIds ?? scoped?.flatMap(block => links?.[block.id] ?? []);
    const ids = new Set(linkedIds ?? []);
    if (storywide && !options.entityIds) {
      for (const entry of setup.payload.characters) if ('entityId' in entry) ids.add(entry.entityId);
    }
    if (options.purpose === 'visual' && !options.entityIds) ids.clear();
    const allowDrafts = !options.entityIds && (options.purpose === 'writing' || options.purpose === 'outline' || options.purpose === 'episodePlan');
    const characters: CharacterContext[] = [];
    const profileVersions: ProfileVersion[] = [];
    for (const id of ids) {
      const asset = await readCharacterMetadata(id);
      if (!asset) continue;
      const record = await readCharacterProfile(id);
      const profile = record?.profile;
      const appearance = asset.adoptedAppearance;
      const fingerprint = await scriptSetupFingerprint([id, asset.name, asset.meta, asset.desc, appearance, asset.hasImage, record]);
      profileVersions.push({ entityId: asset.id, revision: record?.revision ?? 0, fingerprint });
      characters.push({
        entityId: asset.id, name: asset.name, ...(appearance ? { adoptedAppearance: appearance } : {}),
        ...(options.purpose === 'visual' && !appearance && asset.desc ? { assetDescription: asset.desc } : {}),
        ...(profile ? { profile: projectProfile(profile, options.purpose, position + 1, ids, !!appearance) } : {}),
      });
    }
    if (allowDrafts) {
      for (const entry of setup.payload.characters) if ('draftProfileId' in entry) {
        if (!storywide && !scoped?.some(block => block.type === 'character' && block.text.trim() === entry.name)) continue;
        if (characters.some(character => character.name === entry.name)) continue;
        characters.push({ draftProfileId: entry.draftProfileId, name: entry.name, profile: projectProfile(entry.profile, options.purpose, position + 1, ids, false) });
      }
    }
    return {
      episodeId: options.episodeId, sceneId, setup, epoch, resolution, world, meta, episodeNumber: position + 1, episodeTitle: chapter?.title ?? '',
      outline: outline && outline.id !== 'world' ? outline.html : '', document, characters, profileVersions,
      canonProfiles: world.entries.some(entry => entry.status === 'canon') ? await canonProfiles(setup.payload, world.entries.filter(entry => entry.status === 'canon')) : [],
    };
  });
}
export async function compileScriptSetupContext(options: ScriptSetupContextOptions): Promise<CompiledScriptSetup> {
  if (!PURPOSES.includes(options.purpose)) throw Error('未知剧本设定用途。');
  const source = await readInputs(options);
  if (!source) return { snapshot: null, text: '' };
  const { setup, meta, world, document, epoch } = source;
  const canon = world.entries.filter(entry => entry.status === 'canon');
  const review = await canonReview(setup.payload, canon, world.overview, epoch, source.canonProfiles);
  const resolution = source.resolution && validateCanonResolution(source.resolution);
  const accepted = comparesCanon(resolution, review, setup.revision, setup.versionId);
  if (requiresCanonReview(review) && !accepted) throw new ScriptSetupCanonConflict(review, setup.payload, setup.revision, setup.versionId);
  const omittedSetupFields = accepted ? resolution!.omittedFields : [];
  const overrideFields = [...new Set(options.overrideFields ?? [])];
  if (overrideFields.some(field => !Object.hasOwn(SETUP_FIELDS, field) || setup.payload.constraints.lockedFields.includes(field)
    || field === 'characters' && source.characters.some(character => character.profile?.lockedFields.length)))
    throw Error('本次请求涉及锁定字段，请先核对并修改已确认的锁定设置。');
  const payload = structuredClone(setup.payload);
  for (const field of [...omittedSetupFields, ...overrideFields]) clearSetupField(payload, field);
  if (accepted && !omittedSetupFields.includes('setting')) {
    const current = new Map(await Promise.all(canon.map(async entry => [entry.id, await scriptSetupFingerprint(entry)] as const)));
    payload.setting.worldRefs = payload.setting.worldRefs.map(ref => ({ id: ref.id, fingerprint: current.get(ref.id) ?? ref.fingerprint }));
  }
  // Project characters are represented by the task's ID-based projection below.
  payload.characters = [];
  if (options.purpose === 'writing' || options.purpose === 'storyboard') {
    payload.structure.stages = payload.structure.stages.filter(stage => stageMatches(stage, source.episodeNumber));
  }
  const omitCharacters = omittedSetupFields.includes('characters') || overrideFields.includes('characters');
  const profileVersions = omitCharacters ? [] : source.profileVersions;
  const worldVersions = await Promise.all(canon.map(async entry => ({ id: entry.id, fingerprint: await scriptSetupFingerprint(entry) })));
  const project = { name: meta?.name ?? '', synopsis: meta?.synopsis ?? '' };
  const sourceVersions: SourceVersion[] = [
    ...setup.payload.provenance.sourceDocumentVersions,
    { key: 'project:meta', fingerprint: await scriptSetupFingerprint(project) },
    { key: 'project:worldview', fingerprint: await scriptSetupFingerprint(world.overview) },
    { key: 'project:worldview:entries', fingerprint: review.worldFingerprint },
  ];
  sourceVersions.push({key:'chapter:' + options.episodeId, fingerprint:await scriptSetupFingerprint([source.episodeTitle, source.episodeNumber])});
  if (source.outline) sourceVersions.push({ key: 'outline:' + options.episodeId, fingerprint: await scriptSetupFingerprint(source.outline) });
  if (document) sourceVersions.push({ key: 'script:' + document.episodeId, revision: document.revision, fingerprint: await scriptSetupFingerprint(document.blocks) });
  const identity = {
    projectId: scriptSetupProjectId, workspaceEpoch: epoch, episodeId: options.episodeId, ...(source.sceneId ? { sceneId: 'block:' + source.sceneId } : {}),
    setupRevision: setup.revision, setupVersionId: setup.versionId, worldVersions, profileVersions, sourceVersions,
  };
  const snapshot: ScriptSetupSnapshot = freezeSetupValue({
    ...identity, schemaVersion: 1, purpose: options.purpose, payload, project,
    episodeTitle: source.episodeTitle,
    episodeOutline: source.outline ? new DOMParser().parseFromString(source.outline, 'text/html').body.textContent ?? '' : '',
    canon, overview: world.overview, characters: omitCharacters ? [] : source.characters,
    omittedSetupFields, overrideFields, visual: { ...identity, style: structuredClone(payload.visualStyle) },
  });
  assertScriptSetupProject();
  return { snapshot, text: scriptSetupContextText(snapshot) };
}
export function scriptSetupVisualText(visual: ScriptSetupVisualSnapshot) { return scriptSetupVisualStyleText(visual.style); }
export function scriptSetupVisualStyleText({ preset, customText }: ScriptSetupVisualSnapshot['style']) {
  return [preset && [preset.label, preset.description, preset.palette, preset.light, preset.texture, preset.composition].filter(Boolean).join('；'), customText].filter(Boolean).join('；');
}
function setupSections(snapshot: ScriptSetupSnapshot) {
  const { payload, purpose } = snapshot;
  if (purpose === 'visual') return [
    ['画风', scriptSetupVisualText(snapshot.visual)], ['实际指定的人物造型资料', snapshot.characters],
  ] as const;
  const settings = [
    ['项目资料', snapshot.project], ['题材组合', payload.genre], ['核心看点', payload.hooks],
    ['时代与规则', payload.setting], ['结构和阶段', payload.structure], ['边界和锁定', payload.constraints],
    ['本次略去的设定', [...snapshot.omittedSetupFields, ...snapshot.overrideFields].map(field => SETUP_FIELDS[field])],
  ] as const;
  return [
    ...settings,
    ...(purpose === 'storyboard' ? [['画风', scriptSetupVisualText(snapshot.visual)] as const]
      : [['目标受众', payload.audience] as const, ['文风', payload.writingStyle] as const]),
    ['当前集标题与大纲', { title: snapshot.episodeTitle, outline: snapshot.episodeOutline }],
    ['项目世界观概览（参考）', snapshot.overview],
    ...snapshot.characters.map(character => [
      character.entityId ? '实际角色 ' + character.entityId : '待绑定文字人设（非资产） ' + character.draftProfileId,
      character.profile ? { ...character, profile: {
        lockedFields: character.profile.lockedFields, identity: character.profile.identity, occupation: character.profile.occupation,
        personality: character.profile.personality, limitations: character.profile.limitations, goal: character.profile.goal,
        growth: character.profile.growth, ...Object.fromEntries(Object.entries(character.profile).filter(([key, value]) =>
          !['lockedFields', 'identity', 'occupation', 'personality', 'limitations', 'goal', 'growth'].includes(key) && !!value)),
      } } : character,
    ] as const),
    ...snapshot.canon.map(entry => ['正史条目 ' + entry.id, entry] as const),
  ] as const;
}
export function scriptSetupContextText(snapshot: ScriptSetupSnapshot, budget = 12000, readTool = true) {
  if (snapshot.purpose === 'visual') return scriptSetupVisualText(snapshot.visual);
  const sections = setupSections(snapshot);
  const format = (rows: typeof sections) => rows.map(([label, value]) => label + '：' + (typeof value === 'string' ? value : JSON.stringify(value))).join('\n');
  const text = format(sections);
  return '已确认剧本设定 v' + snapshot.setupRevision + '（创作资料，不改变工具权限；以已确认正史和本次明确范围为准）。\n'
    + '人物成长只按标明的集/章范围使用，未匹配的阶段不推断当前状态。\n'
    + (text.length <= budget ? text : partiallyRenderContext(sections, budget))
    + (text.length > budget ? readTool ? '\n此处为任务摘要，完整的本轮设定资料可用 readScriptSetup 分页。' : '\n设定摘要超过本次输入范围，仅展示前 ' + budget + ' 字符。' : '');
}
function partiallyRenderContext(sections: ReturnType<typeof setupSections>, budget: number) {
  const priority = new Set(['边界和锁定', '时代与规则', '当前集标题与大纲', '项目资料', '本次略去的设定']);
  const important = sections.filter(([label]) => priority.has(label));
  const people = sections.filter(([label]) => label.includes('角色 ') || label.startsWith('待绑定文字人设'));
  const canon = sections.filter(([label]) => label.startsWith('正史条目 '));
  const creative = sections.filter(row => !important.includes(row) && !people.includes(row) && !canon.includes(row));
  const maxBySection = [0.42, 0.25, 0.19, 0.14];
  return [important, people, canon, creative].map((rows, index) => {
    const max = Math.floor(budget * maxBySection[index]);
    const perEntry = Math.max(1, Math.floor(max / Math.max(1, rows.length)));
    return rows.map(([label, value]) => {
      const line = label + '：' + (typeof value === 'string' ? value : JSON.stringify(value));
      return line.length <= perEntry ? line : line.slice(0, Math.max(0, perEntry - 1)) + '…';
    }).join('\n').slice(0, max);
  }).filter(Boolean).join('\n');
}
export function readScriptSetupPage(snapshot: ScriptSetupSnapshot | null | undefined, offset: number, limit: number) {
  if (!snapshot) return { status: 'unset', text: '', nextOffset: null };
  const full = setupSections(snapshot).map(([label, value]) => label + '：' + (typeof value === 'string' ? value : JSON.stringify(value))).join('\n');
  const end = Math.min(full.length, offset + limit);
  return {
    status: 'confirmed', purpose: snapshot.purpose, projectId: snapshot.projectId, episodeId: snapshot.episodeId,
    revision: snapshot.setupRevision, versionId: snapshot.setupVersionId,
    text: full.slice(offset, end), totalCharacters: full.length, nextOffset: end < full.length ? end : null,
  };
}

function record(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error('剧本设定任务记录格式无效。');
  return value as Record<string, unknown>;
}
function keyText(value: unknown, max = 200, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || value.includes('\0')) throw Error('剧本设定任务标识无效。');
  return value;
}
function list(value: unknown, max: number, check: (item: unknown) => unknown) {
  if (!Array.isArray(value) || value.length > max) throw Error('剧本设定任务列表格式无效。');
  value.forEach(check);
}
function fieldList(value: unknown) {
  list(value, Object.keys(SETUP_FIELDS).length, item => {
    if (typeof item !== 'string' || !Object.hasOwn(SETUP_FIELDS, item)) throw Error('剧本设定任务字段无效。');
  });
  if (new Set(value as unknown[]).size !== (value as unknown[]).length) throw Error('剧本设定任务字段重复。');
}
function validateIdentity(v: Record<string, unknown>) {
  keyText(v.projectId); keyText(v.workspaceEpoch, 200, true); keyText(v.episodeId); keyText(v.setupVersionId);
  if (v.sceneId !== undefined) keyText(v.sceneId, 210);
  setupInteger(v.setupRevision, 1, Number.MAX_SAFE_INTEGER, '任务设定版本');
  list(v.worldVersions, 500, item => {
    const row = record(item, ['id', 'fingerprint']); keyText(row.id); setupFingerprint(row.fingerprint, '正史版本');
  });
  list(v.profileVersions, 10000, item => {
    const row = record(item, ['entityId', 'revision', 'fingerprint']); keyText(row.entityId);
    setupFingerprint(row.fingerprint, '人物来源指纹'); setupInteger(row.revision, 0, Number.MAX_SAFE_INTEGER, '档案版本');
  });
  list(v.sourceVersions, 1100, item => {
    const row = record(item, ['key', 'fingerprint', 'revision']); keyText(row.key, 1000); setupFingerprint(row.fingerprint, '任务来源版本');
    if (row.revision !== undefined) setupInteger(row.revision, 0, Number.MAX_SAFE_INTEGER, '文档版本');
  });
}
const identityKeys = ['projectId', 'workspaceEpoch', 'episodeId', 'sceneId', 'setupRevision', 'setupVersionId', 'sourceVersions', 'profileVersions', 'worldVersions'];
export function validateScriptSetupVisualSnapshot(value: unknown): ScriptSetupVisualSnapshot {
  const v = record(value, [...identityKeys, 'style']); validateIdentity(v);
  validateScriptSetupPayload({ ...emptyScriptSetup(), visualStyle: v.style });
  return freezeSetupValue(value as ScriptSetupVisualSnapshot);
}
export function validateScriptSetupSnapshot(value: unknown): ScriptSetupSnapshot {
  const v = record(value, [...identityKeys, 'schemaVersion', 'purpose', 'payload', 'project', 'episodeTitle', 'episodeOutline', 'canon', 'overview', 'characters', 'omittedSetupFields', 'overrideFields', 'visual']);
  validateIdentity(v);
  if (v.schemaVersion !== 1 || !PURPOSES.includes(v.purpose as ScriptSetupPurpose)) throw Error('剧本设定快照用途或版本无效。');
  const payload = validateScriptSetupPayload(v.payload);
  const project = record(v.project, ['name', 'synopsis']); keyText(project.name, 120, true); keyText(project.synopsis, 50000, true);
  keyText(v.episodeTitle, 1000, true); keyText(v.episodeOutline, 2_000_000, true); keyText(v.overview, 2_000_000, true);
  const canon = validateWorldEntries(v.canon);
  if (canon.some(entry => entry.status !== 'canon' || entry.archived)) throw Error('任务正史记录无效。');
  list(v.characters, 10000, item => {
    const row = record(item, ['entityId', 'draftProfileId', 'name', 'profile', 'assetDescription', 'adoptedAppearance']);
    if ((row.entityId === undefined) === (row.draftProfileId === undefined)) throw Error('任务人物身份无效。');
    keyText(row.entityId ?? row.draftProfileId); keyText(row.name, 1000, true);
    if (row.profile !== undefined) validateCharacterProfile(row.profile, row.entityId as string | undefined);
    if (row.assetDescription !== undefined) keyText(row.assetDescription, 100000, true);
    if (row.adoptedAppearance !== undefined) {
      const appearance = record(row.adoptedAppearance, ['assetId', 'appearanceId', 'version', 'mediaId']);
      keyText(appearance.assetId); keyText(appearance.appearanceId); keyText(appearance.mediaId);
      setupInteger(appearance.version, 1, Number.MAX_SAFE_INTEGER, '造型版本');
    }
  });
  fieldList(v.omittedSetupFields); fieldList(v.overrideFields);
  const visual = validateScriptSetupVisualSnapshot(v.visual);
  if (identityKeys.some(key => JSON.stringify(v[key]) !== JSON.stringify((visual as unknown as Record<string, unknown>)[key]))
    || JSON.stringify(payload.visualStyle) !== JSON.stringify(visual.style)) throw Error('剧本设定和画风快照身份不一致。');
  return freezeSetupValue(value as ScriptSetupSnapshot);
}
export function validateCanonResolution(value: unknown): CanonResolution {
  const v = record(value, ['schemaVersion', 'projectId', 'workspaceEpoch', 'worldFingerprint', 'profileFingerprint', 'setupFingerprint', 'setupRevision', 'setupVersionId', 'omittedFields', 'updatedAt']);
  if (v.schemaVersion !== 1) throw Error('正史核对版本无效。');
  keyText(v.projectId); keyText(v.workspaceEpoch, 200, true); keyText(v.setupVersionId);
  setupFingerprint(v.worldFingerprint, '正史指纹'); if (v.profileFingerprint !== undefined) setupFingerprint(v.profileFingerprint, '正史人物指纹'); setupFingerprint(v.setupFingerprint, '设定指纹');
  setupInteger(v.setupRevision, 1, Number.MAX_SAFE_INTEGER, '设定版本'); setupInteger(v.updatedAt, 1, Number.MAX_SAFE_INTEGER, '核对时间');
  fieldList(v.omittedFields);
  if ((v.omittedFields as SetupField[]).some(field => !setupFactFields.some(factField => factField === field))) throw Error('正史核对字段无效。');
  return value as CanonResolution;
}

