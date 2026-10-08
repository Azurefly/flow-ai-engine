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

it("私有子流程未到达结束节点时报告失败，不返回空成功", async () => {
  await expect(
    executeSubflowNode(
      {
        subflowId: "missing-target-regression",
        resolvedSubflowDefinition: {
          nodes: [
            { id: "start", type: "start", config: {} },
            {
              id: "router",
              type: "router",
              config: {
                defaultRoute: "chosen",
                routes: [
                  { handle: "chosen", priority: -1, targetNodeId: "missing" },
                ],
              },
            },
            {
              id: "end",
              type: "end",
              config: { resultTemplate: "must-not-run" },
            },
          ],
          edges: [
            { sourceNodeId: "start", targetNodeId: "router" },
            {
              sourceNodeId: "router",
              sourceHandle: "chosen",
              targetNodeId: "end",
            },
          ],
        },
      },
      { input: {} },
      7
    )
  ).rejects.toThrow("子流程未到达结束节点");
});

it("已到结束节点的空业务结果仍然可以成功", async () => {
  const result = await executeSubflowNode(
    {
      subflowId: "empty-result-regression",
      resolvedSubflowDefinition: {
        nodes: [
          { id: "start", type: "start", config: {} },
          {
            id: "end",
            type: "end",
            config: { resultTemplate: "{{input.value}}" },
          },
        ],
        edges: [{ sourceNodeId: "start", targetNodeId: "end" }],
      },
    },
    { input: { value: null } },
    7
  );
  expect(result.result).toEqual({ result: null });
});
