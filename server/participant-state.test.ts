import { describe, expect, it } from "vitest";
import { createParticipantStateExample } from "../shared/participant-state-example";
import {
  analyzeWorkflowDefinition,
  compileWorkflowDefinition,
} from "./workflow-compiler";
import { planParticipantStateChange } from "./participant-state-plan";
import type { ParticipantCard } from "../shared/participant-state";

const cards: Record<string, ParticipantCard> = {
  "1": {
    userId: 1,
    stateNodeId: "sent",
    stateCode: "SENT",
    stateName: "已提交",
    version: 2,
    relationId: "round-1",
  },
  "2": {
    userId: 2,
    stateNodeId: "pending",
    stateCode: "PENDING",
    stateName: "待处理",
    version: 2,
    relationId: "round-1",
  },
};
const relation = {
  id: "round-1",
  senderUserId: 1,
  receiverUserIds: [2],
  status: "active" as const,
  createdVersion: 2,
};
function plan(entryNodeId: string, actorUserId = 1) {
  return {
    definition: createParticipantStateExample(),
    entryNodeId,
    actorUserId,
    initiatorUserId: 1,
    userIds: [1, 2],
    receiverUserIds: [2],
    cards,
    relation,
    roles: new Map<number, string[]>(),
    context: { input: {}, result: {} },
  };
}

describe("参与人状态合同", () => {
  it("通过发布编译并允许跨人工操作返回，未启用的新图仍走原编译语义", () => {
    const definition = createParticipantStateExample();
    const compiled = compileWorkflowDefinition(definition, {
      flowType: "state",
    });
    expect(compiled.plan.compilerVersion).toBe("1.9.0");
    expect(compiled.plan.definition.settings.stateModel).toBe("participant-v1");
    definition.settings = {};
    expect(
      analyzeWorkflowDefinition(definition, { flowType: "state" }).ok
    ).toBe(false);
    expect(
      analyzeWorkflowDefinition(createParticipantStateExample(), {
        flowType: "control",
      }).ok
    ).toBe(false);
  });
  it("逐人分配提交和撤回状态，处理人和原提交人可以是不同的人", () => {
    expect(
      planParticipantStateChange(plan("after-submit")).map(change => [
        change.userId,
        change.stateName,
      ])
    ).toEqual([
      [1, "已提交"],
      [2, "待处理"],
    ]);
    expect(
      planParticipantStateChange(plan("after-withdraw")).map(change => [
        change.userId,
        change.stateName,
      ])
    ).toEqual([
      [1, "已撤回待提交"],
      [2, "下级已撤回"],
    ]);
    expect(
      planParticipantStateChange(plan("after-handle", 2)).map(change => [
        change.userId,
        change.stateName,
      ])
    ).toEqual([
      [1, "已完成"],
      [2, "已处理"],
    ]);
  });
  it("用同一份操作前快照匹配每个人的状态和本次表单", () => {
    const input = plan("after-submit");
    const router = input.definition.nodes.find(
      node => node.id === "after-submit"
    )!;
    router.config.routes = [
      {
        handle: "sender",
        priority: 100,
        conditions: [
          {
            left: "{{participant.stateCode}}",
            operator: "equals",
            right: "SENT",
          },
          { left: "{{result.allowed}}", operator: "equals", right: true },
        ],
      },
      {
        handle: "receiver",
        priority: 50,
        condition: {
          left: "{{participant.isReceiver}}",
          operator: "equals",
          right: true,
        },
      },
    ];
    input.context.result = { allowed: true };
    expect(
      planParticipantStateChange(input).map(change => change.stateNodeId)
    ).toEqual(["sent", "pending"]);
    expect(cards["1"].version).toBe(2);
  });
  it("同优先级冲突阻止整次操作，未命中可保持原卡，新人员必须落到状态", () => {
    const input = plan("after-submit");
    const router = input.definition.nodes.find(
      node => node.id === "after-submit"
    )!;
    router.config.routes = [
      { handle: "sender", priority: 1 },
      { handle: "receiver", priority: 1 },
    ];
    expect(() => planParticipantStateChange(input)).toThrow("相同优先级");
    router.config.routes = [];
    router.config.unmatched = "keep";
    expect(planParticipantStateChange(input)).toEqual([]);
    input.userIds = [3];
    expect(() => planParticipantStateChange(input)).toThrow("未匹配目标状态");
  });
  it("拒绝广播和路由内部循环，发布时明确阻止未纳入原子合同的节点", () => {
    const definition = createParticipantStateExample();
    definition.nodes.find(node => node.id === "after-submit")!.config.gbms =
      true;
    const result = analyzeWorkflowDefinition(definition, { flowType: "state" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map(item => item.code)).toContain(
        "WF_PARTICIPANT_BROADCAST"
      );
    const cycle = createParticipantStateExample();
    cycle.edges.push({
      id: "bad",
      sourceNodeId: "after-submit",
      targetNodeId: "after-withdraw",
      sourceHandle: "extra",
    });
    cycle.edges.push({
      id: "back",
      sourceNodeId: "after-withdraw",
      targetNodeId: "after-submit",
      sourceHandle: "extra",
    });
    const invalid = analyzeWorkflowDefinition(cycle, { flowType: "state" });
    if (!invalid.ok)
      expect(invalid.diagnostics.map(item => item.code)).toContain(
        "WF_PARTICIPANT_ROUTER_CYCLE"
      );
    else throw new Error("router cycle unexpectedly compiled");
  });
});
