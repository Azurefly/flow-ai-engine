import { describe, expect, it } from "vitest";
import { businessStateLabelSql } from "./process-instance-state";
import {
  isCurrentTaskOperation,
  isCurrentTaskOwner,
  isTaskActor,
  processInstanceStatusFilter,
  taskFilter,
} from "./p1-service";

describe("人工操作授权边界", () => {
  const task = {
    id: "task-1",
    nodeId: "state-review",
    assignedUserId: 7,
    claimedByUserId: 7,
    candidateUserIdsJson: [7, 8],
  } as any;

  it("只认当前任务的指定人/候选人，不因管理员身份自动变成操作人", () => {
    expect(isTaskActor(7, task)).toBe(true);
    expect(isTaskActor(8, task)).toBe(true);
    expect(isTaskActor(99, task)).toBe(false);
  });

  it("要求用户当前状态与当前操作集合同时匹配", () => {
    expect(
      isCurrentTaskOperation({
        task,
        state: { sourceNodeId: "state-review" },
        operations: [{ taskId: "task-1" }],
      })
    ).toBe(true);
    expect(
      isCurrentTaskOperation({
        task,
        state: { sourceNodeId: "state-other" },
        operations: [{ taskId: "task-1" }],
      })
    ).toBe(false);
    expect(
      isCurrentTaskOperation({
        task,
        state: { sourceNodeId: "state-review" },
        operations: [{ taskId: "task-2" }],
      })
    ).toBe(false);
  });

  it("拒绝无当前所有人且无候选人的开放领取任务", () => {
    expect(
      isCurrentTaskOperation({
        task: {
          id: "open-1",
          nodeId: "state-review",
          assignedUserId: null,
          candidateUserIdsJson: [],
        },
        operations: [],
      })
    ).toBe(false);
  });

  it("任务领取后仅当前领取人是操作所有人", () => {
    expect(isCurrentTaskOwner(7, { ...task, status: "claimed" })).toBe(true);
    expect(isCurrentTaskOwner(8, { ...task, status: "claimed" })).toBe(false);
    expect(
      isCurrentTaskOwner(8, {
        ...task,
        status: "pending",
        assignedUserId: null,
      })
    ).toBe(true);
  });

  it("待办筛选只包含当前账号可办理的待处理任务", () => {
    const filter = taskFilter("todo", 7);
    expect(filter.clause).toContain("t.status='pending'");
    expect(filter.clause).toContain(
      "t.status='claimed' AND t.claimedByUserId=?"
    );
    expect(filter.clause).toContain("JSON_CONTAINS(t.candidateUserIdsJson,?)");
    expect(filter.clause).not.toContain("JSON_LENGTH");
    expect(filter.params).toEqual([7, JSON.stringify(7), 7]);
    expect(
      isCurrentTaskOwner(7, {
        status: "pending",
        assignedUserId: null,
        candidateUserIdsJson: null,
      } as any)
    ).toBe(false);
    expect(
      isCurrentTaskOwner(7, {
        status: "claimed",
        assignedUserId: 7,
        claimedByUserId: 8,
        candidateUserIdsJson: [7],
      } as any)
    ).toBe(false);
  });
});

describe("流程实例状态筛选", () => {
  it("同一筛选值可匹配运行状态或当前业务状态", () => {
    expect(processInstanceStatusFilter("failed")).toEqual({
      clause: `(r.status=? OR ${businessStateLabelSql}=?)`,
      params: ["failed", "failed"],
    });
    expect(processInstanceStatusFilter("  已授权  ")).toEqual({
      clause: `(r.status=? OR ${businessStateLabelSql}=?)`,
      params: ["已授权", "已授权"],
    });
  });

  it("空筛选不附加 SQL 条件", () => {
    expect(processInstanceStatusFilter("  ")).toEqual({
      clause: "",
      params: [],
    });
  });
});
