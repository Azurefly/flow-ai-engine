import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  permission: vi.fn(),
  audit: vi.fn(),
  resume: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: mocks.permission,
  recordAuthorizationAudit: mocks.audit,
}));
vi.mock("./workflow-engine", () => ({
  resumeWorkflowTask: mocks.resume,
  validateWorkflowTaskSubmission: mocks.validate,
}));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import {
  claimWorkflowTask,
  completeWorkflowTask,
  executeWorkflowTask,
} from "./p1-service";

const user = { id: 7, role: "user" as const };
const row = {
  id: "task_other_level",
  workflowId: "workflow_hierarchy",
  runId: "run_hierarchy",
  status: "pending",
  nodeId: "city_receive",
  assignedUserId: 22,
  candidateUserIdsJson: "[22,23]",
  ownerUserId: 9,
  triggeredByUserId: 9,
  approvalGroupId: null,
  payloadJson: "{}",
  resultJson: null,
};
const operations = [
  ["领取", () => claimWorkflowTask(user, row.id)],
  ["执行", () => executeWorkflowTask(user, row.id, { outcome: "cmd02" })],
  ["完成", () => completeWorkflowTask(user, row.id, { outcome: "cmd02" })],
] as const;

describe("人工任务权限与状态错误合同", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([[{ ...row }]]);
    mocks.permission.mockImplementation(
      async (_user, _workflow, code) => code === "workflow:view"
    );
  });
  it.each(operations)(
    "其他层级人员即使可查看流程也不能%s任务，返回权限拒绝且不写入",
    async (_label, operation) => {
      await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        mocks.query.mock.calls.every(([sql]) =>
          String(sql).trimStart().startsWith("SELECT")
        )
      ).toBe(true);
      expect(mocks.resume).not.toHaveBeenCalled();
      expect(mocks.validate).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  );
  it.each(operations)(
    "不可见或不存在的任务不能%s，不泄露其内容也不返回内部故障",
    async (_label, operation) => {
      mocks.query.mockResolvedValue([[]]);
      await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.resume).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  );
  it.each(operations)(
    "无流程查看权限的人员不能%s任务，不能据此探测任务内容",
    async (_label, operation) => {
      mocks.permission.mockResolvedValue(false);
      await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.resume).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  );
  it("尚未领取的任务不能直接完成，返回可解释的状态冲突", async () => {
    mocks.query.mockResolvedValue([[{ ...row, assignedUserId: user.id }]]);
    await expect(completeWorkflowTask(user, row.id, {})).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("已结束任务的直接执行返回状态冲突，不触发重复恢复", async () => {
    mocks.query.mockResolvedValue([
      [
        {
          ...row,
          assignedUserId: user.id,
          completedByUserId: user.id,
          status: "completed",
        },
      ],
    ]);
    await expect(executeWorkflowTask(user, row.id, {})).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
