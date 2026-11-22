import { isStageBake, stageBakeSignature, stageBakeMotionSignature, withStageBake, canBakeObject, type StageBake } from "@lum/node-shared/stageBake";
import { mkdir, readFile, readdir, stat, writeAtomic } from "@lum/file";
import { basename, dirname, isAbsolute, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Request } from "express";
import { z } from "zod";
import conf from "@/utils/conf";
import { resolveWorkspace } from "@/utils/workspace";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { identityFields, submitFields } from "./schemas";
import renderScript from "./renderScript";
export * from "./schemas";

type Job = { kind?: "bake"; jobId: string; revision?: number; frameTime?: number; status: "queued" | "running" | "completed" | "failed" | "cancelled"; progress: number; outputPath?: string; blendPath?: string; error?: string };
type Active = { directory: string; nodeId: string; folder: string; job: Job; controller: AbortController; blender: string; ffmpeg: string; fps: number };
const jobs = new Map<string, Active>();
const submissions = new Map<string, { signature: string; task: Promise<Job> }>();
const queue: Active[] = [];
let draining = false;
let stopping = false;
const processes = new Set<ChildProcess>();
export async function stopPrevisJobs() {
  stopping = true;
  for (const active of jobs.values()) if (active.job.status === "queued" || active.job.status === "running") active.controller.abort();
  await Promise.all([...processes].map(child => new Promise<void>(resolve => {
    child.once("close", () => resolve());
    child.kill("SIGKILL");
  })));
  await Promise.allSettled([...jobs.values()].filter(active => active.controller.signal.aborted).map(active => {
    active.job.status = "cancelled"; active.job.error = "Lum 已退出，预演任务已停止";
    return save(active);
  }));
}
const jobKey = (directory: string, nodeId: string, jobId: string) => JSON.stringify([process.platform === "win32" ? directory.toLowerCase() : directory, nodeId, jobId]);
const relativeFolder = (nodeId: string, jobId: string) => `assets/${nodeId}/previs/${jobId}`;
const save = (active: Active) => writeAtomic(join(active.folder, "job.json"), JSON.stringify(active.job, null, 2));
function execute(program: string, args: string[], cwd: string, signal: AbortSignal, progress?: (line: string) => void, timeout = 7200000) {
  signal.throwIfAborted();
  if (stopping) throw new Error("Lum 正在退出，未启动渲染");
  return new Promise<string>((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    processes.add(child);
    child.once("close", () => processes.delete(child));
    let output = "", pending = "", timedOut = false;
    // Only terminate this render's process, never a global Blender/FFmpeg image name.
    const stop = () => { child.kill("SIGKILL"); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    signal.addEventListener("abort", stop, { once: true });
    const read = (chunk: Buffer) => {
      const text = chunk.toString(); output = (output + text).slice(-12000); pending += text;
      const lines = pending.split(/[\r\n]+/); pending = lines.pop() ?? "";
      for (const line of lines) progress?.(line);
      if (pending.length > 12000) pending = pending.slice(-12000);
    };
    child.stdout.on("data", read); child.stderr.on("data", read);
    const clean = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); };
    child.once("error", error => { clean(); reject(error); });
    child.once("close", code => { clean();
      if (signal.aborted) reject(new Error("预演任务已取消"));
      else if (timedOut) reject(new Error("渲染超过时间上限，已停止本次进程"));
      else if (code !== 0) reject(new Error(`渲染程序退出 (${code})：${output.slice(-4000)}`));
      else resolve(output);
    });
  });
}
async function verifyBlender(path: string) {
  if (!isAbsolute(path) || !/^blender(?:\.exe)?$/i.test(basename(path)) || !(await stat(path)).isFile()) throw Object.assign(new Error("请选择 Blender 程序文件 blender.exe / blender"), { status: 400 });
  const output = await execute(path, ["--version"], dirname(path), new AbortController().signal, undefined, 10000);
  if (!/^Blender \d/m.test(output)) throw Object.assign(new Error("指定程序不是可用的 Blender"), { status: 400 });
  return path;
}
export async function settings() {
  const raw = conf.get("settings", {}).previs;
  const blenderPath = raw && typeof raw === "object" && "blenderPath" in raw && typeof raw.blenderPath === "string" ? raw.blenderPath : "";
  const candidates = [blenderPath, process.env.BLENDER_PATH ?? "", Bun.which("blender") ?? "", ...(process.platform === "win32" ? [] : ["/usr/bin/blender", "/usr/local/bin/blender", "/Applications/Blender.app/Contents/MacOS/Blender"])];
  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
    if (!base) continue;
    const root = join(base, "Blender Foundation");
    try { for (const folder of (await readdir(root)).sort().reverse()) candidates.push(join(root, folder, "blender.exe")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const candidate of candidates.filter(Boolean)) {
    try { return { blenderPath, detectedPath: await verifyBlender(candidate), available: true }; }
    catch { /* Missing/unusable installations are reported below. */ }
  }
  return { blenderPath, detectedPath: "", available: false };
}
export async function saveSettings(blenderPath: string) {
  if (blenderPath) await verifyBlender(blenderPath);
  conf.set("settings", { ...conf.get("settings", {}), previs: { blenderPath } });
  return settings();
}
async function run(active: Active) {
  const { job, folder, controller } = active;
  try {
    controller.signal.throwIfAborted(); job.status = "running"; await save(active);
    await writeAtomic(join(folder, "render.py"), renderScript, { exclusive: true });
    await mkdir(join(folder, "frames"));
    let persisted = 0;
    await execute(active.blender, ["--background", "--factory-startup", "--disable-autoexec", "--threads", "4", "--python-exit-code", "1", "--python", join(folder, "render.py"), "--", join(folder, "snapshot.json")], folder, controller.signal, line => {
      const match = /^PREVIS_PROGRESS (\d+) (\d+)$/.exec(line);
      if (match) { job.progress = Number(match[1]) / Number(match[2]) * .9;
        if (Date.now() - persisted > 1000) { persisted = Date.now(); void save(active).catch(error => { console.error("预演进度保存失败", error); controller.abort(); }); }
      }
    });
    controller.signal.throwIfAborted(); job.progress = .92; await save(active);
    if (job.kind === "bake") {
      const input = JSON.parse(await readFile(join(folder,"snapshot.json"),"utf8"));
      const objects = JSON.parse(await readFile(join(folder,"bake.json"),"utf8"));
      const result: StageBake = { ...input.bake, enabled: true, strength: .65, signature: stageBakeSignature(input.scene), motionSignature: stageBakeMotionSignature(input.scene,input.plan.tracks), objects };
      if (!isStageBake(result) || result.objects.some(entry => !input.scene.objectList.some((object: any) => object.threeJsonId === entry.objectId && canBakeObject(object)))) throw new Error("烘焙结果无效，原模型保持不变");
      await writeAtomic(join(folder,"bake.json"),JSON.stringify(result));
      job.outputPath = `${relativeFolder(active.nodeId,job.jobId)}/bake.json`;
      job.status = "completed"; job.progress = 1; await save(active); return;
    }
    if (job.frameTime === undefined) await execute(active.ffmpeg, ["-nostdin", "-n", "-framerate", String(active.fps), "-i", join(folder, "frames", "frame_%06d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(folder, "video.mp4")], folder, controller.signal);
    for (const name of ["scene.blend", job.frameTime === undefined ? "video.mp4" : "frames/frame_000000.png"]) if (!(await stat(join(folder, name))).size) throw new Error("渲染输出为空");
    controller.signal.throwIfAborted();
    job.outputPath = `${relativeFolder(active.nodeId, job.jobId)}/${job.frameTime === undefined ? "video.mp4" : "frames/frame_000000.png"}`; job.blendPath = `${relativeFolder(active.nodeId, job.jobId)}/scene.blend`;
    job.status = "completed"; job.progress = 1;
  } catch (error) {
    job.status = controller.signal.aborted ? "cancelled" : "failed";
    job.error = controller.signal.aborted ? "预演任务已取消" : error instanceof Error ? error.message : String(error);
  }
  await save(active);
}
async function drain() {
  if (draining) return;
  draining = true;
  try { while (queue.length) { const active = queue.shift()!; if (active.job.status === "queued") { try { await run(active); } catch (error) { console.error("预演任务状态保存失败", error); } } } }
  finally { draining = false; }
}
export async function submit(req: Request, body: unknown) {
  if (stopping) throw Object.assign(new Error("Lum 正在退出，未接受新任务"), { status: 503 });
  const input = z.strictObject(submitFields).parse(body);
  if (input.bake) {
    if (!input.scene.objectList.some(canBakeObject)) throw Object.assign(new Error("人物不参与烘焙；请先添加场景或道具"),{status:400});
    if (input.scene.studio) delete input.scene.studio.bake;
  } else {
    const bake = input.scene.studio?.bake;
    if (bake && bake.motionSignature !== stageBakeMotionSignature(input.scene,input.plan.tracks)) bake.enabled = false;
    input.scene = withStageBake(input.scene);
  }
  const directory = await resolveWorkspace(req, input.directory);
  if ((input.width ?? 960) * (input.height ?? 540) > 2073600) throw Object.assign(new Error("预演输出最多支持 2073600 像素，请降低分辨率"), { status: 400 });
  const jobId = input.requestId ?? crypto.randomUUID();
  const key = jobKey(directory, input.nodeId, jobId);
  if (input.frameTime !== undefined && input.frameTime > input.plan.duration) throw Object.assign(new Error("校验时间超过场景时长"), { status: 400 });
  const signature = JSON.stringify({ ...input, directory });
  const pending = submissions.get(key);
  if (pending) { if (pending.signature !== signature) throw Object.assign(new Error("提交标识已用于不同请求"), { status: 409 }); return pending.task; }
  const task = (async () => {
    try {
      const previous = await lookup(req, { directory, nodeId: input.nodeId, jobId });
      const saved = JSON.parse(await readFile(join(previous.folder, "snapshot.json"), "utf8"));
      if (JSON.stringify(saved.bake) !== JSON.stringify(input.bake) || saved.revision !== input.revision || JSON.stringify(saved.scene) !== JSON.stringify(input.scene) || JSON.stringify(saved.plan) !== JSON.stringify(input.plan) || saved.frameTime !== input.frameTime || saved.width !== (input.width ?? 960) || saved.height !== (input.height ?? 540) || saved.fps !== (input.fps ?? 24)) throw Object.assign(new Error("提交标识已用于不同的场景版本"), { status: 409 });
      return { ...previous.job };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const installed = await settings();
  if (!installed.available) throw Object.assign(new Error("请先配置可用的 Blender 程序路径"), { status: 424 });
  const tools = input.bake ? { ffmpeg: "" } : await prepareWorkspaceFfmpeg();
  for (const track of input.plan.tracks) {
    const object = input.scene.objectList.find(object => object.threeJsonId === track.objectId);
    if (!object || track.joint && object.objType !== "mannequin") throw Object.assign(new Error("动画引用了不存在的物体或非人偶关节"), { status: 400 });
    if (object.attachment) throw Object.assign(new Error("挂接道具不能同时包含独立动画轨道"), { status: 400 });
  }
  const { path: folder } = await resolveWorkspacePath(directory, relativeFolder(input.nodeId, jobId), true);
  await mkdir(dirname(folder), { recursive: true });
  await resolveWorkspacePath(directory, relativeFolder(input.nodeId, jobId));
  try { await mkdir(folder); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const interrupted: Job = { jobId, revision: input.revision, frameTime: input.frameTime, status: "failed", progress: 0, error: "提交记录写入中断；保留原任务目录，请新建提交。未重复启动渲染。" };
    await writeAtomic(join(folder,"job.json"),JSON.stringify(interrupted,null,2));
    return interrupted;
  }
  const active: Active = { directory, nodeId: input.nodeId, folder, job: { kind: input.bake ? "bake" : undefined, jobId, revision: input.revision, frameTime: input.frameTime, status: "queued", progress: 0 }, controller: new AbortController(), blender: installed.detectedPath, ffmpeg: tools.ffmpeg, fps: input.fps ?? 24 };
  await writeAtomic(join(folder, "snapshot.json"), JSON.stringify({ ...input, directory, width: input.width ?? 960, height: input.height ?? 540, fps: input.fps ?? 24 }), { exclusive: true });
  await save(active); jobs.set(jobKey(directory, input.nodeId, jobId), active); queue.push(active);
  void drain().catch(error => console.error("预演队列异常", error));
  return { ...active.job };
  })();
  submissions.set(key, { signature, task });
  try { return await task; } finally { submissions.delete(key); }
}
async function lookup(req: Request, body: unknown) {
  const input = z.strictObject(identityFields).parse(body);
  const directory = await resolveWorkspace(req, input.directory);
  const memory = jobs.get(jobKey(directory, input.nodeId, input.jobId));
  const { path: folder } = await resolveWorkspacePath(directory, relativeFolder(input.nodeId, input.jobId));
  if (memory) return memory;
  const { path: recordPath } = await resolveWorkspacePath(directory, `${relativeFolder(input.nodeId, input.jobId)}/job.json`);
  const job = z.strictObject({ kind: z.literal("bake").optional(), jobId: z.uuid(), revision: z.number().int().nonnegative().optional(), frameTime: z.number().min(0).max(300).optional(), status: z.enum(["queued", "running", "completed", "failed", "cancelled"]), progress: z.number().min(0).max(1), outputPath: z.string().optional(), blendPath: z.string().optional(), error: z.string().optional() }).parse(JSON.parse(await readFile(recordPath, "utf8")));
  if (job.jobId !== input.jobId) throw new Error("任务记录不匹配");
  if (job.status === "completed") {
    job.outputPath = `${relativeFolder(input.nodeId, input.jobId)}/${job.kind === "bake" ? "bake.json" : job.frameTime === undefined ? "video.mp4" : "frames/frame_000000.png"}`;
    job.blendPath = job.kind === "bake" ? undefined : `${relativeFolder(input.nodeId, input.jobId)}/scene.blend`;
  }
  // Restarted tasks are never silently submitted a second time.
  if (job.status === "running" || job.status === "queued") {
    job.status = "failed"; job.error = "服务已重启，本次渲染已中断；已有输出保留，可重新提交";
    await writeAtomic(join(folder, "job.json"), JSON.stringify(job, null, 2));
  }
  return { directory, nodeId: input.nodeId, folder, job, controller: new AbortController(), blender: "", ffmpeg: "", fps: 24 };
}
export async function status(req: Request, body: unknown) { return { ...(await lookup(req, body)).job }; }
export async function cancel(req: Request, body: unknown) {
  const active = await lookup(req, body);
  if (active.job.status === "queued" || active.job.status === "running") {
    active.controller.abort(); active.job.status = "cancelled"; active.job.error = "预演任务已取消"; await save(active);
  }
  return { ...active.job };
}


