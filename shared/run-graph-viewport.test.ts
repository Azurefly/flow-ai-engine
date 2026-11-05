import { expect, it } from "vitest";
import { getViewportForBounds } from "@xyflow/react";
import { initialRunViewNode, runGraphFitOptions, runGraphHandles } from "./run-graph-viewport";
import { createRequire } from "node:module";
import { canvasContextIds, canvasNodeRects, canvasViewBounds } from "./workflow-canvas-geometry";
import { projectRunGraph, resolveRunGraphFocus, resolveRunGraphRecord } from "./run-execution-graph";

it("普通实例即使默认详情选中结束节点，初始视口仍包含全部六节点", () => {
  const ids = ["start", "left", "right", "join", "summary", "end"];
  const run = { status: "success", definitionSnapshotJson: {
    nodes: ids.map(id => ({ id, name: id, type: "transform", position: { x: 0, y: 0 } })),
    edges: [["start","left"],["start","right"],["left","join"],["right","join"],["join","summary"],["summary","end"]].map(([sourceNodeId,targetNodeId],i)=>({ id: String(i), sourceNodeId, targetNodeId })),
  }, nodeRuns: ids.map((nodeId,i)=>({ id: "record-"+i, nodeId, status: "success", sequenceNo: i })) };
  const before = JSON.stringify(run), graph = projectRunGraph(run);
  expect(resolveRunGraphFocus(run, graph.nodes).nodeId).toBe("end");
  const rects = canvasNodeRects(graph.nodes.map(n=>({ id: n.id, position: n.layout, measured: { width:208, height:104 } })));
  const context = canvasContextIds(rects, graph.edges, initialRunViewNode());
  expect(context.size).toBe(6);
  const bounds = canvasViewBounds(rects, graph.edges, context), options = runGraphFitOptions();
  const view = getViewportForBounds(bounds,749,522,options.minZoom,options.maxZoom,options.padding);
  expect(view.zoom).toBeLessThan(0.4);
  for(const rect of rects){
    expect(view.x+rect.x*view.zoom).toBeGreaterThanOrEqual(0);
    expect(view.y+rect.y*view.zoom).toBeGreaterThanOrEqual(0);
    expect(view.x+(rect.x+rect.width)*view.zoom).toBeLessThanOrEqual(749);
    expect(view.y+(rect.y+rect.height)*view.zoom).toBeLessThanOrEqual(522);
  }
  expect(JSON.stringify(run)).toBe(before);
});

it("任务入口保留精确批次，显式操作记录定位优先，缺失任务不猜节点", () => {
  const run = { status: "success", nodeRuns: [
    { id:"old",nodeId:"review",status:"success",sequenceNo:1 },
    { id:"new",nodeId:"review",status:"success",sequenceNo:2 },
    { id:"end-record",nodeId:"end",status:"success",sequenceNo:3 },
  ],taskActivities:[{id:"task",nodeId:"review",nodeRunId:"old"}] };
  const graph=projectRunGraph(run), task=resolveRunGraphFocus(run,graph.nodes,"task");
  expect(initialRunViewNode(undefined,task.nodeId)).toBe("review");
  expect(resolveRunGraphRecord(graph.nodes.find(n=>n.id==="review"),task,"")?.id).toBe("old");
  expect(initialRunViewNode("end",task.nodeId)).toBe("end");
  const missing=resolveRunGraphFocus(run,graph.nodes,"missing-task");
  expect(missing.warning).toBeTruthy();
  expect(initialRunViewNode(undefined,missing.nodeId)).toBeUndefined();
});
it("长流程中的具体办理节点居中并保持正文原始字号", () => {
  const options = runGraphFitOptions("shared");
  const bounds = { x: 6000, y: 200, width: 224, height: 140 };
  const view = getViewportForBounds(
    bounds,
    900,
    440,
    options.minZoom,
    options.maxZoom,
    options.padding
  );
  expect(options.nodes).toEqual([{ id: "shared" }]);
  expect(view.zoom * 14).toBe(14);
  expect(view.x + (bounds.x + bounds.width / 2) * view.zoom).toBeCloseTo(450);
  expect(view.y + (bounds.y + bounds.height / 2) * view.zoom).toBeCloseTo(220);
});
it("查看全图包含所有节点，并允许长流程缩小以浏览关系", () => {
  const overview = runGraphFitOptions();
  const bounds = { x: 0, y: 0, width: 12000, height: 400 };
  const view = getViewportForBounds(
    bounds,
    900,
    440,
    overview.minZoom,
    overview.maxZoom,
    overview.padding
  );
  expect(overview).not.toHaveProperty("nodes");
  expect(view.zoom).toBeLessThan(0.1);
  expect(view.x).toBeGreaterThanOrEqual(0);
  expect(view.x + bounds.width * view.zoom).toBeLessThanOrEqual(900);
});
it("只读端点在未挂载或重新测量DOM时仍能生成完整连线，支持逆序节点及不同高度", () => {
  const require = createRequire(import.meta.url);
  const system = require(require.resolve("@xyflow/system", { paths: [require.resolve("@xyflow/react")] }));
  const lookup = new Map();
  const parentLookup = new Map();
  for (const height of [100, 180]) {
    const nodes = ["end", "review", "start"].map((id, index) => {
      const size = { width: 224, height: id === "review" ? height : 100 };
      return { id, data: {}, position: { x: (2 - index) * 310, y: 0 }, measured: size, handles: runGraphHandles(size) };
    });
    expect(system.adoptUserNodes(nodes, lookup, parentLookup).nodesInitialized).toBe(true);
    const input = system.getEdgePosition({ id: "in", sourceNode: lookup.get("start"), targetNode: lookup.get("review"), connectionMode: "strict" });
    const output = system.getEdgePosition({ id: "out", sourceNode: lookup.get("review"), targetNode: lookup.get("end"), connectionMode: "strict" });
    expect(input).toMatchObject({ sourceX: 224, sourceY: 50, targetX: 310, targetY: height / 2 });
    expect(output).toMatchObject({ sourceX: 534, sourceY: height / 2, targetX: 620, targetY: 50 });
  }
});
