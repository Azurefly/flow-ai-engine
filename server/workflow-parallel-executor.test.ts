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
import { executeRunSegment } from "./workflow-engine";
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
