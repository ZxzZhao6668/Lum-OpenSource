import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
const router = Router();
export default router.put("/", validateFields({ blenderPath: z.string().max(4096) }), async (req, res) => { res.json(success(await u.previs.saveSettings(req.body.blenderPath))); });
