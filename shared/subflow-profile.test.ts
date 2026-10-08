import { expect, it } from "vitest";
import { readSubflowFlowType, withSubflowFlowType } from "./subflow-profile";
it("旧子流程保持状态流程默认值", () => {
  for (const definition of [
    null,
    [],
    {},
    { settings: {} },
    { settings: { subflowFlowType: "data" } },
  ])
    expect(readSubflowFlowType(definition)).toBe("state");
});
it.each(["state", "control"] as const)("记录 %s 类型并保留原设置", flowType => {
  const before = {
    settings: { concurrency: 2, subflowFlowType: "data" },
    nodes: ["start"],
  };
  const tagged = withSubflowFlowType(before, flowType);
  expect(readSubflowFlowType(tagged)).toBe(flowType);
  expect(tagged.settings.concurrency).toBe(2);
  expect(tagged.nodes).toBe(before.nodes);
  expect(before.settings.subflowFlowType).toBe("data");
});
