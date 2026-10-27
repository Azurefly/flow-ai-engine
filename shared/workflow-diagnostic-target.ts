type Graph = {
  nodes: { id: string; name?: string }[];
  edges: { id: string }[];
};
type Location = { kind?: string; nodeId?: string; edgeId?: string };

/** A saved-version diagnostic must never select an unrelated node in the current draft. */
export function workflowDiagnosticTarget(location: Location, graph: Graph) {
  const edge = graph.edges.find(item => item.id === location.edgeId);
  const node = graph.nodes.find(item => item.id === location.nodeId);
  if (edge && (location.kind === "edge" || !node))
    return { edgeId: edge.id, label: `定位连线：${edge.id}` };
  if (node)
    return { nodeId: node.id, label: `定位节点：${node.name || node.id}` };
  return null;
}
