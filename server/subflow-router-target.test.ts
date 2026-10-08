import { expect, it } from "vitest";
import { executeSubflowNode } from "./workflow-engine";

it.each([
  [10, "correct"],
  [0, "wrong"],
])("私有子流程路由按目标派发，输入 %s 输出 %s", async (amount, expected) => {
  const result = await executeSubflowNode(
    {
      subflowId: "router-target-regression",
      resolvedSubflowDefinition: {
        schemaVersion: 1,
        settings: {},
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: "start", type: "start", config: {} },
          {
            id: "router",
            type: "router",
            config: {
              routes: [
                {
                  handle: "chosen",
                  priority: 100,
                  targetNodeId: "correct",
                  condition: {
                    left: "{{input.amount}}",
                    operator: "greaterThan",
                    right: 0,
                  },
                },
                { handle: "fallback", priority: -1, targetNodeId: "wrong" },
              ],
            },
          },
          { id: "correct", type: "end", config: { resultTemplate: "correct" } },
          { id: "wrong", type: "end", config: { resultTemplate: "wrong" } },
        ],
        edges: [
          { sourceNodeId: "start", targetNodeId: "router" },
          {
            sourceNodeId: "router",
            sourceHandle: "legacy",
            targetNodeId: "correct",
          },
          {
            sourceNodeId: "router",
            sourceHandle: "chosen",
            targetNodeId: "wrong",
          },
        ],
      },
    },
    { input: { amount } },
    7
  );
  expect(result.result).toEqual({ result: expected });
});
