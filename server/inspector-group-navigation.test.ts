import { expect, it } from "vitest";
import { inspectorGroupScrollTarget } from "../client/src/hooks/useInspectorGroupNavigation";

it("长高级配置切到处理人后将面板开头放在实际分类栏下方", () => {
  const observed = { scrollTop: 685.3333, containerTop: 300.6667, panelTop: -98, tabsHeight: 103.3333 };
  const target = inspectorGroupScrollTarget(observed);
  const finalPanelTop = observed.panelTop + observed.scrollTop - target;
  expect(finalPanelTop).toBeCloseTo(observed.containerTop + observed.tabsHeight + 8);
  expect(target).toBeLessThan(observed.scrollTop);
});
it("分类从两行变为一行时按新高度定位，不用固定偏移遮挡字段", () => {
  const input = { scrollTop: 600, containerTop: 100, panelTop: -200, tabsHeight: 36 };
  const singleRow = inspectorGroupScrollTarget(input);
  const twoRows = inspectorGroupScrollTarget({ ...input, tabsHeight: 76 });
  expect(singleRow - twoRows).toBe(40);
});
it("内容很短时不会请求负滚动位置", () => {
  expect(inspectorGroupScrollTarget({ scrollTop: 0, containerTop: 100, panelTop: 110, tabsHeight: 76 })).toBe(0);
});
