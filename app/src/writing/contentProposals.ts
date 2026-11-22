import { db, updateEntity } from "../data/db";
import { mapMentionEdit, type ShotMention } from '../storyboard/mentionModel';
import type { DocRow, EntityRow } from "../data/db";
import type { WriteAuthorization } from './documentStore';

/** Legacy default retained for existing first-episode records. */
export const CONTENT_PROPOSAL_SCOPE = Object.freeze({ projectId: "localProject", episodeId: "ep_001" });
export type ContentTarget = { kind: "outline" | "storyboard" | "entity"; id: string };
export type OutlineContentPatch = { title?: string; find?: string; replace?: string };
export type StoryboardContentPatch = { desc?: string; type?: string; angle?: string; movement?: string; lens?: string };
export type EntityContentPatch = { name?: string; meta?: string; desc?: string };
export type CreateContentProposalInput =
  | { target: { kind: "outline"; id: string }; patch: OutlineContentPatch }
  | { target: { kind: "storyboard"; id: string }; patch: StoryboardContentPatch }
  | { target: { kind: "entity"; id: string }; patch: EntityContentPatch };
export type ContentProposalStatus = "pending" | "applied" | "rejected" | "undone";
export interface ContentProposal {
  schema: 1;
  id: string;
  projectId: "localProject";
  episodeId: string;
  target: ContentTarget;
  patch: Record<string, string>;
  /** Complete target objects, including protected fields and unknown extension fields. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  status: ContentProposalStatus;
  createdAt: number;
  appliedAt?: number;
  rejectedAt?: number;
  undoneAt?: number;
}
export interface ContentProposalResult { proposal: ContentProposal; changed: boolean }
export type ContentProposalErrorCode = "INVALID_INPUT" | "CORRUPT_DATA" | "TARGET_NOT_FOUND" | "PROPOSAL_NOT_FOUND" | "CONFLICT" | "APPROVAL_REQUIRED" | "INVALID_PROPOSAL_STATE";
export class ContentProposalError extends Error {
  readonly code: ContentProposalErrorCode;
  constructor(code: ContentProposalErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ContentProposalError";
  }
}
const PREFIX = "writing:contentProposal:";
const FIELDS = {
  outline: ["title", "find", "replace"],
  storyboard: ["desc", "type", "angle", "movement", "lens"],
  entity: ["name", "meta", "desc"],
} as const;
function fail(code: ContentProposalErrorCode, message: string): never { throw new ContentProposalError(code, message); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], code: ContentProposalErrorCode): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(code, "Unsupported field; arbitrary storage keys and protected fields are forbidden");
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) fail("INVALID_INPUT", "ID must be a nonempty string of at most 200 characters without control characters");
}
function episodeIdentifier(value: unknown): asserts value is string {
  identifier(value);
  if (/[:\s]/.test(value as string)) fail("INVALID_INPUT", "Invalid episode ID");
}
function targetOf(value: unknown): ContentTarget {
  if (!record(value)) fail("INVALID_INPUT", "Target must be an object");
  keys(value, ["kind", "id"], "INVALID_INPUT");
  if (value.kind !== "outline" && value.kind !== "storyboard" && value.kind !== "entity") fail("INVALID_INPUT", "Unsupported content target kind");
  identifier(value.id);
  return { kind: value.kind, id: value.id };
}
function patchOf(target: ContentTarget, value: unknown): Record<string, string> {
  if (!record(value) || !Object.keys(value).length) fail("INVALID_INPUT", "Patch must contain at least one allowed text field");
  keys(value, FIELDS[target.kind], "INVALID_INPUT");
  const result: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== "string" || text.length > 100_000 || text.includes("\u0000")) fail("INVALID_INPUT", `Invalid ${key}: expected a string of at most 100000 characters without NUL`);
    result[key] = text;
  }
  if (target.kind === "outline") {
    const hasFind = Object.prototype.hasOwnProperty.call(result, "find");
    const hasReplace = Object.prototype.hasOwnProperty.call(result, "replace");
    if (hasFind !== hasReplace || (hasFind && !result.find)) fail("INVALID_INPUT", "Outline replacement requires a nonempty find and a replace string together");
  }
  return result;
}
/** Browser-only precise text-node edit; never parse model-provided replacement as HTML.
 * No fallback rebuilds the document or loses formatting when DOMParser is unavailable.
 */
function replaceOutlineText(html: string, find: string, replacement: string): string {
  if (typeof DOMParser === "undefined") fail("INVALID_INPUT", "Precise outline replacement requires browser DOMParser");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  let match: Text | undefined;
  let matchIndex = -1;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    const index = text.indexOf(find);
    if (index < 0) continue;
    if (node.parentElement?.closest("script,style,noscript,template")) fail("INVALID_INPUT", "Cannot replace text in executable or non-content HTML nodes");
    if (match || text.indexOf(find, index + 1) >= 0) fail("INVALID_INPUT", "Outline find must match exactly once in one text node");
    match = node as Text;
    matchIndex = index;
  }
  if (!match) fail("INVALID_INPUT", "Outline find did not match one text node; cross-node replacements are not supported");
  const text = match.data;
  match.data = text.slice(0, matchIndex) + replacement + text.slice(matchIndex + find.length);
  return doc.body.innerHTML;
}
// Validate lossless plain structured data. Do not silently drop unknown fields, undefined, or repair legacy rows.
function plain(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if ((!record(value) && !Array.isArray(value)) || ancestors.has(value)) fail("CORRUPT_DATA", "Target contains unsupported or cyclic structured data");
  ancestors.add(value);
  for (const item of Object.values(value)) plain(item, ancestors);
  ancestors.delete(value);
}
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(key => Object.prototype.hasOwnProperty.call(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function snapshot(value: unknown, target: ContentTarget): Record<string, unknown> {
  if (!record(value) || value.id !== target.id) fail("CORRUPT_DATA", "Invalid target snapshot or mismatched ID");
  plain(value);
  const required = target.kind === "outline" ? ["title", "html"] : target.kind === "storyboard" ? ["no", "desc", "type", "angle", "movement", "lens"] : ["name", "meta", "desc"];
  if (required.some(key => typeof value[key] !== "string")) fail("CORRUPT_DATA", "Target has missing or invalid text fields");
  if (target.kind === "entity" && (!["character", "location", "prop"].includes(value.kind as string) || typeof value.order !== "number")) fail("CORRUPT_DATA", "Invalid entity kind or order");
  if (target.kind === "storyboard" && (typeof value.x !== "number" || typeof value.y !== "number")) fail("CORRUPT_DATA", "Invalid shot coordinates");
  return structuredClone(value);
}
function patched(before: Record<string, unknown>, target: ContentTarget, patch: Record<string, string>): Record<string, unknown> {
  const after = structuredClone(before);
  for (const [key, value] of Object.entries(patch)) {
    if (target.kind === "outline" && (key === "find" || key === "replace")) continue;
    after[key] = value;
  }
  if (target.kind === "outline" && Object.prototype.hasOwnProperty.call(patch, "find")) {
    after.html = replaceOutlineText(before.html as string, patch.find, patch.replace);
  }
  if(target.kind==='storyboard'&&patch.desc!==undefined&&Array.isArray(before.descMentions))after.descMentions=mapMentionEdit(before.desc as string,patch.desc,before.descMentions as ShotMention[]);
  return after;
}
interface LoadedTarget { value: Record<string, unknown>; row?: DocRow; index?: number }
async function loadTarget(target: ContentTarget, episodeId: string): Promise<LoadedTarget> {
  if (target.kind === "entity") {
    const value = await db.entities.get(target.id);
    if (!value) fail("TARGET_NOT_FOUND", `Entity not found: ${target.id}`);
    return { value: snapshot(value, target) };
  }
  const key = `${target.kind}:${episodeId}`;
  const row = await db.docs.get(key);
  if (!row) fail("TARGET_NOT_FOUND", `No persisted ${target.kind} data; open and save the existing content first`);
  const collection = target.kind === "outline" && record(row.payload) ? row.payload.docs : target.kind === "storyboard" ? row.payload : undefined;
  if (!Array.isArray(collection)) fail("CORRUPT_DATA", `Invalid ${target.kind} collection`);
  const ids = new Set<string>();
  for (const value of collection) {
    if (!record(value) || typeof value.id !== "string" || !value.id || ids.has(value.id)) fail("CORRUPT_DATA", "Collection has invalid or duplicate IDs");
    ids.add(value.id);
  }
  const index = collection.findIndex(value => value.id === target.id);
  if (index < 0) fail("TARGET_NOT_FOUND", `Target not found: ${target.id}`);
  return { value: snapshot(collection[index], target), row, index };
}
function proposalOf(row: DocRow): ContentProposal {
  const p = row.payload;
  if (!record(p) || p.schema !== 1 || p.projectId !== "localProject" || typeof p.episodeId !== "string" || typeof p.id !== "string" || row.key !== PREFIX + p.id) fail("CORRUPT_DATA", "Invalid stored content proposal scope/schema/key");
  identifier(p.id);
  episodeIdentifier(p.episodeId);
  const target = targetOf(p.target), patch = patchOf(target, p.patch);
  const before = snapshot(p.before, target), after = snapshot(p.after, target);
  if (!equal(patched(before, target, patch), after)) fail("CORRUPT_DATA", "Stored proposal changes protected fields or has inconsistent snapshots");
  if (!["pending", "applied", "undone", "rejected"].includes(p.status as string) || typeof p.createdAt !== "number" || !Number.isFinite(p.createdAt)) fail("CORRUPT_DATA", "Invalid proposal status/time");
  return structuredClone(p) as unknown as ContentProposal;
}
async function requireProposal(id: string): Promise<ContentProposal> {
  const p = await getContentProposal(id);
  if (!p) fail("PROPOSAL_NOT_FOUND", `Content proposal not found: ${id}`);
  return p;
}
/** Read-only; a malformed proposal throws instead of being hidden or repaired. */
export async function getContentProposal(id: string): Promise<ContentProposal | null> {
  identifier(id);
  const row = await db.docs.get(PREFIX + id);
  return row ? proposalOf(row) : null;
}
export async function listContentProposals(episodeId = "ep_001"): Promise<ContentProposal[]> {
  const rows = await db.docs.where("key").startsWith(PREFIX).toArray();
  return rows.map(proposalOf).filter(p => p.episodeId === episodeId).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
/** Captures the real persisted target, never a caller-supplied before/after or fabricated default. */
export async function createContentProposal(input: CreateContentProposalInput, episodeId = "ep_001"): Promise<ContentProposal> {
  episodeIdentifier(episodeId);
  if (!record(input)) fail("INVALID_INPUT", "Proposal input must be an object");
  keys(input, ["target", "patch"], "INVALID_INPUT");
  const target = targetOf(input.target), patch = patchOf(target, input.patch);
  return db.transaction("rw", db.docs, db.entities, async () => {
    const { value: before } = await loadTarget(target, episodeId);
    const proposal: ContentProposal = {
      schema: 1, id: crypto.randomUUID(), projectId: "localProject", episodeId, target, patch,
      before, after: patched(before, target, patch), status: "pending", createdAt: Date.now(),
    };
    await db.docs.add({ key: PREFIX + proposal.id, payload: proposal, updatedAt: proposal.createdAt });
    return proposal;
  });
}
async function saveProposal(proposal: ContentProposal): Promise<void> {
  const count = await db.docs.update(PREFIX + proposal.id, { payload: proposal, updatedAt: Date.now() });
  if (count !== 1) fail("PROPOSAL_NOT_FOUND", "Proposal disappeared during transaction");
}
async function commitTarget(target: ContentTarget, loaded: LoadedTarget, value: Record<string, unknown>): Promise<void> {
  if (target.kind === "entity") {
    // Full replacement is safe only after full-object CAS, and retains all extension fields.
    await updateEntity(target.id,value as unknown as EntityRow);
    return;
  }
  const row = loaded.row!;
  const payload = structuredClone(row.payload);
  const collection = target.kind === "outline" ? (payload as { docs: unknown[] }).docs : payload as unknown[];
  collection[loaded.index!] = structuredClone(value);
  const count = await db.docs.update(row.key, { payload, updatedAt: Date.now() });
  if (count !== 1) fail("TARGET_NOT_FOUND", "Target document disappeared during transaction");
}
async function backupOriginal(target: ContentTarget, loaded: LoadedTarget, episodeId: string): Promise<void> {
  const key = `writing:contentOriginal:localProject:${episodeId}:${target.kind}:${encodeURIComponent(target.id)}`;
  if (await db.docs.get(key)) return;
  // Add-only, independent of both proposal and live content keys. Never overwrite the first backup.
  await db.docs.add({ key, updatedAt: Date.now(), payload: {
    schema: 1, ...CONTENT_PROPOSAL_SCOPE, episodeId, target, before: loaded.value,
    ...(loaded.row ? { sourceRow: loaded.row } : {}),
  } });
}
function expect(current: Record<string, unknown>, expected: Record<string, unknown>): void {
  if (!equal(current, expected)) fail("CONFLICT", "The complete target changed (including protected fields); review a new proposal. No content was written");
}
/** Write mode is selected by the user; model output cannot enable it. */
export async function applyContentProposal(id: string, approval: WriteAuthorization): Promise<ContentProposalResult> {
  identifier(id);
  if (!record(approval) || (!("approvedByUser" in approval && approval.approvedByUser === true) && !("agentWriteEnabled" in approval && approval.agentWriteEnabled === true))) fail("APPROVAL_REQUIRED", "Writing must be enabled by the user");
  keys(approval, ["approvedByUser", "agentWriteEnabled"], "INVALID_INPUT");
  return db.transaction("rw", db.docs, db.entities, async () => {
    const proposal = await requireProposal(id);
    if (proposal.status !== "pending" && proposal.status !== "applied") fail("INVALID_PROPOSAL_STATE", `Cannot apply a ${proposal.status} proposal`);
    const loaded = await loadTarget(proposal.target, proposal.episodeId);
    expect(loaded.value, proposal.status === "applied" ? proposal.after : proposal.before);
    if (proposal.status === "applied") return { proposal, changed: false };
    await backupOriginal(proposal.target, loaded, proposal.episodeId);
    await commitTarget(proposal.target, loaded, proposal.after);
    proposal.status = "applied";
    proposal.appliedAt = Date.now();
    await saveProposal(proposal);
    return { proposal, changed: true };
  });
}
export async function undoContentProposal(id: string): Promise<ContentProposalResult> {
  identifier(id);
  return db.transaction("rw", db.docs, db.entities, async () => {
    const proposal = await requireProposal(id);
    if (proposal.status !== "applied" && proposal.status !== "undone") fail("INVALID_PROPOSAL_STATE", `Cannot undo a ${proposal.status} proposal`);
    const loaded = await loadTarget(proposal.target, proposal.episodeId);
    expect(loaded.value, proposal.status === "undone" ? proposal.before : proposal.after);
    if (proposal.status === "undone") return { proposal, changed: false };
    await commitTarget(proposal.target, loaded, proposal.before);
    proposal.status = "undone";
    proposal.undoneAt = Date.now();
    await saveProposal(proposal);
    return { proposal, changed: true };
  });
}
export async function rejectContentProposal(id: string): Promise<ContentProposalResult> {
  identifier(id);
  return db.transaction("rw", db.docs, db.entities, async () => {
    const proposal = await requireProposal(id);
    if (proposal.status === "rejected") return { proposal, changed: false };
    if (proposal.status !== "pending") fail("INVALID_PROPOSAL_STATE", `Cannot reject a ${proposal.status} proposal`);
    proposal.status = "rejected";
    proposal.rejectedAt = Date.now();
    await saveProposal(proposal);
    return { proposal, changed: true };
  });
}
