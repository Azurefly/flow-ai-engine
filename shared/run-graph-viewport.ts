/** Overview may shrink; a selected node is always shown at a readable scale. */
export function runGraphFitOptions(nodeId?: string) {
  return {
    padding: nodeId ? 0.25 : 0.18,
    minZoom: nodeId ? 0.8 : 0.01,
    maxZoom: 1,
    duration: 0,
    ...(nodeId ? { nodes: [{ id: nodeId }] } : {}),
  };
}
