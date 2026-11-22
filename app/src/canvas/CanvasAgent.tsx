import { useEffect, useRef, useState } from "react";
import { localReply, loadAgentState, newId, saveAgentState, type AgentState } from "./canvasData";

/** 画布里的 AI 对话面板：浮动 / 可拖 / 可缩放 / 可停靠，会话存在本地 */

type Props = {
  open: boolean;
  onClose: () => void;
  nodeCount: number;
};

export function CanvasAgent({ open, onClose, nodeCount }: Props) {
  const [state, setState] = useState<AgentState | null>(null);
  const [input, setInput] = useState("");
  const [docked, setDocked] = useState(false);
  const [size, setSize] = useState({ w: 400, h: 560 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [thinking, setThinking] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    void (async () => setState(await loadAgentState()))();
  }, []);

  useEffect(() => {
    if (state) void saveAgentState(state);
  }, [state]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state, thinking]);

  const thread = state?.threads.find((t) => t.id === state.activeId) ?? state?.threads[0];

  const patchThread = (fn: (s: AgentState) => AgentState) => setState((cur) => (cur ? fn(cur) : cur));

  const send = () => {
    const text = input.trim();
    if (!text || !state || !thread) return;
    const userMsg = { id: newId("m"), role: "user" as const, text, ts: Date.now() };
    setInput("");
    patchThread((cur) => ({
      ...cur,
      threads: cur.threads.map((t) =>
        t.id === thread.id
          ? {
              ...t,
              title: t.messages.length === 0 ? text.slice(0, 16) : t.title,
              messages: [...t.messages, userMsg],
            }
          : t,
      ),
    }));
    setThinking(true);
    window.setTimeout(() => {
      setThinking(false);
      patchThread((cur) => ({
        ...cur,
        threads: cur.threads.map((t) =>
          t.id === thread.id
            ? { ...t, messages: [...t.messages, { id: newId("m"), role: "assistant" as const, text: localReply(text, nodeCount), ts: Date.now() }] }
            : t,
        ),
      }));
    }, 420);
  };

  const startDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    if (docked) return;
    e.preventDefault();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, ox: pos.x === 0 && pos.y === 0 ? 0 : pos.x, oy: pos.y };
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.sx;
      const dy = ev.clientY - d.sy;
      if (d.mode === "move") {
        setPos({
          x: Math.max(8, Math.min(window.innerWidth - size.w - 8, d.ox + dx)),
          y: Math.max(48, Math.min(window.innerHeight - 80, d.oy + dy)),
        });
      } else {
        setSize({
          w: Math.max(340, Math.min(window.innerWidth - 40, size.w - dx)),
          h: Math.max(320, Math.min(window.innerHeight - 60, size.h + dy)),
        });
      }
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!open) return null;

  const style = docked
    ? { right: 0, top: 40, bottom: 0, width: Math.min(460, Math.round(window.innerWidth * 0.42)) }
    : pos.x === 0 && pos.y === 0
      ? { right: 16, bottom: 60, width: size.w, height: size.h }
      : { left: pos.x, top: pos.y, width: size.w, height: size.h };

  return (
    <aside className={`dsh-agent${docked ? " is-docked" : ""}`} style={style as React.CSSProperties} aria-label="AI 对话">
      <header className="dsh-agent-head" onPointerDown={startDrag("move")}>
        <span className="dsh-agent-dot" />
        <span className="dsh-agent-name">{thread?.title || "新对话"}</span>
        <div className="dsh-agent-actions">
          <button type="button" title="历史对话" onClick={() => setHistoryOpen((v) => !v)}>
            ☰
          </button>
          <button
            type="button"
            title="新对话"
            onClick={() => {
              const t = { id: newId("t"), title: "新对话", messages: [] };
              setState((cur) => (cur ? { threads: [t, ...cur.threads], activeId: t.id } : cur));
            }}
          >
            ＋
          </button>
          <button type="button" title={docked ? "切换为悬浮" : "停靠到右侧"} onClick={() => setDocked((v) => !v)}>
            {docked ? "❐" : "◫"}
          </button>
          <button type="button" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
      </header>

      {historyOpen && state && (
        <div className="dsh-agent-history">
          {state.threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === state.activeId ? "is-active" : ""}
              onClick={() => {
                setState({ ...state, activeId: t.id });
                setHistoryOpen(false);
              }}
            >
              <span>{t.title || "新对话"}</span>
              <span className="dsh-agent-history-del" role="button" tabIndex={-1}>
                {t.messages.length} 条
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="dsh-agent-list" ref={listRef}>
        {(!thread || thread.messages.length === 0) && (
          <div className="dsh-agent-empty">
            <div className="dsh-agent-empty-title">画布助手</div>
            <div>可以直接说：帮我整理画布 / 加一个图片生成节点 / 把选中的节点排成一列。</div>
            <div className="dsh-agent-empty-note">还没接模型 API，回复是本地占位。</div>
          </div>
        )}
        {thread?.messages.map((m) => (
          <div key={m.id} className={`dsh-agent-msg is-${m.role}`}>
            <div className="dsh-agent-bubble">{m.text}</div>
          </div>
        ))}
        {thinking && <div className="dsh-agent-msg is-assistant"><div className="dsh-agent-bubble is-typing">…</div></div>}
      </div>

      <div className="dsh-agent-input">
        <textarea
          value={input}
          placeholder="给画布助手说点什么…"
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="dsh-agent-send" onClick={send} disabled={!input.trim()}>
          发送
        </button>
      </div>

      {!docked && <div className="dsh-agent-resize" onPointerDown={startDrag("resize")} title="拖动调整大小" />}
    </aside>
  );
}
