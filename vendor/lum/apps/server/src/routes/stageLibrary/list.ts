import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
const schema = z.object({ query: z.string().max(200).optional(), category: z.enum(["建筑", "自然", "室内", "道具", "其他"]).optional(), offset: z.coerce.number().int().min(0).max(10000).default(0), limit: z.coerce.number().int().min(1).max(100).default(40) });
export default Router().get("/", validateFields(schema.shape, "query"), async (req, res) => {
  const input = schema.parse(req.query);
  res.set("Cache-Control", "no-store").json(success(await u.stageLibrary.list(input.query, input.category, input.offset, input.limit)));
});
