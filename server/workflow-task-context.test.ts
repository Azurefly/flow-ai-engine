import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({ ...mocks, beginTransaction: vi.fn() }),
  }),
}));
import {
  resumeWorkflowTask,
  reconcileWorkflowContinuations,
} from "./workflow-engine";
beforeEach(() => vi.resetAllMocks());
it("后台恢复不会抢占仍在运行的并行执行器", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM workflow_task t"))
      return [
        [{ runId: "r", payloadJson: JSON.stringify({ parallelTokens: [] }) }],
      ];
    if (sql.includes("FROM workflow_run WHERE"))
      return [[{ id: "r", status: "running", contextJson: "{}" }]];
    throw new Error("不应进入分支续跑写入");
  });
  await expect(reconcileWorkflowContinuations()).resolves.toBe(0);
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
});
it.each(["running", "queued"])(
  "并行任务在%s时保存决定但不清除执行锁或覆盖检查点",
  async status => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM workflow_task t JOIN"))
        return [
          [
            {
              id: "t",
              runId: "r",
              nodeId: "operate",
              status: "claimed",
              claimedByUserId: 1,
              payloadJson: JSON.stringify({
                config: {},
                parallelTokens: [{ frameId: "f", branchId: "a" }],
              }),
            },
          ],
        ];
      if (sql.includes("FROM workflow_run WHERE id=? FOR UPDATE"))
        return [
          [
            {
              status,
              contextJson: JSON.stringify({
                runtime: { executionQueue: ["other"] },
              }),
            },
          ],
        ];
      return [{ affectedRows: 1 }];
    });
    await expect(
      resumeWorkflowTask({
        taskId: "t",
        completedBy: { id: 1, role: "admin" },
        result: { decision: "approved" },
      })
    ).resolves.toMatchObject({ status: "queued", continuationPending: true });
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        sql.includes("UPDATE workflow_run SET")
      )
    ).toBe(false);
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO workflow_run_job")
      )
    ).toBe(false);
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        sql.includes("UPDATE workflow_task SET status='completed'")
      )
    ).toBe(true);
  }
);
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

it.each([
  {
    decision: "approved",
    outcome: "revise",
    expectedDecision: "approved",
    approved: 1,
    rejected: 0,
  },
  {
    decision: "rejected",
    outcome: "send_back",
    expectedDecision: "rejected",
    approved: 0,
    rejected: 1,
  },
  {
    decision: "abstained",
    outcome: "abstained",
    expectedDecision: "rejected",
    approved: 0,
    rejected: 0,
  },
])("补偿续跑保留单人操作结果 $outcome 和正确的签署统计", async sample => {
  const task = {
    id: "task",
    runId: "run",
    nodeId: "review",
    nodeName: "审核",
    nodeRunId: "node-run",
    assignedUserId: 11,
    completedByUserId: 11,
    operationCode: "REVIEW",
    responsibleUserId: 33,
    representedUserId: 44,
    delegationId: "delegation",
    resultJson: JSON.stringify({
      decision: sample.decision,
      outcome: sample.outcome,
      comment: "请修改后提交",
      field: "原始表单值",
    }),
    payloadJson: JSON.stringify({ parallelTokens: [] }),
    nextNodeIdsJson: JSON.stringify(["wrong-default"]),
    outcomeHandlesJson: JSON.stringify({
      mode: "explicit",
      handles: { [sample.outcome]: "selected" },
    }),
    definitionSnapshotJson: JSON.stringify({
      nodes: [],
      edges: [
        {
          sourceNodeId: "review",
          sourceHandle: "selected",
          targetNodeId: "next",
        },
      ],
    }),
  };
  const latest = {
    vars: { sibling: "已完成" },
    nodes: {},
    runtime: {
      executionQueue: ["other-next"],
      parallelCheckpoint: {
        frames: {},
        queue: [{ nodeId: "other-next", tokens: [] }],
      },
    },
  };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM workflow_task t")) return [[task]];
    if (sql.includes("FROM workflow_run WHERE"))
      return [
        [
          {
            id: "run",
            status: "waiting",
            contextJson: JSON.stringify(latest),
            startedAt: new Date(),
          },
        ],
      ];
    if (sql.includes("FROM workflow_run_job")) return [[]];
    if (sql.includes("SELECT id,startedAt FROM workflow_node_run"))
      return [[{ id: "node-run", startedAt: new Date() }]];
    return [{ affectedRows: 1 }];
  });
  await expect(reconcileWorkflowContinuations()).resolves.toBe(1);
  const insert = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO workflow_run_job")
  );
  const checkpoint = JSON.parse(insert![1][3]);
  expect(checkpoint.queue).toEqual(["other-next", "next"]);
  expect(checkpoint.context.vars.sibling).toBe("已完成");
  expect(checkpoint.context.vars.review).toMatchObject({
    decision: sample.expectedDecision,
    outcome: sample.outcome,
    operationCode: "REVIEW",
    completedByUserId: 11,
    responsibleUserId: 33,
    representedUserId: 44,
    delegationId: "delegation",
    result: { field: "原始表单值" },
    approvalProgress: {
      approved: sample.approved,
      rejected: sample.rejected,
      decided: 1,
    },
  });
  expect(checkpoint.context.runtime.roleKeysByUser["11"]).toContain("sender");
  expect(checkpoint.context.runtime.participantUserIds).toContain(11);
});

it("会签补偿使用最终决定任务的处理人，不能按成员创建顺序猜测", async () => {
  const task = {
    id: "first-member",
    runId: "run",
    nodeId: "review",
    nodeRunId: "node-run",
    approvalGroupId: "group",
    groupStatus: "completed",
    groupOutcome: "approved",
    requiredApprovals: 2,
    totalApprovers: 2,
    assignedUserId: 11,
    completedByUserId: 11,
    resultJson: JSON.stringify({ decision: "approved", outcome: "approved" }),
    nextNodeIdsJson: "[]",
    payloadJson: "{}",
  };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM workflow_task t")) return [[task]];
    if (sql.includes("FROM workflow_run WHERE"))
      return [
        [
          {
            id: "run",
            status: "waiting",
            contextJson: "{}",
            startedAt: new Date(),
          },
        ],
      ];
    if (sql.includes("FROM workflow_run_job")) return [[]];
    if (sql.includes("SELECT id,startedAt FROM workflow_node_run"))
      return [[{ id: "node-run", startedAt: new Date() }]];
    if (sql.includes("FROM workflow_task WHERE approvalGroupId"))
      return [
        [
          {
            id: "first-member",
            completedByUserId: 11,
            resultJson: task.resultJson,
          },
          {
            id: "second-member",
            completedByUserId: 22,
            resultJson: task.resultJson,
          },
        ],
      ];
    return [{ affectedRows: 1 }];
  });
  expect(await reconcileWorkflowContinuations()).toBe(1);
  const insert = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO workflow_run_job")
  );
  expect(JSON.parse(insert![1][3]).context.vars.review.completedByUserId).toBe(
    11
  );
});
