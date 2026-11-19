import type { NextFunction, Response } from "express";
import type { CorrelatedRequest } from "./http-security";

const inputErrors = new Map<string, readonly [number, string]>([
  ["entity.parse.failed", [400, "请求正文格式无效。"]],
  ["querystring.parse.rangeError", [400, "表单参数的嵌套层级超过限制。"]],
  ["request.aborted", [400, "请求正文未完整接收。"]],
  ["request.size.invalid", [400, "请求正文长度与声明不符。"]],
  ["entity.verify.failed", [403, "请求正文校验失败。"]],
  ["entity.too.large", [413, "请求正文超过大小限制。"]],
  ["parameters.too.many", [413, "表单参数数量超过限制。"]],
  ["charset.unsupported", [415, "请求正文的字符集不受支持。"]],
  ["encoding.unsupported", [415, "请求正文的内容编码不受支持。"]],
]);

const compressionErrors = new Set(["Z_DATA_ERROR", "Z_BUF_ERROR", "Z_NEED_DICT"]);

export function handleRequestBodyError(
  error: unknown,
  req: CorrelatedRequest,
  res: Response,
  next: NextFunction
) {
  const metadata = error as { type?: string; code?: string; status?: number } | null;
  const type =
    metadata?.status === 400 && compressionErrors.has(metadata.code ?? "")
      ? "entity.parse.failed"
      : metadata?.type;
  const failure = type && inputErrors.get(type);
  if (!failure || metadata?.status !== failure[0]) return next(error);

  // Parser errors can carry the entire request body. Consume known client
  // errors here, even if the peer already disconnected.
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(failure[0]).json({ error: failure[1], requestId: req.requestId });
}
