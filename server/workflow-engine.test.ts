import { describe, expect, it } from "vitest";
import {
  assertSafeHttpUrl,
  assertJsonSchemaValue,
  evaluateApprovalResults,
  interpolate,
  normalizeApprovalResult,
  normalizeReferenceHttpConfig,
  selectRouterRoute,
  withWorkflowIdempotencyHeader,
  redactSensitiveValues,
  validateFormSubmission,
} from "./workflow-engine";

describe("工作流变量插值", () => {
  const context = {
    input: { topic: "流程引擎" },
    nodes: { request: { body: { id: 7 } } },
    vars: {},
  };

  it("保留纯变量的原始类型，并支持文本中的多个模板", () => {
    expect(interpolate("{{nodes.request.body.id}}", context)).toBe(7);
    expect(
      interpolate(
        "主题：{{input.topic}}；编号：{{nodes.request.body.id}}",
        context
      )
    ).toBe("主题：流程引擎；编号：7");
  });
});

describe("表单节点服务端校验", () => {
  const fields = [
    { key: "name", type: "text", required: true, maxLength: 10 },
    { key: "days", type: "number", min: 1, max: 30 },
    { key: "category", type: "select", options: ["annual", "sick"] },
    { key: "internal", type: "text", readOnly: true, defaultValue: "fixed" },
  ];

  it("只输出声明字段并执行必填、类型、选项与只读校验", () => {
    expect(
      validateFormSubmission(fields, {
        name: "张三",
        days: 3,
        category: "annual",
        ignored: "drop",
      })
    ).toEqual({ name: "张三", days: 3, category: "annual", internal: "fixed" });
    expect(() => validateFormSubmission(fields, { days: 3 })).toThrow("必填字段");
    expect(() => validateFormSubmission(fields, { name: "张三", days: "3" })).toThrow("有限数值");
    expect(() => validateFormSubmission(fields, { name: "张三", category: "other" })).toThrow("选项范围外");
    expect(() => validateFormSubmission(fields, { name: "张三", internal: "changed" })).toThrow("只读");
  });
});

describe("LLM 结构化输出边界", () => {
  const schema = {
    type: "object",
    required: ["decision"],
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["approved", "rejected"] },
      score: { type: "number" },
    },
  };
  it("校验必填字段、类型、枚举和额外字段", () => {
    expect(() => assertJsonSchemaValue({ decision: "approved", score: 0.9 }, schema)).not.toThrow();
    expect(() => assertJsonSchemaValue({}, schema)).toThrow("缺少必填字段");
    expect(() => assertJsonSchemaValue({ decision: "maybe" }, schema)).toThrow("枚举值");
    expect(() => assertJsonSchemaValue({ decision: "approved", extra: true }, schema)).toThrow("未允许字段");
  });

  it("持久化输入前递归脱敏凭据和授权字段", () => {
    expect(
      redactSensitiveValues({
        authorization: "Bearer secret",
        nested: { apiKey: "key", value: 7 },
      })
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", value: 7 },
    });
  });
});

describe("HTTP 节点 SSRF 防护", () => {
  it("拒绝本机、私有网段和非 HTTP 协议", async () => {
    await expect(assertSafeHttpUrl("http://localhost/private")).rejects.toThrow(
      "本机地址"
    );
    await expect(assertSafeHttpUrl("http://127.0.0.1/private")).rejects.toThrow(
      "私有、环回"
    );
    await expect(assertSafeHttpUrl("http://[::1]/private")).rejects.toThrow(
      "私有、环回"
    );
    await expect(
      assertSafeHttpUrl("http://[::ffff:172.16.0.1]/private")
    ).rejects.toThrow("私有、环回");
    await expect(assertSafeHttpUrl("ftp://example.com/file")).rejects.toThrow(
      "仅支持"
    );
  });

  it("为有副作用的请求注入稳定运行幂等键，并尊重显式配置", () => {
    const context = { runtime: { executionRunId: "run-1", executionNodeId: "notify" } };
    expect(withWorkflowIdempotencyHeader("POST", {}, context)).toEqual({
      "Idempotency-Key": "flow:run-1:notify",
    });
    expect(withWorkflowIdempotencyHeader("GET", {}, context)).toEqual({});
    expect(withWorkflowIdempotencyHeader("PATCH", { "idempotency-key": "business-key" }, context)).toEqual({
      "idempotency-key": "business-key",
    });
  });
});

describe("原版 REST 与方法节点配置映射", () => {
  it("将 GET 参数、请求头和入口参数转换到受限 HTTP 执行器", () => {
    expect(
      normalizeReferenceHttpConfig({
        restApi: "https://example.com/search",
        restType: "get",
        restHeaderParam: [
          { key: "x-token", value: "{{input.token}}" },
          { key: "", value: "ignored" },
        ],
        restGetBodyParam: [{ key: "keyword", value: "{{input.keyword}}" }],
        restAttributeMap: { restEntryParam: { page: 2 } },
      })
    ).toEqual({
      url: "https://example.com/search",
      method: "GET",
      headers: { "x-token": "{{input.token}}" },
      body: undefined,
      query: { keyword: "{{input.keyword}}", page: 2 },
      timeout: undefined,
    });
  });

  it("解析原版 JSON 请求体并兼容当前 endpoint、method、headers、body 字段", () => {
    expect(
      normalizeReferenceHttpConfig({
        restApi: "https://example.com/orders",
        restType: "POST",
        restJsonParam: JSON.stringify({ id: 7, enabled: true }),
      })
    ).toMatchObject({ method: "POST", body: { id: 7, enabled: true } });

    expect(
      normalizeReferenceHttpConfig({
        endpoint: "https://example.com/compatible",
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: { status: "done" },
      })
    ).toMatchObject({
      url: "https://example.com/compatible",
      method: "PATCH",
      headers: { authorization: "Bearer token" },
      body: { status: "done" },
    });
  });
});

describe("路由节点配置映射", () => {
  it("按 routes 中的条件选择句柄，未命中时回退至 defaultRoute", () => {
    const routes = [
      {
        handle: "approved",
        condition: {
          left: "{{input.status}}",
          operator: "equals",
          right: "approved",
        },
      },
      {
        handle: "rejected",
        condition: {
          left: "{{input.status}}",
          operator: "equals",
          right: "rejected",
        },
      },
    ];
    expect(
      selectRouterRoute(
        { routes, defaultRoute: "pending" },
        { input: { status: "approved" }, vars: {}, nodes: {} }
      ).selectedRoute
    ).toBe("approved");
    expect(
      selectRouterRoute(
        { routes, defaultRoute: "{{input.fallback}}" },
        {
          input: { status: "waiting", fallback: "pending" },
          vars: {},
          nodes: {},
        }
      ).selectedRoute
    ).toBe("pending");
  });
});

describe("人工审批决定与多人签署门槛", () => {
  it("拒绝无明确决定的结果，并要求拒绝意见", () => {
    expect(() => normalizeApprovalResult({})).toThrow("必须明确选择同意或拒绝");
    expect(() => normalizeApprovalResult({ decision: "rejected" })).toThrow(
      "必须填写处理意见"
    );
    expect(
      normalizeApprovalResult({ decision: "approved", comment: " 同意 " })
    ).toMatchObject({ decision: "approved", comment: "同意" });
    expect(
      normalizeApprovalResult({ decision: "rejected", comment: " 资料不完整 " })
    ).toMatchObject({ decision: "rejected", comment: "资料不完整" });
  });

  it("或签只在有人通过时完成，所有人拒绝后才拒绝", () => {
    expect(
      evaluateApprovalResults({
        totalApprovers: 3,
        requiredApprovals: 1,
        results: [{ decision: "rejected" }],
      })
    ).toMatchObject({
      outcome: "waiting",
      approved: 0,
      rejected: 1,
      pending: 2,
    });
    expect(
      evaluateApprovalResults({
        totalApprovers: 3,
        requiredApprovals: 1,
        results: [{ decision: "rejected" }, { decision: "approved" }],
      })
    ).toMatchObject({ outcome: "approved", approved: 1, rejected: 1 });
    expect(
      evaluateApprovalResults({
        totalApprovers: 3,
        requiredApprovals: 1,
        results: [
          { decision: "rejected" },
          { decision: "rejected" },
          { decision: "rejected" },
        ],
      })
    ).toMatchObject({ outcome: "rejected", approved: 0, rejected: 3 });
  });

  it("会签在剩余票数不可能达到门槛时提前拒绝", () => {
    expect(
      evaluateApprovalResults({
        totalApprovers: 3,
        requiredApprovals: 2,
        results: [{ decision: "approved" }],
      })
    ).toMatchObject({ outcome: "waiting", approved: 1, pending: 2 });
    expect(
      evaluateApprovalResults({
        totalApprovers: 3,
        requiredApprovals: 2,
        results: [{ decision: "approved" }, { decision: "rejected" }],
      })
    ).toMatchObject({
      outcome: "waiting",
      approved: 1,
      rejected: 1,
      pending: 1,
    });
    expect(
      evaluateApprovalResults({
        totalApprovers: 3,
        requiredApprovals: 2,
        results: [{ decision: "rejected" }, { decision: "rejected" }],
      })
    ).toMatchObject({
      outcome: "rejected",
      approved: 0,
      rejected: 2,
      pending: 1,
    });
  });
});
