import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096), taskId: z.uuid(),
  nodeId: z.string().min(1).max(512), canvasPath: z.string().min(1).max(4096),
  mediaType: z.literal("video"), request: z.unknown(),
}), async (req, res) => {
  const body = req.body;
  const cwd = await u.workspace.resolveWorkspace(req, body.directory);
  const owner = { nodeId: body.nodeId, canvasPath: body.canvasPath };
  res.set("Cache-Control", "no-store").json(success(await u.mediaTasks.prepareEnhancement(cwd, body.taskId, body.mediaType, body.request, owner)));
});
