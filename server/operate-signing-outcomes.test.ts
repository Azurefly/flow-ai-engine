import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { WorkflowCompileError } from "./workflow-compiler";
import {
  assertOperateOutcomes,
  readOperateOutcomes,
} from "../shared/workflow-node-contract";
import {
  aggregateOutcomeCode,
  contractOutcomeDecision,
  outcomeDecision,
  assertSigningOutcomes,
} from "../shared/operate-signing-outcomes";
import {
  evaluateApprovalResults,
  validateWorkflowTaskSubmission,
  resolveOperateOutcomeRouting,
} from "./workflow-engine";
const outcomes = [
  {
    code: "feedback_ok",
    label: "反馈完成",
    sourceHandle: "to_parent",
    decision: "approved",
  },
  {
    code: "rework",
    label: "退回补正",
    sourceHandle: "to_branch",
    decision: "rejected",
    requireComment: true,
  },
  {
    code: "defer",
    label: "弃权",
    sourceHandle: "single_only",
    decision: "abstained",
  },
];
const contract = {
  mode: "explicit",
  outcomes,
  handles: Object.fromEntries(outcomes.map(x => [x.code, x.sourceHandle])),
};
const task = {
  approvalGroupId: "group",
  outcomeHandlesJson: contract,
  payload: { config: { formSchema: { fields: [] } } },
};
describe("多人签署业务结果合同", () => {
  it.each(["orSignFor", "andSignFor", "sequentialSignFor"])(
    "%s保留业务代号和含义",
    mode => {
      const config = {
        outcomeMode: "explicit",
        outcomes,
        bdcz: { hqhqsz: mode },
      };
      expect(() => assertOperateOutcomes(config)).not.toThrow();
      expect(readOperateOutcomes(config)).toEqual(outcomes);
      expect(aggregateOutcomeCode(contract, "approved")).toBe("feedback_ok");
      expect(aggregateOutcomeCode(contract, "rejected")).toBe("rework");
    }
  );
  it("不再丢失业务结果的恢复含义", () => {
    expect(contractOutcomeDecision(contract, "rework")).toBe("rejected");
    expect(contractOutcomeDecision(contract, "feedback_ok")).toBe("approved");
    expect(contractOutcomeDecision({ mode: "legacy_cancel" }, "rejected")).toBe(
      "rejected"
    );
  });
  it("原系统结果代号无需新增字段即可继续运行", () => {
    const old = {
      mode: "explicit",
      handles: { approved: "yes", rejected: "no" },
    };
    expect(aggregateOutcomeCode(old, "approved")).toBe("approved");
    expect(aggregateOutcomeCode(null, "rejected")).toBe("rejected");
    expect(outcomeDecision({ code: "returned" })).toBe("rejected");
  });
  it("多个通过或多个拒绝出口在配置时拒绝歧义", () => {
    expect(() =>
      assertSigningOutcomes(
        [...outcomes, { code: "also_ok", decision: "approved" }],
        true
      )
    ).toThrow("每种含义只能");
    expect(() =>
      assertSigningOutcomes(
        [...outcomes, { code: "also_no", decision: "rejected" }],
        true
      )
    ).toThrow("每种含义只能");
  });
  it("自定义多人结果必须有明确含义，单人旧配置保留", () => {
    expect(() =>
      assertOperateOutcomes({
        outcomeMode: "explicit",
        outcomes: [{ code: "custom", label: "反馈" }],
        bdcz: { hqhqsz: "orSignFor" },
      })
    ).toThrow("明确签署含义");
    expect(() =>
      assertOperateOutcomes({
        outcomeMode: "explicit",
        outcomes: [{ code: "custom", label: "反馈" }],
      })
    ).not.toThrow();
  });
  it("弃权必须有最终拒绝出口，且不降低会签门槛", () => {
    expect(() =>
      assertSigningOutcomes(
        outcomes.filter(x => x.decision !== "rejected"),
        true
      )
    ).toThrow("必须配置拒绝出口");
    const progress = evaluateApprovalResults({
      totalApprovers: 2,
      requiredApprovals: 2,
      results: [{ decision: "approved" }, { decision: "abstained" }],
    });
    expect(progress.outcome).toBe("rejected");
    expect(aggregateOutcomeCode(contract, progress.outcome as "rejected")).toBe(
      "rework"
    );
  });
  it("或签一人拒绝仍等待另一人的判断", () => {
    expect(
      evaluateApprovalResults({
        totalApprovers: 2,
        requiredApprovals: 1,
        results: [{ decision: "rejected" }],
      }).outcome
    ).toBe("waiting");
    expect(
      evaluateApprovalResults({
        totalApprovers: 2,
        requiredApprovals: 1,
        results: [{ decision: "rejected" }, { decision: "approved" }],
      }).outcome
    ).toBe("approved");
  });
  it("通过一种含义即可支持只有反馈完成的多人节点", () => {
    expect(
      aggregateOutcomeCode(
        { mode: "explicit", outcomes: [outcomes[0]] },
        "approved"
      )
    ).toBe("feedback_ok");
  });
  it("代号长度符合组结果存储边界", () => {
    expect(() =>
      assertSigningOutcomes(
        [{ code: "a".repeat(97), decision: "approved" }],
        true
      )
    ).toThrow("96");
    expect(() =>
      assertSigningOutcomes(
        [{ code: "a".repeat(96), decision: "approved" }],
        true
      )
    ).not.toThrow();
  });
  it("保留代号不能反转含义，非法含义也不可保存", () => {
    expect(() =>
      assertOperateOutcomes({
        outcomeMode: "explicit",
        outcomes: [{ code: "approved", decision: "rejected" }],
      })
    ).toThrow("不可更改");
    expect(() =>
      assertOperateOutcomes({
        outcomeMode: "explicit",
        outcomes: [{ code: "custom", decision: "maybe" }],
      })
    ).toThrow("必须是");
  });
  it("提交业务结果时核对真实票义并保留业务代号", () => {
    expect(
      validateWorkflowTaskSubmission(task, {
        decision: "approved",
        outcome: "feedback_ok",
      })
    ).toMatchObject({ decision: "approved", outcome: "feedback_ok" });
    expect(
      validateWorkflowTaskSubmission(task, {
        decision: "rejected",
        outcome: "rework",
        comment: "请补正",
      })
    ).toMatchObject({ decision: "rejected", outcome: "rework" });
  });
  it("不接受伪造业务结果的审批决定，且返回400", () => {
    try {
      validateWorkflowTaskSubmission(task, {
        decision: "rejected",
        outcome: "feedback_ok",
        comment: "伪造拒绝票",
      });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("BAD_REQUEST");
      expect((error as Error).message).toContain("不一致");
    }
  });
  it("内置结果也不可通过不一致decision伪造票数", () => {
    expect(() =>
      validateWorkflowTaskSubmission(
        {
          ...task,
          outcomeHandlesJson: {
            mode: "explicit",
            handles: { approved: "yes" },
          },
        },
        { decision: "abstained", outcome: "approved" }
      )
    ).toThrow("不一致");
  });
  it("自定义退回必须填写意见", () => {
    expect(() =>
      validateWorkflowTaskSubmission(task, {
        decision: "rejected",
        outcome: "rework",
      })
    ).toThrow("处理意见");
  });
  it("缺少汇总分支不能静默选择其他出口", () => {
    expect(() =>
      aggregateOutcomeCode(
        { mode: "explicit", outcomes: [outcomes[0]] },
        "rejected"
      )
    ).toThrow("缺少");
    expect(() =>
      resolveOperateOutcomeRouting(
        { mode: "explicit", handles: {} },
        "constructor"
      )
    ).toThrow("没有配置");
  });
  it("自动执行必须有且仅有一个通过含义的出口", () => {
    const auto = { outcomeMode: "explicit", outcomes, zdzx: { sfzdzx: true } };
    expect(() => assertOperateOutcomes(auto)).not.toThrow();
  });
  it("自动执行拒绝未指定或多个通过含义", () => {
    expect(() =>
      assertOperateOutcomes({
        outcomeMode: "explicit",
        autoExecute: true,
        outcomes: [{ code: "custom" }],
      })
    ).toThrow("唯一");
    expect(() =>
      assertOperateOutcomes({
        outcomeMode: "explicit",
        autoExecute: true,
        outcomes: [outcomes[0], { code: "another", decision: "approved" }],
      })
    ).toThrow("唯一");
  });
  it("编译诊断作为400返回并保留位置", () => {
    const error = new WorkflowCompileError([
      {
        code: "WF_NODE_CONFIG_INVALID",
        message: "含义不明确",
        location: { kind: "node", nodeId: "review", field: "outcomes" },
      },
    ]);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.diagnostics[0].location.nodeId).toBe("review");
  });
});
