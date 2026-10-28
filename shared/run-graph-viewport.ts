import type { NodeHandle, Position } from "@xyflow/react";

/** Read-only nodes have one input and one output at their measured vertical center. */
export function runGraphHandles(size = { width: 224, height: 140 }): NodeHandle[] {
  return [
    { type: "target", position: "left" as Position, x: 0, y: size.height / 2, width: 0, height: 0 },
    { type: "source", position: "right" as Position, x: size.width, y: size.height / 2, width: 0, height: 0 },
  ];
}

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
