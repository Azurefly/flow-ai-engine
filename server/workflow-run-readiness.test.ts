import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  permission: vi.fn(),
  project: vi.fn(),
  preview: vi.fn(),
  resources: vi.fn(),
  query: vi.fn(),
}));
vi.mock("./workflow-service", () => ({
  getWorkflow: mocks.get,
  hasWorkflowPermission: mocks.permission,
}));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.project }));
vi.mock("./workflow-approval-preview", () => ({
  previewOperateApproval: mocks.preview,
}));
vi.mock("./dataflow-resource-readiness", () => ({
  dataflowResourceDiagnostics: mocks.resources,
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import {
  inspectRunParticipants,
  inspectWorkflowRunReadiness,
} from "./workflow-run-readiness";
import { assertRunPreflightRevision } from "./workflow-run-revision";
import {
  compileWorkflowDefinition,
  hashWorkflowExecutionPlan,
  type WorkflowDefinition,
} from "./workflow-compiler";
import { createDefaultNodeConfig } from "../shared/workflow-node-contract";
import { canonicalResourcePayload } from "../shared/resource-creation";

function definition(config: Record<string, unknown> = {}): WorkflowDefinition {
  return {
    schemaVersion: 1,
    settings: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "start",
        name: "开始",
        type: "start",
        position: { x: 0, y: 0 },
        config: createDefaultNodeConfig("start"),
      },
      {
        id: "review",
        name: "审批",
        type: "operate",
        position: { x: 300, y: 0 },
        config: {
          ...createDefaultNodeConfig("operate"),
          outcomeMode: "legacy_cancel",
          outcomes: [],
          assigneeMode: "user",
          assigneeUserId: 7,
          ...config,
        },
      },
      {
        id: "end",
        name: "结束",
        type: "end",
        position: { x: 600, y: 0 },
        config: createDefaultNodeConfig("end"),
      },
    ],
    edges: [
      {
        id: "a",
        sourceNodeId: "start",
        targetNodeId: "review",
        sourceHandle: "default",
      },
      {
        id: "b",
        sourceNodeId: "review",
        targetNodeId: "end",
        sourceHandle: "approved",
      },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.project.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:workflow:edit", "project:workflow:run"]),
  });
  mocks.preview.mockResolvedValue({ totalApprovers: 2, signModeLabel: "会签" });
  mocks.resources.mockResolvedValue([]);
  mocks.get.mockResolvedValue({
    id: "workflow",
    definitionVersion: 3,
    flowType: "control",
    status: "draft",
    definition: definition(),
  });
});

describe("本次运行的只读就绪检查", () => {
  it("保存时的JSON属性重排不使本次输入失效，真实修改或关闭窗口仍会失效", () => {
    const before = { nodes: [{ id: "review", config: { mode: "user", userId: 7 } }] };
    const saved = { nodes: [{ config: { userId: 7, mode: "user" }, id: "review" }] };
    const key = (open: boolean, graph: unknown, userId: string | number = 7) => canonicalResourcePayload([open, "workflow", { userId }, graph, []]);
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(saved));
    expect(key(true, saved)).toBe(key(true, before));
    expect(key(false, saved)).not.toBe(key(true, before));
    expect(key(true, saved, "7")).not.toBe(key(true, before));
    expect(key(true, { nodes: [] })).not.toBe(key(true, before));
  });
  it.each([
    "initiator",
    "initiator_manager",
    "initiator_manager_n",
    "initiator_manager_3",
    "department_manager",
    "form_user",
  ])("用实际输入检查%s，不伪造发起人", async mode => {
    const config = {
      assigneeMode: mode,
      assigneeFormField: "input.approverId",
    };
    const input = { approverId: 9 };
    const result = await inspectRunParticipants(
      "workflow",
      definition(config),
      7,
      input
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.checks[0].status).toBe("checked");
    expect(mocks.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          input,
          runtime: expect.objectContaining({ triggeredByUserId: 7 }),
        }),
      })
    );
  });
  it.each(["sender_manager", "receivers", "form_user"])(
    "运行中依赖%s不使用空上下文给出假成功",
    async mode => {
      const result = await inspectRunParticipants(
        "workflow",
        definition({
          assigneeMode: mode,
          assigneeFormField: "vars.nextApprover",
        }),
        7,
        {}
      );
      expect(result.checks[0].status).toBe("deferred");
      expect(mocks.preview).not.toHaveBeenCalled();
    }
  );
  it("首个人工节点处理人不可用时阻止发起，未执行任何读写节点", async () => {
    mocks.preview.mockRejectedValue(new Error("人员已停用"));
    const result = await inspectWorkflowRunReadiness(
      { id: 7, role: "user" },
      { workflowId: "workflow", mode: "test" }
    );
    expect(result.canStart).toBe(false);
    expect(result.issues[0].code).toBe("WF_PARTICIPANTS_UNAVAILABLE");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("不将未确定的后续分支解析失败变成全流程阻断", async () => {
    const graph = definition();
    graph.nodes.push({ ...graph.nodes[0], id: "route", type: "router" });
    graph.edges[0].targetNodeId = "route";
    graph.edges.push(
      { id: "path", sourceNodeId: "route", targetNodeId: "review" },
      { id: "bypass", sourceNodeId: "route", targetNodeId: "end" }
    );
    mocks.preview.mockRejectedValue(new Error("当前无候选人"));
    const result = await inspectRunParticipants("workflow", graph, 7, {});
    expect(result.diagnostics).toEqual([]);
    expect(result.checks[0]).toMatchObject({
      status: "deferred",
      message: expect.stringContaining("当前解析未通过"),
    });
  });
  it("分支汇入同一首个人工节点时，必达的无效处理人会提前阻断", async () => {
    const graph = definition();
    graph.nodes.push(
      { ...graph.nodes[0], id: "route", type: "router" },
      { ...graph.nodes[0], id: "left", type: "transform" },
      { ...graph.nodes[0], id: "right", type: "transform" }
    );
    graph.edges[0].targetNodeId = "route";
    graph.edges.push(
      { id: "l", sourceNodeId: "route", targetNodeId: "left" },
      { id: "r", sourceNodeId: "route", targetNodeId: "right" },
      { id: "lr", sourceNodeId: "left", targetNodeId: "review" },
      { id: "rr", sourceNodeId: "right", targetNodeId: "review" }
    );
    mocks.preview.mockRejectedValue(new Error("处理人已停用"));
    const result = await inspectRunParticipants("workflow", graph, 7, {});
    expect(result.checks[0].status).toBe("blocked");
    expect(result.diagnostics[0].location.nodeId).toBe("review");
  });
  it("检查真实发布快照，未发布画布不会覆盖检查对象", async () => {
    const compiled = compileWorkflowDefinition(definition(), {
      flowType: "control",
    });
    mocks.get.mockResolvedValue({
      id: "workflow",
      definitionVersion: 4,
      flowType: "control",
      status: "published",
      publishedExecutionPlanJson: JSON.stringify(compiled.plan),
      publishedExecutionPlanHash: compiled.planHash,
      definition: { nodes: [], edges: [] },
    });
    const result = await inspectWorkflowRunReadiness(
      { id: 7, role: "user" },
      { workflowId: "workflow", mode: "test" }
    );
    expect(result).toMatchObject({
      canStart: true,
      executionSource: "published_plan",
      definitionVersion: 4,
      planHash: compiled.planHash,
    });
  });
  it("发布快照损坏作为阻断诊断返回，不执行其他检查", async () => {
    const compiled = compileWorkflowDefinition(definition(), {
      flowType: "control",
    });
    mocks.get.mockResolvedValue({
      id: "workflow",
      definitionVersion: 4,
      flowType: "control",
      status: "published",
      publishedExecutionPlanJson: compiled.plan,
      publishedExecutionPlanHash: "0".repeat(64),
      definition: definition(),
    });
    const result = await inspectWorkflowRunReadiness(
      { id: 7, role: "user" },
      { workflowId: "workflow", mode: "test" }
    );
    expect(result).toMatchObject({
      canStart: false,
      executionSource: "published_plan",
      planHash: null,
    });
    expect(result.issues[0].code).toBe("WF_EXECUTION_PLAN_INVALID");
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("已发布快照中的旧聚合字段也检查当前执行合同，保留原快照", async () => {
    const graph = definition();
    graph.nodes[1] = {
      ...graph.nodes[1],
      type: "source",
      config: { ...createDefaultNodeConfig("source"), assetId: "asset-1" },
    };
    graph.nodes.push({
      id: "aggregate",
      name: "汇总",
      type: "aggregate",
      position: { x: 500, y: 0 },
      config: {
        groupBy: [],
        metrics: [{ name: "total", operation: "sum", field: "amount" }],
      },
    });
    graph.edges[1] = {
      ...graph.edges[1],
      sourceHandle: "default",
      targetNodeId: "aggregate",
    };
    graph.edges.push({
      id: "c",
      sourceNodeId: "aggregate",
      targetNodeId: "end",
      sourceHandle: "default",
    });
    const compiled = compileWorkflowDefinition(graph, { flowType: "data" });
    compiled.plan.definition.nodes.find(
      node => node.id === "aggregate"
    )!.config.metrics = [{ as: "total", op: "sum", field: "amount" }];
    const before = JSON.stringify(compiled.plan);
    mocks.get.mockResolvedValue({
      id: "workflow",
      projectId: "project",
      projectStatus: "active",
      definitionVersion: 4,
      flowType: "data",
      status: "published",
      publishedExecutionPlanJson: compiled.plan,
      publishedExecutionPlanHash: hashWorkflowExecutionPlan(compiled.plan),
      definition: graph,
    });
    const result = await inspectWorkflowRunReadiness(
      { id: 7, role: "user" },
      { workflowId: "workflow", mode: "formal" }
    );
    expect(result.canStart).toBe(false);
    expect(
      result.issues.some(issue => issue.location.nodeId === "aggregate")
    ).toBe(true);
    expect(JSON.stringify(compiled.plan)).toBe(before);
    expect(mocks.resources).not.toHaveBeenCalled();
  });
  it("无运行权限时不解析人员或读取资源", async () => {
    mocks.permission.mockResolvedValue(false);
    await expect(
      inspectWorkflowRunReadiness(
        { id: 7, role: "user" },
        { workflowId: "workflow", mode: "test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.resources).not.toHaveBeenCalled();
  });
  it("数据草稿需要业务编辑权限，正式运行需要业务运行权限", async () => {
    mocks.get.mockResolvedValue({
      id: "workflow",
      projectId: "project",
      projectStatus: "active",
      definitionVersion: 3,
      flowType: "data",
      status: "draft",
      definition: definition(),
    });
    mocks.project.mockResolvedValue({
      exists: true,
      permissions: new Set(["project:workflow:run"]),
    });
    await expect(
      inspectWorkflowRunReadiness(
        { id: 7, role: "user" },
        { workflowId: "workflow", mode: "test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      inspectWorkflowRunReadiness(
        { id: 7, role: "user" },
        { workflowId: "workflow", mode: "formal" }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("数据流程检查业务资源元数据，不读取数据行或探测连接", async () => {
    const graph = definition();
    graph.nodes[1] = {
      ...graph.nodes[1],
      type: "source",
      config: { ...createDefaultNodeConfig("source"), assetId: "asset-1" },
    };
    graph.edges[1].sourceHandle = "default";
    mocks.get.mockResolvedValue({
      id: "workflow",
      projectId: "project",
      projectStatus: "active",
      definitionVersion: 3,
      flowType: "data",
      status: "draft",
      definition: graph,
    });
    mocks.resources.mockResolvedValue([
      {
        code: "DATAFLOW_RESOURCE_UNAVAILABLE",
        message: "资源已停用",
        location: { kind: "node", nodeId: "review" },
      },
    ]);
    const result = await inspectWorkflowRunReadiness(
      { id: 7, role: "user" },
      { workflowId: "workflow", mode: "test" }
    );
    expect(result.canStart).toBe(false);
    expect(mocks.resources).toHaveBeenCalledWith(
      expect.anything(),
      "project",
      expect.objectContaining({ nodes: expect.any(Array) })
    );
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("基础设施失败保留请求失败，不能显示检查通过", async () => {
    mocks.preview.mockRejectedValue(
      Object.assign(new Error("database unavailable"), { code: "ECONNRESET" })
    );
    await expect(
      inspectWorkflowRunReadiness(
        { id: 7, role: "user" },
        { workflowId: "workflow", mode: "test" }
      )
    ).rejects.toThrow("database unavailable");
  });
  it("当前结构无效返回定位诊断，不执行人员查询", async () => {
    mocks.get.mockResolvedValue({
      id: "workflow",
      definitionVersion: 3,
      flowType: "control",
      status: "draft",
      definition: { nodes: [], edges: [] },
    });
    const result = await inspectWorkflowRunReadiness(
      { id: 7, role: "user" },
      { workflowId: "workflow", mode: "test" }
    );
    expect(result.canStart).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("运行版本或执行计划已变化时拒绝创建，旧调用保持兼容", () => {
    expect(() => assertRunPreflightRevision(3, "a", {})).not.toThrow();
    expect(() =>
      assertRunPreflightRevision(3, "a", {
        expectedDefinitionVersion: 3,
        expectedExecutionPlanHash: "a",
      })
    ).not.toThrow();
    expect(() =>
      assertRunPreflightRevision(4, "a", { expectedDefinitionVersion: 3 })
    ).toThrow("运行版本已变化");
    expect(() =>
      assertRunPreflightRevision(3, "b", { expectedExecutionPlanHash: "a" })
    ).toThrow("运行版本已变化");
  });
});
