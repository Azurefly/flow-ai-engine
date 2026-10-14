import { expect, it } from "vitest";
import { isWorkflowRunController, workflowRunControlAllowed, workflowRunControlCapabilities } from "./workflow-run-controls";

const run = { ownerUserId: 1, triggeredByUserId: 2, status: "waiting" };
it("全局运行权限不能替代发起人或所有者身份", () => {
  expect(workflowRunControlCapabilities(3, run, true)).toMatchObject({ canPause: false, canResume: false, canCancel: false, canTerminate: false, disabledReason: "仅流程发起人或流程所有者可控制此运行。" });
  expect(workflowRunControlCapabilities(1, run, true).canCancel).toBe(true);
  expect(workflowRunControlCapabilities(2, run, true).canCancel).toBe(true);
  expect(workflowRunControlCapabilities(2, run, false).canCancel).toBe(false);
});
it("运行状态决定可用操作，未知或已结束状态全部关闭", () => {
  expect(workflowRunControlCapabilities(1, { ...run, status: "running" }, true)).toMatchObject({ canPause: false, canResume: false, canCancel: true, canTerminate: true });
  expect(workflowRunControlCapabilities(1, { ...run, status: "blocked" }, true)).toMatchObject({ canPause: false, canResume: true, canCancel: true, canTerminate: true });
  for (const status of ["success", "failed", "cancelled", "terminated", "unknown"])
    expect(workflowRunControlCapabilities(1, { ...run, status }, true)).toMatchObject({ canPause: false, canResume: false, canCancel: false, canTerminate: false });
});
it("缺少能力数据或无效身份时保守关闭确认入口", () => {
  expect(workflowRunControlAllowed(undefined, "cancel")).toBe(false);
  expect(isWorkflowRunController(0, { ownerUserId: 0 })).toBe(false);
  expect(isWorkflowRunController(1, { ownerUserId: true })).toBe(false);
  expect(isWorkflowRunController(1, { ownerUserId: "1" })).toBe(true);
});
