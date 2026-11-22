import { Router } from "express";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
const router = Router();
export default router.post("/", validateFields(u.previs.identityFields), async (req, res) => { res.json(success(await u.previs.cancel(req, req.body))); });
