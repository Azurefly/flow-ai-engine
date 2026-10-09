import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    getConnection: async () => ({
      query: mocks.query,
      beginTransaction: mocks.begin,
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    }),
  }),
}));
import { markWorkflowRunFailed } from "./workflow-engine";
beforeEach(() => vi.resetAllMocks());
it("重新续租或已被替换的任务不失败当前运行", async () => {
  mocks.query.mockResolvedValue([[]]);
  expect(
    await markWorkflowRunFailed(
      "own-run",
      new Error("expired"),
      "old-token",
      "own-job"
    )
  ).toBe(false);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][0]).toContain("leaseExpiresAt<NOW()");
  expect(mocks.query.mock.calls[0][0]).toContain("FOR UPDATE");
  expect(mocks.query.mock.calls[0][1]).toEqual([
    "own-job",
    "own-run",
    "old-token",
  ]);
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(1);
});

function mockExpiredRun() {
  mocks.query
    .mockResolvedValueOnce([[{ id: "own-job" }]])
    .mockResolvedValueOnce([[{
      id: "own-run", workflowId: "own-flow", name: "测试流程",
      ownerUserId: 1, triggeredByUserId: 1, startedAt: null,
    }]])
    .mockResolvedValue([{ affectedRows: 1 }]);
}

it("耗尽的过期任务与运行、待办和通知在同一事务收敛", async () => {
  mockExpiredRun();
  expect(await markWorkflowRunFailed("own-run", new Error("expired"), "old-token", "own-job")).toBe(true);
  const statements = mocks.query.mock.calls.map(call => String(call[0]));
  expect(statements[2]).toContain("executionLockToken=? AND status IN ('queued','running','waiting')");
  expect(statements[3]).toContain("UPDATE workflow_run_job SET status='failed'");
  expect(mocks.query.mock.calls[3][1]).toEqual([JSON.stringify({ message: "expired" }), "own-job", "old-token"]);
  expect(statements.some(sql => sql.includes("UPDATE workflow_task SET status='cancelled'"))).toBe(true);
  expect(statements.some(sql => sql.includes("UPDATE workflow_wait_subscription"))).toBe(true);
  expect(statements.some(sql => sql.includes("INSERT INTO workflow_outbox_event"))).toBe(true);
  expect(mocks.commit).toHaveBeenCalledTimes(1);
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledTimes(1);
});

it("任务更新失败时回滚运行失败，避免部分收敛", async () => {
  mocks.query.mockResolvedValueOnce([[{ id: "own-job" }]])
    .mockResolvedValueOnce([[{ id: "own-run", startedAt: null }]])
    .mockResolvedValueOnce([{ affectedRows: 1 }])
    .mockRejectedValueOnce(new Error("job write failed"));
  await expect(markWorkflowRunFailed("own-run", new Error("expired"), "old-token", "own-job")).rejects.toThrow("job write failed");
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(1);
});
