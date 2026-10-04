import { expect, it } from "vitest";
import {
  canManageTask,
  taskAssignmentTargetReason,
} from "../shared/task-assignment";
it("only permits assignment controls for actionable active tasks", () => {
  expect(canManageTask({ status: "pending", canAct: true })).toBe(true);
  expect(canManageTask({ status: "claimed", canAct: true })).toBe(true);
  for (const status of ["completed", "cancelled", "failed", undefined])
    expect(canManageTask({ status, canAct: true })).toBe(false);
  expect(canManageTask({ status: "pending", canAct: false })).toBe(false);
  expect(canManageTask({ status: "pending", canAct: "true" })).toBe(false);
  expect(canManageTask(undefined)).toBe(false);
});

it("分配选择排除当前处理人和已存在的审批成员", () => {
  const task = {
    status: "pending",
    assignedUserId: 12,
    viewerUserId: 12,
    approvalGroupId: "group",
    approvalMembers: [{ assignedUserId: 12 }, { assignedUserId: 13 }],
  };
  expect(taskAssignmentTargetReason(task, 12)).toContain("当前处理人");
  expect(taskAssignmentTargetReason(task, 13)).toContain("审批组");
  expect(taskAssignmentTargetReason(task, 14)).toBeNull();
  expect(taskAssignmentTargetReason(task, "")).toContain("请选择");
});
it("候选人领取与已领取任务使用实际当前处理人，不错误过滤原指定人", () => {
  expect(
    taskAssignmentTargetReason({ status: "pending", viewerUserId: 12 }, 12)
  ).toContain("当前处理人");
  const task = {
    status: "claimed",
    assignedUserId: 12,
    claimedByUserId: 14,
    viewerUserId: 14,
  };
  expect(taskAssignmentTargetReason(task, 14)).toContain("当前处理人");
  expect(taskAssignmentTargetReason(task, 12)).toBeNull();
});
