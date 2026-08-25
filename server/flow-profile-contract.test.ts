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
    expect(isFlowNodeAllowed("control", "milestone")).toBe(true);
    expect(isFlowNodeAllowed("state", "milestone")).toBe(false);
    expect(isFlowNodeAllowed("data", "http")).toBe(false);
    expect(isFlowNodeAllowed("data", "source")).toBe(true);
  });

  it("keeps control milestones distinct and rejects duplicate codes", () => {
    const definition = withMiddle("milestone", {
      milestoneCode: "SYNCED",
      displayName: "同步完成",
      category: "integration",
      details: { target: "crm" },
    });
    expect(
      analyzeWorkflowDefinition(definition, {
        flowType: "control",
        executable: true,
      }).ok
    ).toBe(true);
    definition.nodes.splice(2, 0, {
      id: "milestone-2",
      type: "milestone",
      name: "重复里程碑",
      position: { x: 300, y: 0 },
      config: {
        milestoneCode: "SYNCED",
        displayName: "重复",
        category: "business",
      },
    });
    const duplicate = analyzeWorkflowDefinition(definition, {
      flowType: "control",
      executable: true,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok)
      expect(duplicate.diagnostics.map(item => item.code)).toContain(
        "WF_MILESTONE_CODE_DUPLICATE"
      );
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
    const control = compileWorkflowDefinition(base(), { flowType: "control" });
    const data = compileWorkflowDefinition(base(), {
      flowType: "data",
    });
    expect(control.planHash).not.toBe(data.planHash);
  });

  it("enforces state facts and a unique initial and terminal state", () => {
    const missingState = analyzeWorkflowDefinition(base(), {
      flowType: "state",
      executable: true,
    });
    expect(missingState.ok).toBe(false);
    if (!missingState.ok)
      expect(missingState.diagnostics.map(item => item.code)).toEqual(
        expect.arrayContaining([
          "WF_STATE_REQUIRED",
          "WF_STATE_INITIAL_AMBIGUOUS",
          "WF_STATE_TERMINAL_REQUIRED",
        ])
      );

    const validState = withMiddle("state", {
      nodeDh: "APPROVED",
      jdmc: "已通过",
      stateType: "terminal",
    });
    expect(
      analyzeWorkflowDefinition(validState, {
        flowType: "state",
        executable: true,
      }).ok
    ).toBe(true);
  });

  it("requires every explicit operate outcome to have one matching branch", () => {
    const definition = withMiddle("operate", {
      nodeDh: "REVIEW",
      instruction: "请审核",
      assigneeMode: "initiator",
      outcomeMode: "explicit",
      outcomes: [
        { code: "approved", label: "同意", sourceHandle: "approved" },
        { code: "rejected", label: "拒绝", sourceHandle: "rejected" },
      ],
    });
    definition.edges[1]!.sourceHandle = "approved";
    const result = analyzeWorkflowDefinition(definition, {
      flowType: "control",
      executable: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "WF_OPERATE_OUTCOME_BRANCH_INVALID",
          }),
        ])
      );
  });
});
