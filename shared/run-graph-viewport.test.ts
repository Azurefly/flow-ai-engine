import { expect, it } from "vitest";
import { getViewportForBounds } from "@xyflow/react";
import { runGraphFitOptions } from "./run-graph-viewport";
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
