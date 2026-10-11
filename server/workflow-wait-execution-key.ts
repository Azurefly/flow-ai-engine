import { createHash } from "node:crypto";
import type { BranchToken } from "./workflow-parallel-state";

export function workflowWaitExecutionKey(
  runtime: Record<string, unknown>,
  tokens: BranchToken[]
) {
  const version = runtime.durableWaitVersion ?? 0;
  // Runs created before the migration keep their original durable identity.
  if (version === 0) return "legacy";
  if (version !== 1)
    throw new Error("等待节点执行身份版本无效，无法安全恢复。");
  if (!Array.isArray(tokens))
    throw new Error("等待节点并行分支身份无效，无法安全恢复。");
  const seen = new Set<string>();
  const path = tokens.map(token => {
    if (
      !token ||
      typeof token.frameId !== "string" ||
      !token.frameId.trim() ||
      typeof token.branchId !== "string" ||
      !token.branchId.trim() ||
      seen.has(token.frameId)
    )
      throw new Error("等待节点并行分支身份无效，无法安全恢复。");
    seen.add(token.frameId);
    return [token.frameId, token.branchId];
  });
  return path.length
    ? `branch:${createHash("sha256").update(JSON.stringify(path)).digest("hex")}`
    : "root";
}
