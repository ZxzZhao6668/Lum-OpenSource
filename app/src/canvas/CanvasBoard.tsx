import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import {
  emptyFile,
  loadCanvasState,
  newId,
  saveCanvasState,
  type CanvasFile,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasState,
} from "./canvasData";
import { showToast } from "../ui/toast";
import { CanvasAgent } from "./CanvasAgent";
import { useAppSettings } from "../state/appSettings";

/** 画布：节点画布 + 多画布文件 + 节点右键菜单 + 对齐工具 + AI 助手 */

const KIND_META: Record<string, { label: string; glyph: string }> = {
  text: { label: "文本", glyph: "T" },
  image: { label: "图片生成", glyph: "▣" },
  video: { label: "视频生成", glyph: "▶" },
  audio: { label: "音频生成", glyph: "♪" },
  character: { label: "角色", glyph: "☺" },
  scene: { label: "场景", glyph: "▤" },
};

const ALL_KINDS = ["image", "video", "audio", "text", "character", "scene"];
const EMPTY_ACTIONS = ["image", "video", "audio"];

function CanvasNodeView({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData;
  const meta = KIND_META[d.kind] ?? KIND_META.text;
  const isMedia = d.kind === "image" || d.kind === "video" || d.kind === "audio";
  return (
    <div className={`dsh-node${selected ? " is-selected" : ""}${d.disabled ? " is-off" : ""}`}>
      <Handle type="target" position={Position.Left} className="dsh-node-handle" />
      <div className="dsh-node-head">
        <span className="dsh-node-dot" />
        <span className="dsh-node-name">{d.title || meta.label}</span>
        <span className="dsh-node-kind">{meta.label}</span>
      </div>
      <div className="dsh-node-body">
        {isMedia ? (
          <div className="dsh-node-thumb">{d.text || `${meta.label}占位`}</div>
        ) : (
          <span className={d.text ? "" : "is-empty"}>{d.text || "还没有内容"}</span>
        )}
      </div>
      <div className="dsh-node-foot">
        <span className="dsh-node-chip">{meta.label}</span>
        <span className="dsh-node-chip">{d.disabled ? "已禁用" : "未连接模型"}</span>
      </div>
      <Handle type="source" position={Position.Right} className="dsh-node-handle" />
    </div>
  );
}

const nodeTypes = { canvasNode: CanvasNodeView };

function Board({ onBack }: { onBack?: () => void }) {
  const [state, setState] = useState<CanvasState>({ files: [emptyFile()], activeId: "" });
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([] as CanvasNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loaded, setLoaded] = useState(false);
  const defaults = useAppSettings((s) => s.settings).general;
  const [snap, setSnap] = useState(defaults.snapToGrid);
  const [showMap, setShowMap] = useState(defaults.showMiniMap);
  const [showEdges, setShowEdges] = useState(defaults.showEdges);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [fileMenu, setFileMenu] = useState(false);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [selCount, setSelCount] = useState(0);
  const [frame, setFrame] = useState({ left: 276, top: 40 });

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition, getViewport, setViewport, fitView, getNodes } = useReactFlow();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef<string[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeFile = state.files.find((f) => f.id === state.activeId) ?? state.files[0];

  // 贴着左侧图标条摆放
  useEffect(() => {
    const host = document.querySelector(".laper-host");
    const panel = host?.querySelector<HTMLElement>(".bg-panel");
    const rail = host?.querySelector<HTMLElement>("[data-dsh-rail]");
    const pr = panel?.getBoundingClientRect();
    const rr = rail?.getBoundingClientRect();
    const railRight = rr ? Math.round(rr.right) : 40;
    if (pr && pr.width > 0) setFrame({ left: Math.round(pr.right) + 8, top: Math.round(rr?.top ?? pr.top) });
    else setFrame({ left: Math.min(40, railRight) + 8, top: Math.round(rr?.top ?? 40) });
  }, []);

  // 载入
  useEffect(() => {
    void (async () => {
      const s = await loadCanvasState();
      const id = s.activeId || s.files[0].id;
      setState({ ...s, activeId: id });
      const file = s.files.find((f) => f.id === id) ?? s.files[0];
      setNodes(file.nodes.map((n) => ({ ...n, type: "canvasNode" })));
      setEdges(file.edges ?? []);
      if (file.viewport) setViewport(file.viewport);
      else if (file.nodes.length) window.setTimeout(() => void fitView({ padding: 0.2, duration: 0, maxZoom: 1 }), 90);
      else setViewport({ x: 0, y: 0, zoom: useAppSettings.getState().settings.general.defaultZoom || 1 });
      setLoaded(true);
    })();
  }, [fitView, setEdges, setNodes, setViewport]);

  const flushCurrent = useCallback((cur: CanvasState) => ({
    ...cur,
    files: cur.files.map((f) =>
      f.id === cur.activeId ? { ...f, nodes: nodes.map((n) => ({ ...n, selected: false })), edges, viewport: getViewport() } : f,
    ),
  }), [nodes, edges, getViewport]);

  // 保存（写回当前画布文件）
  const persistCurrent = useCallback(async () => {
    const next = flushCurrent(stateRef.current);
    setState(next);
    await saveCanvasState(next);
  }, [flushCurrent]);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void persistCurrent(); }, 400);
  }, [loaded, persistCurrent]);

  const returnHome = useCallback(async () => {
    if (loaded) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try { await persistCurrent(); }
      catch (error) { showToast(error instanceof Error ? error.message : '画布保存失败，请重试'); return; }
    }
    onBack?.();
  }, [loaded, persistCurrent, onBack]);

  const snapshot = useCallback(() => {
    history.current.push(JSON.stringify({ nodes: getNodes(), edges }));
    if (history.current.length > 40) history.current.shift();
  }, [edges, getNodes]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    const parsed = JSON.parse(prev) as { nodes: CanvasNode[]; edges: Edge[] };
    setNodes(parsed.nodes);
    setEdges(parsed.edges);
  }, [setEdges, setNodes]);

  const duplicateSelected = useCallback(() => {
    snapshot();
    setNodes((cur) => {
      const picked = cur.filter((n) => n.selected);
      const added = picked.map((n) => ({
        ...n,
        id: newId("n"),
        position: { x: n.position.x + 32, y: n.position.y + 32 },
        selected: true,
      }));
      return [...cur.map((n) => ({ ...n, selected: false })), ...added];
    });
  }, [setNodes, snapshot]);

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        if (menu || nodeMenu || fileMenu || rename) {
          setMenu(null);
          setNodeMenu(null);
          setFileMenu(false);
          setRename(null);
          return;
        }
        void returnHome();
        return;
      }
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, nodeMenu, fileMenu, rename, returnHome, undo, duplicateSelected]);

  const onConnect = useCallback(
    (c: Connection) => {
      snapshot();
      setEdges((cur) => addEdge({ ...c }, cur));
    },
    [setEdges, snapshot],
  );

  const spawn = useCallback(
    (kind: string, flowX: number, flowY: number) => {
      snapshot();
      const meta = KIND_META[kind] ?? KIND_META.text;
      const node: CanvasNode = {
        id: newId("n"),
        type: "canvasNode",
        position: { x: Math.round(flowX - 118), y: Math.round(flowY - 60) },
        data: { kind, title: meta.label, text: "" },
        selected: true,
      };
      setNodes((cur) => [...cur.map((n) => ({ ...n, selected: false })), node]);
      setMenu(null);
    },
    [setNodes, snapshot],
  );

  // 捕获阶段监听（React Flow 的 pane 会吞掉 click/dblclick/contextmenu）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onDbl = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".dsh-cvb-menu, .dsh-agent, .dsh-cvb-nodemenu")) return;
      if (!target.closest(".react-flow__pane")) return;
      const rect = el.getBoundingClientRect();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, flowX: p.x, flowY: p.y });
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".dsh-cvb-menu, .dsh-cvb-nodemenu, .dsh-cvb-filemenu, .dsh-cvb-rename, .dsh-agent")) return;
      setMenu(null);
      setNodeMenu(null);
      setFileMenu(false);
    };
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const nodeEl = target.closest<HTMLElement>(".react-flow__node");
      if (!nodeEl) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setNodeMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, id: nodeEl.getAttribute("data-id") ?? "" });
    };
    el.addEventListener("dblclick", onDbl, true);
    el.addEventListener("click", onClick, true);
    el.addEventListener("contextmenu", onCtx, true);
    return () => {
      el.removeEventListener("dblclick", onDbl, true);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("contextmenu", onCtx, true);
    };
  }, [screenToFlowPosition]);

  const align = useCallback(
    (mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdist") => {
      snapshot();
      setNodes((cur) => {
        const picked = cur.filter((n) => n.selected);
        if (picked.length < 2) return cur;
        const W = 236;
        const H = 150;
        const xs = picked.map((n) => n.position.x);
        const ys = picked.map((n) => n.position.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs) + W;
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys) + H;
        const sortedX = [...picked].sort((a, b) => a.position.x - b.position.x);
        const map = new Map<string, { x: number; y: number }>();
        picked.forEach((n) => {
          let x = n.position.x;
          let y = n.position.y;
          if (mode === "left") x = minX;
          if (mode === "right") x = maxX - W;
          if (mode === "hcenter") x = Math.round((minX + maxX) / 2 - W / 2);
          if (mode === "top") y = minY;
          if (mode === "bottom") y = maxY - H;
          if (mode === "vcenter") y = Math.round((minY + maxY) / 2 - H / 2);
          if (mode === "hdist") {
            const idx = sortedX.findIndex((s) => s.id === n.id);
            x = minX + Math.round((maxX - minX - W) * (idx / Math.max(1, picked.length - 1)));
          }
          map.set(n.id, { x, y });
        });
        return cur.map((n) => {
          const p = map.get(n.id);
          return p ? { ...n, position: p } : n;
        });
      });
    },
    [setNodes, snapshot],
  );

  const visibleEdges = useMemo(() => (showEdges ? edges : []), [edges, showEdges]);

  const checkViewport = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || getNodes().length === 0) {
      setHint(false);
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const vp = getViewport();
    const anyInside = getNodes().some((n) => {
      const w = n.measured?.width ?? 236;
      const h = n.measured?.height ?? 150;
      const x = n.position.x * vp.zoom + vp.x;
      const y = n.position.y * vp.zoom + vp.y;
      return x < rect.width && y < rect.height && x + w * vp.zoom > 0 && y + h * vp.zoom > 0;
    });
    setHint(!anyInside);
  }, [getNodes, getViewport]);

  const switchFile = (id: string) => {
    if (id === state.activeId) {
      setFileMenu(false);
      return;
    }
    const next = { ...flushCurrent(stateRef.current), activeId: id };
    const target = next.files.find((f) => f.id === id);
    if (!target) return;
    setState(next);
    void saveCanvasState(next);
    setNodes(target.nodes.map((n) => ({ ...n, type: "canvasNode" })));
    setEdges(target.edges ?? []);
    setFileMenu(false);
    window.setTimeout(() => {
      if (target.viewport) setViewport(target.viewport);
      else void fitView({ padding: 0.2, duration: 0, maxZoom: 1 });
    }, 30);
  };

  const createFile = () => {
    const cur = flushCurrent(stateRef.current);
    const file: CanvasFile = emptyFile(`画布 ${cur.files.length + 1}`);
    const next = { files: [...cur.files, file], activeId: file.id };
    setState(next);
    void saveCanvasState(next);
    setNodes([]);
    setEdges([]);
    setFileMenu(false);
    window.setTimeout(() => void setViewport({ x: 0, y: 0, zoom: defaults.defaultZoom || 1 }), 30);
  };

  const deleteFile = (id: string) => {
    const cur = stateRef.current;
    if (cur.files.length <= 1) return;
    const files = cur.files.filter((f) => f.id !== id);
    const activeId = cur.activeId === id ? files[0].id : cur.activeId;
    const next = { files, activeId };
    setState(next);
    void saveCanvasState(next);
    if (activeId !== cur.activeId) {
      const target = files.find((f) => f.id === activeId) ?? files[0];
      setNodes(target.nodes.map((n) => ({ ...n, type: "canvasNode" })));
      setEdges(target.edges ?? []);
    }
    setFileMenu(false);
  };

  const renameFile = (id: string, name: string) => {
    const cur = stateRef.current;
    const next = { ...cur, files: cur.files.map((f) => (f.id === id ? { ...f, name } : f)) };
    setState(next);
    void saveCanvasState(next);
  };

  return (
    <div
      className="dsh-canvas-board"
      style={{ ["--dsh-cvb-left" as string]: `${frame.left}px`, ["--dsh-cvb-top" as string]: `${frame.top}px` }}
    >
      <div className="dsh-cvb-head">
        <button className="dsh-cvb-back" type="button" onClick={() => void returnHome()} title="返回首页（Esc）">
          ← 返回首页
        </button>

        <button className="dsh-cvb-file" type="button" onClick={() => setFileMenu((v) => !v)}>
          {activeFile?.name ?? "画布"} <span style={{ opacity: 0.5 }}>▾</span>
        </button>

        <span className="dsh-cvb-sub">
          {nodes.length} 个节点 · {edges.length} 条连线
        </span>

        <div className="dsh-cvb-head-actions">
          <button className="dsh-cvb-hbtn" type="button" onClick={() => void fitView({ duration: 250 })}>
            适应视图
          </button>
          <button className="dsh-cvb-hbtn" type="button" onClick={() => setAgentOpen((v) => !v)}>
            AI 助手
          </button>
        </div>
      </div>

      {fileMenu && (
        <div className="dsh-cvb-filemenu">
          <div className="dsh-cvb-menu-title">画布文件</div>
          {state.files.map((f) => (
            <div key={f.id} className={`dsh-cvb-file-row${f.id === state.activeId ? " is-active" : ""}`}>
              <button type="button" className="dsh-cvb-file-name" onClick={() => switchFile(f.id)}>
                {f.id === state.activeId ? "●" : "○"} {f.name}
              </button>
              <button type="button" title="重命名" onClick={() => setRename({ id: f.id, value: f.name })}>
                ✎
              </button>
              <button type="button" title="删除" onClick={() => deleteFile(f.id)} disabled={state.files.length <= 1}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="dsh-cvb-menu-item" onClick={createFile}>
            ＋ 新建画布
          </button>
        </div>
      )}

      {rename && (
        <div className="dsh-cvb-rename">
          <div className="dsh-cvb-rename-title">重命名画布</div>
          <input
            autoFocus
            value={rename.value}
            onChange={(e) => setRename({ ...rename, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameFile(rename.id, rename.value.trim() || "未命名画布");
                setRename(null);
              }
              if (e.key === "Escape") setRename(null);
            }}
          />
          <div className="dsh-cvb-rename-actions">
            <button type="button" onClick={() => setRename(null)}>
              取消
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => {
                renameFile(rename.id, rename.value.trim() || "未命名画布");
                setRename(null);
              }}
            >
              保存
            </button>
          </div>
        </div>
      )}

      <div className="dsh-cvb-body" ref={wrapRef}>
        <ReactFlow
          nodes={nodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={snapshot}
          onMove={(_, vp) => {
            setZoom(vp.zoom);
            checkViewport();
          }}
          onSelectionChange={({ nodes: sel }: { nodes: CanvasNode[] }) => setSelCount(sel.length)}
          snapToGrid={snap}
          snapGrid={[16, 16]}
          minZoom={0.2}
          maxZoom={8}
          zoomOnScroll
          zoomOnDoubleClick={false}
          panOnScroll={false}
          selectionOnDrag
          panOnDrag={[1, 2]}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d5dbd7" />
          {showMap && (
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              style={{ bottom: 58, left: 12, width: 150, height: 100, borderRadius: 12, border: "1px solid #e4e8e6" }}
              nodeColor="#dfe4e1"
              maskColor="rgba(239,241,240,0.7)"
            />
          )}
        </ReactFlow>

        {nodes.length === 0 && (
          <div className="dsh-cvb-empty">
            <div className="dsh-cvb-empty-hint">◎ 双击画布 自由生成节点</div>
            <div className="dsh-cvb-empty-actions">
              {EMPTY_ACTIONS.map((kind) => {
                const meta = KIND_META[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    className="dsh-cvb-empty-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = wrapRef.current?.getBoundingClientRect();
                      const center = screenToFlowPosition({
                        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 + (EMPTY_ACTIONS.indexOf(kind) - 1) * 180,
                        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
                      });
                      spawn(kind, center.x, center.y);
                    }}
                  >
                    <span className="dsh-cvb-empty-icon">{meta.glyph}</span>
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {menu && (
          <div className="dsh-cvb-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="dsh-cvb-menu-title">新建节点</div>
            {ALL_KINDS.filter((k) => defaults.nodeMenuKinds.includes(k)).map((kind) => (
              <button key={kind} type="button" className="dsh-cvb-menu-item" onClick={() => spawn(kind, menu.flowX, menu.flowY)}>
                <span className="dsh-cvb-menu-glyph">{KIND_META[kind].glyph}</span>
                {KIND_META[kind].label}
              </button>
            ))}
          </div>
        )}

        {nodeMenu && (
          <div className="dsh-cvb-nodemenu" style={{ left: nodeMenu.x, top: nodeMenu.y }}>
            <button
              type="button"
              onClick={() => {
                const node = nodes.find((n) => n.id === nodeMenu.id);
                setNodeMenu(null);
                if (!node) return;
                const title = window.prompt("节点名称", node.data.title);
                if (title != null) {
                  snapshot();
                  setNodes((cur) => cur.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, title: title.trim() || node.data.title } } : n)));
                }
              }}
            >
              ✎ 重命名
            </button>
            <button
              type="button"
              onClick={() => {
                setNodes((cur) => {
                  const target = cur.find((n) => n.id === nodeMenu.id);
                  if (!target) return cur;
                  return [
                    ...cur.map((n) => ({ ...n, selected: false })),
                    { ...target, id: newId("n"), position: { x: target.position.x + 32, y: target.position.y + 32 }, selected: true },
                  ];
                });
                setNodeMenu(null);
              }}
            >
              ⧉ 复制
            </button>
            <button
              type="button"
              onClick={() => {
                setNodes((cur) => cur.map((n) => (n.id === nodeMenu.id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n)));
                setNodeMenu(null);
              }}
            >
              ⊘ 启用 / 禁用
            </button>
            <button
              type="button"
              onClick={() => {
                setNodeMenu(null);
                setAgentOpen(true);
              }}
            >
              ✦ 交给 AI 助手
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                snapshot();
                setNodes((cur) => cur.filter((n) => n.id !== nodeMenu.id));
                setEdges((cur) => cur.filter((e) => e.source !== nodeMenu.id && e.target !== nodeMenu.id));
                setNodeMenu(null);
              }}
            >
              ✕ 删除
            </button>
          </div>
        )}

        <div className="dsh-cvb-tools">
          <button type="button" className={`dsh-cvb-tool${assetsOpen ? " is-on" : ""}`} title="素材库" onClick={() => setAssetsOpen((v) => !v)}>
            ▤
          </button>
          <button
            className="dsh-cvb-tool"
            type="button"
            title="整理画布"
            onClick={() => {
              snapshot();
              const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length || 1)));
              setNodes((cur) => cur.map((n, i) => ({ ...n, position: { x: (i % cols) * 300, y: Math.floor(i / cols) * 260 } })));
              window.setTimeout(() => void fitView({ duration: 250, padding: 0.2, maxZoom: 1 }), 60);
            }}
          >
            ⤧
          </button>
          <button type="button" className={`dsh-cvb-tool${showMap ? " is-on" : ""}`} title="显示或隐藏地图" onClick={() => setShowMap((v) => !v)}>
            ◱
          </button>
          <button type="button" className={`dsh-cvb-tool${snap ? " is-on" : ""}`} title="网格吸附" onClick={() => setSnap((v) => !v)}>
            ⌗
          </button>
          <button type="button" className={`dsh-cvb-tool${showEdges ? " is-on" : ""}`} title="显示或隐藏连线" onClick={() => setShowEdges((v) => !v)}>
            ⇢
          </button>
          <button className="dsh-cvb-tool" type="button" title="适应视图" onClick={() => void fitView({ duration: 250 })}>
            ⌖
          </button>
          <button
            className="dsh-cvb-tool"
            type="button"
            title="缩小"
            onClick={() => setViewport({ ...getViewport(), zoom: Math.max(0.2, getViewport().zoom - 0.2) }, { duration: 120 })}
          >
            −
          </button>
          <span className="dsh-cvb-zoom">{Math.round(zoom * 100)}%</span>
          <button
            className="dsh-cvb-tool"
            type="button"
            title="放大"
            onClick={() => setViewport({ ...getViewport(), zoom: Math.min(8, getViewport().zoom + 0.2) }, { duration: 120 })}
          >
            +
          </button>
        </div>

        {selCount > 0 && (
          <div className="dsh-cvb-selection">
            <span>已选 {selCount}</span>
            {selCount > 1 && (
              <>
                <button className="dsh-cvb-tool" type="button" title="左对齐" onClick={() => align("left")}>
                  ⇤
                </button>
                <button className="dsh-cvb-tool" type="button" title="水平居中" onClick={() => align("hcenter")}>
                  ⇔
                </button>
                <button className="dsh-cvb-tool" type="button" title="右对齐" onClick={() => align("right")}>
                  ⇥
                </button>
                <button className="dsh-cvb-tool" type="button" title="顶对齐" onClick={() => align("top")}>
                  ⇡
                </button>
                <button className="dsh-cvb-tool" type="button" title="垂直居中" onClick={() => align("vcenter")}>
                  ⇕
                </button>
                <button className="dsh-cvb-tool" type="button" title="底对齐" onClick={() => align("bottom")}>
                  ⇣
                </button>
                <button className="dsh-cvb-tool" type="button" title="水平等距" onClick={() => align("hdist")}>
                  ⋯
                </button>
              </>
            )}
            <button className="dsh-cvb-tool" type="button" title="复制" onClick={duplicateSelected}>
              ⧉
            </button>
            <button
              className="dsh-cvb-tool"
              type="button"
              title="删除"
              onClick={() => {
                snapshot();
                setNodes((cur) => cur.filter((n) => !n.selected));
                setEdges((cur) => cur.filter((e) => !e.selected));
              }}
            >
              ✕
            </button>
          </div>
        )}

        {hint && (
          <div className="dsh-cvb-hint">
            <span>当前视窗没有节点</span>
            <button type="button" onClick={() => void fitView({ duration: 250 })}>
              返回节点
            </button>
            <button type="button" onClick={() => setHint(false)}>
              ✕
            </button>
          </div>
        )}

        {assetsOpen && (
          <div className="dsh-cvb-assets">
            <div className="dsh-cvb-assets-head">
              素材库
              <button type="button" style={{ marginLeft: "auto" }} onClick={() => setAssetsOpen(false)}>
                ✕
              </button>
            </div>
            <div className="dsh-cvb-assets-body">
              <div className="dsh-cvb-assets-item">▤ 参考图</div>
              <div className="dsh-cvb-assets-item">☺ 角色形象</div>
              <div className="dsh-cvb-assets-item">▥ 场景板</div>
              <div style={{ marginTop: 10, lineHeight: 1.7 }}>
                素材库还没接后端，先把上一轮场次卡、分镜图放进来。接上以后这里会列出项目里的图片与视频，可直接拖进画布。
              </div>
            </div>
          </div>
        )}

        {!agentOpen && (
          <button type="button" className="dsh-cvb-agentbtn" onClick={() => setAgentOpen(true)} title="AI 对话">
            <span>✦</span> AI 助手
          </button>
        )}

        <CanvasAgent open={agentOpen} onClose={() => setAgentOpen(false)} nodeCount={nodes.length} />
      </div>
    </div>
  );
}

export function CanvasBoard({ onBack }: { onBack?: () => void }) {
  const back = () => onBack?.();
  return (
    <ReactFlowProvider>
      <Board onBack={back} />
    </ReactFlowProvider>
  );
}
