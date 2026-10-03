import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: vi.fn(async () => true),
  recordAuthorizationAudit: vi.fn(),
}));
vi.mock("./workflow-engine", () => ({ resumeWorkflowTask: vi.fn() }));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import { claimWorkflowTask } from "./p1-service";
beforeEach(() => vi.resetAllMocks());
const task = {
  id: "next-task",
  workflowId: "test-flow",
  nodeId: "approval",
  status: "pending",
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
