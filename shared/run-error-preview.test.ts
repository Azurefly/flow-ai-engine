import { expect, it } from "vitest";
import { runErrorPreview } from "./run-error-preview";
it("错误原因直接显示，堆栈独立且其他字段保留", () => {
  const value = {
    message: "端点已停用",
    code: "ENDPOINT_DISABLED",
    context: { projectId: "p1" },
    config: { endpointRef: "API" },
    stack: "Error: endpoint\n at execute",
  };
  expect(runErrorPreview(JSON.stringify(value))).toEqual({
    message: value.message,
    stack: value.stack,
    details: { code: value.code, context: value.context, config: value.config },
  });
  expect(value).toHaveProperty("message");
});
it("纯文本错误和 JSON 字符串均保持原文", () => {
  expect(runErrorPreview("请求超时").message).toBe("请求超时");
  expect(runErrorPreview('"业务规则拒绝"').message).toBe("业务规则拒绝");
});
it.each([false, 0, null, ["a", "b"]])("非标准错误 %s 保留详情", value =>
  expect(runErrorPreview(value).details).toEqual(value)
);
it("非文本 message 和 stack 不丢失，特殊字段安全保留", () => {
  const result = runErrorPreview(
    '{"message":{"code":12},"stack":["a"],"__proto__":"历史字段"}'
  );
  expect(result.message).toBeNull();
  expect(result.stack).toBeNull();
  expect(result.details).toEqual(
    JSON.parse('{"message":{"code":12},"stack":["a"],"__proto__":"历史字段"}')
  );
});
it("空对象与 JSON null 没有虚构的错误原因", () => {
  expect(runErrorPreview({})).toEqual({
    message: null,
    details: null,
    stack: null,
  });
  expect(runErrorPreview("null").message).toBeNull();
});
