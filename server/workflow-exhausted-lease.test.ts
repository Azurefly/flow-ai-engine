import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), fail: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./workflow-engine", () => ({
  executePreparedWorkflowRun: vi.fn(),
  markWorkflowRunFailed: mocks.fail,
  reconcileDueWorkflowWaits: vi.fn(),
  reconcileDueWorkflowTaskSchedules: vi.fn(),
  reconcileWorkflowContinuations: vi.fn(),
  submitWorkflowRun: vi.fn(),
  WorkflowExecutionInjectedCrash: class extends Error {},
}));
vi.mock("./p2-service", () => ({
  runDataflowJobOnce: vi.fn(),
  runDataSourceTestJobOnce: vi.fn(),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
import { reconcileExhaustedWorkflowJobs } from "./workflow-worker";
beforeEach(() => vi.resetAllMocks());
it("仅收敛已耗尽、过期且仍属于当前运行租约的任务", async () => {
  mocks.query.mockResolvedValue([
    [{ id: "own-job", runId: "own-run", leaseToken: "own-token" }],
  ]);
  mocks.fail.mockResolvedValue(true);
  expect(await reconcileExhaustedWorkflowJobs()).toBe(1);
  const sql = mocks.query.mock.calls[0][0];
  expect(sql).toContain("j.attempt>=j.maxAttempts");
  expect(sql).toContain("j.leaseExpiresAt<NOW()");
  expect(sql).toContain("r.executionLockToken=j.leaseToken");
  expect(mocks.fail).toHaveBeenCalledWith(
    "own-run",
    expect.any(Error),
    "own-token",
    "own-job"
  );
});
it("续租或所有权改变时不计为收敛成功", async () => {
  mocks.query.mockResolvedValue([
    [{ id: "own-job", runId: "own-run", leaseToken: "old-token" }],
  ]);
  mocks.fail.mockResolvedValue(false);
  expect(await reconcileExhaustedWorkflowJobs()).toBe(0);
});
it("没有到期耗尽任务时不修改运行", async () => {
  mocks.query.mockResolvedValue([[]]);
  expect(await reconcileExhaustedWorkflowJobs()).toBe(0);
  expect(mocks.fail).not.toHaveBeenCalled();
});
it("单个任务事务失败不阻塞其他到期任务，下次仍可重试", async () => {
  mocks.query.mockResolvedValue([[{ id: "job-a", runId: "run-a", leaseToken: "token-a" }, { id: "job-b", runId: "run-b", leaseToken: "token-b" }]]);
  mocks.fail.mockRejectedValueOnce(new Error("temporary write failure")).mockResolvedValueOnce(true);
  expect(await reconcileExhaustedWorkflowJobs()).toBe(1);
  expect(mocks.fail).toHaveBeenCalledTimes(2);
  expect(mocks.fail.mock.calls[1][0]).toBe("run-b");
  mocks.fail.mockResolvedValue(true);
  expect(await reconcileExhaustedWorkflowJobs()).toBe(2);
});
