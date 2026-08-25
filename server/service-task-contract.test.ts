import { describe, expect, it } from "vitest";
import { compileHttpServiceTask } from "../shared/service-task-contract";
import {
  isRetryableServiceTaskError,
  serviceTaskPlanToRuntimeConfig,
  serviceTaskRetryDelay,
} from "./workflow-engine";

describe("统一 HTTP ServiceTask 执行计划", () => {
  it("将 HTTP、REST 和 METHOD 编译为同一不可变契约", () => {
    const http = compileHttpServiceTask("http", {
      url: "https://example.com/read",
      method: "GET",
      timeout: 5000,
    });
    const rest = compileHttpServiceTask("rest", {
      restApi: "https://example.com/write",
      restType: "POST",
      restHeaderParam: [{ key: "x-tenant", value: "demo" }],
      restJsonParam: '{"ok":true}',
    });
    expect(http).toMatchObject({
      kind: "http",
      sourceType: "http",
      effect: "read",
      idempotency: "none",
      retryClass: "safe_read",
    });
    expect(rest).toMatchObject({
      kind: "http",
      sourceType: "rest",
      effect: "write",
      idempotency: "workflow_node_key",
      retryClass: "idempotent_write",
      bodyTemplate: { ok: true },
      writeSafety: "unconfigured",
      retry: { maxAttempts: 1, baseDelayMs: 250 },
      circuit: { failureThreshold: 5, resetAfterMs: 30000 },
      concurrency: { key: "", limit: 5 },
    });
  });

  it("运行时只消费统一计划映射，不再分别解释三套节点字段", () => {
    expect(
      serviceTaskPlanToRuntimeConfig("method", {
        restApi: "https://example.com/method",
        restType: "PATCH",
        restGetBodyParam: [{ key: "id", value: 7 }],
      })
    ).toMatchObject({
      url: "https://example.com/method",
      method: "PATCH",
      query: { id: 7 },
    });
  });

  it("仅对瞬时故障分类重试并使用有界指数退避", () => {
    expect(isRetryableServiceTaskError(new Error("HTTP 节点请求失败：503 Service Unavailable"))).toBe(true);
    expect(isRetryableServiceTaskError(new Error("HTTP 节点请求超时。"))).toBe(true);
    expect(isRetryableServiceTaskError(new Error("HTTP 节点请求失败：400 Bad Request"))).toBe(false);
    expect(serviceTaskRetryDelay(250, 1)).toBe(250);
    expect(serviceTaskRetryDelay(250, 3)).toBe(1000);
    expect(serviceTaskRetryDelay(5000, 9)).toBe(10000);
  });
});
