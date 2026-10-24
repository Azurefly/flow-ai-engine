import { expect, it } from "vitest";
import { availableEditorHeight } from "./editor-viewport";
it("按实际位置扣除页头、状态区和底部留白，不使用固定220px偏移", () => {
  expect(availableEditorHeight(1000, 200)).toBe(784);
  expect(availableEditorHeight(1000, 280)).toBe(704);
  expect(availableEditorHeight(800, 210, 12)).toBe(578);
});
it("短窗口或展开大量诊断时保留可操作高度，允许外层正常滚动", () => {
  expect(availableEditorHeight(500, 300)).toBe(360);
  expect(availableEditorHeight(900, -20)).toBe(884);
  expect(availableEditorHeight(NaN, 10)).toBe(480);
});
