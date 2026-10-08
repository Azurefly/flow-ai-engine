import { expect, it } from "vitest";
import { analyzeWorkflowDefinition } from "./workflow-compiler";
const definition = (targetNodeId?: string, legacy = false) => ({
  schemaVersion: 1,
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "router",
      type: "router",
      name: "分流",
      position: { x: 100, y: 0 },
      config: {
        defaultRoute: "chosen",
        ...(legacy
          ? {
              lysz: [
                {
                  route: {
                    routerTargetId: targetNodeId,
                    handle: "chosen",
                    priority: -1,
                  },
                },
              ],
            }
          : { routes: [{ handle: "chosen", priority: -1, targetNodeId }] }),
      },
    },
    {
      id: "map",
      type: "transform",
      name: "转换",
      position: { x: 200, y: 0 },
      config: { mappings: { value: 1 } },
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 300, y: 0 },
      config: {},
    },
  ],
  edges: [
    { id: "sr", sourceNodeId: "start", targetNodeId: "router" },
    {
      id: "rm",
      sourceNodeId: "router",
      targetNodeId: "map",
      sourceHandle: "chosen",
    },
    { id: "me", sourceNodeId: "map", targetNodeId: "end" },
  ],
});
it.each([
  ["missing", "WF_ROUTER_TARGET_MISSING"],
  ["end", "WF_ROUTER_TARGET_UNCONNECTED"],
])("配置目标 %s 时提前报错", (target, code) => {
  const result = analyzeWorkflowDefinition(definition(target), {
    flowType: "control",
    executable: true,
  });
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code, location: expect.anything() }),
    ])
  );
});
it.each([undefined, "map"])("旧句柄和合法目标 %s 保持可执行", target => {
  expect(
    analyzeWorkflowDefinition(definition(target), {
      flowType: "control",
      executable: true,
    }).ok
  ).toBe(true);
});

it("历史路由目标字段同样提前检查", () => {
  const result = analyzeWorkflowDefinition(definition("missing", true), {
    flowType: "control",
    executable: true,
  });
  expect(result.diagnostics.map(item => item.code)).toContain(
    "WF_ROUTER_TARGET_MISSING"
  );
});
