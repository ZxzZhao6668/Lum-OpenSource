import { lstat, readFile, open } from "@lum/file";
import { createHash } from "node:crypto";
import { sendFile } from "@/utils/fileHttp";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096), snapshot: z.enum(["true"]).optional(), inspect: z.enum(["true"]).optional(), maxBytes: z.coerce.number().int().positive().max(20 * 1024 * 1024).optional() }, "query"), async (req, res, next) => {
  const { path } = await u.workspaceFile.resolveWorkspaceFile(req, req.query.directory as string, req.query.path as string);
  const file = await lstat(path);
  if (!file.isFile()) throw Object.assign(new Error("只能读取文件"), { status: 400 });
  res.set("Cache-Control", "no-store");
  if (req.query.inspect === "true") {
    const handle = await open(path, "r");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      const before = await handle.stat();
      if (before.dev !== file.dev || before.ino !== file.ino || before.mtimeMs !== file.mtimeMs || before.ctimeMs !== file.ctimeMs) throw Object.assign(new Error("检查前源文件发生变化"), { status: 409 });
      if (!before.isFile() || before.size > 20 * 1024 ** 3) throw Object.assign(new Error("只能检查不超过 20 GiB 的普通文件"), { status: 413 });
      const hash = createHash("sha256");
      let size = 0;
      const stream = handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024, signal: controller.signal });
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > before.size) { stream.destroy(); throw Object.assign(new Error("检查期间源文件发生变化"), { status: 409 }); }
        hash.update(chunk);
      }
      const after = await handle.stat();
      const current = await lstat(path);
      if (size !== before.size || [after, current].some(value => !value.isFile() || value.dev !== before.dev || value.ino !== before.ino || value.size !== before.size || value.mtimeMs !== before.mtimeMs || value.ctimeMs !== before.ctimeMs)) {
        throw Object.assign(new Error("检查期间源文件发生变化"), { status: 409 });
      }
      res.json(success({ path: req.query.path, sha256: hash.digest("hex"), size }));
    } finally { res.off("close", cancel); await handle.close(); }
    return;
  }
  if (req.query.snapshot === "true") {
    const maxBytes = req.query.maxBytes === undefined ? undefined : Number(req.query.maxBytes);
    if (maxBytes !== undefined && file.size > maxBytes) throw Object.assign(new Error("文件超过本次文本读取的大小限制"), { status: 413 });
    const bytes = await readFile(path);
    if (maxBytes !== undefined && bytes.length > maxBytes) throw Object.assign(new Error("文件超过本次文本读取的大小限制"), { status: 413 });
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be"
        : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8-bom" : "utf-8";
    let text: string;
    try {
      text = new TextDecoder(encoding === "utf-8-bom" ? "utf-8" : encoding, { fatal: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("binary");
    } catch {
      throw Object.assign(new Error("文件不是受支持的 UTF-8 或带 BOM 的 UTF-16 文本，请先用原编辑器转换编码后再打开，原文件未修改"), { status: 415 });
    }
    res.json(success({ text, encoding, revision: createHash("sha256").update(bytes).digest("hex") }));
    return;
  }
  await sendFile(res, path, { dotfiles: "allow" }, err => { if (err) next(err); });
});
