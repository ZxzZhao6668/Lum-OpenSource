import type { Request, Response } from "express";
import u from "@/utils";
import type { AuthenticatedOptions, Channel } from "@/utils/channel/types";
import { success } from "@/lib/responseFormat";

function getAccountToken() {
  const account = u.conf.get("settings", {}).lumAccount as { token?: unknown } | null | undefined;
  return typeof account?.token === "string" ? account.token.trim() : "";
}

export default async function channelRequest(
  req: Request,
  res: Response,
  action: (channel: Channel, options: AuthenticatedOptions) => Promise<unknown>,
  authenticated = false,
) {
  res.set("Cache-Control", "no-store");
  u.mcpControl.assertAppRequest(req);
  const token = authenticated ? getAccountToken() : "";
  if (authenticated && (!token || req.get("authorization") !== `Bearer ${token}`)) {
    throw Object.assign(new Error("当前会话无权执行此操作"), { status: 401 });
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  req.once("aborted", abort);
  req.socket.once("close", abort);
  if (req.aborted || res.destroyed || req.socket.destroyed) abort();
  try {
    controller.signal.throwIfAborted();
    const result = await action(u.channel.getChannel(), { token, signal: controller.signal });
    if (authenticated && getAccountToken() !== token) {
      throw Object.assign(new Error("账号已变更，请刷新后重试"), { status: 401 });
    }
    if (!controller.signal.aborted && !res.destroyed) res.json(success(result));
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    res.off("close", abort);
    req.off("aborted", abort);
    req.socket.off("close", abort);
  }
}
