import { db } from "../data/db";
import { assertScriptSetupProject, readScriptSetupWorkspaceEpoch } from '../scriptSetup/scriptSetupStore';
import { migrateSceneReferences } from "../storyboard/sceneReferences";
import type { BlockType, ScriptBlock } from "../script/editor";

export type { ScriptBlock } from "../script/editor";
export const DOCUMENT_LIMITS = Object.freeze({ blocks: 10_000, id: 200, blockText: 100_000, totalText: 2_000_000 });
const TYPES = new Set<BlockType>(["scene", "action", "character", "parenthetical", "dialogue", "transition", "comment", "subtitle"]);

export type DocumentErrorCode = "UNKNOWN_EPISODE" | "INVALID_BLOCKS" | "INVALID_REVISION" | "CONFLICT" | "CORRUPT_DATA" | "PROPOSAL_NOT_FOUND" | "INVALID_PROPOSAL_STATE" | "APPROVAL_REQUIRED";
export class DocumentStoreError extends Error {
  readonly code: DocumentErrorCode;
  constructor(code: DocumentErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "DocumentStoreError";
  }
}
export interface DocumentSnapshot {
  episodeId: string;
  blocks: ScriptBlock[];
  revision: number;
  updatedAt: number;
}
export interface SelectionProposalSource { id: string; projectId: string; workspaceEpoch: string }
export interface Proposal {
  id: string;
  episodeId: string;
  baseRevision: number;
  before: ScriptBlock[];
  after: ScriptBlock[];
  status: "pending" | "applied" | "undone" | "rejected";
  createdAt: number;
  appliedRevision?: number;
  appliedAt?: number;
  undoneRevision?: number;
  undoneAt?: number;
  selectionRun?: SelectionProposalSource;
}
export interface CreateProposalInput {
  episodeId: string;
  baseRevision: number;
  before: readonly ScriptBlock[];
  after: readonly ScriptBlock[];
  selectionRun?: SelectionProposalSource;
}
export interface ProposalResult {
  /** Current document, even when an idempotent retry performs no write. */
  document: DocumentSnapshot;
  proposal: Proposal;
  changed: boolean;
}
interface Metadata {
  schema: 1;
  revision: number;
  /** Full snapshot detects legacy writers which do not update metadata. */
  blocks: ScriptBlock[];
}
interface State {
  document: DocumentSnapshot;
  metadata: Metadata | null;
  exists: boolean;
  drifted: boolean;
}
const bodyKey = (ep: string) => `script:${ep}`;
const metaKey = (ep: string) => `writing:document:${ep}:metadata`;
const backupKey = (ep: string) => `writing:document:${ep}:original`;
export const proposalKey = (ep: string, id: string) => `writing:proposal:${ep}:${id}`;

function fail(code: DocumentErrorCode, message: string): never {
  throw new DocumentStoreError(code, message);
}
function episode(ep: string): void {
  if (typeof ep !== "string" || !ep.trim() || ep.length > DOCUMENT_LIMITS.id || /[:\s\x00]/.test(ep)) {
    fail("UNKNOWN_EPISODE", "Invalid episode ID");
  }
}

/** Register a new document explicitly. Reading an unknown ID never creates a document. */
export async function createEpisodeDocument(episodeId: string): Promise<DocumentSnapshot> {
  episode(episodeId);
  return db.transaction("rw", db.docs, async () => {
    const existing = await db.docs.get(bodyKey(episodeId));
    const metadata = await db.docs.get(metaKey(episodeId));
    if (existing || metadata) fail("CONFLICT", "Episode document already exists");
    const document: DocumentSnapshot = { episodeId, blocks: [], revision: 0, updatedAt: Date.now() };
    await db.docs.add({ key: bodyKey(episodeId), payload: [], updatedAt: document.updatedAt });
    await putMetadata(document);
    return document;
  });
}
function revision(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_REVISION", "Revision must be a non-negative safe integer");
  }
}
function nextRevision(value: number): number {
  revision(value + 1);
  return value + 1;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate and copy; never truncate, normalize, or retain caller-owned blocks. Limits use UTF-16 code units. */
export function validateBlocks(value: unknown): ScriptBlock[] {
  if (!Array.isArray(value) || value.length > DOCUMENT_LIMITS.blocks) fail("INVALID_BLOCKS", "Invalid block array or too many blocks");
  const ids = new Set<string>();
  let total = 0;
  const result: ScriptBlock[] = [];
  for (const block of value) {
    if (!record(block) || typeof block.id !== "string" || !block.id.trim() || block.id.length > DOCUMENT_LIMITS.id || ids.has(block.id)) {
      fail("INVALID_BLOCKS", "Block IDs must be nonempty, unique strings of at most 200 code units");
    }
    if (typeof block.type !== "string" || !TYPES.has(block.type as BlockType)) fail("INVALID_BLOCKS", "Unsupported block type");
    if (typeof block.text !== "string" || block.text.length > DOCUMENT_LIMITS.blockText || block.text.includes("\u0000")) {
      fail("INVALID_BLOCKS", "Block text must be a string of at most 100000 code units without NUL");
    }
    total += block.text.length;
    if (total > DOCUMENT_LIMITS.totalText) fail("INVALID_BLOCKS", "Document text exceeds 2000000 code units");
    ids.add(block.id);
    result.push({ id: block.id, type: block.type as BlockType, text: block.text });
  }
  return result;
}
function equal(a: readonly ScriptBlock[], b: readonly ScriptBlock[]): boolean {
  return a.length === b.length && a.every((v, i) => v.id === b[i].id && v.type === b[i].type && v.text === b[i].text);
}

// All helpers below are called inside the caller's single db.docs transaction.
async function loadState(ep: string): Promise<State> {
  const body = await db.docs.get(bodyKey(ep));
  const row = await db.docs.get(metaKey(ep));
  // The original episode remains compatible with projects created before registration.
  if (ep !== "ep_001" && !body && !row) fail("UNKNOWN_EPISODE", `Unknown episode: ${ep}`);
  const blocks = body ? validateBlocks(body.payload) : [];
  let metadata: Metadata | null = null;
  if (row) {
    if (!record(row.payload) || row.payload.schema !== 1) fail("CORRUPT_DATA", "Invalid document metadata");
    revision(row.payload.revision);
    metadata = { schema: 1, revision: row.payload.revision, blocks: validateBlocks(row.payload.blocks) };
  }
  return {
    document: { episodeId: ep, blocks, revision: metadata?.revision ?? 0, updatedAt: body?.updatedAt ?? 0 },
    metadata,
    exists: !!body,
    drifted: !!metadata && !equal(metadata.blocks, blocks),
  };
}
async function backupOriginal(state: State): Promise<void> {
  const key = backupKey(state.document.episodeId);
  if (!(await db.docs.get(key))) {
    await db.docs.add({ key, updatedAt: Date.now(), payload: {
      schema: 1, episodeId: state.document.episodeId, existed: state.exists,
      revision: state.document.revision, blocks: state.document.blocks, updatedAt: state.document.updatedAt,
    } });
  }
}
async function putMetadata(document: DocumentSnapshot): Promise<void> {
  const metadata: Metadata = { schema: 1, revision: document.revision, blocks: document.blocks };
  await db.docs.put({ key: metaKey(document.episodeId), payload: metadata, updatedAt: Date.now() });
}
function expect(state: State, expected: number, before?: readonly ScriptBlock[]): void {
  if (state.drifted || state.document.revision !== expected || (before && !equal(state.document.blocks, before))) {
    fail("CONFLICT", "Document changed; readDocument again and review a new proposal before retrying");
  }
}
async function commit(state: State, blocks: ScriptBlock[]): Promise<DocumentSnapshot> {
  await backupOriginal(state);
  if (!equal(state.document.blocks.filter(b => b.type === "scene"), blocks.filter(b => b.type === "scene"))) {
    await migrateSceneReferences(state.document.episodeId, state.document.blocks);
  }
  const document: DocumentSnapshot = {
    episodeId: state.document.episodeId, blocks,
    revision: nextRevision(state.document.revision), updatedAt: Date.now(),
  };
  // Retain the old array payload for every existing reader.
  await db.docs.put({ key: bodyKey(document.episodeId), payload: blocks, updatedAt: document.updatedAt });
  await putMetadata(document);
  return document;
}

/** Missing persisted body for the real ep_001 reads as [], revision 0; no fabricated episodes.
 * First read establishes metadata + an immutable original backup (without changing body).
 * A legacy out-of-band write is reconciled to a NEW revision, atomically.
 * Legacy writers cannot offer CAS themselves: migrate them to saveDocument for full protection.
 */
export async function readDocument(episodeId: string): Promise<DocumentSnapshot> {
  episode(episodeId);
  return db.transaction("rw", db.docs, async () => {
    const state = await loadState(episodeId);
    if (!state.metadata) {
      // Establish a CAS baseline even for the first read, before any legacy writer can race it.
      await backupOriginal(state);
      await putMetadata(state.document);
    }
    if (state.drifted) {
      await backupOriginal(state);
      await migrateSceneReferences(episodeId, state.metadata!.blocks);
      state.document.revision = nextRevision(state.document.revision);
      // A deleted legacy row is made an explicit empty array when reconciling.
      if (!state.exists) {
        state.document.updatedAt = Date.now();
        await db.docs.put({ key: bodyKey(episodeId), payload: [], updatedAt: state.document.updatedAt });
      }
      await putMetadata(state.document);
    }
    return state.document;
  });
}
export async function saveDocument(episodeId: string, blocks: readonly ScriptBlock[], expectedRevision: number): Promise<DocumentSnapshot> {
  episode(episodeId);
  revision(expectedRevision);
  const copy = validateBlocks(blocks);
  return db.transaction("rw", db.docs, async () => {
    const state = await loadState(episodeId);
    expect(state, expectedRevision);
    return commit(state, copy);
  });
}

/** Only persists a pending proposal, NEVER changes the document body. */
export async function createProposal(input: CreateProposalInput): Promise<Proposal> {
  // Capture primitive fields and copy arrays before yielding to avoid caller mutation races.
  const { episodeId, baseRevision } = input;
  episode(episodeId);
  revision(baseRevision);
  const before = validateBlocks(input.before);
  const after = validateBlocks(input.after);
  const proposal: Proposal = { id: crypto.randomUUID(), episodeId, baseRevision, before, after, status: "pending", createdAt: Date.now(),
    ...(input.selectionRun ? { selectionRun: validateSelectionProposalSource(input.selectionRun) } : {}) };
  return db.transaction("rw", db.docs, async () => {
    const state = await loadState(episodeId);
    expect(state, baseRevision, before);
    await backupOriginal(state);
    if (!state.metadata) await putMetadata(state.document);
    await db.docs.add({ key: proposalKey(episodeId, proposal.id), payload: proposal, updatedAt: proposal.createdAt });
    return proposal;
  });
}
async function loadProposal(ep: string, id: string): Promise<Proposal> {
  if (ep !== "ep_001" && !(await db.docs.get(bodyKey(ep))) && !(await db.docs.get(metaKey(ep)))) {
    fail("UNKNOWN_EPISODE", `Unknown episode: ${ep}`);
  }
  if (typeof id !== "string" || !id || id.length > 200) fail("PROPOSAL_NOT_FOUND", "Invalid proposal ID");
  const row = await db.docs.get(proposalKey(ep, id));
  if (!row) fail("PROPOSAL_NOT_FOUND", "Proposal not found");
  const p = row.payload;
  if (!record(p) || p.id !== id || p.episodeId !== ep || !["pending", "applied", "undone", "rejected"].includes(String(p.status)) || typeof p.createdAt !== "number") {
    fail("CORRUPT_DATA", "Invalid proposal record");
  }
  revision(p.baseRevision);
  const result: Proposal = {
    id, episodeId: ep, baseRevision: p.baseRevision, before: validateBlocks(p.before), after: validateBlocks(p.after),
    status: p.status as Proposal["status"], createdAt: p.createdAt,
    ...(p.selectionRun !== undefined ? { selectionRun: validateSelectionProposalSource(p.selectionRun) } : {}),
  };
  if (result.status === "applied" || result.status === "undone") {
    revision(p.appliedRevision);
    if (p.appliedRevision !== nextRevision(p.baseRevision) || typeof p.appliedAt !== "number") fail("CORRUPT_DATA", "Invalid applied proposal version");
    result.appliedRevision = p.appliedRevision;
    result.appliedAt = p.appliedAt;
  }
  if (result.status === "undone") {
    revision(p.undoneRevision);
    if (p.undoneRevision !== nextRevision(result.appliedRevision!) || typeof p.undoneAt !== "number") fail("CORRUPT_DATA", "Invalid undo proposal version");
    result.undoneRevision = p.undoneRevision;
    result.undoneAt = p.undoneAt;
  }
  return result;
}
export async function readProposal(episodeId: string, proposalId: string): Promise<Proposal> {
  episode(episodeId);
  return db.transaction("r", db.docs, () => loadProposal(episodeId, proposalId));
}
export const getProposal = readProposal;

export function validateSelectionProposalSource(value: unknown): SelectionProposalSource {
  if (!record(value) || Object.keys(value).some(key => !['id', 'projectId', 'workspaceEpoch'].includes(key))
      || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
      || typeof value.projectId !== 'string' || !/^(?:legacy|[a-f0-9-]{36})$/i.test(value.projectId)
      || typeof value.workspaceEpoch !== 'string' || value.workspaceEpoch !== '' && !/^[a-f0-9-]{36}$/.test(value.workspaceEpoch))
    return fail('CORRUPT_DATA', '选区写作提案来源无效');
  return { id: value.id, projectId: value.projectId, workspaceEpoch: value.workspaceEpoch };
}

/** Persisted history, newest first. No network/model activity. */
export async function listProposals(episodeId: string): Promise<Proposal[]> {
  episode(episodeId);
  return db.transaction("r", db.docs, async () => {
    await loadState(episodeId);
    const prefix = proposalKey(episodeId, "");
    const rows = await db.docs.where("key").startsWith(prefix).toArray();
    const proposals: Proposal[] = [];
    for (const row of rows) proposals.push(await loadProposal(episodeId, row.key.slice(prefix.length)));
    return proposals.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  });
}

/** Reject a pending proposal without touching正文; retries are idempotent. */
export async function rejectProposal(episodeId: string, proposalId: string): Promise<Proposal> {
  episode(episodeId);
  return db.transaction("rw", db.docs, async () => {
    const proposal = await loadProposal(episodeId, proposalId);
    if (proposal.status === "rejected") return proposal;
    if (proposal.status !== "pending") fail("INVALID_PROPOSAL_STATE", "Only a pending proposal can be rejected");
    proposal.status = "rejected";
    await putProposal(proposal);
    return proposal;
  });
}

async function putProposal(proposal: Proposal): Promise<void> {
  await db.docs.put({ key: proposalKey(proposal.episodeId, proposal.id), payload: proposal, updatedAt: Date.now() });
}

export type WriteAuthorization = { approvedByUser: true } | { agentWriteEnabled: true };
/** Authorization comes from a UI approval or the user's selected direct-write mode,
 * never from model arguments. No model calls are made here.
 * Retrying applied/undone IDs never reapplies their changes, even after later edits.
 */
export async function applyProposal(episodeId: string, proposalId: string, approval: WriteAuthorization): Promise<ProposalResult> {
  episode(episodeId);
  if (!(approval && (('approvedByUser' in approval && approval.approvedByUser === true) || ('agentWriteEnabled' in approval && approval.agentWriteEnabled === true)))) fail("APPROVAL_REQUIRED", "Writing must be enabled by the user");
  return db.transaction("rw", db.docs, async () => {
    const proposal = await loadProposal(episodeId, proposalId);
    const state = await loadState(episodeId);
    if (proposal.status === "rejected") fail("INVALID_PROPOSAL_STATE", "A rejected proposal cannot be applied");
    if (proposal.status !== "pending") {
      if (state.drifted) fail("CONFLICT", "Legacy document changed; readDocument before retrying");
      return { document: state.document, proposal, changed: false };
    }
    await checkSelectionProposalOrigin(proposal);
    expect(state, proposal.baseRevision, proposal.before);
    const document = await commit(state, proposal.after);
    proposal.status = "applied";
    proposal.appliedRevision = document.revision;
    proposal.appliedAt = document.updatedAt;
    await putProposal(proposal);
    return { document, proposal, changed: true };
  });
}

async function checkSelectionProposalOrigin(proposal: Proposal) {
  if (!proposal.selectionRun) return;
  const { projectId, workspaceEpoch } = proposal.selectionRun;
  assertScriptSetupProject(projectId);
  if (workspaceEpoch !== await readScriptSetupWorkspaceEpoch()) fail('CONFLICT', '工作区已恢复，旧选区提案保持历史状态。');
}

/** Undo is a fresh revision, and succeeds only while the applied revision AND full body still match. */
export async function undoProposal(episodeId: string, proposalId: string): Promise<ProposalResult> {
  episode(episodeId);
  return db.transaction("rw", db.docs, async () => {
    const proposal = await loadProposal(episodeId, proposalId);
    const state = await loadState(episodeId);
    if (proposal.status === "undone") {
      if (state.drifted) fail("CONFLICT", "Legacy document changed; readDocument before retrying");
      return { document: state.document, proposal, changed: false };
    }
    if (proposal.status !== "applied") fail("INVALID_PROPOSAL_STATE", "Only an applied proposal can be undone");
    await checkSelectionProposalOrigin(proposal);
    expect(state, proposal.appliedRevision!, proposal.after);
    const document = await commit(state, proposal.before);
    proposal.status = "undone";
    proposal.undoneRevision = document.revision;
    proposal.undoneAt = document.updatedAt;
    await putProposal(proposal);
    return { document, proposal, changed: true };
  });
}
