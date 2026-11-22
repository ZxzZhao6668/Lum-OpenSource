import { Toonflow } from "./toonflow";
import type { Channel } from "./types";

const official = new Toonflow();
const channels = new Map<string, Channel>([["lum", official], ["toonflow", official]]);

export function getChannel(): Channel {
  const source = channels.get((process.env.LUM_CHANNEL ?? process.env.TOONFLOW_CHANNEL)?.trim() || "lum");
  if (!source) throw Object.assign(new Error("渠道未配置，请检查 LUM_CHANNEL"), { status: 503 });
  return source;
}
