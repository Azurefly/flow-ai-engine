import { expect, it } from "vitest";
import { canvasContextIds, canvasNodeRects, canvasViewBounds, readableCanvasLayout } from "../shared/workflow-canvas-geometry";
import { projectRunGraph, resolveRunGraphFocus, resolveRunGraphRecord } from "../shared/run-execution-graph";

it("实例定位纳入真实上下游和循环外侧通道，布局测量不改变记录与快照", () => {
  const run = { id: "run", status: "success", definitionSnapshotJson: {
    nodes: ["start", "review", "router", "end"].map(id => ({ id, name: id, type: id === "review" ? "operate" : "transform", position: { x: 0, y: 0 } })),
    edges: [{ id: "a", sourceNodeId: "start", targetNodeId: "review" }, { id: "b", sourceNodeId: "review", targetNodeId: "router" }, { id: "back", sourceNodeId: "router", targetNodeId: "review" }, { id: "done", sourceNodeId: "router", targetNodeId: "end" }],
  }, nodeRuns: [{ id: "A", nodeId: "review", status: "success", sequenceNo: 1, durationMs: 123 }, { id: "B", nodeId: "review", status: "success", sequenceNo: 2, durationMs: 456 }], taskActivities: [{ id: "task-a", nodeId: "review", nodeRunId: "A" }] };
  const original = JSON.stringify(run), graph = projectRunGraph(run);
  const focus = resolveRunGraphFocus(run, graph.nodes, "task-a"), review = graph.nodes.find(n => n.id === focus.nodeId);
  expect(resolveRunGraphRecord(review, focus, "")?.id).toBe("A");
  const edges = graph.edges.map(e => ({ source: String(e.source), target: String(e.target), data: { loop: e.returning } }));
  const nodes = readableCanvasLayout(graph.nodes.map(n => ({ id: n.id, position: n.layout, measured: { width: 208, height: n.id === "review" ? 240 : 104 } })), edges);
  const rects = canvasNodeRects(nodes), context = canvasContextIds(rects, edges, focus.nodeId);
  expect(context).toEqual(new Set(["review", "start", "router"]));
  const bounds = canvasViewBounds(rects, edges, context);
  for (const r of rects.filter(r => context.has(r.id))) {
    expect(r.x).toBeGreaterThan(bounds.x); expect(r.y).toBeGreaterThan(bounds.y);
    expect(r.x + r.width).toBeLessThan(bounds.x + bounds.width);
    expect(r.y + r.height).toBeLessThan(bounds.y + bounds.height);
  }
  expect(bounds.y).toBeLessThan(Math.min(...rects.map(r => r.y)) - 48);
  expect(resolveRunGraphRecord(review, focus, "B")?.durationMs).toBe(456);
  expect(resolveRunGraphRecord(review, focus, "")?.durationMs).toBe(123);
  expect(JSON.stringify(run)).toBe(original);
});
