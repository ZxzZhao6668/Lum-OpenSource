export interface VideoContinuity {
  episodeId: string; sceneId: string; shotIds: string[];
  previous?: {shotId: string; sceneId: string; label: string; text: string};
  next?: {shotId: string; sceneId: string; label: string; text: string};
}
export function parseVideoContinuity(value: unknown): VideoContinuity | undefined {
  if (value === undefined) return;
  const input = value as VideoContinuity;
  const short = (text: unknown) => typeof text === "string" && text.length > 0 && text.length <= 500 && !text.includes("\0");
  if (!input || !short(input.episodeId) || !short(input.sceneId) || !Array.isArray(input.shotIds) || !input.shotIds.length || input.shotIds.length > 100 || !input.shotIds.every(short)) throw Error("镜头衔接资料无效");
  const neighbor = (item: VideoContinuity["previous"]) => {
    if (item === undefined) return;
    if (!item || !short(item.shotId) || !short(item.sceneId) || !short(item.label) || typeof item.text !== "string" || item.text.length > 8000 || item.text.includes("\0")) throw Error("相邻镜头资料无效");
    return {shotId: item.shotId, sceneId: item.sceneId, label: item.label, text: item.text};
  };
  return {episodeId: input.episodeId, sceneId: input.sceneId, shotIds: [...input.shotIds], previous: neighbor(input.previous), next: neighbor(input.next)};
}
