import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  artifacts: [] as { sql: string; params: any[] }[],
  sequence: 0,
  nodeStatus: "running",
  nodeInsertions: 0,
  failSecondMember: false,
  failWaitUpdate: false,
  completedEnd: undefined as unknown,
  prepared: undefined as unknown,
  rollbacks: 0,
  poolQueries: [] as string[],
}));
vi.mock("./db", () => {
  const artifact = (sql: string) =>
    [
      "workflow_task_group",
      "workflow_task",
      "workflow_task_schedule",
      "workflow_participant_state",
      "workflow_wait_subscription",
    ].some(
      table =>
        sql.startsWith(`INSERT INTO ${table} (`) ||
        sql.startsWith(`INSERT INTO ${table}\n`)
    );
  const commonRead = (sql: string, params: any[]) => {
    if (sql.startsWith("SELECT r.*,w.id AS workflowDefinitionId"))
      return [state.prepared === undefined ? [] : [state.prepared]];
    if (sql.includes("SELECT LAST_INSERT_ID()"))
      return [[{ sequenceNo: state.sequence }]];
    if (sql.startsWith("SELECT id,payloadJson FROM workflow_task")) {
      const rows = state.artifacts
        .filter(
          entry =>
            entry.sql.startsWith("INSERT INTO workflow_task (") &&
            entry.params[3] === params[0] &&
            entry.params[4] === params[1] &&
            entry.params[24] === params[2]
        )
        .map(entry => ({ id: entry.params[0], payloadJson: entry.params[16] }));
      return [rows.slice(0, 1)];
    }
    if (sql.startsWith("SELECT id,nodeRunId FROM workflow_wait_subscription"))
      return [
        state.artifacts
          .filter(
            entry =>
              entry.sql.startsWith("INSERT INTO workflow_wait_subscription") &&
              entry.params[1] === params[0] &&
              entry.params[3] === params[1] &&
              entry.params[11] === params[2]
          )
          .map(entry => ({ id: entry.params[0], nodeRunId: entry.params[4] })),
      ];
    if (sql.includes("UNION ALL SELECT id FROM workflow_wait_subscription"))
      return [
        [
          ...state.artifacts
            .filter(
              entry =>
                entry.sql.startsWith("INSERT INTO workflow_task (") ||
                entry.sql.startsWith("INSERT INTO workflow_wait_subscription")
            )
            .map(entry => ({ id: entry.params[0] })),
        ],
      ];
    if (sql.startsWith("SELECT outputJson FROM workflow_node_run"))
      return [
        state.completedEnd === undefined
          ? []
          : [{ outputJson: state.completedEnd }],
      ];
    return sql.startsWith("SELECT") ? [[]] : undefined;
  };
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      state.poolQueries.push(sql);
      const read = commonRead(sql, params);
      if (read) return read;
      if (artifact(sql)) state.artifacts.push({ sql, params });
      if (
        sql.startsWith("UPDATE workflow_node_run SET status=?") &&
        (!sql.includes("AND status='running'") ||
          state.nodeStatus === "running")
      )
        state.nodeStatus = params[0];
      if (sql.startsWith("UPDATE workflow_node_run SET status='waiting'"))
        state.nodeStatus = "waiting";
      return [{ affectedRows: 1 }];
    },
    getConnection: async () => {
      let pending: { sql: string; params: any[] }[] = [];
      let nodeStatus: string | undefined;
      let members = 0;
      return {
        beginTransaction: async () => {},
        query: async (sql: string, params: any[] = []) => {
          if (sql.includes("nextNodeSequence=LAST_INSERT_ID")) {
            state.sequence++;
            return [{ affectedRows: 1 }];
          }
          const read = commonRead(sql, params);
          if (read) return read;
          if (sql.startsWith("INSERT INTO workflow_node_run")) {
            state.nodeInsertions++;
            nodeStatus = "running";
          }
          if (sql.startsWith("INSERT INTO workflow_task (")) {
            members++;
            if (state.failSecondMember && members === 2)
              throw new Error("Injected second member insert failure");
          }
          if (artifact(sql)) pending.push({ sql, params });
          if (sql.startsWith("UPDATE workflow_node_run SET status=?"))
            nodeStatus = params[0];
          if (sql.startsWith("UPDATE workflow_node_run SET status='waiting'")) {
            if (state.failWaitUpdate)
              throw new Error("Injected wait node update failure");
            nodeStatus = "waiting";
          }
          return [{ affectedRows: 1 }];
        },
        commit: async () => {
          state.artifacts.push(...pending);
          pending = [];
          if (nodeStatus) state.nodeStatus = nodeStatus;
        },
        rollback: async () => {
          state.rollbacks++;
          pending = [];
          nodeStatus = undefined;
        },
        release: () => {},
      };
    },
  };
  return { getSharedPool: () => pool };
});
vi.mock("./organization-service", () => ({
  resolveAutoRelatedParticipantUserIds: async () => [],
  resolveWorkflowUserRoleKeys: async () => new Map(),
  resolveOperateAssignees: async () => ({
    mode: "user",
    assignedUserId: 1,
    candidateUserIds: [1, 2],
  }),
}));
import {
  executeRunSegment,
  executePreparedWorkflowRun,
  WorkflowExecutionInjectedCrash,
} from "./workflow-engine";

const definition = {
  nodes: [
    {
      id: "review",
      type: "operate",
      name: "Review",
      config: {
        bdcz: { hqhqsz: "andSignFor", hqtgbfb: 100 },
        reminderAfterSeconds: 5,
        dueAfterSeconds: 10,
        escalationAfterSeconds: 15,
      },
    },
  ],
  edges: [],
} as any;
const context = () => ({
  input: {},
  vars: {},
  nodes: {},
  runtime: {
    durableTaskVersion: 1,
    atomicHumanTaskVersion: 1,
    triggeredByUserId: 1,
    participantUserIds: [1],
    roleKeysByUser: {},
  },
});
const run = (ctx: any, checkpoint?: (value: any) => Promise<void>) =>
  executeRunSegment({
    runId: "run",
    workflow: { id: "flow", ownerUserId: 1 } as any,
    definition,
    context: ctx,
    queue: ["review"],
    checkpoint,
  });
const count = (table: string) =>
  state.artifacts.filter(
    entry =>
      entry.sql.startsWith(`INSERT INTO ${table} (`) ||
      entry.sql.startsWith(`INSERT INTO ${table}\n`)
  ).length;

beforeEach(() => {
  state.artifacts = [];
  state.sequence = 0;
  state.nodeStatus = "running";
  state.nodeInsertions = 0;
  state.failSecondMember = false;
  state.failWaitUpdate = false;
  state.completedEnd = undefined;
  state.prepared = undefined;
  state.rollbacks = 0;
  state.poolQueries = [];
});
afterEach(() => vi.unstubAllEnvs());

it("成员写入失败回滚审批组、全部任务、提醒与人员状态", async () => {
  state.failSecondMember = true;
  await expect(run(context())).rejects.toThrow("second member insert failure");
  expect(state.rollbacks).toBe(1);
  expect(count("workflow_task_group")).toBe(0);
  expect(count("workflow_task")).toBe(0);
  expect(count("workflow_task_schedule")).toBe(0);
  expect(count("workflow_participant_state")).toBe(0);
  expect(state.nodeStatus).toBe("failed");
});

it("事务提交后检查点中断可重放，保留完整成员并不重复创建", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv(
    "WORKFLOW_WORKER_FAULT_POINT",
    "after_human_commit_before_checkpoint"
  );
  let saved: any;
  await expect(
    run(context(), async checkpoint => {
      saved = structuredClone(checkpoint);
    })
  ).rejects.toBeInstanceOf(WorkflowExecutionInjectedCrash);
  expect(saved.queue).toEqual(["review"]);
  expect(state.nodeStatus).toBe("waiting");
  expect(count("workflow_task_group")).toBe(1);
  expect(count("workflow_task")).toBe(2);
  expect(count("workflow_task_schedule")).toBeGreaterThan(0);
  expect(count("workflow_participant_state")).toBe(2);
  const taskIds = state.artifacts
    .filter(entry => entry.sql.startsWith("INSERT INTO workflow_task ("))
    .map(entry => entry.params[0]);
  vi.unstubAllEnvs();
  const replayContext: any = saved.context;
  const result = await run(replayContext, async checkpoint => {
    saved = structuredClone(checkpoint);
  });
  expect(result).toEqual({ status: "waiting", taskId: taskIds[0] });
  expect(saved.queue).toEqual([]);
  expect(count("workflow_task_group")).toBe(1);
  expect(count("workflow_task")).toBe(2);
  expect(state.nodeInsertions).toBe(1);
  expect(replayContext.runtime.roleKeysByUser["2"]).toContain("receiver");
});

it("任务已完成后丢失检查点租约不会覆盖成功的节点记录", async () => {
  await expect(
    run(context(), async checkpoint => {
      if (checkpoint.currentNodeId === null) {
        state.nodeStatus = "success";
        throw new Error("Checkpoint ownership changed");
      }
    })
  ).rejects.toThrow("ownership changed");
  expect(state.nodeStatus).toBe("success");
  expect(count("workflow_task")).toBe(2);
  expect(
    state.poolQueries.some(sql => sql.includes("AND status='running'"))
  ).toBe(true);
});
const waitDefinition = {
  nodes: [
    {
      id: "hold",
      type: "message_catch",
      name: "Hold",
      config: { messageName: "ready", correlationKey: "owned" },
    },
    { id: "end", type: "end", name: "End", config: {} },
  ],
  edges: [{ id: "h-e", sourceNodeId: "hold", targetNodeId: "end" }],
} as any;
const waitContext = () => ({
  ...context(),
  runtime: {
    ...context().runtime,
    durableWaitVersion: 1,
    deferredRootWaitVersion: 1,
  },
});
const waitRun = (
  ctx: any,
  queue: string[],
  checkpoint?: (value: any) => Promise<void>
) =>
  executeRunSegment({
    runId: "run",
    workflow: { id: "flow", ownerUserId: 1 } as any,
    definition: waitDefinition,
    context: ctx,
    queue,
    checkpoint,
  });
it("等待节点写入失败回滚订阅，不留下可触发的半成品", async () => {
  state.failWaitUpdate = true;
  await expect(waitRun(waitContext(), ["hold"])).rejects.toThrow(
    "wait node update failure"
  );
  expect(count("workflow_wait_subscription")).toBe(0);
  expect(state.nodeStatus).toBe("failed");
});
it("等待事务提交后中断可重放，订阅与等待节点不重复", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv(
    "WORKFLOW_WORKER_FAULT_POINT",
    "after_wait_commit_before_checkpoint"
  );
  let saved: any;
  await expect(
    waitRun(waitContext(), ["hold"], async checkpoint => {
      saved = structuredClone(checkpoint);
    })
  ).rejects.toBeInstanceOf(WorkflowExecutionInjectedCrash);
  expect(state.nodeStatus).toBe("waiting");
  expect(count("workflow_wait_subscription")).toBe(1);
  const subscription = state.artifacts.find(entry =>
    entry.sql.startsWith("INSERT INTO workflow_wait_subscription")
  )!;
  expect(JSON.parse(subscription.params[9]).queue).toEqual([]);
  expect(
    JSON.parse(subscription.params[9]).context.runtime.rootWaitContinuation
      .nextNodeIds
  ).toEqual(["end"]);
  vi.unstubAllEnvs();
  expect(await waitRun(saved.context, saved.queue)).toEqual({
    status: "waiting",
    taskId: subscription.params[0],
  });
  expect(count("workflow_wait_subscription")).toBe(1);
  expect(state.nodeInsertions).toBe(1);
});
it("空检查点保留已登记的线性等待，不重新执行起点", async () => {
  const ctx: any = waitContext();
  await waitRun(ctx, ["hold"]);
  expect((await waitRun(ctx, [])).status).toBe("waiting");
  expect(state.nodeInsertions).toBe(1);
  ctx.runtime.executionQueue = [];
  state.prepared = {
    workflowDefinitionId: "flow",
    workflowId: "flow",
    ownerUserId: 1,
    status: "running",
    definitionSnapshotJson: {
      ...waitDefinition,
      nodes: [
        { id: "start", type: "start", name: "Start", config: {} },
        ...waitDefinition.nodes,
      ],
      edges: [
        { id: "s-h", sourceNodeId: "start", targetNodeId: "hold" },
        ...waitDefinition.edges,
      ],
    },
    contextJson: ctx,
  };
  expect((await executePreparedWorkflowRun({ runId: "run" })).status).toBe(
    "waiting"
  );
  expect(state.nodeInsertions).toBe(1);
});
it("终点已提交时从空检查点完成运行而不重复执行", async () => {
  state.completedEnd = { result: { done: true } };
  expect(await waitRun(waitContext(), [])).toEqual({
    status: "success",
    output: state.completedEnd,
  });
  expect(state.nodeInsertions).toBe(0);
});
