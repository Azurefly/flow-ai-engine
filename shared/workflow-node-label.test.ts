import { expect, it } from "vitest";
import { FLOW_NODE_DEFINITIONS } from "./workflow-node-contract";
import { workflowNodeTypeLabel } from "./workflow-node-label";
it("轻量标签与配置契约一致，避免类型名称漂移", () => {
  for (const [type, definition] of Object.entries(FLOW_NODE_DEFINITIONS))
    expect(workflowNodeTypeLabel(type)).toBe(definition.label);
});
it("未知历史类型保留标识，缺失类型有明确提示", () => {
  expect(workflowNodeTypeLabel("legacy_custom")).toBe("legacy_custom");
  expect(workflowNodeTypeLabel(null)).toBe("未知节点");
});

it.each(["__proto__", "constructor", "prototype"])(
  "特殊历史标识 %s 不读取原型属性",
  type => expect(workflowNodeTypeLabel(type)).toBe(type)
);
