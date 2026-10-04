import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { getWorkflowRunMetrics } from "./workflow-engine";
it("监控统计在原聚合查询中统计执行与等待数量并保持原有指标", async () => {
  mocks.query.mockResolvedValue([
    [
      {
        totalRuns: "5",
        executingRuns: "1",
        waitingRuns: "2",
        successfulRuns: "1",
        failedRuns: "1",
        averageDurationMs: "20",
        maxDurationMs: "30",
      },
    ],
  ]);
  const metrics = await getWorkflowRunMetrics("workflow-1", {
    status: "waiting",
  });
  expect(metrics).toMatchObject({
    totalRuns: 5,
    executingRuns: 1,
    waitingRuns: 2,
    successfulRuns: 1,
    failedRuns: 1,
    failureRate: 20,
  });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  const [sql, params] = mocks.query.mock.calls[0];
  expect(sql).toContain("r.status IN ('queued','running')");
  expect(sql).toContain("r.status IN ('waiting','blocked')");
  expect(params.slice(0, 3)).toEqual(["workflow-1", "waiting", "waiting"]);
});
