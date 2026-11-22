import type { GraphNode, Node, useVueFlow } from "@vue-flow/core";
import { useNodeToolsContext } from "@lum/nodes-scaffold/nodeTools";

type Flow = ReturnType<typeof useVueFlow>;

export interface BatchItem {
  id?: string;
  type: string;
  label: string;
  data?: Record<string, unknown>;
  width?: number;
  height?: number;
}

/** 在来源节点右侧找一块空位，按网格放入一个分组；返回分组与子节点 ID。 */
export function addGroupedNodes(flow: Flow, source: GraphNode, label: string, items: BatchItem[], options: { columns?: number; gap?: number; offsetY?: number; groupData?: Record<string, unknown> } = {}) {
  if (!flow.nodeTypes?.value?.canvasGroup) throw new Error("当前画布不支持分组");
  for (const type of new Set(items.map(item => item.type))) if (!flow.nodeTypes.value[type]) throw new Error(`请先启用节点插件：${type.replace(/^remote-/, "")}`);
  const columns = Math.max(1, Math.min(options.columns ?? 4, items.length));
  const gap = options.gap ?? 32;
  const cellWidth = Math.max(...items.map(item => item.width ?? 360));
  const cellHeight = Math.max(...items.map(item => item.height ?? 360));
  const rows = Math.ceil(items.length / columns);
  const width = columns * cellWidth + (columns - 1) * gap + 48;
  const height = rows * cellHeight + (rows - 1) * gap + 64;
  const x = source.computedPosition.x + (source.dimensions.width || 420) + 120;
  let y = source.computedPosition.y + (options.offsetY ?? 0);
  for (const other of [...flow.getNodes.value].filter(item => !item.parentNode).sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
    const position = other.computedPosition;
    if (position.x < x + width && position.x + (other.dimensions.width || 320) > x && position.y < y + height && position.y + (other.dimensions.height || 300) > y) {
      y = position.y + (other.dimensions.height || 300) + 48;
    }
  }
  const groupId = crypto.randomUUID();
  const nodes: Node[] = [{
    id: groupId, type: "canvasGroup", position: { x, y },
    style: { width: `${width}px`, height: `${height}px` },
    connectable: false, expandParent: false,
    data: { label, ...options.groupData },
  }];
  const ids = items.map((item, index) => {
    const id = item.id ?? crypto.randomUUID();
    nodes.push({
      id, type: item.type, parentNode: groupId, expandParent: false,
      position: { x: 24 + index % columns * (cellWidth + gap), y: 40 + Math.floor(index / columns) * (cellHeight + gap) },
      data: { label: item.label, ...item.data },
    });
    return id;
  });
  try { flow.addNodes(nodes); }
  catch (error) { flow.removeNodes(nodes.map(item => item.id), true, false); throw error; }
  return { groupId, ids };
}

/** 等节点挂载并注册函数后调用，例如 node:generateImage。 */
export function useNodeCaller() {
  const context = useNodeToolsContext();
  return async function callNode(nodeId: string, name: `node:${string}`, args: Record<string, unknown> = {}, timeout = 15000) {
    const tools = context();
    const started = Date.now();
    while (![...tools.list([nodeId], [name])].length) {
      if (Date.now() - started > timeout) throw new Error(`节点尚未就绪：${name}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return tools.call({ nodeId, name, args });
  };
}
