import { describe, expect, it } from "vitest";
import {
  compileWorkflowDefinition,
  type WorkflowDefinition,
} from "../../server/workflow-compiler";
import {
  selectRouterRoutes,
  interpolate,
  parseStructuredLlmOutput,
  assertJsonSchemaValue,
  withWorkflowIdempotencyHeader,
  isRetryableServiceTaskError,
  serviceTaskRetryDelay,
  canTransitionWorkflowRunStatus,
} from "../../server/workflow-engine";
import { compileHttpServiceTask } from "../../shared/service-task-contract";

describe("业务场景验证 2：智能客户售后工单与故障自动化诊断分流 (Smart Ticket & AI Auto-Triage Control Flow)", () => {
  // 1. 控制流 DAG 编排定义：包含 REST 客户校验、LLM 智能分析、Router 分流、PagerDuty 紧急告警与 CRM 入库
  // 流程必须且仅能包含 1 个开始节点和 1 个结束节点，两个分支最终汇聚至统一结束节点
  const smartTicketWorkflowDefinition: WorkflowDefinition = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {
      enableAudit: true,
      titleTemplate: "工单自动化分析-[{{input.ticketId}}]-{{input.customerName}}",
    },
    nodes: [
      {
        id: "node-start",
        type: "start",
        name: "客户工单Webhook触发",
        position: { x: 50, y: 150 },
        config: {},
      },
      {
        id: "node-rest-customer",
        type: "rest",
        name: "查询客户签约等级与SLA",
        position: { x: 220, y: 150 },
        config: {
          nodeDh: "REST_CRM_QUERY",
          restmc: "查询CRM客户SLA",
          restType: "GET",
          restApi: "https://crm.internal.example.com/api/v1/customers/{{input.customerId}}",
          timeout: 5000,
          retryMaxAttempts: 3,
          retryBaseDelayMs: 200,
        },
      },
      {
        id: "node-llm-triage",
        type: "llm",
        name: "AI大模型工单诊断与情绪分类",
        position: { x: 440, y: 150 },
        config: {
          model: "claude-3-5-sonnet",
          systemPrompt:
            "你是一名SaaS平台高级支持工程师。请分析客户报障内容，返回严格合法的JSON格式，包含severity(SEV1/SEV2/SEV3/SEV4)、sentiment(ANGRY/URGENT/NEUTRAL)、category(OUTAGE/BILLING/FEATURE_REQUEST)、recommendedAction。",
          prompt:
            "客户ID: {{input.customerId}}，签约等级: {{nodes.node-rest-customer.vipLevel}}，工单描述: {{input.rawDescription}}",
          maxTokens: 512,
          timeoutMs: 15000,
        },
      },
      {
        id: "node-router-triage",
        type: "router",
        name: "智能工单分流路由",
        position: { x: 680, y: 150 },
        config: {
          relation: "or",
          routes: [
            {
              handle: "urgent_escalation",
              targetNodeId: "node-rest-pagerduty",
              priority: 200,
              conditions: [
                {
                  left: "{{nodes.node-llm-triage.severity}}",
                  operator: "equals",
                  right: "SEV1",
                },
                {
                  left: "{{nodes.node-rest-customer.vipLevel}}",
                  operator: "equals",
                  right: "VIP",
                },
              ],
            },
            {
              handle: "standard_queue",
              targetNodeId: "node-rest-crm-ticket",
              priority: 100,
              conditions: [
                {
                  left: "{{nodes.node-llm-triage.severity}}",
                  operator: "equals",
                  right: "SEV4",
                },
              ],
            },
          ],
          defaultRoute: "standard_queue",
        },
      },
      // 紧急分支：值班工程师告警
      {
        id: "node-rest-pagerduty",
        type: "rest",
        name: "值班工程师即时呼叫告警",
        position: { x: 920, y: 60 },
        config: {
          nodeDh: "REST_PAGERDUTY",
          restmc: "触发PagerDuty紧急值班响应",
          restType: "POST",
          restApi: "https://pagerduty.internal.example.com/v2/enqueue",
          timeout: 10000,
          writeSafety: "idempotent",
          retryMaxAttempts: 3,
          retryBaseDelayMs: 300,
        },
      },
      // 常规分支：常规工单入库
      {
        id: "node-rest-crm-ticket",
        type: "rest",
        name: "创建常规支持工单",
        position: { x: 920, y: 260 },
        config: {
          nodeDh: "REST_CREATE_TICKET",
          restmc: "写入客服CRM工单池",
          restType: "POST",
          restApi: "https://crm.internal.example.com/api/v1/tickets",
          timeout: 5000,
          writeSafety: "idempotent",
          retryMaxAttempts: 2,
          retryBaseDelayMs: 250,
        },
      },
      // 统一汇聚结束节点
      {
        id: "node-end",
        type: "end",
        name: "工单调度流程结束",
        position: { x: 1150, y: 150 },
        config: {},
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "node-start", targetNodeId: "node-rest-customer" },
      { id: "e2", sourceNodeId: "node-rest-customer", targetNodeId: "node-llm-triage" },
      { id: "e3", sourceNodeId: "node-llm-triage", targetNodeId: "node-router-triage" },
      // 路由分支
      { id: "e-urgent", sourceNodeId: "node-router-triage", sourceHandle: "urgent_escalation", targetNodeId: "node-rest-pagerduty" },
      { id: "e-standard", sourceNodeId: "node-router-triage", sourceHandle: "standard_queue", targetNodeId: "node-rest-crm-ticket" },
      // 终态汇聚
      { id: "e-end-urg", sourceNodeId: "node-rest-pagerduty", targetNodeId: "node-end" },
      { id: "e-end-std", sourceNodeId: "node-rest-crm-ticket", targetNodeId: "node-end" },
    ],
  };

  it("步骤 1：控制流（Control Flow）拓扑定义编译验证与类型隔离校验", () => {
    const compiled = compileWorkflowDefinition(smartTicketWorkflowDefinition, {
      flowType: "control",
    });

    expect(compiled.ok).toBe(true);
    expect(compiled.definition.nodes.length).toBe(7);
    expect(compiled.definition.edges.length).toBe(7);
    expect(compiled.plan?.entryNodeId).toBe("node-start");
    expect(compiled.plan?.terminalNodeIds).toEqual(["node-end"]);
  });

  it("步骤 2：REST 服务调用任务编译与幂等性 Header 注入验证", () => {
    const restNode = smartTicketWorkflowDefinition.nodes.find(
      n => n.id === "node-rest-pagerduty"
    )!;

    // 编译成标准 HttpServiceTaskPlan
    const taskPlan = compileHttpServiceTask("rest", restNode.config);
    expect(taskPlan).not.toBeNull();
    expect(taskPlan?.method).toBe("POST");
    expect(taskPlan?.urlTemplate).toContain("pagerduty.internal.example.com");

    // 幂等性防护：高频网络抖动下必须带入幂等唯一标识 Idempotency-Key: flow:{runId}:{nodeId}
    const baseHeaders = { "Content-Type": "application/json" };
    const runtimeContext = {
      runtime: {
        executionRunId: "run-ticket-20260916-9901",
        executionNodeId: "node-rest-pagerduty",
      },
    };
    const headersWithIdempotency = withWorkflowIdempotencyHeader(
      "POST",
      baseHeaders,
      runtimeContext
    );

    expect(headersWithIdempotency["Idempotency-Key"]).toBe(
      "flow:run-ticket-20260916-9901:node-rest-pagerduty"
    );
  });

  it("步骤 3：LLM 提示词模板动态变量插值（客户上下文 + 报障描述）", () => {
    const llmNode = smartTicketWorkflowDefinition.nodes.find(
      n => n.id === "node-llm-triage"
    )!;

    const runtimeContext = {
      input: {
        customerId: "CUST-TENANT-8821",
        customerName: "未来零售科技",
        ticketId: "TCK-2026-0916-01",
        rawDescription: "生产环境数据库连接池耗尽，前端全部报500无法结算下单！急！",
      },
      nodes: {
        "node-rest-customer": {
          vipLevel: "VIP",
          slaTier: "Platinum-24x7",
          assignedTam: "张架构师",
        },
      },
    };

    const resolvedPrompt = String(interpolate(llmNode.config.prompt, runtimeContext));

    expect(resolvedPrompt).toContain("CUST-TENANT-8821");
    expect(resolvedPrompt).toContain("VIP");
    expect(resolvedPrompt).toContain("生产环境数据库连接池耗尽");
    expect(resolvedPrompt).not.toContain("{{");
  });

  it("步骤 4：LLM 结构化输出解析与 Schema 契约校验", () => {
    const rawJsonPayload = JSON.stringify({
      severity: "SEV1",
      sentiment: "ANGRY",
      category: "OUTAGE",
      recommendedAction: "立即呼叫数据库SRE专家，介入排查连接池泄露并启动热备实例。",
      estimatedImpactUsers: 50000,
    });

    const parsed = parseStructuredLlmOutput(rawJsonPayload) as Record<string, unknown>;

    expect(parsed).toBeDefined();
    expect(parsed.severity).toBe("SEV1");
    expect(parsed.sentiment).toBe("ANGRY");
    expect(parsed.category).toBe("OUTAGE");
    expect(parsed.estimatedImpactUsers).toBe(50000);

    // Schema 枚举与类型断言校验
    expect(() =>
      assertJsonSchemaValue(parsed.severity, {
        type: "string",
        enum: ["SEV1", "SEV2", "SEV3", "SEV4"],
      })
    ).not.toThrow();

    expect(() =>
      assertJsonSchemaValue("INVALID_SEV", {
        type: "string",
        enum: ["SEV1", "SEV2", "SEV3", "SEV4"],
      })
    ).toThrow("不在允许的枚举值中");
  });

  it("步骤 5：紧急场景分流（VIP 客户 + SEV1 故障 -> 命中紧急工程师呼叫分支）", () => {
    const routerNode = smartTicketWorkflowDefinition.nodes.find(
      n => n.id === "node-router-triage"
    )!;

    const urgentContext = {
      nodes: {
        "node-rest-customer": { vipLevel: "VIP" },
        "node-llm-triage": {
          severity: "SEV1",
          sentiment: "ANGRY",
          category: "OUTAGE",
        },
      },
    };

    const routes = selectRouterRoutes(routerNode.config, urgentContext, [101]);
    expect(routes.selectedBranches.length).toBe(1);
    expect(routes.selectedBranches[0].handle).toBe("urgent_escalation");
    expect(routes.selectedBranches[0].targetNodeId).toBe("node-rest-pagerduty");

    // 实例运行状态平滑流转
    expect(canTransitionWorkflowRunStatus("running", "success")).toBe(true);
  });

  it("步骤 6：普通咨询场景分流（普通客户 + SEV4 账单咨询 -> 命中常规客服工单分支）", () => {
    const routerNode = smartTicketWorkflowDefinition.nodes.find(
      n => n.id === "node-router-triage"
    )!;

    const standardContext = {
      nodes: {
        "node-rest-customer": { vipLevel: "Standard" },
        "node-llm-triage": {
          severity: "SEV4",
          sentiment: "NEUTRAL",
          category: "BILLING",
        },
      },
    };

    const routes = selectRouterRoutes(routerNode.config, standardContext, [101]);
    expect(routes.selectedBranches.length).toBe(1);
    expect(routes.selectedBranches[0].handle).toBe("standard_queue");
    expect(routes.selectedBranches[0].targetNodeId).toBe("node-rest-crm-ticket");
  });

  it("步骤 7：外部服务抖动重试机制验证（503 Service Unavailable 指数退避）", () => {
    // 1. 判定是否为可重试服务错误（包含 503 / 502 / timeout / ECONNRESET）
    const http503Error = new Error("HTTP 503 Service Unavailable from external API");
    const http502Error = new Error("HTTP 502 Bad Gateway");
    const http400Error = new Error("HTTP 400 Bad Request - Invalid Parameter");

    expect(isRetryableServiceTaskError(http503Error)).toBe(true);
    expect(isRetryableServiceTaskError(http502Error)).toBe(true);
    expect(isRetryableServiceTaskError(http400Error)).toBe(false); // 400 客户端错误不触发重试

    // 2. 指数退避延时计算（第 1 次、第 2 次、第 3 次重试延时阶梯增长）
    const baseDelay = 200; // ms
    const delay1 = serviceTaskRetryDelay(baseDelay, 1);
    const delay2 = serviceTaskRetryDelay(baseDelay, 2);
    const delay3 = serviceTaskRetryDelay(baseDelay, 3);

    expect(delay1).toBe(200); // 200 * 2^0 = 200
    expect(delay2).toBe(400); // 200 * 2^1 = 400
    expect(delay3).toBe(800); // 200 * 2^2 = 800
  });
});
