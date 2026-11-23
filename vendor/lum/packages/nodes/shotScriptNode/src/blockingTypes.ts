export type Point = { x: number; y: number };
export type StageActor = { id: string; name: string; home: Point; locked: boolean };
export type StageMark = { id: string; name: string; at: Point };
export type StageScene = { id: string; name: string; actors: StageActor[]; marks: StageMark[] };
export type ActorRoute = { start?: Point; via: Point[]; end?: Point; visible: boolean; facing: string };
export type StageFrame = { url: string; mimeType: string };
export type ShotStage = {
  shotId: string;
  sceneId: string;
  cut: boolean;
  camera: "south" | "north" | "east" | "west";
  focus: string;
  routes: Record<string, ActorRoute>;
  note: string;
  startFrame?: StageFrame;
  endFrame?: StageFrame;
};
export type BlockingPlan = { version: 1; scenes: StageScene[]; shots: Record<string, ShotStage> };
export type StageConstraint = { image: string; video: string; endImage?: string };
