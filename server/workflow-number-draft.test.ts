import { expect, it } from "vitest";
import { analyzeWorkflowDefinition } from "./workflow-compiler";

const definition = (
  type: "wait" | "quality_gate" | "llm",
  config: Record<string, unknown>
) => ({
  schemaVersion: 1,
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      config: {},
      position: { x: 0, y: 0 },
    },
    ...(type === "quality_gate"
      ? [
          {
            id: "source",
            type: "source",
            name: "待配置资源",
            config: { assetId: "" },
            position: { x: 100, y: 0 },
          },
        ]
      : []),
    {
      id: "config",
      type,
      name: "数值配置",
      config,
      position: { x: 200, y: 0 },
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      config: {},
      position: { x: 400, y: 0 },
    },
  ],
  edges:
    type === "quality_gate"
      ? [
          { id: "a", sourceNodeId: "start", targetNodeId: "source" },
          { id: "b", sourceNodeId: "source", targetNodeId: "config" },
          { id: "c", sourceNodeId: "config", targetNodeId: "end" },
        ]
      : [
          { id: "a", sourceNodeId: "start", targetNodeId: "config" },
          { id: "b", sourceNodeId: "config", targetNodeId: "end" },
        ],
});
it.each(["1e-", "", 2.5, 0, -1])("草稿保存阶段也拒绝非法等待时长 %s", value => {
  const result = analyzeWorkflowDefinition(
    definition("wait", { durationSeconds: value }),
    { flowType: "control", executable: false }
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "WF_NODE_NUMBER_INVALID",
      location: expect.objectContaining({
        nodeId: "config",
        field: "config.durationSeconds",
      }),
    })
  );
});
it("允许合法小数且仍可保存尚未选择资源的草稿", () => {
  expect(
    analyzeWorkflowDefinition(
      definition("quality_gate", { minRows: 1, maxNullRate: 0.05 }),
      { flowType: "data", executable: false }
    ).ok
  ).toBe(true);
});
it("允许尚未配置提示词的普通草稿", () => {
  expect(
    analyzeWorkflowDefinition(
      definition("llm", { prompt: "", maxTokens: 1024 }),
      { flowType: "control", executable: false }
    ).ok
  ).toBe(true);
});
