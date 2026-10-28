import { expect, it } from "vitest";
import { getViewportForBounds } from "@xyflow/react";
import { runGraphFitOptions, runGraphHandles } from "./run-graph-viewport";
import { createRequire } from "node:module";
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
