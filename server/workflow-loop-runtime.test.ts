import { expect, it } from "vitest";
import type { WorkflowEdge } from "./workflow-compiler";
import { emptyWorkflowLoopCursor, advanceWorkflowLoopCursor, mergeWorkflowLoopCursors } from "./workflow-loop-cursor";
import { activateWorkflowLoopVisit, chargeWorkflowLoopVisit, initialWorkflowLoopQueue, MAX_DURABLE_WORKFLOW_STEPS, workflowLoopSuccessorCursors, workflowLoopVisitIdentity } from "./workflow-loop-runtime";
import { forkParallelState } from "./workflow-parallel-state";
import { prepareParallelJoin } from "./workflow-parallel-join";
import { restoreParallelCheckpoint, resumeParallelCheckpoint } from "./workflow-parallel-checkpoint";
import { withWorkflowIdempotencyHeader } from "./workflow-engine";
import { subflowRuntimeContext } from "./subflow-runtime-context";
import { readFileSync } from "node:fs";
const edges: WorkflowEdge[] = [
  { id: "forward", sourceNodeId: "start", targetNodeId: "review" },
  { id: "return", sourceNodeId: "review", targetNodeId: "start", sourceHandle: "retry", loop: { maxIterations: 3 } },
  { id: "finish", sourceNodeId: "review", targetNodeId: "end", sourceHandle: "done" },
];
const runtime = () => ({ loopExecutionVersion: 1, executionStepCount: 0, executionLoopCursor: emptyWorkflowLoopCursor() } as Record<string, unknown>);
it("节点重叠时连线定位入口仍可打开循环设置，沿用同一选择处理器", () => {
  const source = readFileSync(new URL("../client/src/components/WorkflowCanvas.tsx", import.meta.url), "utf8");
  expect(source).toContain('aria-label="定位并配置连线"');
  expect(source).toContain('new CustomEvent("flow:focus-node", { detail: { edgeId: event.target.value } })');
  expect(source).toContain('setSelectedEdgeId(edge.id)');
});
it("初始访问有独立检查点，激活后提供明确的连线计数", () => {
  const queue = initialWorkflowLoopQueue("start");
  expect(queue.queue[0].loopCursor).toEqual(emptyWorkflowLoopCursor());
  const state = runtime(); activateWorkflowLoopVisit(state, queue.queue[0].loopCursor, edges);
  expect(state.loopIterations).toEqual({ return: 0 });
});
it("只推进实际选择的返回边，普通出口不消耗循环次数", () => {
  const state = runtime();
  const next = workflowLoopSuccessorCursors(state, edges, "review", ["start"], "retry")!;
  expect(next[0].traversals).toEqual([{ edgeId: "return", count: 1 }]);
  expect(workflowLoopSuccessorCursors(state, edges, "review", ["end"], "done")![0].traversals).toEqual([]);
  expect((state.executionLoopCursor as any).traversals).toEqual([]);
  expect(() => workflowLoopSuccessorCursors(state, edges, "review", ["start"], "done")).toThrow("后继与运行定义不一致");
});
it("重复进入同一节点使用不同迭代身份，重放保持原身份", () => {
  const state = runtime(); const first = workflowLoopVisitIdentity(state, "review", []);
  state.executionLoopCursor = advanceWorkflowLoopCursor(state.executionLoopCursor, edges[1]);
  const second = workflowLoopVisitIdentity(state, "review", []);
  expect(second).not.toBe(first);
  expect(workflowLoopVisitIdentity(JSON.parse(JSON.stringify(state)), "review", [])).toBe(second);
  expect(workflowLoopVisitIdentity(state, "review", [{ frameId: "fork", branchId: "b" }])).not.toBe(second);
});
it("检查点重放不重复扣除步数，下一次迭代累计计数", () => {
  const state = runtime(); chargeWorkflowLoopVisit(state, "review", []);
  expect(state.executionStepCount).toBe(1);
  const restored = JSON.parse(JSON.stringify(state)); chargeWorkflowLoopVisit(restored, "review", []);
  expect(restored.executionStepCount).toBe(1);
  restored.executionLoopCursor = advanceWorkflowLoopCursor(restored.executionLoopCursor, edges[1]);
  chargeWorkflowLoopVisit(restored, "review", []); expect(restored.executionStepCount).toBe(2);
});
it("等待恢复不重置执行预算，非法计数和策略版本拒绝恢复", () => {
  const state = runtime(); state.executionStepCount = MAX_DURABLE_WORKFLOW_STEPS;
  expect(() => chargeWorkflowLoopVisit(state, "review", [])).toThrow("步上限");
  state.executionStepCount = "1"; expect(() => chargeWorkflowLoopVisit(state, "review", [])).toThrow("累计步数检查点无效");
  state.loopExecutionVersion = 2; expect(() => chargeWorkflowLoopVisit(state, "review", [])).toThrow("策略版本无效");
});
it("循环达到上限会拒绝返回，不能跳到另一后继绕过策略", () => {
  const state = runtime(); for (let i = 0; i < 3; i++) state.executionLoopCursor = advanceWorkflowLoopCursor(state.executionLoopCursor, edges[1]);
  expect(() => workflowLoopSuccessorCursors(state, edges, "review", ["start"], "retry")).toThrow("3 次上限");
  expect(workflowLoopSuccessorCursors(state, edges, "review", ["end"], "done")![0].traversals[0].count).toBe(3);
});
it("分支汇聚保留最大计数，不相加，也不修改旧分支检查点", () => {
  const a = { schemaVersion: 1, traversals: [{ edgeId: "return", count: 2 }] };
  const b = { schemaVersion: 1, traversals: [{ edgeId: "return", count: 3 }] };
  expect(mergeWorkflowLoopCursors([a, b]).traversals).toEqual([{ edgeId: "return", count: 3 }]);
  expect(a.traversals[0].count).toBe(2);
  const fork = forkParallelState({}, "fork", "route", "join", ["a", "b"], []);
  const checkpoint = { frames: fork.state, queue: [{ nodeId: "join", tokens: fork.tokens[0], loopCursor: a }, { nodeId: "join", tokens: fork.tokens[1], loopCursor: b }] } as any;
  const first = prepareParallelJoin(checkpoint); expect(first.ready).toBe(false);
  const second = prepareParallelJoin(first.checkpoint); expect(second.ready).toBe(true);
  expect(second.checkpoint.queue[0].loopCursor?.traversals[0].count).toBe(3);
  expect(second.checkpoint.queue[0].tokens).toEqual([]);
  expect(prepareParallelJoin(second.checkpoint).checkpoint).toEqual(second.checkpoint);
  expect(restoreParallelCheckpoint(second.checkpoint, ["join"])).toEqual(second.checkpoint);
});
it("恢复后继逐项保存游标，不把当前分支迭代复制到其他分支", () => {
  const first = emptyWorkflowLoopCursor(), second = advanceWorkflowLoopCursor(first, edges[1]);
  const checkpoint = resumeParallelCheckpoint({ frames: {}, queue: [] }, [], ["one", "two"], [], [], undefined, [first, second]);
  expect(checkpoint.queue[0].loopCursor?.traversals).toEqual([]);
  expect(checkpoint.queue[1].loopCursor?.traversals).toEqual([{ edgeId: "return", count: 1 }]);
  expect(() => resumeParallelCheckpoint({ frames: {}, queue: [] }, [], ["one"], [], [], undefined, [first, second])).toThrow("后继检查点与执行队列不一致");
});
it("HTTP 写请求在不同迭代使用不同幂等身份，重放使用原键", () => {
  const state = { ...runtime(), httpIdempotencyVersion: 4, executionRunId: "run", executionNodeId: "write", httpInvocationPath: ["write"] };
  const first = withWorkflowIdempotencyHeader("POST", {}, { runtime: state })["Idempotency-Key"];
  const repeat = withWorkflowIdempotencyHeader("POST", {}, { runtime: JSON.parse(JSON.stringify(state)) })["Idempotency-Key"];
  expect(repeat).toBe(first);
  state.executionLoopCursor = advanceWorkflowLoopCursor(state.executionLoopCursor, edges[1]);
  expect(withWorkflowIdempotencyHeader("POST", {}, { runtime: state })["Idempotency-Key"]).not.toBe(first);
});
it("同步子流程隔离自身计数并保留父迭代身份与累计预算", () => {
  const parent = { ...runtime(), httpIdempotencyVersion: 4, executionRunId: "run", executionNodeId: "call", httpInvocationPath: ["call"] };
  parent.executionLoopCursor = advanceWorkflowLoopCursor(parent.executionLoopCursor, edges[1]);
  parent.executionStepCount = 7;
  const child = subflowRuntimeContext(parent, "child")!;
  expect(child.runtime.executionLoopCursor).toEqual(emptyWorkflowLoopCursor());
  expect(child.runtime.httpParentLoopVisits).toEqual([parent.executionLoopCursor]);
  expect(child.runtime.executionStepCount).toBe(7);
  expect(child.runtime.executionVisitScope).toEqual(["call", "$subflow", "child"]);
  const key = workflowLoopVisitIdentity(child.runtime, "same", []);
  expect(key).not.toBe(workflowLoopVisitIdentity(parent, "same", []));
});
