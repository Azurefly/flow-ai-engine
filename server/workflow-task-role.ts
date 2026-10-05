import { createHash } from "node:crypto";
import type { BranchToken } from "./workflow-parallel-state";
export function workflowTaskRoleKey(
  roleKey: string,
  nodeId: string,
  tokens: BranchToken[]
) {
  if (!tokens.length) return roleKey;
  return `parallel:${createHash("sha256")
    .update(JSON.stringify([roleKey, nodeId, tokens]))
    .digest("hex")
    .slice(0, 48)}`;
}
