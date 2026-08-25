import {
  FLOW_PROFILES,
  isFlowNodeAllowed,
  isRuntimeKindAllowed,
} from "@shared/flow-profile-contract";
import { describe, expect, it } from "vitest";
import {
  analyzeWorkflowDefinition,
  compileWorkflowDefinition,
  type WorkflowDefinition,
} from "./workflow-compiler";

function base(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      {
        id: "start",
        type: "start",
        name: "开始",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "end",
        type: "end",
        name: "结束",
        position: { x: 400, y: 0 },
        config: {},
      },
    ],
    edges: [{ id: "start-end", sourceNodeId: "start", targetNodeId: "end" }],
  };
}

function withMiddle(
  type: WorkflowDefinition["nodes"][number]["type"],
  config: Record<string, unknown> = {}
) {
  const definition = base();
  definition.nodes.splice(1, 0, {
    id: "middle",
    type,
    name: type,
    position: { x: 200, y: 0 },
    config,
  });
  definition.edges = [
    { id: "start-middle", sourceNodeId: "start", targetNodeId: "middle" },
    { id: "middle-end", sourceNodeId: "middle", targetNodeId: "end" },
  ];
  return definition;
}

describe("flow profile contract", () => {
  it("publishes one authoritative runtime and node allowlist per flow type", () => {
    expect(FLOW_PROFILES.state.runtimeKind).toBe("workflow");
    expect(FLOW_PROFILES.control.runtimeKind).toBe("workflow");
    expect(FLOW_PROFILES.data.runtimeKind).toBe("dataflow");
    expect(isRuntimeKindAllowed("data", "workflow")).toBe(false);
    expect(isFlowNodeAllowed("state", "state")).toBe(true);
    expect(isFlowNodeAllowed("control", "state")).toBe(false);
    expect(isFlowNodeAllowed("data", "http")).toBe(false);
    expect(isFlowNodeAllowed("data", "source")).toBe(true);
  });

  it.each([
    ["control", "state"],
    ["state", "source"],
    ["data", "http"],
    ["data", "condition"],
    ["data", "subflow"],
  ] as const)(
    "rejects %s profile node %s on the server",
    (flowType, nodeType) => {
      const result = analyzeWorkflowDefinition(withMiddle(nodeType), {
        flowType,
        executable: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "WF_PROFILE_NODE_FORBIDDEN" }),
          ])
        );
    }
  );

  it("compiles only the data nodes enabled by the current P2 executor", () => {
    const definition = base();
    definition.nodes = [
      definition.nodes[0]!,
      {
        id: "source",
        type: "source",
        name: "订单资源",
        position: { x: 120, y: 0 },
        config: { assetId: "asset-1" },
      },
      {
        id: "filter",
        type: "filter",
        name: "状态筛选",
        position: { x: 240, y: 0 },
        config: { filterField: "status", filterValue: "paid" },
      },
      {
        id: "sink",
        type: "sink",
        name: "审计输出",
        position: { x: 360, y: 0 },
        config: { outputName: "orders" },
      },
      definition.nodes[1]!,
    ];
    definition.edges = [
      { id: "start-source", sourceNodeId: "start", targetNodeId: "source" },
      {
        id: "source-filter",
        sourceNodeId: "source",
        targetNodeId: "filter",
      },
      { id: "filter-sink", sourceNodeId: "filter", targetNodeId: "sink" },
      { id: "sink-end", sourceNodeId: "sink", targetNodeId: "end" },
    ];
    const compiled = compileWorkflowDefinition(definition, {
      flowType: "data",
    });
    expect(compiled.plan.profile).toEqual({
      flowType: "data",
      profileVersion: 1,
      runtimeKind: "dataflow",
    });
  });

  it("includes the flow profile in the immutable plan hash", () => {
    const state = compileWorkflowDefinition(base(), { flowType: "state" });
    const control = compileWorkflowDefinition(base(), {
      flowType: "control",
    });
    expect(state.planHash).not.toBe(control.planHash);
  });
});
