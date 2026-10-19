import { describe, expect, it } from "vitest";
import {
  canonicalResourcePayload,
  newResourceRequestKey,
  resourceRequestKeyPattern,
} from "./resource-creation";

describe("资源保存请求内容", () => {
  it("对象字段顺序不影响请求内容，数组顺序仍有意义", () => {
    expect(
      canonicalResourcePayload({ name: "订单", fields: { b: 2, a: 1 } })
    ).toBe(canonicalResourcePayload({ fields: { a: 1, b: 2 }, name: "订单" }));
    expect(canonicalResourcePayload([1, 2])).not.toBe(
      canonicalResourcePayload([2, 1])
    );
  });
  it("匹配 JSON 持久化的 undefined、日期和空值语义，特殊键不会修改对象原型", () => {
    expect(
      canonicalResourcePayload({
        missing: undefined,
        nil: null,
        date: new Date("2026-01-01T00:00:00Z"),
      })
    ).toBe('{"date":"2026-01-01T00:00:00.000Z","nil":null}');
    expect(
      canonicalResourcePayload(JSON.parse('{"__proto__":{"value":1}}'))
    ).toBe('{"__proto__":{"value":1}}');
    expect(({} as { value?: number }).value).toBeUndefined();
    expect(canonicalResourcePayload(undefined)).toBe("null");
  });
  it("生成适用于非 HTTPS 页面 getRandomValues 的保存标识", () => {
    const first = newResourceRequestKey(),
      second = newResourceRequestKey();
    expect(first).toMatch(/^[a-f0-9]{48}$/);
    expect(resourceRequestKeyPattern.test(first)).toBe(true);
    expect(first).not.toBe(second);
    for (const key of [
      "short",
      "x".repeat(97),
      " ".repeat(20),
      "x/".repeat(10),
    ])
      expect(resourceRequestKeyPattern.test(key)).toBe(false);
  });
});
