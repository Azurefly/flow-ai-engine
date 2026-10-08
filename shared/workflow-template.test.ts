import { expect, it } from "vitest";
import { FLOW_NODE_TYPES } from "./workflow-node-contract";
import { TEMPLATE_NODE_TYPES, isTemplateNodeType } from "./workflow-template";

it("三类流程的普通节点均可保存模板，入口出口和子流程独立管理", () => {
  expect(TEMPLATE_NODE_TYPES).toEqual(
    FLOW_NODE_TYPES.filter(type => !["start", "end", "subflow"].includes(type))
  );
  for (const type of [
    "state",
    "operate",
    "message_catch",
    "map",
    "aggregate",
    "quality_gate",
    "output",
  ])
    expect(isTemplateNodeType(type)).toBe(true);
});
it.each(["start", "end", "subflow", "legacy_unknown", "__proto__", null])(
  "拒绝非模板类型 %s",
  type => expect(isTemplateNodeType(type)).toBe(false)
);
