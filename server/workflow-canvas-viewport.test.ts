import { expect, it } from "vitest";
import { automaticCanvasFit, hasCanvasInspectorSelection, readWorkflowLoopLimit } from "../client/src/components/workflow-canvas-viewport";

it("节点和连线均可打开配置，清空或删除后的选择不显示面板", () => {
  const nodes = [{ id: "node" }], edges = [{ id: "edge" }];
  expect(hasCanvasInspectorSelection(nodes, edges, "node", null)).toBe(true);
  expect(hasCanvasInspectorSelection(nodes, edges, null, "edge")).toBe(true);
  expect(hasCanvasInspectorSelection(nodes, edges, null, null)).toBe(false);
  expect(hasCanvasInspectorSelection(nodes, [], null, "edge")).toBe(false);
  expect(hasCanvasInspectorSelection([], edges, "node", null)).toBe(false);
});
it("循环返回上限只接受 1 到 1000 的整数", () => {
  expect(readWorkflowLoopLimit("1")).toBe(1);
  expect(readWorkflowLoopLimit("1000")).toBe(1000);
  for (const value of ["", " ", "0", "-1", "1001", "1.5", "NaN", "Infinity"]) {
    expect(readWorkflowLoopLimit(value)).toBeNull();
  }
});

it("编辑视图自动适配时保持节点可读", () => {
  expect(automaticCanvasFit(false)).toEqual({
    padding: 0.22,
    minZoom: 0.65,
    maxZoom: 1,
  });
});
it("打开配置时聚焦所选节点", () => {
  expect(automaticCanvasFit(false, "approval").nodes).toEqual([
    { id: "approval" },
  ]);
});
it("只读预览保留完整流程适配", () => {
  expect(automaticCanvasFit(true, "approval")).toEqual({
    padding: 0.12,
    minZoom: 0.1,
    maxZoom: 1.25,
  });
});
