import { createHash } from "node:crypto";
import type { WorkflowEdge } from "./workflow-compiler";
import type { BranchToken } from "./workflow-parallel-state";
import {
  advanceWorkflowLoopCursor, emptyWorkflowLoopCursor, mergeWorkflowLoopCursors,
  restoreWorkflowLoopCursor, validateWorkflowLoopCursor,
} from "./workflow-loop-cursor";
import { workflowTaskExecutionKey } from "./workflow-wait-execution-key";

export const MAX_DURABLE_WORKFLOW_STEPS = 10000;
export function usesWorkflowLoopVisits(runtime: Record<string, unknown>) {
  if (runtime.loopExecutionVersion === undefined) return false;
  if (runtime.loopExecutionVersion !== 1) throw new Error("流程迭代策略版本无效，无法安全恢复。");
  return true;
}
export function activateWorkflowLoopVisit(runtime: Record<string, unknown>, value: unknown, edges: WorkflowEdge[]) {
  if (!usesWorkflowLoopVisits(runtime)) return;
  const cursor = validateWorkflowLoopCursor(value, edges);
  runtime.executionLoopCursor = cursor;
  runtime.loopIterations = Object.fromEntries(edges.filter(edge => edge.loop).map(edge => [edge.id, cursor.traversals.find(item => item.edgeId === edge.id)?.count ?? 0]));
}
export function workflowLoopVisitIdentity(runtime: Record<string, unknown>, nodeId: string, tokens: BranchToken[]) {
  const cursor = restoreWorkflowLoopCursor(runtime.executionLoopCursor);
  const branch = workflowTaskExecutionKey({ durableTaskVersion: 2, executionLoopCursor: cursor }, tokens);
  const scope = runtime.executionVisitScope ?? [];
  if (!Array.isArray(scope) || scope.some(part => typeof part !== "string" || !part.trim()))
    throw new Error("流程访问范围检查点无效，无法安全恢复。");
  return `visit:${createHash("sha256").update(JSON.stringify([scope, nodeId, branch])).digest("hex")}`;
}
export function restoreParentLoopVisits(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("子流程父迭代身份无效。");
  return Array.from(value, restoreWorkflowLoopCursor);
}
/** The predecessor checkpoint may be replayed; never mutate its cursor. */
export function workflowLoopSuccessorCursors(runtime: Record<string, unknown>, edges: WorkflowEdge[], sourceNodeId: string, next: string[], handle?: string) {
  if (!usesWorkflowLoopVisits(runtime)) return undefined;
  const cursor = validateWorkflowLoopCursor(runtime.executionLoopCursor, edges);
  return next.map(targetNodeId => {
    const selected = edges.filter(edge => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId && (handle === undefined || (edge.sourceHandle?.trim() || "default") === handle));
    if (!selected.length) throw new Error("循环恢复后继与运行定义不一致，不能推进流程。");
    return mergeWorkflowLoopCursors(selected.map(edge => advanceWorkflowLoopCursor(cursor, edge)));
  });
}
/** Charge a logical visit once, including recovery after an interrupted attempt. */
export function chargeWorkflowLoopVisit(runtime: Record<string, unknown>, nodeId: string, tokens: BranchToken[]) {
  if (!usesWorkflowLoopVisits(runtime)) return;
  const count = runtime.executionStepCount;
  if (!Number.isInteger(count) || Number(count) < 0 || Number(count) > MAX_DURABLE_WORKFLOW_STEPS)
    throw new Error("流程累计步数检查点无效，无法安全恢复。");
  const key = workflowLoopVisitIdentity(runtime, nodeId, tokens);
  if (runtime.executionChargedVisit === key) return;
  if (Number(count) >= MAX_DURABLE_WORKFLOW_STEPS)
    throw new Error(`流程累计执行已达到 ${MAX_DURABLE_WORKFLOW_STEPS} 步上限，请降低循环次数或简化流程。`);
  runtime.executionStepCount = Number(count) + 1;
  runtime.executionChargedVisit = key;
}
export function initialWorkflowLoopQueue(nodeId: string) {
  return { frames: {}, queue: [{ nodeId, tokens: [], loopCursor: emptyWorkflowLoopCursor() }] };
}
