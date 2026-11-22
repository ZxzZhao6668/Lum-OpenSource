import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { sendFile } from "@/utils/fileHttp";
export default Router().get("/", validateFields({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/) }, "query"), async (req, res, next) => {
  const path = await u.stageLibrary.preview(req.query.id as string);
  res.set({ "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Type": "image/png" });
  await sendFile(res, path, {}, error => { if (error) next(error); });
});
