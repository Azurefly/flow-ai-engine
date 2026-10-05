import type { NodeConfig } from "./workflow-node-contract";

export function setRouterBroadcast(
  config: NodeConfig,
  enabled: boolean
): NodeConfig {
  return { ...config, gbms: enabled, broadcast: enabled };
}

/** Update both sides of a parallel binding without changing unrelated config. */
export function bindParallelJoin(
  nodes: Array<{ id: string; config: NodeConfig }>,
  routerId: string,
  joinId: string
): Record<string, NodeConfig> {
  const router = nodes.find(node => node.id === routerId);
  const join = nodes.find(node => node.id === joinId);
  if (!router || (joinId && (!join || joinId === routerId)))
    throw new Error("请选择当前流程中的其他节点作为汇聚节点。");
  if (
    join?.config.parallelForNodeId &&
    join.config.parallelForNodeId !== routerId
  )
    throw new Error("该汇聚节点已绑定其他并行路由，请选择其他节点。");
  const changes: Record<string, NodeConfig> = {
    [routerId]: { ...router.config, parallelJoinNodeId: joinId },
  };
  for (const node of nodes)
    if (node.id !== joinId && node.config.parallelForNodeId === routerId)
      changes[node.id] = { ...node.config, parallelForNodeId: "" };
  if (join) changes[joinId] = { ...join.config, parallelForNodeId: routerId };
  return changes;
}
