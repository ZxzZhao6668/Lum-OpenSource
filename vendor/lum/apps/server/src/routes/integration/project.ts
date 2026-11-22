import { Router } from "express";
import { dirname, resolve } from "node:path";
import { lstat, mkdir, realpath } from "@lum/file";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", validateFields({ projectId: z.union([z.literal("localProject"), z.uuid()]) }), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) {
    throw Object.assign(new Error("仅允许本机应用打开关联画布"), { status: 403 });
  }
  // Stable host IDs map to separate directories; retain the original shared directory for legacy data.
  const projectId = req.body.projectId === "localProject" ? "localProject" : req.body.projectId.toLowerCase();
  let directory = dirname(u.conf.path);
  for (const name of ["workspaces", "laper", projectId]) {
    directory = resolve(directory, name);
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw Object.assign(new Error("关联画布目录不能是文件或符号链接"), { status: 400 });
    }
  }
  res.json(success({ directory: await realpath(directory) }));
});
