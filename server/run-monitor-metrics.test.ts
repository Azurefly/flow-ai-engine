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
        durationSamples: "2",
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

it("无完成耗时样本时返回空值，不能伪装为零耗时", async () => {
  mocks.query.mockResolvedValue([
    [{ totalRuns: 1, averageDurationMs: null, durationSamples: 0 }],
  ]);
  const metrics = await getWorkflowRunMetrics("workflow-1");
  expect(metrics.averageDurationMs).toBeNull();
  expect(metrics.durationSamples).toBe(0);
});
it("真实零耗时仍有效", async () => {
  mocks.query.mockResolvedValue([
    [
      {
        totalRuns: 1,
        successfulRuns: 1,
        averageDurationMs: 0,
        durationSamples: 1,
      },
    ],
  ]);
  const metrics = await getWorkflowRunMetrics("workflow-1");
  expect(metrics.averageDurationMs).toBe(0);
  expect(metrics.durationSamples).toBe(1);
});
