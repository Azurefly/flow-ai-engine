import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: vi.fn(async () => true),
  recordAuthorizationAudit: vi.fn(),
}));
vi.mock("./workflow-engine", () => ({ resumeWorkflowTask: vi.fn() }));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import {
  claimWorkflowTask,
  taskActionState,
  getWorkflowTask,
} from "./p1-service";
beforeEach(() => vi.resetAllMocks());
const task = {
  id: "next-task",
  workflowId: "test-flow",
  nodeId: "approval",
  status: "pending",
  runStatus: "waiting",
  assignedUserId: 12,
  approvalGroupId: "group",
  signMode: "sequentialSignFor",
  approvalOrder: 2,
};
it("顺序未到时返回可理解原因，且不领取或推进任务", async () => {
  mocks.query
    .mockResolvedValueOnce([[task]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[{ id: "earlier-task" }]]);
  await expect(
    claimWorkflowTask({ id: 12, role: "user" }, task.id)
  ).rejects.toThrow("顺序会签尚未轮到当前审批人");
  expect(mocks.query).toHaveBeenCalledTimes(3);
  expect(
    mocks.query.mock.calls.every(call => !String(call[0]).includes("UPDATE"))
  ).toBe(true);
  expect(mocks.query.mock.calls[2][1]).toEqual(["group", 2]);
});
it("其他人员不能用顺序提示绕过任务领取权限", async () => {
  mocks.query.mockResolvedValueOnce([[task]]).mockResolvedValueOnce([[]]);
  await expect(
    claimWorkflowTask({ id: 99, role: "admin" }, task.id)
  ).rejects.toThrow("无权领取");
  expect(mocks.query).toHaveBeenCalledTimes(2);
});

it("后续审批人等待期间不能办理，前序完成后恢复办理", () => {
  expect(
    taskActionState(12, { ...task, hasEarlierPendingSigner: 1 } as any)
  ).toMatchObject({ canAct: false, actionLabel: "等待前序审批" });
  expect(
    taskActionState(12, { ...task, hasEarlierPendingSigner: 0 } as any)
  ).toMatchObject({ canAct: true, blockedReason: null });
  expect(
    taskActionState(99, { ...task, hasEarlierPendingSigner: 0 } as any).canAct
  ).toBe(false);
  expect(
    taskActionState(12, {
      ...task,
      signMode: "andSignFor",
      hasEarlierPendingSigner: 1,
    } as any).canAct
  ).toBe(true);
  expect(
    taskActionState(12, {
      ...task,
      status: "completed",
      hasEarlierPendingSigner: 1,
    } as any)
  ).toMatchObject({ canAct: false, blockedReason: null });
});
it("详情返回顺序等待原因并通过查询读取前序状态", async () => {
  mocks.query
    .mockResolvedValueOnce([[{ ...task, hasEarlierPendingSigner: 1 }]])
    .mockResolvedValueOnce([[]]);
  const detail = await getWorkflowTask({ id: 12, role: "user" }, task.id);
  expect(detail).toMatchObject({ canAct: false, actionLabel: "等待前序审批" });
  expect(detail?.blockedReason).toContain("前序审批人");
  expect(mocks.query.mock.calls[0][0]).toContain(
    "earlier.approvalOrder<t.approvalOrder"
  );
});

it.each(["blocked", "queued", "success", "failed", "cancelled", "terminated"])(
  "实例 %s 不返回可办理状态",
  runStatus => {
    expect(
      taskActionState(12, {
        ...task,
        runStatus,
        hasEarlierPendingSigner: 0,
      } as any).canAct
    ).toBe(false);
  }
);
it("暂停实例有明确原因，恢复后原任务恢复办理", () => {
  expect(
    taskActionState(12, { ...task, runStatus: "blocked" } as any)
  ).toMatchObject({
    canAct: false,
    actionLabel: "流程已暂停",
    blockedReason: "流程已暂停，恢复后才能办理。",
  });
  expect(
    taskActionState(12, {
      ...task,
      runStatus: "waiting",
      hasEarlierPendingSigner: 0,
    } as any).canAct
  ).toBe(true);
});
