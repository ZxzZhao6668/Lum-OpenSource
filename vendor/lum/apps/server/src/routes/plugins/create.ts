import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  type: z.enum(["skill", "tool"]),
  fileName: z.string().max(104),
  source: z.string().min(1).max(20 * 1024 * 1024),
}), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) return res.status(403).json(error("请在桌面端或服务器本机安装插件", null, 403));
  const { type, fileName, source } = req.body as { type: "tool" | "skill"; fileName: string; source: string };
  if (type === "skill" && fileName !== "SKILL.md") return res.status(400).json(error("技能主文件需命名为 SKILL.md", null, 400));
  const result = type === "tool"
    ? await u.pluginInstall.installTool(fileName, source, "createOnly")
    : await u.pluginInstall.installSkill(fileName, Buffer.from(source, "utf8"), "createOnly");
  res.json(success(result, "插件已安装"));
});
