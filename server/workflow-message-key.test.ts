import { expect, it } from "vitest";
import { resolveMessageCorrelationKey } from "./workflow-message-key";
it.each([
  {},
  [],
  true,
  false,
  null,
  undefined,
  NaN,
  Infinity,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
])("拒绝不能可靠关联消息的值 %s", value => {
  expect(() => resolveMessageCorrelationKey(value)).toThrow("相关键模板");
});
it.each(["", "   ", "x".repeat(256)])("拒绝空值与超长相关键 %s", value => {
  expect(() => resolveMessageCorrelationKey(value)).toThrow("1 至 255");
});
it.each([
  [0, "0"],
  [42, "42"],
  ["  ORDER-42  ", "ORDER-42"],
  ["业务编号", "业务编号"],
  ["x".repeat(255), "x".repeat(255)],
])("稳定解析合法业务编号 %s", (value, expected) => {
  expect(resolveMessageCorrelationKey(value)).toBe(expected);
});
