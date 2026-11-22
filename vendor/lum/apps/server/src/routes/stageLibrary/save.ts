import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { isStageLibraryModel } from "@lum/node-shared/stageLibrary";
export default Router().post("/", validateFields({ model: z.unknown().refine(isStageLibraryModel, "模型格式无效") }), async (req, res) => {
  res.json(success(await u.stageLibrary.save(req.body.model)));
});
