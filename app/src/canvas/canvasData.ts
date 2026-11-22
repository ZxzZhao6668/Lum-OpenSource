import { loadDoc, saveDoc } from "../data/db";
import type { Edge, Node } from "@xyflow/react";

/** 画布数据：一个项目下可以有多个画布文件，字段对齐 Lum 的 canvas file 概念 */

export type CanvasNodeData = {
  kind: string;
  title: string;
  text: string;
  disabled?: boolean;
};

export type CanvasNode = Node<CanvasNodeData>;

export type CanvasFile = {
  id: string;
  name: string;
  nodes: CanvasNode[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
};

export type CanvasState = { files: CanvasFile[]; activeId: string };

export const CANVAS_KEY = "canvas:ep_001";
export const AGENT_KEY = "agent:ep_001";

export type AgentMsg = { id: string; role: "user" | "assistant"; text: string; ts: number };
export type AgentThread = { id: string; title: string; messages: AgentMsg[] };
export type AgentState = { threads: AgentThread[]; activeId: string };

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyFile(name = "画布 1"): CanvasFile {
  return { id: newId("cf"), name, nodes: [], edges: [] };
}

/** 兼容旧的单画布结构 { nodes, edges, viewport } */
export async function loadCanvasState(): Promise<CanvasState> {
  const raw = await loadDoc<CanvasState | { nodes: CanvasNode[]; edges: Edge[]; viewport?: CanvasFile["viewport"] }>(CANVAS_KEY);
  if (!raw) return { files: [emptyFile()], activeId: "" };
  if ("files" in raw && Array.isArray(raw.files) && raw.files.length) {
    return { files: raw.files, activeId: raw.activeId || raw.files[0].id };
  }
  const legacy = raw as { nodes?: CanvasNode[]; edges?: Edge[]; viewport?: CanvasFile["viewport"] };
  const file: CanvasFile = { id: newId("cf"), name: "画布 1", nodes: legacy.nodes ?? [], edges: legacy.edges ?? [], viewport: legacy.viewport };
  return { files: [file], activeId: file.id };
}

export async function saveCanvasState(state: CanvasState) {
  await saveDoc(CANVAS_KEY, state);
}

export async function loadAgentState(): Promise<AgentState> {
  const raw = await loadDoc<AgentState>(AGENT_KEY);
  if (raw?.threads?.length) return raw;
  const thread: AgentThread = { id: newId("t"), title: "新对话", messages: [] };
  return { threads: [thread], activeId: thread.id };
}

export async function saveAgentState(state: AgentState) {
  await saveDoc(AGENT_KEY, state);
}

/** 没有接模型时的本地回复，先把行为跑通 */
export function localReply(prompt: string, nodeCount: number): string {
  const q = prompt.trim();
  if (/整理|排列|对齐/.test(q)) return `在画布上点左下角「整理画布」就会按网格重排（当前 ${nodeCount} 个节点）。`;
  if (/节点|新增|加一个/.test(q)) return "双击画布空白处可以选节点类型；也可以右键节点做复制、重命名、删除。";
  if (/连线/.test(q)) return "从一个节点右侧的圆点拖到另一个节点左侧的圆点就能连线。";
  return `收到：${q.slice(0, 60)}\n\n还没接模型 API，所以这里只是把话记下来。接上聚合平台之后，这里会直接生成节点、改文案、跑图。`;
}
