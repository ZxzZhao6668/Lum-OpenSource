import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { inspectEnhancementFile } from "@/utils/media/enhancementFiles";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096), taskId: z.uuid().optional(),
  nodeId: z.string().min(1).max(512).optional(), canvasPath: z.string().min(1).max(4096).optional(),
  resume: z.boolean().optional(), abandon: z.boolean().optional(),
  inspect: z.string().min(1).max(4096).optional(),
}), async (req, res) => {
  const body = req.body;
  const cwd = await u.workspace.resolveWorkspace(req, body.directory);
  res.set("Cache-Control", "no-store");
  if (body.inspect !== undefined) {
    if (body.taskId !== undefined || body.nodeId !== undefined || body.canvasPath !== undefined || body.resume !== undefined || body.abandon !== undefined) {
      return res.status(400).json(error("探测视频不能混入任务操作"));
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      const source = await inspectEnhancementFile(cwd, body.inspect, "video", undefined, controller.signal);
      if (!controller.signal.aborted) res.json(success(source));
    } finally { res.off("close", cancel); }
    return;
  }
  if (!body.taskId || !body.nodeId || !body.canvasPath || body.resume && body.abandon) {
    return res.status(400).json(error("增强任务操作或归属无效"));
  }
  const owner = { nodeId: body.nodeId, canvasPath: body.canvasPath };
  const task = await u.mediaTasks.readEnhancement(cwd, body.taskId, owner, body.resume === true, body.abandon === true);
  if (task.state === "missing") return res.status(404).json(error("增强任务尚无本地记录", { missingEnhancementTask: true }, 404));
  res.json(success(task));
});
