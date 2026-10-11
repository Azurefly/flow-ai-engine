import { createHash } from "node:crypto";
import type { BranchToken } from "./workflow-parallel-state";
import { restoreWorkflowLoopCursor } from "./workflow-loop-cursor";

function durableExecutionKey(
  version: unknown,
  tokens: BranchToken[],
  label: string,
  loopCursor: unknown
) {
  // Runs created before the migration keep their original durable identity.
  if (version === 0) return "legacy";
  if (version !== 1 && version !== 2)
    throw new Error(`${label}执行身份版本无效，无法安全恢复。`);
  if (!Array.isArray(tokens))
    throw new Error(`${label}并行分支身份无效，无法安全恢复。`);
  const seen = new Set<string>();
  const path = Array.from(tokens, token => {
    if (
      !token ||
      typeof token.frameId !== "string" ||
      !token.frameId.trim() ||
      typeof token.branchId !== "string" ||
      !token.branchId.trim() ||
      seen.has(token.frameId)
    )
      throw new Error(`${label}并行分支身份无效，无法安全恢复。`);
    seen.add(token.frameId);
    return [token.frameId, token.branchId];
  });
  if (version === 2) {
    const cursor = restoreWorkflowLoopCursor(loopCursor);
    return `visit:${createHash("sha256")
      .update(JSON.stringify([path, cursor.traversals]))
      .digest("hex")}`;
  }
  return path.length
    ? `branch:${createHash("sha256").update(JSON.stringify(path)).digest("hex")}`
    : "root";
}
export function workflowWaitExecutionKey(
  runtime: Record<string, unknown>,
  tokens: BranchToken[]
) {
  return durableExecutionKey(
    runtime.durableWaitVersion ?? 0,
    tokens,
    "等待节点",
    runtime.executionLoopCursor
  );
}
export function workflowTaskExecutionKey(
  runtime: Record<string, unknown>,
  tokens: BranchToken[]
) {
  return durableExecutionKey(
    runtime.durableTaskVersion ?? 0,
    tokens,
    "人工任务",
    runtime.executionLoopCursor
  );
}
