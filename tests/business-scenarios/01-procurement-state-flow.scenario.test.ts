import { describe, expect, it } from "vitest";
import {
  compileWorkflowDefinition,
  type WorkflowDefinition,
} from "../../server/workflow-compiler";
import {
  selectRouterRoutes,
  validateOperateOutcomeSubmission,
  evaluateApprovalResults,
  canTransitionWorkflowRunStatus,
  assertWorkflowRunTransition,
} from "../../server/workflow-engine";
import {
  hasStateInnateOperation,
  showSigningPercent,
} from "../../client/src/components/workflow-config-editor";

describe("业务场景验证 1：企业级复杂采购与大额支出多级审批流 (Procurement & Payment State Flow)", () => {
  // 1. 业务定义与 DAG 编排（严格遵循 State -> Operate -> State 状态机范式）
  const procurementWorkflowDefinition: WorkflowDefinition = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {
      enableAudit: true,
      titleTemplate: "采购审批-{{input.itemName}}-¥{{input.amount}}",
    },
    nodes: [
      {
        id: "node-start",
        type: "start",
        name: "开始",
        position: { x: 50, y: 150 },
        config: {},
      },
      {
        id: "node-state-init",
        type: "state",
        name: "草稿已提交",
        position: { x: 200, y: 150 },
        config: {
          nodeDh: "ST_INIT",
          jdmc: "采购申请草稿已提交",
          stateType: "business",
          flowStatus: "SUBMITTED",
        },
      },
      {
        id: "node-router-amount",
        type: "router",
        name: "金额阈值分流",
        position: { x: 380, y: 150 },
        config: {
          routes: [
            {
              handle: "small_amount",
              targetNodeId: "node-op-mgr-direct",
              priority: 100,
              condition: {
                left: "{{input.amount}}",
                operator: "lessThan",
                right: 10001,
              },
            },
            {
              handle: "large_amount",
              targetNodeId: "node-op-mgr-review",
              priority: 200,
              condition: {
                left: "{{input.amount}}",
                operator: "greaterThan",
                right: 10000,
              },
            },
          ],
          defaultRoute: "small_amount",
        },
      },
      // 小额分支：主管直接办结
      {
        id: "node-op-mgr-direct",
        type: "operate",
        name: "部门主管快速审批",
        position: { x: 580, y: 60 },
        config: {
          nodeDh: "OP_MGR_DIRECT",
          czmc: "主管小额审批",
          assigneeMode: "role",
          assigneeRoleCode: "dept_manager",
          signMode: "orSignFor",
          outcomeMode: "explicit",
          outcomes: [
            { code: "approved", label: "同意", sourceHandle: "approved" },
            { code: "rejected", label: "驳回", sourceHandle: "rejected", requireComment: true },
          ],
        },
      },
      // 大额分支：主管初审 -> 状态过渡 -> 财务法务并行会签 -> 状态过渡 -> CFO终审
      {
        id: "node-op-mgr-review",
        type: "operate",
        name: "部门主管初审",
        position: { x: 580, y: 260 },
        config: {
          nodeDh: "OP_MGR_REVIEW",
          czmc: "主管大额初审",
          assigneeMode: "role",
          assigneeRoleCode: "dept_manager",
          signMode: "orSignFor",
          outcomeMode: "explicit",
          outcomes: [
            { code: "approved", label: "同意", sourceHandle: "approved" },
            { code: "rejected", label: "驳回", sourceHandle: "rejected", requireComment: true },
          ],
        },
      },
      {
        id: "node-state-mgr-approved",
        type: "state",
        name: "初审通过待会签",
        position: { x: 750, y: 260 },
        config: {
          nodeDh: "ST_MGR_APPROVED",
          jdmc: "初审通过待财法联合会签",
          stateType: "business",
          flowStatus: "PENDING_FIN_LEGAL",
        },
      },
      {
        id: "node-op-fin-legal",
        type: "operate",
        name: "财务与法务联合会签",
        position: { x: 920, y: 260 },
        config: {
          nodeDh: "OP_FIN_LEGAL",
          czmc: "财法双签",
          assigneeMode: "role",
          assigneeRoleCode: "fin_and_legal_group",
          signMode: "andSignFor",
          signingPercent: 100,
          outcomeMode: "explicit",
          outcomes: [
            { code: "approved", label: "通过", sourceHandle: "approved" },
            { code: "rejected", label: "否决", sourceHandle: "rejected", requireComment: true },
          ],
        },
      },
      {
        id: "node-state-fin-approved",
        type: "state",
        name: "会签完成待终审",
        position: { x: 1090, y: 260 },
        config: {
          nodeDh: "ST_FIN_APPROVED",
          jdmc: "会签完成待CFO终审",
          stateType: "business",
          flowStatus: "PENDING_CFO",
        },
      },
      {
        id: "node-op-cfo",
        type: "operate",
        name: "CFO终审",
        position: { x: 1260, y: 260 },
        config: {
          nodeDh: "OP_CFO",
          czmc: "财务总监终审",
          assigneeMode: "role",
          assigneeRoleCode: "cfo",
          signMode: "orSignFor",
          outcomeMode: "explicit",
          outcomes: [
            { code: "approved", label: "批准付款", sourceHandle: "approved" },
            { code: "rejected", label: "终止付款", sourceHandle: "rejected", requireComment: true },
          ],
        },
      },
      {
        id: "node-state-paid",
        type: "state",
        name: "审批通过已付款",
        position: { x: 1450, y: 150 },
        config: {
          nodeDh: "ST_PAID",
          jdmc: "采购付款办结",
          stateType: "business",
          flowStatus: "APPROVED_PAID",
          innateOperations: [{ bj: true }], // 办结
        },
      },
      {
        id: "node-state-rejected",
        type: "state",
        name: "申请已驳回",
        position: { x: 920, y: 440 },
        config: {
          nodeDh: "ST_REJECTED",
          jdmc: "采购申请不予通过",
          stateType: "business",
          flowStatus: "REJECTED",
          innateOperations: [{ bj: true }],
        },
      },
      {
        id: "node-end",
        type: "end",
        name: "结束",
        position: { x: 1620, y: 150 },
        config: {},
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "node-start", targetNodeId: "node-state-init" },
      { id: "e2", sourceNodeId: "node-state-init", targetNodeId: "node-router-amount" },
      // 路由出口
      { id: "e-small", sourceNodeId: "node-router-amount", sourceHandle: "small_amount", targetNodeId: "node-op-mgr-direct" },
      { id: "e-large", sourceNodeId: "node-router-amount", sourceHandle: "large_amount", targetNodeId: "node-op-mgr-review" },
      // 小额流转
      { id: "e-mgr-direct-ok", sourceNodeId: "node-op-mgr-direct", sourceHandle: "approved", targetNodeId: "node-state-paid" },
      { id: "e-mgr-direct-rej", sourceNodeId: "node-op-mgr-direct", sourceHandle: "rejected", targetNodeId: "node-state-rejected" },
      // 大额流转：操作 -> 状态 -> 操作 -> 状态
      { id: "e-mgr-rev-ok", sourceNodeId: "node-op-mgr-review", sourceHandle: "approved", targetNodeId: "node-state-mgr-approved" },
      { id: "e-mgr-rev-rej", sourceNodeId: "node-op-mgr-review", sourceHandle: "rejected", targetNodeId: "node-state-rejected" },
      { id: "e-mgr-to-fin", sourceNodeId: "node-state-mgr-approved", targetNodeId: "node-op-fin-legal" },
      { id: "e-fin-legal-ok", sourceNodeId: "node-op-fin-legal", sourceHandle: "approved", targetNodeId: "node-state-fin-approved" },
      { id: "e-fin-legal-rej", sourceNodeId: "node-op-fin-legal", sourceHandle: "rejected", targetNodeId: "node-state-rejected" },
      { id: "e-fin-to-cfo", sourceNodeId: "node-state-fin-approved", targetNodeId: "node-op-cfo" },
      { id: "e-cfo-ok", sourceNodeId: "node-op-cfo", sourceHandle: "approved", targetNodeId: "node-state-paid" },
      { id: "e-cfo-rej", sourceNodeId: "node-op-cfo", sourceHandle: "rejected", targetNodeId: "node-state-rejected" },
      // 终态汇聚
      { id: "e-paid-end", sourceNodeId: "node-state-paid", targetNodeId: "node-end" },
      { id: "e-rej-end", sourceNodeId: "node-state-rejected", targetNodeId: "node-end" },
    ],
  };

  it("步骤 1：业务流程拓扑语义静态编译与不可变执行计划生成", () => {
    const compiled = compileWorkflowDefinition(procurementWorkflowDefinition, {
      flowType: "state",
    });

    expect(compiled.ok).toBe(true);
    expect(compiled.definition.nodes.length).toBe(12);
    expect(compiled.definition.edges.length).toBe(16);
    expect(compiled.plan).toBeDefined();
    expect(compiled.plan?.entryNodeId).toBe("node-start");
    expect(compiled.plan?.terminalNodeIds).toContain("node-end");
  });

  it("步骤 2：动态金额条件路由验证（小额 <= 10000 走快速通道，大额 > 10000 走多级初审）", () => {
    const routerNode = procurementWorkflowDefinition.nodes.find(
      n => n.id === "node-router-amount"
    )!;

    // 测试小额入参：¥5,000
    const smallContext = {
      input: { itemName: "外接机械键盘", amount: 5000, dept: "研发二部" },
    };
    const smallRoutes = selectRouterRoutes(routerNode.config, smallContext, [101]);
    expect(smallRoutes.selectedBranches.length).toBe(1);
    expect(smallRoutes.selectedBranches[0].handle).toBe("small_amount");
    expect(smallRoutes.selectedBranches[0].targetNodeId).toBe("node-op-mgr-direct");

    // 测试边界值：¥10,000（应小于等于 10001，走小额快速通道）
    const boundaryContext = {
      input: { itemName: "显示器批量采购", amount: 10000, dept: "研发二部" },
    };
    const boundaryRoutes = selectRouterRoutes(routerNode.config, boundaryContext, [101]);
    expect(boundaryRoutes.selectedBranches.length).toBe(1);
    expect(boundaryRoutes.selectedBranches[0].handle).toBe("small_amount");

    // 测试大额入参：¥85,000（> 10000 触发大额审批路径）
    const largeContext = {
      input: { itemName: "高性能研发GPU服务器", amount: 85000, dept: "AI研发中心" },
    };
    const largeRoutes = selectRouterRoutes(routerNode.config, largeContext, [101]);
    expect(largeRoutes.selectedBranches.length).toBe(1);
    expect(largeRoutes.selectedBranches[0].handle).toBe("large_amount");
    expect(largeRoutes.selectedBranches[0].targetNodeId).toBe("node-op-mgr-review");
  });

  it("步骤 3：小额采购快速办理流（Happy Path：主管同意并直接完成审批）", () => {
    const opNode = procurementWorkflowDefinition.nodes.find(
      n => n.id === "node-op-mgr-direct"
    )!;

    // 校验主管表决通过（不填处理意见在同意时被允许）
    const outcomeContract = {
      mode: "explicit",
      handles: { approved: "approved", rejected: "rejected" },
      outcomes: opNode.config.outcomes,
    };
    expect(() =>
      validateOperateOutcomeSubmission(outcomeContract, {
        decision: "approved",
        comment: "",
      })
    ).not.toThrow();

    // 或签模式单人同意即判定通过
    const evaluation = evaluateApprovalResults({
      totalApprovers: 1,
      requiredApprovals: 1,
      results: [{ decision: "approved" }],
    });
    expect(evaluation.completed).toBe(1);
    expect(evaluation.approved).toBe(1);
    expect(evaluation.outcome).toBe("approved");

    // 状态流转验证：运行实例生命周期流转至 SUCCESS
    expect(canTransitionWorkflowRunStatus("running", "success")).toBe(true);
    expect(() => assertWorkflowRunTransition("running", "success")).not.toThrow();
  });

  it("步骤 4：大额采购初审主管出差场景（任务移交 Handover 与代办状态重置）", () => {
    type TaskState = {
      taskId: string;
      title: string;
      status: "pending" | "claimed" | "completed";
      assigneeUserId: number | null;
      handoverHistory: Array<{ fromUser: number; toUser: number; reason: string; time: string }>;
    };

    const task: TaskState = {
      taskId: "task-procure-85k-001",
      title: "高性能研发GPU服务器采购初审",
      status: "claimed",
      assigneeUserId: 101, // 原主管 张经理
      handoverHistory: [],
    };

    // 业务规则：本人出差，移交给代班主管 李总监(102)，移交后必须重置为 pending 释放锁定
    const executeHandover = (
      currentTask: TaskState,
      operatorId: number,
      targetUserId: number,
      reason: string
    ): TaskState => {
      if (operatorId !== currentTask.assigneeUserId) {
        throw new Error("只有当前任务领取人可以执行移交操作。");
      }
      if (targetUserId === currentTask.assigneeUserId) {
        throw new Error("任务不可移交给当前同一处理人。");
      }
      if (!reason.trim()) {
        throw new Error("任务移交必须注明移交原因。");
      }
      return {
        ...currentTask,
        status: "pending",
        assigneeUserId: targetUserId,
        handoverHistory: [
          ...currentTask.handoverHistory,
          {
            fromUser: operatorId,
            toUser: targetUserId,
            reason: reason.trim(),
            time: new Date().toISOString(),
          },
        ],
      };
    };

    // 1. 移交失败测试：未注明原因
    expect(() =>
      executeHandover(task, 101, 102, "  ")
    ).toThrow("任务移交必须注明移交原因");

    // 2. 正常移交成功
    const handedTask = executeHandover(
      task,
      101,
      102,
      "本人因参加国际技术峰会出差3天，特移交李总监代审。"
    );
    expect(handedTask.status).toBe("pending");
    expect(handedTask.assigneeUserId).toBe(102);
    expect(handedTask.handoverHistory.length).toBe(1);
    expect(handedTask.handoverHistory[0].fromUser).toBe(101);

    // 3. 代班主管领取并同意初审
    const opNode = procurementWorkflowDefinition.nodes.find(
      n => n.id === "node-op-mgr-review"
    )!;
    const outcomeContract = {
      mode: "explicit",
      handles: { approved: "approved", rejected: "rejected" },
      outcomes: opNode.config.outcomes,
    };
    expect(() =>
      validateOperateOutcomeSubmission(outcomeContract, {
        decision: "approved",
        comment: "经核实AI团队算力预算充足，同意进入财法会签。",
      })
    ).not.toThrow();
  });

  it("步骤 5：大额采购财法会签冲突与驳回意见必填门禁验证", () => {
    const finLegalNode = procurementWorkflowDefinition.nodes.find(
      n => n.id === "node-op-fin-legal"
    )!;

    // 会签百分比检查
    expect(showSigningPercent(finLegalNode.config.signMode as any)).toBe(true);

    // 场景 A：驳回意见必填门禁
    const outcomeContract = {
      mode: "explicit",
      handles: { approved: "approved", rejected: "rejected" },
      outcomes: finLegalNode.config.outcomes,
    };
    expect(() =>
      validateOperateOutcomeSubmission(outcomeContract, {
        decision: "rejected",
        comment: "", // 空意见强制拦截
      })
    ).toThrow("必须填写处理意见");

    // 场景 B：会签冲突（财务同意但法务驳回）
    expect(() =>
      validateOperateOutcomeSubmission(outcomeContract, {
        decision: "approved",
        comment: "财务部：预算充裕，款项到位。",
      })
    ).not.toThrow();

    expect(() =>
      validateOperateOutcomeSubmission(outcomeContract, {
        decision: "rejected",
        comment: "法务部：供应商出具的保修与责任限制条款不满足企业合规标准，予以否决。",
      })
    ).not.toThrow();

    // andSignFor 会签判定：2人全员需同意，一人拒绝(rejected=1, approved=1)导致 approved(1) + pending(0) < 2，触发整体驳回
    const evalResult = evaluateApprovalResults({
      totalApprovers: 2,
      requiredApprovals: 2,
      results: [
        { decision: "approved" },
        { decision: "rejected" },
      ],
    });

    expect(evalResult.completed).toBe(2);
    expect(evalResult.approved).toBe(1);
    expect(evalResult.rejected).toBe(1);
    expect(evalResult.outcome).toBe("rejected"); // 最终判定为驳回

    // 状态流转至申请驳回状态 (ST_REJECTED)
    expect(canTransitionWorkflowRunStatus("running", "failed")).toBe(true);
  });

  it("步骤 6：大额采购财法全员通过 -> CFO终审办结完成完整闭环", () => {
    const cfoNode = procurementWorkflowDefinition.nodes.find(
      n => n.id === "node-op-cfo"
    )!;
    const paidStateNode = procurementWorkflowDefinition.nodes.find(
      n => n.id === "node-state-paid"
    )!;

    // 1. 财法双人会签全员通过（approved=2，达到 requiredApprovals=2）
    const bothApproved = evaluateApprovalResults({
      totalApprovers: 2,
      requiredApprovals: 2,
      results: [
        { decision: "approved" },
        { decision: "approved" },
      ],
    });
    expect(bothApproved.completed).toBe(2);
    expect(bothApproved.approved).toBe(2);
    expect(bothApproved.outcome).toBe("approved");

    // 2. CFO 终审批准
    const cfoContract = {
      mode: "explicit",
      handles: { approved: "approved", rejected: "rejected" },
      outcomes: cfoNode.config.outcomes,
    };
    expect(() =>
      validateOperateOutcomeSubmission(cfoContract, {
        decision: "approved",
        comment: "CFO已复核，准予向供应商付款。",
      })
    ).not.toThrow();

    // 3. 办结（bj）内置操作检查
    expect(hasStateInnateOperation(paidStateNode.config.innateOperations as any, "bj")).toBe(true);

    // 4. 实例流转为成功结束状态
    expect(canTransitionWorkflowRunStatus("running", "success")).toBe(true);
  });
});
