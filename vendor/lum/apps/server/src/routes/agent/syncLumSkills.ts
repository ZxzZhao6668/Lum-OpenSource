import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { lumSkillsSchema, syncLumSkills } from "@/agent/skills/lumLibrary";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), skills: lumSkillsSchema }), async (req, res) => {
  const cwd = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.json(success(await syncLumSkills(cwd, req.body.skills)));
});
