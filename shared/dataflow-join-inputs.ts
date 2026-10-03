import type { NodeConfig } from "./workflow-node-contract";

/** Bind join sides to node identities instead of incidental edge ordering. */
export function resolveDataflowJoinInputs(
  config: NodeConfig,
  parents: string[],
  allowLegacy = false
): [string, string] {
  if (parents.length !== 2 || new Set(parents).size !== 2)
    throw new Error("关联节点必须连接两个不同的上游数据节点。");
  const left = String(config.leftInputNodeId ?? "").trim();
  const right = String(config.rightInputNodeId ?? "").trim();
  if (!left && !right && allowLegacy) return [parents[0], parents[1]];
  if (!left || !right) throw new Error("关联节点必须选择左侧输入和右侧输入。");
  if (left === right) throw new Error("关联节点左右输入不能选择同一个节点。");
  if (!parents.includes(left) || !parents.includes(right))
    throw new Error("关联节点左右输入必须分别连接到当前节点。");
  return [left, right];
}
