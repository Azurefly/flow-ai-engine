import { expect, it } from "vitest";
import { validateNodeConfig } from "../shared/workflow-node-contract";
const config = (priority: unknown) => ({
  routes: [{ handle: "chosen", priority }],
  defaultRoute: "chosen",
});
it.each([0, 100, -1, 1.5, "20", "", undefined])(
  "有效优先级 %s 可配置",
  priority => {
    expect(() => validateNodeConfig("router", config(priority))).not.toThrow();
  }
);
it.each([Infinity, NaN, "bad", true, {}, []])(
  "非法优先级 %s 提前拒绝",
  priority => {
    expect(() => validateNodeConfig("router", config(priority))).toThrow(
      "优先级必须是有限数值"
    );
  }
);
it("兼容优先级字段也必须是有限数值", () => {
  expect(() =>
    validateNodeConfig("router", {
      routes: [{ handle: "chosen", priority: 10, routerRulePriority: "bad" }],
      defaultRoute: "chosen",
    })
  ).toThrow("优先级必须是有限数值");
});
