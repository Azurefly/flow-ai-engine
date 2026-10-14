export function hasCanvasInspectorSelection(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ id: string }>,
  nodeId: string | null,
  edgeId: string | null
) {
  return nodes.some(node => node.id === nodeId) || edges.some(edge => edge.id === edgeId);
}

export function readWorkflowLoopLimit(value: string): number | null {
  const count = Number(value);
  return value.trim() && Number.isInteger(count) && count >= 1 && count <= 1000 ? count : null;
}

export function automaticCanvasFit(
  preview: boolean,
  selectedId?: string | null
) {
  return {
    padding: preview ? 0.12 : 0.22,
    minZoom: preview ? 0.1 : 0.65,
    maxZoom: preview ? 1.25 : 1,
    ...(selectedId && !preview ? { nodes: [{ id: selectedId }] } : {}),
  };
}
