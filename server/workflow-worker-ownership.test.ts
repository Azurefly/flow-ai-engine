import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  failed: vi.fn(),
  next: true,
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({
      query: mocks.query,
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
    }),
  }),
}));
vi.mock("./workflow-engine", () => ({
  executePreparedWorkflowRun: mocks.execute,
  markWorkflowRunFailed: mocks.failed,
  reconcileDueWorkflowWaits: async () => 0,
  reconcileDueWorkflowTaskSchedules: async () => 0,
  reconcileWorkflowContinuations: async () => 0,
  submitWorkflowRun: vi.fn(),
  WorkflowExecutionInjectedCrash: class extends Error {},
}));
vi.mock("./p2-service", () => ({
  runDataflowJobOnce: async () => false,
  runDataSourceTestJobOnce: async () => false,
}));
import {
  runWorkflowWorkerOnce,
  getWorkflowWorkerStatus,
} from "./workflow-worker";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.next = true;
  mocks.execute.mockRejectedValue(new Error("Checkpoint ownership changed"));
  mocks.query.mockImplementation(async (sql: string) => {
    if (
      sql.includes(
        "SELECT j.id,j.runId,j.attempt,j.maxAttempts,j.checkpointJson"
      )
    ) {
      if (!mocks.next) return [[]];
      mocks.next = false;
      return [
        [
          {
            id: "job",
            runId: "run",
            attempt: 0,
            maxAttempts: 3,
            checkpointJson: { queue: ["review"], context: {} },
          },
        ],
      ];
    }
    if (sql.startsWith("SELECT status,executionLockToken FROM workflow_run"))
      return [[{ status: "queued", executionLockToken: null }]];
    return sql.trim().startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }];
  });
});
it("人工续跑接管租约后旧 Worker 不重排过期检查点", async () => {
  expect(await runWorkflowWorkerOnce()).toBe(true);
  const statements = mocks.query.mock.calls.map(([sql]) => sql);
  expect(
    statements.some(sql =>
      sql.includes(
        "SET status=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW()"
      )
    )
  ).toBe(true);
  expect(statements.some(sql => sql.includes("SET j.status='queued'"))).toBe(
    false
  );
  expect(mocks.failed).not.toHaveBeenCalled();
  expect(getWorkflowWorkerStatus().lastError).toBeNull();
});
