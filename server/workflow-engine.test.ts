import { describe, expect, it } from "vitest";
import { assertSafeHttpUrl, interpolate, selectRouterRoute } from "./workflow-engine";

describe("工作流变量插值", () => {
  const context = { input: { topic: "流程引擎" }, nodes: { request: { body: { id: 7 } } }, vars: {} };

  it("保留纯变量的原始类型，并支持文本中的多个模板", () => {
    expect(interpolate("{{nodes.request.body.id}}", context)).toBe(7);
    expect(interpolate("主题：{{input.topic}}；编号：{{nodes.request.body.id}}", context)).toBe("主题：流程引擎；编号：7");
  });
});

describe("HTTP 节点 SSRF 防护", () => {
  it("拒绝本机、私有网段和非 HTTP 协议", async () => {
    await expect(assertSafeHttpUrl("http://localhost/private")).rejects.toThrow("本机地址");
    await expect(assertSafeHttpUrl("http://127.0.0.1/private")).rejects.toThrow("私有、环回");
    await expect(assertSafeHttpUrl("ftp://example.com/file")).rejects.toThrow("仅支持");
  });
});

describe("路由节点配置映射", () => {
  it("按 routes 中的条件选择句柄，未命中时回退至 defaultRoute", () => {
    const routes = [
      { handle: "approved", condition: { left: "{{input.status}}", operator: "equals", right: "approved" } },
      { handle: "rejected", condition: { left: "{{input.status}}", operator: "equals", right: "rejected" } },
    ];
    expect(selectRouterRoute({ routes, defaultRoute: "pending" }, { input: { status: "approved" }, vars: {}, nodes: {} }).selectedRoute).toBe("approved");
    expect(selectRouterRoute({ routes, defaultRoute: "{{input.fallback}}" }, { input: { status: "waiting", fallback: "pending" }, vars: {}, nodes: {} }).selectedRoute).toBe("pending");
  });
});
