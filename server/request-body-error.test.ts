import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { CorrelatedRequest } from "./_core/http-security";
import { handleRequestBodyError } from "./_core/request-body-error";

function exchange() {
  const req = { requestId: "trace-parser-1234" } as CorrelatedRequest;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() };
  return { req, res, next: vi.fn() };
}

describe("HTTP 请求正文解析错误", () => {
  it.each([
    ["entity.parse.failed", 400, "请求正文格式无效。"],
    ["querystring.parse.rangeError", 400, "表单参数的嵌套层级超过限制。"],
    ["request.aborted", 400, "请求正文未完整接收。"],
    ["request.size.invalid", 400, "请求正文长度与声明不符。"],
    ["entity.verify.failed", 403, "请求正文校验失败。"],
    ["entity.too.large", 413, "请求正文超过大小限制。"],
    ["parameters.too.many", 413, "表单参数数量超过限制。"],
    ["charset.unsupported", 415, "请求正文的字符集不受支持。"],
    ["encoding.unsupported", 415, "请求正文的内容编码不受支持。"],
    ["Z_DATA_ERROR", 400, "请求正文格式无效。"],
    ["Z_BUF_ERROR", 400, "请求正文格式无效。"],
    ["Z_NEED_DICT", 400, "请求正文格式无效。"],
  ] as const)("为 %s 返回固定消息和请求编号", (kind, status, message) => {
    const { req, res, next } = exchange();
    const error = {
      ...(kind.startsWith("Z_") ? { code: kind } : { type: kind }),
      status,
      message: "示例错误描述",
      body: "示例表单",
      stack: "示例调用栈",
    };
    handleRequestBodyError(error, req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: message, requestId: req.requestId });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    { type: "stream.not.readable", status: 500 },
    { type: "stream.encoding.set", status: 500 },
    { code: "Z_DATA_ERROR", status: 500 },
    { status: 404 },
  ])("将其他错误原样交给现有中间件", error => {
    const { req, res, next } = exchange();
    handleRequestBodyError(error, req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    { destroyed: true },
    { writableEnded: true },
    { headersSent: true },
  ])("连接结束或响应已开始时仍消费已知解析错误", state => {
    const { req, res, next } = exchange();
    const response = Object.assign(res, state);
    handleRequestBodyError(
      { type: "request.aborted", status: 400 },
      req,
      response as unknown as Response,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes("headersSent" in state ? 1 : 0);
  });
});
