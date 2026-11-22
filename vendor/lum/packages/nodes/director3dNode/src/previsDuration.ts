import type { PrevisSnapshot } from "./previs";
import type { PrevisScriptSource } from "./previsSkills";

export function suggestPrevisDuration(sources: PrevisScriptSource[]) {
  const available = sources.filter(source => source.text.trim());
  // 场次正文与关联分镜是同一段剧情，自动汇总优先使用分镜，避免重复计时。
  const shots = available.filter(source => source.id.startsWith("shot:"));
  const selected = shots.length ? shots : available;
  let explicitCount = 0, estimatedCount = 0;
  const seconds = selected.reduce((sum, source) => {
    const text = source.text.normalize("NFKC");
    const total = text.match(/(?:总时长|总长|全片时长)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(秒|s(?:ec(?:onds?)?)?\b|分钟|min(?:utes?)?\b)/i);
    const entries = total ? [total] : [...text.matchAll(/(?:时长|持续时间|duration)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(秒|s(?:ec(?:onds?)?)?\b|分钟|min(?:utes?)?\b)/gi)];
    const explicit = entries.reduce((value, match) => value + Number(match[1]) * (/分钟|^min/i.test(match[2]!) ? 60 : 1), 0);
    if (explicit > 0) { explicitCount++; return sum + explicit; }
    // 无时长标注时给出可编辑的阅读节奏估算，不把它当成 AI 精确测算。
    const body = text.split("\n").filter(line => !/景别.+角度.+运镜|^.+ · 镜头 /.test(line)).join("\n");
    const chinese = (body.match(/[\u3400-\u9fff]/g) ?? []).length;
    const words = (body.match(/[a-z]+(?:'[a-z]+)?/gi) ?? []).length;
    const pauses = (body.match(/[。！？!?；;]/g) ?? []).length;
    estimatedCount++;
    return sum + Math.max(4, chinese / 4 + words / 2.5 + pauses * .4);
  }, 0);
  return { seconds: Math.round(seconds * 10) / 10, explicitCount, estimatedCount, count: selected.length };
}

export function resizePrevisDuration(snapshot: PrevisSnapshot, seconds: number, mode: "scale" | "extend") {
  if (!Number.isFinite(seconds) || seconds < .2 || seconds > 300) throw new Error("总时长范围为 0.2～300 秒；更长的剧情请分场预演");
  const previous = snapshot.plan.duration;
  if (seconds === previous) return;
  if (mode === "extend" && seconds < previous) throw new Error("保留节奏仅支持加长；缩短请选按比例调整");
  const ratio = mode === "scale" ? seconds / previous : 1;
  const time = (value: number) => Math.min(seconds, value * ratio);
  const tracks = (entries: PrevisSnapshot["plan"]["tracks"]) => {
    for (const track of entries) for (const frame of track.frames) frame.time = time(frame.time);
  };
  const clips = (entries: { start: number; duration: number }[]) => {
    for (const entry of entries) {
      const start = time(entry.start), end = time(entry.start + entry.duration);
      if (end - start < .2 - 1e-8) throw new Error("缩短后有动作或路线不足 0.2 秒，请增加总时长");
      entry.start = start; entry.duration = Math.max(.2, end - start);
    }
  };
  if (ratio !== 1) {
    for (const plan of [snapshot.plan, snapshot.state.basePlan]) {
      if (!plan) continue;
      tracks(plan.tracks);
      for (const frame of plan.cameraFrames) frame.time = time(frame.time);
    }
    for (const shot of snapshot.state.shots) shot.start = time(shot.start);
    const shots = [...snapshot.state.shots].sort((a, b) => a.start - b.start);
    if (shots.some((shot, index) => (shots[index + 1]?.start ?? seconds) - shot.start < .1 - 1e-8)) throw new Error("缩短后有镜头不足 0.1 秒，请增加总时长");
    clips(snapshot.state.actions); clips(snapshot.state.paths);
    for (const camera of snapshot.state.cameras) for (const frame of camera.keyframes ?? []) frame.time = time(frame.time);
    for (const entry of snapshot.state.shotOverrides ?? []) {
      tracks(entry.tracks); tracks(entry.baseTracks ?? []);
      clips(entry.actions ?? []); clips(entry.paths ?? []);
    }
  }
  snapshot.plan.duration = seconds;
  if (snapshot.state.basePlan) snapshot.state.basePlan.duration = seconds;
}
