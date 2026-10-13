import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), sequence: 0, checkpoints: [] as any[] }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query, getConnection: async () => ({ query: mocks.query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) }) }));
import { executeRunSegment } from "./workflow-engine";
import { initialWorkflowLoopQueue } from "./workflow-loop-runtime";
import { emptyWorkflowLoopCursor } from "./workflow-loop-cursor";
it("真实调度器重复执行返回节点，达到策略上限后失败而非去重跳过", async () => {
  mocks.sequence = 0; mocks.checkpoints = [];
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("UPDATE workflow_run SET nextNodeSequence")) { mocks.sequence++; return [{ affectedRows: 1 }]; }
    if (sql.startsWith("SELECT LAST_INSERT_ID")) return [[{ sequenceNo: mocks.sequence }]];
    if (sql.startsWith("SELECT")) return [[]];
    return [{ affectedRows: 1 }];
  });
  const definition: any = { schemaVersion: 1, settings: {}, nodes: [
    { id: "start", type: "start", name: "开始", config: {}, position: { x: 0, y: 0 } },
    { id: "route", type: "router", name: "循环", config: { defaultRoute: "again" }, position: { x: 100, y: 0 } },
    { id: "end", type: "end", name: "结束", config: {}, position: { x: 200, y: 0 } },
  ], edges: [
    { id: "forward", sourceNodeId: "start", targetNodeId: "route" },
    { id: "back", sourceNodeId: "route", targetNodeId: "start", sourceHandle: "again", loop: { maxIterations: 2 } },
    { id: "done", sourceNodeId: "route", targetNodeId: "end", sourceHandle: "done" },
  ] };
  const context: any = { input: {}, vars: {}, nodes: {}, runtime: {
    loopExecutionVersion: 1, executionStepCount: 0, executionLoopCursor: emptyWorkflowLoopCursor(),
    durableWaitVersion: 2, durableTaskVersion: 2, httpIdempotencyVersion: 4,
    parallelCheckpoint: initialWorkflowLoopQueue("start"),
  } };
  await expect(executeRunSegment({ runId: "owned-run", workflow: { id: "owned-flow", flowType: "control", ownerUserId: 1 } as any, definition, context, queue: ["start"], checkpoint: async snapshot => { mocks.checkpoints.push(JSON.parse(JSON.stringify(snapshot))); } })).rejects.toThrow("2 次上限");
  const starts = mocks.query.mock.calls.filter(([sql, args]) => sql.startsWith("INSERT INTO workflow_node_run") && args[3] === "start");
  expect(starts).toHaveLength(3);
  expect(context.runtime.executionStepCount).toBe(6);
  expect(mocks.checkpoints.some(checkpoint => checkpoint.context.runtime.executionStepCount === 6)).toBe(true);
});
