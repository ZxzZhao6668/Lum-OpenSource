import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const router = Router();

export default router.get("/", async (req, res) => {
  u.marketplace.requireAccess(req);
  res.set("Cache-Control", "private, no-store").json(success(await u.marketplace.getCatalog()));
});
