import { expect, it } from "vitest";
import { automaticCanvasFit } from "../client/src/components/workflow-canvas-viewport";

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
