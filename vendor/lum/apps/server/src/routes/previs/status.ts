import { Router } from "express";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
const router = Router();
export default router.get("/", validateFields(u.previs.identityFields, "query"), async (req, res) => { res.set("Cache-Control", "no-store").json(success(await u.previs.status(req, req.query))); });
