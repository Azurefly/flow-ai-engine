import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    getConnection: async () => ({ ...mocks, beginTransaction: vi.fn() }),
  }),
}));
import { resumeWorkflowTask } from "./workflow-engine";
beforeEach(() => vi.resetAllMocks());
it("人工任务完成使用行锁获取的最新上下文，保留另一分支输出与待执行队列", async () => {
  const latest = {
    vars: { other: "已完成" },
    nodes: { other: { value: 7 } },
    runtime: { executionQueue: ["other-next"] },
  };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM workflow_task t JOIN"))
      return [
        [
          {
            id: "t",
            runId: "r",
            nodeId: "operate",
            workflowId: "w",
            status: "claimed",
            claimedByUserId: 1,
            contextJson: JSON.stringify({
              vars: { other: "旧结果" },
              runtime: { executionQueue: [] },
            }),
            nextNodeIdsJson: JSON.stringify(["next"]),
            payloadJson: JSON.stringify({ config: {} }),
          },
        ],
      ];
    if (sql.includes("FROM workflow_run WHERE id=? FOR UPDATE"))
      return [
        [
          {
            status: "waiting",
            contextJson: JSON.stringify(latest),
            startedAt: new Date(),
          },
        ],
      ];
    if (sql.includes("SELECT id,startedAt FROM workflow_node_run"))
      return [[{ id: "nr", startedAt: new Date() }]];
    return [{ affectedRows: 1 }];
  });
  await expect(
    resumeWorkflowTask({
      taskId: "t",
      completedBy: { id: 1, role: "admin" },
      result: { decision: "approved" },
    })
  ).resolves.toMatchObject({ status: "queued" });
  const insert = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO workflow_run_job")
  );
  const checkpoint = JSON.parse(insert![1][3]);
  expect(checkpoint.queue).toEqual(["other-next", "next"]);
  expect(checkpoint.context.vars.other).toBe("已完成");
  expect(checkpoint.context.nodes.other).toEqual({ value: 7 });
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.rollback).not.toHaveBeenCalled();
});
