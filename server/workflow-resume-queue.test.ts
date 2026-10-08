import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getConnection: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  queue: ["ready-node"] as string[],
  task: false,
  wait: true,
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.getConnection }),
}));
import { resumeWorkflowRun } from "./workflow-engine";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.queue = ["ready-node"];
  mocks.task = false;
  mocks.wait = true;
  mocks.getConnection.mockResolvedValue({
    query: mocks.query,
    beginTransaction: mocks.beginTransaction,
    commit: mocks.commit,
    rollback: mocks.rollback,
    release: mocks.release,
  });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id,status,contextJson,requestId"))
      return [
        [
          {
            id: "run-ready",
            status: "blocked",
            contextJson: { runtime: { executionQueue: mocks.queue } },
          },
        ],
      ];
    if (sql.includes("SELECT id FROM workflow_task"))
      return [mocks.task ? [{ id: "pending-task" }] : []];
    if (sql.includes("SELECT id FROM workflow_wait_subscription"))
      return [mocks.wait ? [{ id: "active-wait" }] : []];
    if (sql.startsWith("SELECT")) return [[]];
    return [{ affectedRows: 1 }];
  });
});
it("并行分支有等待订阅时也必须恢复已排队后继", async () => {
  const result = await resumeWorkflowRun("run-ready");
  expect(result?.status).toBe("queued");
  const insert = mocks.query.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT INTO workflow_run_job")
  );
  expect(insert).toBeDefined();
  expect(JSON.parse(insert![1][3]).queue).toEqual(["ready-node"]);
});
it("存在人工任务时也不能忽略另一分支的执行队列", async () => {
  mocks.task = true;
  expect((await resumeWorkflowRun("run-ready"))?.status).toBe("queued");
});
it("没有就绪队列的消息等待仅恢复等待，不重启起点", async () => {
  mocks.queue = [];
  expect((await resumeWorkflowRun("run-ready"))?.status).toBe("waiting");
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.startsWith("INSERT INTO workflow_run_job")
    )
  ).toBe(false);
});
it("没有就绪队列的人工任务保持等待", async () => {
  mocks.queue = [];
  mocks.task = true;
  expect((await resumeWorkflowRun("run-ready"))?.status).toBe("waiting");
});
