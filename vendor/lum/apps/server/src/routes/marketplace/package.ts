import { Router } from "express";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";

const router = Router();

export default router.get("/", validateFields({
  revision: u.marketplace.revisionSchema,
  file: u.marketplace.fileSchema,
}, "query"), async (req, res) => {
  u.marketplace.requireAccess(req);
  const { revision, file } = req.query as { revision: string; file: string };
  const bytes = await u.marketplace.getPackage(revision, file);
  res.set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff")
    .attachment(file.split("/").at(-1)!).type("application/octet-stream").send(bytes);
});
