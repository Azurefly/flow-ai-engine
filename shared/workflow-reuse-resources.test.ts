import { expect, it } from "vitest";
import { availableWorkflowReuseResources } from "./workflow-reuse-resources";
const templates = [
  { nodeType: "map" },
  { nodeType: "message_catch" },
  { nodeType: "transform" },
  { nodeType: "state" },
] as const;
const subflows = [
  { id: "enabled", isEnabled: true },
  { id: "disabled", isEnabled: false },
];
it("数据流程数量和可见模板一致，不包含子流程与消息模板", () => {
  const resources = availableWorkflowReuseResources(
    "data",
    templates,
    subflows
  );
  expect(resources.availableTemplates.map(t => t.nodeType)).toEqual([
    "map",
    "transform",
  ]);
  expect(resources.availableSubflows).toEqual([]);
  expect(resources.count).toBe(2);
});
it.each(["state", "control"] as const)(
  "%s 流程仅包含适用模板与启用子流程",
  type => {
    const resources = availableWorkflowReuseResources(
      type,
      templates,
      subflows
    );
    expect(resources.availableTemplates.some(t => t.nodeType === "map")).toBe(
      false
    );
    expect(resources.availableSubflows).toEqual([subflows[0]]);
    expect(resources.count).toBe(resources.availableTemplates.length + 1);
  }
);
it("无可用资源时计数为零", () =>
  expect(
    availableWorkflowReuseResources(
      "data",
      [{ nodeType: "message_catch" }],
      subflows
    ).count
  ).toBe(0));
