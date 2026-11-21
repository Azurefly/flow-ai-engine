import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { assistantToolDefinitions, commitAssistantTool, prepareAssistantTool } from "./assistant-tools";
import { compareCondition } from "./workflow-routing";

const services = vi.hoisted(() => ({
  getProjectAccess: vi.fn(),
  getProject: vi.fn(),
  listProjectPage: vi.fn(),
  createProjectWorkflow: vi.fn(),
  listDataResourceOptions: vi.fn(),
  dataflowResourceDiagnostics: vi.fn(),
  listWorkflowTasks: vi.fn(),
  updateP1SystemSetting: vi.fn(),
  getP1SystemSettings: vi.fn(),
  listWorkflows: vi.fn(),
  query: vi.fn(),
}));
vi.mock("./project-service", () => services);
vi.mock("./p2-service", () => services);
vi.mock("./dataflow-resource-readiness", () => services);
vi.mock("./p1-service", () => services);
vi.mock("./workflow-service", () => services);
vi.mock("./db", () => ({ getSharedPool: () => ({ query: services.query }) }));

const user = { id: 7, role: "user" as const, tokenVersion: 2 };
const admin = { ...user, role: "admin" as const };
const projectId = "procurement01";
const context = { projectId };
const requestKey = "assistant-confirmation-001";
const reimbursement = (threshold: number) => ({
  name: "报销审批",
  flowType: "control",
  nodes: [
    { id: "start", type: "start", name: "开始" },
    {
      id: "amount",
      type: "condition",
      name: "金额判断",
      field: "amount",
      operator: "greaterThan",
      value: threshold,
    },
    {
      id: "finance",
      type: "operate",
      name: "财务复核",
      assignee: "role",
      role: "财务",
    },
    {
      id: "manager",
      type: "operate",
      name: "部门审批",
      assignee: "department_manager",
    },
    { id: "end", type: "end", name: "完成" },
  ],
  edges: [
    { from: "start", to: "amount" },
    { from: "amount", branch: "true", to: "finance" },
    { from: "amount", branch: "false", to: "manager" },
    { from: "finance", to: "end" },
    { from: "manager", to: "end" },
  ],
});

beforeEach(() => {
  vi.resetAllMocks();
  services.getProjectAccess.mockResolvedValue({
    permissions: new Set(["project:workflow:create"]),
  });
  services.getProject.mockResolvedValue({
    id: projectId,
    name: "采购业务",
    code: "PURCHASE",
  });
  services.query.mockResolvedValue([[{ code: "finance", name: "财务" }]]);
  services.listDataResourceOptions.mockResolvedValue({ assets: [], connectorVersions: [] });
  services.dataflowResourceDiagnostics.mockResolvedValue([]);
});

describe("对话业务工具", () => {
  it("向模型公开数据节点的扁平字段定义", () => {
    const draft = assistantToolDefinitions.find(tool => tool.function.name === "createWorkflowDraft");
    expect(draft?.function.parameters).toMatchObject({
      properties: { nodes: { items: {
        type: "object",
        required: ["id", "name", "type"],
        properties: {
          asset: expect.objectContaining({ type: "string" }),
          field: expect.objectContaining({ type: "string" }),
          metrics: expect.objectContaining({ type: "array" }),
        },
      } } },
    });
  });
  it.each(["state", "control"])("为 %s 流程选择兼容的并行汇合节点", async flowType => {
    const graph = {
      name: "财务和法务并审", flowType,
      nodes: [
        { id:"start",type:"start",name:"开始" }, {id:"fork",type:"parallel",name:"启动并审",joinId:"join"},
        ...["finance","legal"].map(id => ({id,type:"operate",name:id,assignee:"initiator"})),
        {id:"join",type:"merge",forkId:"fork",name:"汇总结果"}, {id:"end",type:"end",name:"结束"},
      ],
      edges:[["start","fork"],["fork","finance"],["fork","legal"],["finance","join"],["legal","join"],["join","end"]].map(([from,to])=>({from,to})),
    };
    const preview = await prepareAssistantTool(user,"createWorkflowDraft",graph,context);
    if (preview.kind !== "proposal" || preview.proposal.tool !== "createWorkflowDraft") throw new Error("缺少画布");
    const definition = preview.proposal.payload.definition;
    expect(definition.nodes.find(n=>n.id==="fork")?.config).toMatchObject({broadcast:true,parallelJoinNodeId:"join"});
    expect(definition.edges.filter(e=>e.sourceNodeId==="fork").map(e=>e.sourceHandle)).toEqual(["finance","legal"]);
    expect(definition.nodes.find(n=>n.id==="join")).toMatchObject({
      type: flowType === "state" ? "state" : "transform",
      config: { parallelForNodeId: "fork" },
    });
    await expect(prepareAssistantTool(user,"createWorkflowDraft",{...graph,edges:graph.edges.map(e=>e.from==="legal"?{...e,to:"end"}:e)},context)).rejects.toThrow();
  });
  it("将数据流程绑定到同一业务的真实资产，确认前只准备画布", async () => {
    const graph = {
      name: "订单地区汇总", flowType: "data",
      nodes: [
        { id: "start", type: "start", name: "开始" },
        { id: "orders", type: "source", name: "读订单", asset: "订单样本" },
        { id: "paid", type: "filter", name: "已付款", field: "status", value: "paid" },
        { id: "totals", type: "aggregate", name: "地区汇总", groupBy: ["region"], metrics: [{ name: "total", operation: "sum", field: "amount" }] },
        { id: "end", type: "end", name: "查看汇总" },
      ],
      edges: [["start", "orders"], ["orders", "paid"], ["paid", "totals"], ["totals", "end"]].map(([from, to]) => ({ from, to })),
    };
    services.listDataResourceOptions.mockResolvedValue({
      assets: [{ name: "订单样本", value: "ordersAsset1", disabled: false, nativeReadable: true }], connectorVersions: [],
    });
    const prepared = await prepareAssistantTool(user, "createWorkflowDraft", graph, context);
    if (prepared.kind !== "proposal" || prepared.proposal.tool !== "createWorkflowDraft") throw new Error("缺少数据草稿");
    const draft = prepared.proposal.payload.definition;
    expect(draft.nodes.find(n => n.type === "source")?.config).toMatchObject({ assetId: "ordersAsset1" });
    expect(draft.nodes.find(n => n.type === "filter")?.config).toMatchObject({ filterField: "status", filterValue: "paid" });
    expect(prepared.proposal.summary).toContain("数据流程");
    expect(services.dataflowResourceDiagnostics).toHaveBeenCalledWith(expect.anything(), projectId, draft);
    expect(services.createProjectWorkflow).not.toHaveBeenCalled();

    services.listDataResourceOptions.mockResolvedValueOnce({ assets: [], connectorVersions: [] });
    await expect(prepareAssistantTool(user, "createWorkflowDraft", graph, context)).rejects.toThrow("订单样本");
    services.listDataResourceOptions.mockResolvedValueOnce({ assets: [
      { name: "订单样本", value: "ordersAsset1", disabled: false }, { name: "订单样本", value: "ordersAsset2", disabled: false },
    ], connectorVersions: [] });
    await expect(prepareAssistantTool(user, "createWorkflowDraft", graph, context)).rejects.toThrow("同名");
    services.listDataResourceOptions.mockResolvedValueOnce({
      assets: [{ name: "订单样本", value: "ordersAsset1", disabled: false, nativeReadable: false }],
      connectorVersions: [{ id: "ordersVersion1", assetId: "ordersAsset1", kind: "file_read", enabled: true, label: "月度订单" }],
    });
    const pinned = await prepareAssistantTool(user, "createWorkflowDraft", graph, context);
    if (pinned.kind !== "proposal" || pinned.proposal.tool !== "createWorkflowDraft") throw new Error("缺少文件资源草稿");
    expect(pinned.proposal.payload.definition.nodes.find(n => n.type === "source")?.config.connectorVersionId).toBe("ordersVersion1");
  });
  it("将审批角色、条件和两个真实去向显示在审批草稿中；可以预览后修订", async () => {
    const first = await prepareAssistantTool(
      user,
      "createWorkflowDraft",
      reimbursement(5000),
      context
    );
    const revised = await prepareAssistantTool(
      user,
      "createWorkflowDraft",
      reimbursement(8000),
      context
    );
    if (
      first.kind !== "proposal" ||
      revised.kind !== "proposal" ||
      revised.proposal.tool !== "createWorkflowDraft"
    )
      throw new Error("缺少提案");
    expect(first.proposal.details).toContain(
      "金额判断 · 输入 amount 大于 5000"
    );
    expect(revised.proposal.details).toEqual(
      expect.arrayContaining([
        "金额判断 · 输入 amount 大于 8000",
        "金额判断（成立） → 财务复核",
        "金额判断（不成立） → 部门审批",
        "财务复核 · 办理人：财务（finance）",
      ])
    );
    expect(services.createProjectWorkflow).not.toHaveBeenCalled();
    const decision = revised.proposal.payload.definition.nodes.find(
      node => node.id === "amount"
    )!.config;
    expect(
      compareCondition(8000, String(decision.operator), decision.right)
    ).toBe(false);
    expect(
      compareCondition(8000.01, String(decision.operator), decision.right)
    ).toBe(true);
    services.createProjectWorkflow.mockResolvedValue({
      id: "created-flow",
      name: "报销审批",
    });
    const result = await commitAssistantTool(
      user,
      revised.proposal,
      requestKey
    );
    expect(result.workflowId).toBe("created-flow");
    expect(services.createProjectWorkflow).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        requestKey,
        projectId,
        definition: revised.proposal.payload.definition,
      })
    );
    services.createProjectWorkflow.mockRejectedValueOnce(new Error("无权创建"));
    await expect(
      commitAssistantTool(user, revised.proposal, requestKey)
    ).rejects.toThrow("无权创建");
  });
  it("不允许模型改变会话绑定的项目或代替用户选择目标", async () => {
    await expect(
      prepareAssistantTool(
        user,
        "createWorkflowDraft",
        { ...reimbursement(1), projectId: "otherProject" },
        context
      )
    ).rejects.toThrow("绑定");
    await expect(
      prepareAssistantTool(user, "createWorkflowDraft", reimbursement(1), {})
    ).rejects.toThrow("目标业务项目");
    services.getProjectAccess.mockResolvedValueOnce({ permissions: new Set() });
    await expect(
      prepareAssistantTool(
        user,
        "createWorkflowDraft",
        reimbursement(1),
        context
      )
    ).rejects.toThrow("无权");
    expect(services.query).not.toHaveBeenCalled();
  });
  it("角色不存在、分支短缺时阻止生成并提示修正", async () => {
    services.query.mockResolvedValueOnce([[]]);
    await expect(
      prepareAssistantTool(
        user,
        "createWorkflowDraft",
        reimbursement(1),
        context
      )
    ).rejects.toThrow("审批角色");
    const graph = reimbursement(3);
    graph.edges.splice(2, 1);
    await expect(
      prepareAssistantTool(user, "createWorkflowDraft", graph, context)
    ).rejects.toThrow(/分支|不可达/);
    expect(services.createProjectWorkflow).not.toHaveBeenCalled();
  });
  it("查询沿用登录身份和项目范围，仅返回简要信息以及已授权的入口", async () => {
    services.listWorkflowTasks.mockResolvedValue([
      {
        id: "task01",
        nodeName: "提交",
        workflowName: "申请",
        workflowId: "workflow01",
        runId: "run000001",
        status: "pending",
        instruction: "内部文档",
      },
    ]);
    const tasks = await prepareAssistantTool(user, "listMyTasks", {}, context);
    expect(services.listWorkflowTasks).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ view: "todo", projectId, summaryOnly: true })
    );
    expect(tasks).toMatchObject({
      kind: "read",
      links: [{ href: "#/runs/workbench/task/task01" }],
    });
    expect(JSON.stringify(tasks)).not.toContain("内部文档");
    services.listWorkflows.mockResolvedValue([
      {
        id: "workflow01",
        name: "报销",
        status: "draft",
        flowType: "state",
        definition: { secret: "不要返回" },
      },
    ]);
    const flows = await prepareAssistantTool(
      user,
      "searchWorkflows",
      { search: "报销" },
      context
    );
    expect(services.listWorkflows).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ projectId, search: "报销", summaryOnly: true })
    );
    expect(flows).toMatchObject({
      kind: "read",
      links: [{ href: "#/flows/workflow/workflow01/detail" }],
    });
    expect(JSON.stringify(flows)).not.toContain("不要返回");
  });
  it("已办以本人和当前项目查询，返回完成时间与工作台入口", async () => {
    const completedAt = "2026-11-18T12:00:00Z";
    services.listWorkflowTasks.mockResolvedValue([{
      id: "done01", nodeName: "复核", workflowName: "采购", workflowId: "flow01",
      status: "completed", completedAt, resultJson: { comment: "内部意见" },
    }]);
    const completed = await prepareAssistantTool(user, "listMyCompletedTasks", { limit: 3 }, context);
    expect(services.listWorkflowTasks).toHaveBeenCalledWith(user, {
      view: "done", projectId, summaryOnly: true, limit: 3,
    });
    expect(completed).toEqual({
      kind: "read", message: "已查询我的已办。",
      result: [{ id: "done01", nodeName: "复核", workflowName: "采购", workflowId: "flow01", status: "completed", completedAt }],
      links: [{ label: "采购 · 复核 · 查看已办", href: "#/runs/workbench/task/done01" }],
    });
  });
  it("配置预览仅供管理员使用，保存委托给带版本检查的业务事务", async () => {
    await expect(
      prepareAssistantTool(user, "updateWatermark", { enabled: false }, context)
    ).rejects.toThrow("管理员");
    expect(services.getP1SystemSettings).not.toHaveBeenCalled();
    services.getP1SystemSettings.mockResolvedValue({
      general: {
        platformName: "Flow",
        watermarkEnabled: true,
        watermarkText: "资料",
      },
      configTokens: { general: "original-token" },
    });
    const result = await prepareAssistantTool(
      admin,
      "updateWatermark",
      { text: "保密资料" },
      context
    );
    if (result.kind !== "proposal") throw new Error("缺少配置预览");
    expect(result.proposal.details).toContain("水印文字：资料 → 保密资料");
    expect(services.updateP1SystemSetting).not.toHaveBeenCalled();
    await expect(
      commitAssistantTool(user, result.proposal, requestKey)
    ).rejects.toThrow("管理员");
    services.updateP1SystemSetting.mockResolvedValueOnce({});
    await commitAssistantTool(admin, result.proposal, requestKey);
    expect(services.updateP1SystemSetting).toHaveBeenCalledWith(
      admin,
      "general",
      { watermarkText: "保密资料" },
      "original-token",
      undefined,
      requestKey
    );
    const conflict = new TRPCError({
      code: "CONFLICT",
      message: "已被其他管理员更新",
    });
    services.updateP1SystemSetting.mockRejectedValueOnce(conflict);
    await expect(
      commitAssistantTool(admin, result.proposal, requestKey)
    ).rejects.toThrow("其他管理员");
    services.updateP1SystemSetting.mockResolvedValueOnce({ replayed: true });
    await expect(
      commitAssistantTool(admin, result.proposal, requestKey)
    ).resolves.toEqual({ message: "此水印提案已确认并保存。" });
    await expect(
      prepareAssistantTool(
        admin,
        "updateWatermark",
        { text: "", enabled: true },
        context
      )
    ).rejects.toThrow("水印文本");
    await expect(
      prepareAssistantTool(
        admin,
        "updateWatermark",
        { platformName: "修改平台名" },
        context
      )
    ).rejects.toThrow("参数无效");
  });
});
