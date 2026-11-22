import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
export default Router().get("/", validateFields({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/) }, "query"), async (req, res) => {
  res.set("Cache-Control", "no-store").json(success(await u.stageLibrary.read(req.query.id as string)));
});
