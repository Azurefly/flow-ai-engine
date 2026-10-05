import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
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
vi.mock("./organization-service", () => ({
  resolveAutoRelatedParticipantUserIds: async () => [],
  resolveWorkflowUserRoleKeys: async () => new Map(),
  resolveOperateAssignees: async ({ config }: any) => ({
    mode: "user",
    assignedUserId: config.assigneeUserId ?? 1,
    candidateUserIds: [config.assigneeUserId ?? 1],
  }),
}));
import {
  executeRunSegment,
  resumeWorkflowTask,
  signalWorkflowMessage,
} from "./workflow-engine";
import {
  forkParallelState,
  reachParallelJoin,
} from "./workflow-parallel-state";
import { restoreParallelCheckpoint } from "./workflow-parallel-checkpoint";
beforeEach(() => {
  vi.resetAllMocks();
  let sequence = 0;
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("nextNodeSequence=LAST_INSERT_ID")) {
      sequence++;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("SELECT LAST_INSERT_ID()"))
      return [[{ sequenceNo: sequence }]];
    return sql.startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }];
  });
});
it("同一节点来自两个分支时使用各自人员快照，汇聚后再合并", async () => {
  const fork = forkParallelState({}, "f", "router", "join", ["a", "b"], []);
  const context: any = {
    vars: {},
    nodes: {},
    runtime: {
      participantUserIds: [11, 22],
      nodeParticipantUserIds: { shared: [11, 22] },
      parallelCheckpoint: {
        frames: fork.state,
        queue: fork.tokens.map((tokens, i) => ({
          nodeId: "shared",
          tokens,
          participantUserIds: [i === 0 ? 11 : 22],
        })),
      },
    },
  };
  const result = await executeRunSegment({
    runId: "run",
    workflow: { id: "flow", ownerUserId: 1 } as any,
    definition: {
      nodes: [
        node("shared"),
        node("join", "transform", { parallelForNodeId: "router" }),
        node("end", "end"),
      ],
      edges: [edge("shared", "join"), edge("join", "end")],
    } as any,
    context,
    queue: ["shared", "shared"],
  });
  expect(result.status).toBe("success");
  const runs = mocks.query.mock.calls.filter(([sql]) =>
    sql.includes("INSERT INTO workflow_node_run")
  );
  expect(
    runs
      .filter(([, params]) => params[3] === "shared")
      .map(
        ([, params]) =>
          JSON.parse(params[6]).context.runtime.currentNodeParticipantUserIds
      )
  ).toEqual([[11], [22]]);
  const join = runs.find(([, params]) => params[3] === "join");
  expect(
    JSON.parse(join![1][6]).context.runtime.currentNodeParticipantUserIds
  ).toEqual([11, 22]);
});
it("消息等待续跑使用最新汇聚状态和其他分支输出，避免旧快照覆盖", async () => {
  const fork = forkParallelState({}, "f", "router", "join", ["a", "b"], []);
  const arrived = reachParallelJoin(fork.state, "join", fork.tokens[1]);
  const latest = {
    vars: { b: { value: 9 } },
    nodes: { b: { value: 9 } },
    runtime: {
      executionQueue: [],
      parallelCheckpoint: { frames: arrived.state, queue: [] },
    },
  };
  const stale = {
    queue: [],
    context: {
      vars: {},
      nodes: {},
      runtime: {
        parallelCheckpoint: { frames: fork.state, queue: [] },
        parallelWaitContinuation: {
          nextNodeIds: ["join"],
          tokens: fork.tokens[0],
        },
      },
    },
    currentNodeId: null,
    finalOutput: null,
  };
  const baseQuery = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.trim().startsWith("SELECT id FROM workflow_wait_subscription"))
      return [[{ id: "wait" }]];
    if (sql.includes("SELECT s.*,r.status AS runStatus"))
      return [
        [
          {
            id: "wait",
            runId: "run",
            nodeId: "catch",
            nodeRunId: "nr",
            status: "active",
            runStatus: "waiting",
            waitType: "message",
            checkpointJson: JSON.stringify(stale),
            runContextJson: JSON.stringify(latest),
          },
        ],
      ];
    return baseQuery(sql, params);
  });
  await expect(
    signalWorkflowMessage({
      runId: "run",
      messageName: "ready",
      correlationKey: "one",
      payload: { received: true },
    })
  ).resolves.toMatchObject({ status: "queued" });
  const job = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO workflow_run_job")
  );
  const checkpoint = JSON.parse(job![1][3]);
  expect(checkpoint.context.vars.b).toEqual({ value: 9 });
  expect(checkpoint.context.nodes.catch.payload).toEqual({ received: true });
  expect(checkpoint.queue).toEqual(["join"]);
  const result = await executeRunSegment({
    runId: "run",
    workflow: { id: "flow", ownerUserId: 1 } as any,
    definition: {
      nodes: [
        node("join", "transform", { parallelForNodeId: "router" }),
        node("end", "end"),
      ],
      edges: [edge("join", "end")],
    } as any,
    context: checkpoint.context,
    queue: checkpoint.queue,
  });
  expect(result.status).toBe("success");
});
const node = (id: string, type = "transform", config: any = {}) => ({
  id,
  type,
  name: id,
  config,
});
const edge = (
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle = "default"
) => ({ sourceNodeId, targetNodeId, sourceHandle });
const router = (id: string, join: string, targets: string[]) =>
  node(id, "router", {
    broadcast: true,
    parallelJoinNodeId: join,
    routes: targets.map((targetNodeId, i) => ({
      handle: targetNodeId,
      targetNodeId,
      priority: 100 - i,
      conditions: [],
    })),
  });
async function run(
  nodes: any[],
  edges: any[],
  onCheckpoint?: (checkpoint: any) => void
) {
  const checkpoints: any[] = [];
  const context = { input: {}, vars: {}, nodes: {}, runtime: {} };
  const result = await executeRunSegment({
    runId: "run",
    workflow: { id: "flow", ownerUserId: 1 } as any,
    definition: { nodes, edges } as any,
    context,
    queue: ["start"],
    checkpoint: async checkpoint => {
      (context.runtime as any).executionQueue = [...checkpoint.queue];
      const saved = JSON.parse(JSON.stringify(checkpoint));
      if (saved.context.runtime.parallelCheckpoint)
        restoreParallelCheckpoint(
          saved.context.runtime.parallelCheckpoint,
          saved.queue
        );
      checkpoints.push(saved);
      onCheckpoint?.(saved);
    },
  });
  const executed = mocks.query.mock.calls
    .filter(([sql]) => sql.includes("INSERT INTO workflow_node_run"))
    .map(([, params]) => params[3]);
  return { result, executed, checkpoints, context };
}
it("执行器隔离分支读取，汇聚后保留全部分支输出", async () => {
  const result = await run(
    [
      node("start", "start"),
      router("router", "join", ["a", "b"]),
      node("a", "transform", { mappings: { value: 10 } }),
      node("b", "transform", { mappings: { seen: "{{vars.a.value}}" } }),
      node("join", "transform", { parallelForNodeId: "router" }),
      node("end", "end"),
    ],
    [
      edge("start", "router"),
      edge("router", "a", "a"),
      edge("router", "b", "b"),
      edge("a", "join"),
      edge("b", "join"),
      edge("join", "end"),
    ]
  );
  expect(result.result.status).toBe("success");
  expect((result.context.vars as any).a).toEqual({ value: 10 });
  expect((result.context.vars as any).b.seen).not.toBe(10);
  expect((result.context.vars as any).b.seen).not.toBe("10");
});
it("执行器执行两条广播分支并仅执行一次汇聚及结束", async () => {
  const result = await run(
    [
      node("start", "start"),
      router("router", "join", ["a", "b"]),
      node("a"),
      node("b"),
      node("join", "transform", { parallelForNodeId: "router" }),
      node("end", "end"),
    ],
    [
      edge("start", "router"),
      edge("router", "a", "a"),
      edge("router", "b", "b"),
      edge("a", "join"),
      edge("b", "join"),
      edge("join", "end"),
    ]
  );
  expect(result.result.status).toBe("success");
  expect(result.executed).toEqual(["start", "router", "a", "b", "join", "end"]);
});
it("两个并行人工任务同时生成，依次提交后仅汇聚一次", async () => {
  const nodes = [
    node("start", "start"),
    router("router", "join", ["a", "b"]),
    node("a", "operate", { assigneeUserId: 1 }),
    node("b", "operate", { assigneeUserId: 2 }),
    node("join", "transform", { parallelForNodeId: "router" }),
    node("end", "end"),
  ];
  const edges = [
    edge("start", "router"),
    edge("router", "a", "a"),
    edge("router", "b", "b"),
    edge("a", "join"),
    edge("b", "join"),
    edge("join", "end"),
  ];
  const baseQuery = mocks.query.getMockImplementation()!;
  const pending = new Set(["a", "b"]);
  let context: any;
  let selectedTask: any;
  mocks.query.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.includes("FROM workflow_task t JOIN")) return [[selectedTask]];
    if (sql.includes("FROM workflow_run WHERE id=? FOR UPDATE"))
      return [
        [
          {
            status: "waiting",
            contextJson: JSON.stringify(context),
            definitionSnapshotJson: JSON.stringify({ nodes, edges }),
            startedAt: new Date(),
          },
        ],
      ];
    if (sql.includes("SELECT id,startedAt FROM workflow_node_run"))
      return [[{ id: `nr-${selectedTask.nodeId}`, startedAt: new Date() }]];
    if (sql.includes("UPDATE workflow_node_run SET status='success'"))
      pending.delete(selectedTask.nodeId);
    if (sql.includes("UNION ALL SELECT id FROM workflow_wait_subscription"))
      return [
        [
          ...Array.from(pending)
            .slice(0, 1)
            .map(id => ({ id })),
        ],
      ];
    return baseQuery(sql, params);
  });
  const initial = await run(nodes, edges);
  expect(initial.result.status).toBe("waiting");
  expect(initial.executed).toEqual(["start", "router", "a", "b"]);
  const tasks = mocks.query.mock.calls.filter(([sql]) =>
    sql.includes("INSERT INTO workflow_task (")
  );
  expect(tasks).toHaveLength(2);
  expect(tasks[0][1][11]).not.toBe(tasks[1][1][11]);
  const tokens = tasks.map(
    ([, params]) => JSON.parse(params[16]).parallelTokens
  );
  expect(tokens[0]).not.toEqual(tokens[1]);
  const nodeRunIds = tasks.map(
    ([, params]) => JSON.parse(params[16]).nodeRunId
  );
  expect(new Set(nodeRunIds).size).toBe(2);
  context = initial.context;
  for (const [, params] of tasks) {
    selectedTask = {
      id: params[0],
      workflowId: "flow",
      runId: "run",
      nodeId: params[4],
      status: "claimed",
      claimedByUserId: params[6],
      roleKey: params[11],
      payloadJson: params[16],
      nextNodeIdsJson: params[22],
    };
    await resumeWorkflowTask({
      taskId: selectedTask.id,
      completedBy: { id: params[6], role: "admin" },
      result: { decision: "approved" },
    });
    const job = mocks.query.mock.calls
      .filter(([sql]) => sql.includes("INSERT INTO workflow_run_job"))
      .slice(-1)[0];
    const checkpoint = JSON.parse(job[1][3]);
    context = checkpoint.context;
    const segment = await executeRunSegment({
      runId: "run",
      workflow: { id: "flow", ownerUserId: 1 } as any,
      definition: { nodes, edges } as any,
      context,
      queue: checkpoint.queue,
      checkpoint: async next => {
        context.runtime.executionQueue = [...next.queue];
      },
    });
    expect(segment.status).toBe(pending.size ? "waiting" : "success");
  }
  const resumedNodeQueries = mocks.query.mock.calls.filter(([sql]) =>
    sql.includes("SELECT id,startedAt FROM workflow_node_run")
  );
  expect(resumedNodeQueries.map(([, params]) => params[2])).toEqual(nodeRunIds);
  expect(context.vars.a.result.decision).toBe("approved");
  expect(context.vars.b.result.decision).toBe("approved");
  const executed = mocks.query.mock.calls
    .filter(([sql]) => sql.includes("INSERT INTO workflow_node_run"))
    .map(([, params]) => params[3]);
  expect(executed).toEqual(["start", "router", "a", "b", "join", "end"]);
});
it("汇聚释放后的检查点中断恢复不会漏执行汇聚或重跑分支", async () => {
  const nodes = [
    node("start", "start"),
    router("router", "join", ["a", "b"]),
    node("a"),
    node("b"),
    node("join", "transform", { parallelForNodeId: "router" }),
    node("end", "end"),
  ];
  const edges = [
    edge("start", "router"),
    edge("router", "a", "a"),
    edge("router", "b", "b"),
    edge("a", "join"),
    edge("b", "join"),
    edge("join", "end"),
  ];
  let saved: any;
  await expect(
    run(nodes, edges, checkpoint => {
      if (
        checkpoint.currentNodeId === "join" &&
        checkpoint.context.runtime.parallelCheckpoint.queue[0]
          .releasedJoinFrameId
      ) {
        saved = checkpoint;
        throw new Error("模拟进程中断");
      }
    })
  ).rejects.toThrow("模拟进程中断");
  expect(saved).toBeDefined();
  const result = await executeRunSegment({
    runId: "run",
    workflow: { id: "flow", ownerUserId: 1 } as any,
    definition: { nodes, edges } as any,
    context: JSON.parse(JSON.stringify(saved.context)),
    queue: [...saved.queue],
  });
  expect(result.status).toBe("success");
  const executed = mocks.query.mock.calls
    .filter(([sql]) => sql.includes("INSERT INTO workflow_node_run"))
    .map(([, params]) => params[3]);
  expect(executed).toEqual(["start", "router", "a", "b", "join", "end"]);
});
it("定时等待只挂起自身分支，其他分支仍推进到汇聚", async () => {
  const query = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (sql: string, params: any) => {
    if (sql.includes("UNION ALL SELECT id FROM workflow_wait_subscription"))
      return [[{ id: "wait-id" }]];
    return query(sql, params);
  });
  const result = await run(
    [
      node("start", "start"),
      router("router", "join", ["wait", "b"]),
      node("wait", "wait", { durationSeconds: 5 }),
      node("b"),
      node("join", "transform", { parallelForNodeId: "router" }),
      node("end", "end"),
    ],
    [
      edge("start", "router"),
      edge("router", "wait", "wait"),
      edge("router", "b", "b"),
      edge("wait", "join"),
      edge("b", "join"),
      edge("join", "end"),
    ]
  );
  expect(result.result).toEqual({ status: "waiting", taskId: "wait-id" });
  expect(result.executed).toEqual(["start", "router", "wait", "b"]);
  const subscription = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO workflow_wait_subscription")
  );
  const saved = JSON.parse(subscription![1][9]);
  expect(saved.context.runtime.parallelWaitContinuation.nextNodeIds).toEqual([
    "join",
  ]);
  expect(saved.context.runtime.parallelWaitContinuation.tokens).toHaveLength(1);
  const frames: any[] = Object.values(
    (result.context.runtime as any).parallelCheckpoint.frames
  );
  expect(frames[0].barrier.arrived).toHaveLength(1);
  expect(frames[0].barrier.released).toBe(false);
});
it("广播只派发一条命中分支时不等待未派发的连线", async () => {
  const result = await run(
    [
      node("start", "start"),
      router("router", "join", ["a"]),
      node("a"),
      node("b"),
      node("join", "transform", { parallelForNodeId: "router" }),
      node("end", "end"),
    ],
    [
      edge("start", "router"),
      edge("router", "a", "a"),
      edge("router", "b", "b"),
      edge("a", "join"),
      edge("b", "join"),
      edge("join", "end"),
    ]
  );
  expect(result.result.status).toBe("success");
  expect(result.executed).toEqual(["start", "router", "a", "join", "end"]);
});
it("嵌套广播先汇聚内层再汇聚外层且各汇聚仅执行一次", async () => {
  const result = await run(
    [
      node("start", "start"),
      router("outer", "outer-join", ["inner", "b"]),
      router("inner", "inner-join", ["x", "y"]),
      node("b"),
      node("x"),
      node("y"),
      node("inner-join", "transform", { parallelForNodeId: "inner" }),
      node("outer-join", "transform", { parallelForNodeId: "outer" }),
      node("end", "end"),
    ],
    [
      edge("start", "outer"),
      edge("outer", "inner", "inner"),
      edge("outer", "b", "b"),
      edge("inner", "x", "x"),
      edge("inner", "y", "y"),
      edge("x", "inner-join"),
      edge("y", "inner-join"),
      edge("inner-join", "outer-join"),
      edge("b", "outer-join"),
      edge("outer-join", "end"),
    ]
  );
  expect(result.result.status).toBe("success");
  expect(result.executed.filter(id => id === "inner-join")).toHaveLength(1);
  expect(result.executed.filter(id => id === "outer-join")).toHaveLength(1);
  expect(result.executed.indexOf("inner-join")).toBeLessThan(
    result.executed.indexOf("outer-join")
  );
});
