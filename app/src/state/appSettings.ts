import { create } from "zustand";

/** 项目设置：对齐 Lum 设置面板的分组与字段，全部存在本地 */

export type Provider = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
};

export type McpServer = { id: string; name: string; command: string; args: string; enabled: boolean };

export type AppSettings = {
  account: { nickname: string };
  general: {
    startupAnimation: boolean;
    agentNotifications: boolean;
    canvasCompositing: boolean;
    canvasEdgeAnimation: boolean;
    edgeColorMode: "none" | "theme" | "custom";
    edgeColor: string;
    snapToGrid: boolean;
    showMiniMap: boolean;
    showEdges: boolean;
    defaultZoom: number;
    nodeMenuKinds: string[];
  };
  text: { providers: Provider[]; defaultId: string };
  media: { image: Provider; video: Provider; audio: Provider };
  mcp: { servers: McpServer[] };
  network: { proxy: string; timeout: number; retries: number };
  personal: { accent: string; radius: number; fontScale: number; reduceMotion: boolean };
  developer: { systemPrompt: string; debugLog: boolean };
};

export const NODE_KIND_LABELS: Record<string, string> = {
  image: "图片生成",
  video: "视频生成",
  audio: "音频生成",
  text: "文本",
  character: "角色",
  scene: "场景",
};

const KEY = "dsh.app-settings";

const provider = (id: string, label: string, baseUrl: string, model: string): Provider => ({
  id,
  label,
  baseUrl,
  apiKey: "",
  model,
  enabled: id === "aggregator",
});

export const DEFAULT_SETTINGS: AppSettings = {
  account: { nickname: "" },
  general: {
    startupAnimation: true,
    agentNotifications: true,
    canvasCompositing: true,
    canvasEdgeAnimation: true,
    edgeColorMode: "theme",
    edgeColor: "#1a4a35",
    snapToGrid: true,
    showMiniMap: true,
    showEdges: true,
    defaultZoom: 1,
    nodeMenuKinds: ["image", "video", "audio", "text", "character", "scene"],
  },
  text: {
    defaultId: "aggregator",
    providers: [
      provider("aggregator", "聚合平台（OpenAI 兼容）", "", "gpt-4o"),
      provider("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"),
      provider("openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o"),
      provider("anthropic", "Anthropic", "https://api.anthropic.com/v1", "claude-sonnet-4"),
      provider("qwen", "通义千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
      provider("custom", "自定义服务商", "", ""),
    ],
  },
  media: {
    image: provider("img-default", "图片生成", "", "doubao-seedream"),
    video: provider("vid-default", "视频生成", "", "kling-v1"),
    audio: provider("aud-default", "音频生成", "", "tts-1"),
  },
  mcp: { servers: [] },
  network: { proxy: "", timeout: 60, retries: 2 },
  personal: { accent: "#1a4a35", radius: 16, fontScale: 1, reduceMotion: false },
  developer: { systemPrompt: "", debugLog: false },
};

function merge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return (patch === undefined ? base : (patch as T));
  if (!patch || typeof patch !== "object") return base;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = k in out ? merge((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

export function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = merge(DEFAULT_SETTINGS, JSON.parse(raw));
    // 兼容旧版单一接口配置
    const legacy = localStorage.getItem("dsh.api-config");
    if (legacy) {
      const old = JSON.parse(legacy) as { baseUrl?: string; apiKey?: string; model?: string };
      const agg = parsed.text.providers.find((p) => p.id === "aggregator");
      if (agg && !agg.apiKey) {
        agg.baseUrl = old.baseUrl || agg.baseUrl;
        agg.apiKey = old.apiKey || "";
        agg.model = old.model || agg.model;
      }
    }
    return parsed;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface Store {
  settings: AppSettings;
  open: boolean;
  savedAt: number | null;
  setOpen(open: boolean): void;
  update<K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>): void;
  mutate(fn: (cur: AppSettings) => AppSettings): void;
  replace(next: AppSettings): void;
  save(): void;
}

export const useAppSettings = create<Store>((set, get) => ({
  settings: readSettings(),
  open: false,
  savedAt: null,
  setOpen: (open) => set({ open }),
  update: (section, patch) =>
    set({ settings: { ...get().settings, [section]: { ...get().settings[section], ...patch } } }),
  mutate: (fn) => set({ settings: fn(get().settings) }),
  replace: (next) => set({ settings: next }),
  save: () => {
    localStorage.setItem(KEY, JSON.stringify(get().settings));
    set({ savedAt: Date.now() });
  },
}));

/** 把个性化设置落到全局 CSS 变量上 */
export function applyPersonalization(s: AppSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--dsh-accent", s.personal.accent);
  root.style.setProperty("--dsh-radius", `${s.personal.radius}px`);
  root.style.fontSize = `${Math.round(16 * s.personal.fontScale)}px`;
  root.classList.toggle("dsh-reduce-motion", s.personal.reduceMotion);
}

applyPersonalization(readSettings());

/** 设置自动落盘（每次修改都存，另外保存按钮也会存一次） */
useAppSettings.subscribe((s, prev) => {
  if (s.settings !== prev.settings) {
    localStorage.setItem(KEY, JSON.stringify(s.settings));
    applyPersonalization(s.settings);
  }
});
