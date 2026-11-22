import { writingStyles } from '../writing/styles';

export const SCRIPT_SETUP_SCHEMA = 1;
export const SETUP_FIELDS = {
  genre: '题材组合', audience: '目标受众', characters: '角色设定', setting: '时代 / 世界',
  hooks: '核心看点', visualStyle: '画面风格', writingStyle: '文风',
  structure: '剧本结构', mustKeep: '必须保留', mustAvoid: '必须避免',
} as const;
export type SetupField = keyof typeof SETUP_FIELDS;
export interface ChoiceSnapshot { id: string; label: string; description?: string }
export interface GenreChoice extends ChoiceSnapshot { subtype?: ChoiceSnapshot }
export interface StoryHook extends ChoiceSnapshot { dimension: 'direction' | 'highlight' }
export interface GrowthStage { title: string; scope: string; state: string }
export interface CharacterRelationship { entityId: string; behavior: string }
export const PROFILE_FIELDS = {
  identity: '身份', occupation: '职业', speech: '说话方式', habits: '习惯动作',
  appearance: '外貌与识别特征', abilities: '专长与能力', limitations: '弱点与知识边界',
  motives: '动机与恐惧', values: '价值观与底线', goal: '目标',
  everyday: '平时表现', underPressure: '压力下表现',
} as const;
export type ProfileField = keyof typeof PROFILE_FIELDS;
export type ProfileLock = ProfileField | 'personality' | 'relationships' | 'growth';
export type CharacterProfile = Record<ProfileField, string> & {
  personality: ChoiceSnapshot[]; relationships: CharacterRelationship[]; growth: GrowthStage[]; lockedFields: ProfileLock[];
};
export interface BoundCharacter { entityId: string; profileRevision: number }
export interface UnboundCharacter { draftProfileId: string; name: string; profile: CharacterProfile }
export type SetupCharacter = BoundCharacter | UnboundCharacter;
export interface CharacterEdit {
  entityId: string; expectedRevision: number; expectedEntityFingerprint: string; profile: CharacterProfile;
}
export interface WorldRef { id: string; fingerprint: string }
export interface MechanismChoice extends ChoiceSnapshot { rules: string }
export interface ScriptSetupVisualStyle {
  preset?: ChoiceSnapshot & { palette: string; light: string; texture: string; composition: string };
  customText: string; referenceMediaId?: string;
}
export interface ScriptSetupPayload {
  genre: { primary?: GenreChoice; secondary?: GenreChoice; fusionNote: string; catalogRevision: number };
  audience: { choices: ChoiceSnapshot[]; language: string; accessibility: string };
  characters: SetupCharacter[];
  setting: {
    mainEra: string; place: string; worldRules: string; worldRefs: WorldRef[];
    mechanisms: MechanismChoice[]; originEra: string; transition: string;
  };
  hooks: StoryHook[];
  visualStyle: ScriptSetupVisualStyle;
  writingStyle: string;
  structure: { episodeCount?: number; episodeDuration?: number; pattern: string; stages: GrowthStage[] };
  constraints: { mustKeep: string[]; mustAvoid: string[]; lockedFields: SetupField[] };
  provenance: { kind: 'user' | 'extracted'; sourceDocumentVersions: { key: string; fingerprint: string }[] };
}
export type SetupStatus = 'draft' | 'confirmed';
export interface ScriptSetupRecord {
  schemaVersion: 1; revision: number; versionId: string; updatedAt: number; status: SetupStatus;
  payload: ScriptSetupPayload; characterEdits?: CharacterEdit[]; restoredFrom?: number;
}
export interface CharacterProfileRecord {
  schemaVersion: 1; entityId: string; revision: number; updatedAt: number;
  entityFingerprint: string; profile: CharacterProfile;
}

export function emptyCharacterProfile(): CharacterProfile {
  const fields = Object.fromEntries(Object.keys(PROFILE_FIELDS).map(key => [key, ''])) as Record<ProfileField, string>;
  return { ...fields, personality: [], relationships: [], growth: [], lockedFields: [] };
}
export function emptyScriptSetup(): ScriptSetupPayload {
  return {
    genre: { fusionNote: '', catalogRevision: 1 }, audience: { choices: [], language: '', accessibility: '' }, characters: [],
    setting: { mainEra: '', place: '', worldRules: '', worldRefs: [], mechanisms: [], originEra: '', transition: '' },
    hooks: [], visualStyle: { customText: '' }, writingStyle: 'inherit', structure: { pattern: '', stages: [] },
    constraints: { mustKeep: [], mustAvoid: [], lockedFields: [] }, provenance: { kind: 'user', sourceDocumentVersions: [] },
  };
}

function bad(label: string): never { throw Error(`剧本设定：${label}格式不正确或超过限制`); }
function object(value: unknown, label: string, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad(label);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !Object.hasOwn(v, key))) return bad(label);
  return v;
}
function txt(value: unknown, limit: number, label: string, required = false) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > limit || (required && !value.trim())) return bad(label);
  return value;
}
function identifier(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[\w-]{1,160}$/.test(value)) return bad(label);
  return value;
}
export function setupFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) return bad(label);
  return value;
}
export function setupInteger(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return bad(label);
  return value;
}
function array(value: unknown, max: number, label: string, validate: (v: unknown) => unknown, unique = false) {
  if (!Array.isArray(value) || value.length > max) return bad(label);
  const seen = new Set<unknown>();
  for (const entry of value) { const identity = validate(entry); if (unique && seen.has(identity)) return bad(label); seen.add(identity); }
}
function oneOf(value: unknown, choices: readonly string[], label: string) {
  if (typeof value !== 'string' || !choices.includes(value)) return bad(label);
  return value;
}
const choiceKeys = ['id', 'label'];
function choice(value: unknown, label: string, extra: string[] = [], optional: string[] = []) {
  const v = object(value, label, [...choiceKeys, ...extra], ['description', ...optional]);
  identifier(v.id, label); txt(v.label, 120, label, true);
  if (Object.hasOwn(v, 'description')) txt(v.description, 1200, label);
  return v;
}
function genre(value: unknown) {
  const v = choice(value, '题材', [], ['subtype']);
  if (Object.hasOwn(v, 'subtype')) {
    const sub = choice(v.subtype, '细分题材');
    if (sub.id === v.id || !String(sub.id).startsWith(`${v.id}-`)) bad('细分题材归属');
  }
  return v.id;
}
function stage(value: unknown) {
  const v = object(value, '阶段', ['title', 'scope', 'state']);
  txt(v.title, 120, '阶段名称', true); txt(v.scope, 600, '阶段范围'); txt(v.state, 3000, '阶段说明');
}
export function validateCharacterProfile(value: unknown, selfId?: string): CharacterProfile {
  const fields = Object.keys(PROFILE_FIELDS);
  const v = object(value, '人物档案', [...fields, 'personality', 'relationships', 'growth', 'lockedFields']);
  for (const key of fields) txt(v[key], 3000, PROFILE_FIELDS[key as ProfileField]);
  array(v.personality, 5, '核心性格（每人最多 5 项）', item => choice(item, '性格').id, true);
  array(v.relationships, 100, '人物关系', entry => {
    const r = object(entry, '人物关系', ['entityId', 'behavior']);
    if (r.entityId === selfId) bad('人物不能与自己建立关系');
    txt(r.behavior, 3000, '关系表现'); return identifier(r.entityId, '关系人物 ID');
  }, true);
  array(v.growth, 40, '人物成长', stage);
  array(v.lockedFields, fields.length + 3, '人物锁定字段', field => oneOf(field, [...fields, 'personality', 'relationships', 'growth'], '人物锁定字段'), true);
  return value as CharacterProfile;
}
export const ordinaryMechanisms = ['amnesia', 'dual-timeline'];
export function validateScriptSetupPayload(value: unknown): ScriptSetupPayload {
  const v = object(value, '设定', ['genre', 'audience', 'characters', 'setting', 'hooks', 'visualStyle', 'writingStyle', 'structure', 'constraints', 'provenance']);
  const g = object(v.genre, '题材组合', ['fusionNote', 'catalogRevision'], ['primary', 'secondary']);
  txt(g.fusionNote, 3000, '融合说明'); setupInteger(g.catalogRevision, 1, Number.MAX_SAFE_INTEGER, '目录版本');
  const primary = Object.hasOwn(g, 'primary') ? genre(g.primary) : undefined;
  if (Object.hasOwn(g, 'secondary') && (!primary || genre(g.secondary) === primary)) bad('请先选主题材，并选择不同的融合题材');
  const a = object(v.audience, '受众', ['choices', 'language', 'accessibility']);
  array(a.choices, 2, '受众（最多 2 项）', item => choice(item, '受众').id, true);
  txt(a.language, 120, '语言'); txt(a.accessibility, 1000, '叙事理解度');
  array(v.characters, 200, '人物列表', entry => {
    if (entry && typeof entry === 'object' && Object.hasOwn(entry, 'entityId')) {
      const c = object(entry, '已绑定人物', ['entityId', 'profileRevision']);
      setupInteger(c.profileRevision, 0, Number.MAX_SAFE_INTEGER, '人物档案版本'); return `entity:${identifier(c.entityId, '人物 ID')}`;
    }
    const c = object(entry, '待绑定人物', ['draftProfileId', 'name', 'profile']);
    txt(c.name, 120, '待绑定人物名称'); validateCharacterProfile(c.profile); return `draft:${identifier(c.draftProfileId, '人设草稿 ID')}`;
  }, true);
  const s = object(v.setting, '时代与世界', ['mainEra', 'place', 'worldRules', 'worldRefs', 'mechanisms', 'originEra', 'transition']);
  for (const key of ['mainEra', 'place', 'originEra']) txt(s[key], 200, key);
  txt(s.worldRules, 12000, '世界规则'); txt(s.transition, 3000, '跨时空关系');
  array(s.worldRefs, 100, '世界观引用', entry => {
    const ref = object(entry, '世界观引用', ['id', 'fingerprint']); setupFingerprint(ref.fingerprint, '世界规则指纹'); return identifier(ref.id, '世界规则 ID');
  }, true);
  array(s.mechanisms, 24, '叙事机制', item => { const m = choice(item, '叙事机制', ['rules']); txt(m.rules, 4000, '机制规则'); return m.id; }, true);
  const ids = (s.mechanisms as MechanismChoice[]).map(m => m.id);
  if (ids.includes('none-supernatural') && ids.some(id => id !== 'none-supernatural' && !ordinaryMechanisms.includes(id))) bad('无超自然机制与所选超自然机制冲突');
  array(v.hooks, 3, '核心看点（最多 3 项）', item => {
    const h = choice(item, '核心看点', ['dimension']); oneOf(h.dimension, ['direction', 'highlight'], '看点分类'); return h.id;
  }, true);
  const visual = object(v.visualStyle, '画风', ['customText'], ['preset', 'referenceMediaId']);
  txt(visual.customText, 4000, '画风补充');
  if (Object.hasOwn(visual, 'preset')) {
    const preset = choice(visual.preset, '画风预设', ['palette', 'light', 'texture', 'composition']);
    for (const key of ['palette', 'light', 'texture', 'composition']) txt(preset[key], 600, '画风说明', true);
  }
  if (Object.hasOwn(visual, 'referenceMediaId') && (typeof visual.referenceMediaId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(visual.referenceMediaId))) bad('画风参考原图');
  oneOf(v.writingStyle, ['inherit', ...writingStyles.map(style => style.id)], '文风');
  const st = object(v.structure, '剧本结构', ['pattern', 'stages'], ['episodeCount', 'episodeDuration']);
  if (Object.hasOwn(st, 'episodeCount')) setupInteger(st.episodeCount, 1, 200, '集数（1–200）');
  if (Object.hasOwn(st, 'episodeDuration')) setupInteger(st.episodeDuration, 1, 86400, '每集目标时长');
  txt(st.pattern, 200, '结构模板'); array(st.stages, 40, '剧本阶段', stage);
  const c = object(v.constraints, '创作边界', ['mustKeep', 'mustAvoid', 'lockedFields']);
  for (const key of ['mustKeep', 'mustAvoid']) array(c[key], 80, key, line => txt(line, 3000, key, true), true);
  array(c.lockedFields, Object.keys(SETUP_FIELDS).length, '锁定字段', key => oneOf(key, Object.keys(SETUP_FIELDS), '锁定字段'), true);
  const p = object(v.provenance, '来源', ['kind', 'sourceDocumentVersions']);
  oneOf(p.kind, ['user', 'extracted'], '来源');
  array(p.sourceDocumentVersions, 1000, '来源文档版本', entry => {
    const source = object(entry, '来源文档版本', ['key', 'fingerprint']); setupFingerprint(source.fingerprint, '文档版本指纹');
    return txt(source.key, 1000, '来源文档 ID', true);
  }, true);
  return value as ScriptSetupPayload;
}
export function validateScriptSetupConfirmation(payload: ScriptSetupPayload) {
  for (const mechanism of payload.setting.mechanisms) {
    if (mechanism.id === 'time-travel' && (!payload.setting.mainEra.trim() || !payload.setting.originEra.trim() || !payload.setting.transition.trim())) {
      throw Error('确认「穿越」前，请填写主体时代、来源时代和跨时空关系。可先保存草稿。');
    }
    if (['limited-system', 'time-loop'].includes(mechanism.id) && !mechanism.rules.trim()) {
      throw Error(`确认「${mechanism.label}」前，请填写机制规则。可先保存草稿。`);
    }
  }
}
export function validateCharacterEdits(value: unknown, payload: ScriptSetupPayload): CharacterEdit[] {
  const ids = new Set(payload.characters.flatMap(c => 'entityId' in c ? [c.entityId] : []));
  array(value, 200, '待应用人物档案', item => {
    const edit = object(item, '待应用人物档案', ['entityId', 'expectedRevision', 'expectedEntityFingerprint', 'profile']);
    const id = identifier(edit.entityId, '人物 ID'); if (!ids.has(id)) bad('待应用人物未绑定');
    setupInteger(edit.expectedRevision, 0, Number.MAX_SAFE_INTEGER, '待应用档案版本');
    setupFingerprint(edit.expectedEntityFingerprint, '人物来源指纹'); validateCharacterProfile(edit.profile, id); return id;
  }, true);
  return value as CharacterEdit[];
}
export function validateScriptSetupRecord(value: unknown, expectedStatus?: SetupStatus): ScriptSetupRecord {
  const v = object(value, '设定版本', ['schemaVersion', 'revision', 'versionId', 'updatedAt', 'status', 'payload'], ['restoredFrom', 'characterEdits']);
  if (v.schemaVersion !== SCRIPT_SETUP_SCHEMA) bad('设定格式版本');
  const rev = setupInteger(v.revision, 1, Number.MAX_SAFE_INTEGER, '设定版本'); identifier(v.versionId, '版本 ID');
  setupInteger(v.updatedAt, 1, Number.MAX_SAFE_INTEGER, '更新时间');
  oneOf(v.status, ['draft', 'confirmed'], '保存状态');
  if (expectedStatus && v.status !== expectedStatus) bad('设定保存状态');
  const payload = validateScriptSetupPayload(v.payload);
  if (Object.hasOwn(v, 'restoredFrom')) {
    if (v.status !== 'confirmed') bad('恢复状态');
    setupInteger(v.restoredFrom, 1, rev - 1, '恢复来源');
  }
  if (Object.hasOwn(v, 'characterEdits')) {
    if (v.status !== 'draft') bad('已确认设定不能包含待应用人物编辑');
    validateCharacterEdits(v.characterEdits, payload);
  }
  if (v.status === 'confirmed') validateScriptSetupConfirmation(payload);
  return value as ScriptSetupRecord;
}
export function validateCharacterProfileRecord(value: unknown, entityId: string): CharacterProfileRecord {
  const v = object(value, '人物档案版本', ['schemaVersion', 'entityId', 'revision', 'updatedAt', 'entityFingerprint', 'profile']);
  if (v.schemaVersion !== SCRIPT_SETUP_SCHEMA || identifier(v.entityId, '档案人物 ID') !== entityId) bad('档案人物或格式版本');
  setupInteger(v.revision, 1, Number.MAX_SAFE_INTEGER, '人物档案版本');
  setupInteger(v.updatedAt, 1, Number.MAX_SAFE_INTEGER, '人物更新时间');
  setupFingerprint(v.entityFingerprint, '人物来源指纹'); validateCharacterProfile(v.profile, entityId);
  return value as CharacterProfileRecord;
}
