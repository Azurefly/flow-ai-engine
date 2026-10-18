/** Static directed connections, kept separate from execution state and saved data. */
export function traceWorkflowNeighborhood(
  nodeIds: string[],
  edges: { id: string; source: string; target: string }[],
  selected: string | null
) {
  const valid = new Set(nodeIds);
  if (!selected || !valid.has(selected)) return null;
  const incoming = new Map<string, typeof edges>();
  const outgoing = new Map<string, typeof edges>();
  for (const edge of edges) {
    if (!valid.has(edge.source) || !valid.has(edge.target)) continue;
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    incoming.get(edge.target)!.push(edge);
    outgoing.get(edge.source)!.push(edge);
  }
  const edgeIds = new Set<string>();
  function walk(
    index: Map<string, typeof edges>,
    direction: "source" | "target"
  ) {
    const visited = new Set([selected!]);
    const queue = [selected!];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const edge of index.get(queue[cursor]) ?? []) {
        edgeIds.add(edge.id);
        const next = edge[direction];
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    visited.delete(selected!);
    return visited;
  }
  const upstream = walk(incoming, "source");
  const downstream = walk(outgoing, "target");
  return {
    upstream,
    downstream,
    nodes: new Set([
      selected,
      ...Array.from(upstream),
      ...Array.from(downstream),
    ]),
    edges: edgeIds,
  };
}
