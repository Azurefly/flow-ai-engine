import { describe, expect, it } from "vitest";
import { compileHttpServiceTask } from "../shared/service-task-contract";
import { serviceTaskPlanToRuntimeConfig } from "./workflow-engine";

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
});
