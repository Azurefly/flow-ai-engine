import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  permission: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: mocks.permission,
  recordAuthorizationAudit: vi.fn(),
}));
vi.mock("./workflow-engine", () => ({ resumeWorkflowTask: mocks.resume }));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import { completeWorkflowTask } from "./p1-service";
beforeEach(() => vi.resetAllMocks());
it.each([false, true])(
  "完成任务返回本人实例查看权限 %s，办理权限仍独立校验",
  async canViewRun => {
    mocks.permission.mockResolvedValue(canViewRun);
    mocks.query
      .mockResolvedValueOnce([
        [
          {
            id: "task-1",
            workflowId: "flow-1",
            runId: "run-1",
            nodeId: "operate",
            assignedUserId: 12,
            claimedByUserId: 12,
            status: "claimed",
            runStatus: "waiting",
          },
        ],
      ])
      .mockResolvedValueOnce([[{ status: "active" }]])
      .mockResolvedValueOnce([
        [
          {
            sourceNodeId: "operate",
            availableOperationsJson: JSON.stringify([{ taskId: "task-1" }]),
          },
        ],
      ]);
    mocks.resume.mockResolvedValue({ runId: "run-1", status: "queued" });
    await expect(
      completeWorkflowTask({ id: 12, role: "user" }, "task-1", {
        decision: "approved",
      })
    ).resolves.toEqual({ runId: "run-1", status: "queued", canViewRun });
    expect(mocks.permission).toHaveBeenCalledWith(
      { id: 12, role: "user" },
      "flow-1",
      "workflow:view"
    );
    expect(mocks.resume).toHaveBeenCalledTimes(1);
  }
);
