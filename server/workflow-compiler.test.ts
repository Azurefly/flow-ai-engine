import { describe, expect, it } from "vitest";
import {
  analyzeWorkflowDefinition,
  compileWorkflowDefinition,
  hashWorkflowExecutionPlan,
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
        position: { x: 240, y: 0 },
        config: {},
      },
    ],
    edges: [{ id: "start-end", sourceNodeId: "start", targetNodeId: "end" }],
  };
}

function state(id = "state") {
  return {
    id,
    type: "state" as const,
    name: id,
    position: { x: 120, y: 0 },
    config: { nodeDh: id, jdmc: id, flowStatus: id },
  };
}

describe("WorkflowCompiler", () => {
  it("compiles a canonical immutable plan and produces a stable hash", () => {
    const first = compileWorkflowDefinition(base(), { flowType: "control" });
    const second = compileWorkflowDefinition(
      {
        ...base(),
        nodes: [...base().nodes].reverse(),
        edges: [...base().edges].reverse(),
      },
      { flowType: "control" }
    );
    expect(first.plan.entryNodeId).toBe("start");
    expect(first.plan.terminalNodeIds).toEqual(["end"]);
    expect(first.planHash).toBe(second.planHash);
    expect(first.planHash).toBe(hashWorkflowExecutionPlan(first.plan));
    expect(first.plan.topologicalOrder).toEqual(["start", "end"]);
  });

  it("blocks unsafe write service tasks and validates compensation routing", () => {
    const definition = base();
    definition.nodes.splice(1, 0, {
      id: "write",
      type: "http",
      name: "写入外部系统",
      position: { x: 120, y: 0 },
      config: { method: "POST", url: "https://example.com/items" },
    });
    definition.edges = [
      { id: "start-write", sourceNodeId: "start", targetNodeId: "write" },
      { id: "write-end", sourceNodeId: "write", targetNodeId: "end" },
    ];
    const unsafe = analyzeWorkflowDefinition(definition, {
      flowType: "control",
      executable: true,
    });
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok)
      expect(unsafe.diagnostics.map(item => item.code)).toContain(
        "WF_SERVICE_WRITE_SAFETY_REQUIRED"
      );

    definition.nodes[1]!.config = {
      ...definition.nodes[1]!.config,
      writeSafety: "idempotent",
      retryMaxAttempts: 3,
    };
    const safe = compileWorkflowDefinition(definition, { flowType: "control" });
    expect(safe.plan.serviceTasks?.write).toMatchObject({
      effect: "write",
      writeSafety: "idempotent",
      retry: { maxAttempts: 3 },
    });
  });

  it.each([
    ["WF_DEF_INVALID", undefined],
    ["WF_VIEWPORT_INVALID", { viewport: { x: 0, y: 0, zoom: 0 } }],
    ["WF_NODE_ID_DUPLICATE", { nodes: [state("start"), state("start")] }],
    [
      "WF_NODE_POSITION_INVALID",
      { node: { position: { x: Number.NaN, y: 0 } } },
    ],
    ["WF_NODE_CONFIG_INVALID", { node: { config: [] } }],
    ["WF_START_END_CARDINALITY", { nodes: [state("only")] }],
    ["WF_EDGE_DANGLING", { edge: { targetNodeId: "missing" } }],
    ["WF_EDGE_ID_DUPLICATE", { duplicateEdge: true }],
    ["WF_EDGE_SELF_LOOP", { selfLoop: true }],
    ["WF_EDGE_TYPE_NOT_ALLOWED", { illegalType: true }],
    ["WF_EDGE_DUPLICATE", { duplicateEdgeKey: true }],
    ["WF_START_HAS_INCOMING", { startIncoming: true }],
    ["WF_END_HAS_OUTGOING", { endOutgoing: true }],
    ["WF_START_NO_OUTGOING", { noStartOutgoing: true }],
    ["WF_NODE_UNREACHABLE", { unreachable: true }],
    ["WF_NODE_CANNOT_REACH_END", { deadEnd: true }],
    ["WF_CONDITION_BRANCH_INVALID", { conditionMissingBranch: true }],
    ["WF_CONDITION_HANDLE_UNKNOWN", { conditionUnknownHandle: true }],
    ["WF_ROUTER_HANDLE_DUPLICATE", { routerDuplicateHandle: true }],
    ["WF_ROUTER_BRANCH_UNCONNECTED", { routerUnconnected: true }],
    ["WF_ROUTER_HANDLE_UNKNOWN", { routerUnknown: true }],
    ["WF_PARALLEL_BRANCHES_REQUIRED", { parallelSingleBranch: true }],
    ["WF_PARALLEL_JOIN_REQUIRED", { parallelMissingJoin: true }],
    ["WF_PARALLEL_JOIN_MISMATCH", { parallelJoinMismatch: true }],
    ["WF_PARALLEL_JOIN_INPUTS_REQUIRED", { parallelJoinMissingInput: true }],
    ["WF_PARALLEL_BRANCH_MISSES_JOIN", { parallelBranchMissesJoin: true }],
    ["WF_LOOP_NOT_DECLARED", { undeclaredLoop: true }],
    ["WF_LOOP_LIMIT_INVALID", { invalidLoopLimit: true }],
    ["WF_LOOP_EDGE_NOT_CYCLIC", { nonCyclicLoop: true }],
  ] as const)("exposes stable diagnostic code %s", (code, marker) => {
    if (marker === undefined) {
      const result = analyzeWorkflowDefinition(undefined, {
        flowType: "state",
        executable: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostics.map(item => item.code)).toContain(code);
      return;
    }
    const definition = base();
    const item = marker as Record<string, unknown>;
    if (item.viewport)
      definition.viewport = item.viewport as WorkflowDefinition["viewport"];
    if (item.nodes)
      definition.nodes = item.nodes as WorkflowDefinition["nodes"];
    if (item.node)
      (definition.nodes[0] as any) = {
        ...definition.nodes[0],
        ...(item.node as object),
      };
    if (item.edge)
      definition.edges[0] = {
        ...definition.edges[0],
        ...(item.edge as object),
      };
    if (item.duplicateEdge)
      definition.edges.push({ ...definition.edges[0], id: "start-end" });
    if (item.selfLoop)
      definition.edges.push({
        id: "self",
        sourceNodeId: "start",
        targetNodeId: "start",
      });
    if (item.illegalType) {
      definition.nodes.splice(
        1,
        0,
        { ...state("middle"), type: "state" },
        { ...state("sink"), type: "sink" }
      );
      definition.edges = [
        { id: "s-m", sourceNodeId: "start", targetNodeId: "middle" },
        { id: "bad", sourceNodeId: "middle", targetNodeId: "sink" },
        { id: "end", sourceNodeId: "sink", targetNodeId: "end" },
      ];
    }
    if (item.duplicateEdgeKey)
      definition.edges.push({
        id: "same-target",
        sourceNodeId: "start",
        targetNodeId: "end",
      });
    if (item.startIncoming)
      definition.edges.push({
        id: "into-start",
        sourceNodeId: "end",
        targetNodeId: "start",
      });
    if (item.endOutgoing) {
      definition.nodes.push(state("after"));
      definition.edges.push({
        id: "after-end",
        sourceNodeId: "end",
        targetNodeId: "after",
      });
    }
    if (item.noStartOutgoing) definition.edges = [];
    if (item.unreachable) definition.nodes.push(state("orphan"));
    if (item.deadEnd) {
      definition.nodes.splice(1, 0, state("dead"));
      definition.edges.push({
        id: "dead-edge",
        sourceNodeId: "start",
        targetNodeId: "dead",
      });
    }
    if (item.conditionMissingBranch || item.conditionUnknownHandle) {
      definition.nodes.splice(1, 0, {
        ...state("condition"),
        type: "condition",
        config: {},
      });
      definition.edges = [
        { id: "s-c", sourceNodeId: "start", targetNodeId: "condition" },
        {
          id: "c-e",
          sourceNodeId: "condition",
          sourceHandle: item.conditionUnknownHandle ? "other" : "true",
          targetNodeId: "end",
        },
      ];
    }
    if (
      item.routerDuplicateHandle ||
      item.routerUnconnected ||
      item.routerUnknown ||
      item.parallelSingleBranch ||
      item.parallelMissingJoin ||
      item.parallelJoinMismatch ||
      item.parallelJoinMissingInput ||
      item.parallelBranchMissesJoin
    ) {
      const routerConfig: Record<string, unknown> = {
        routes: [
          { handle: "a" },
          ...(item.routerDuplicateHandle ? [{ handle: "a" }] : []),
        ],
        defaultRoute: "default",
        ...(item.parallelSingleBranch ||
        item.parallelMissingJoin ||
        item.parallelJoinMismatch ||
        item.parallelJoinMissingInput ||
        item.parallelBranchMissesJoin
          ? { gbms: true }
          : {}),
      };
      const router = {
        ...state("router"),
        type: "router" as const,
        config: routerConfig,
      };
      definition.nodes = [
        { ...definition.nodes[0] },
        router,
        { ...definition.nodes[1] },
      ];
      definition.edges = [
        { id: "s-r", sourceNodeId: "start", targetNodeId: "router" },
        {
          id: "r-e",
          sourceNodeId: "router",
          sourceHandle: item.routerUnknown
            ? "unknown"
            : item.routerUnconnected
              ? "a"
              : "default",
          targetNodeId: "end",
        },
      ];
      if (item.routerUnconnected)
        (router.config as any).routes = [{ handle: "a" }, { handle: "b" }];
      if (item.parallelSingleBranch)
        (router.config as any).parallelJoinNodeId = "end";
      if (item.parallelMissingJoin)
        (router.config as any).parallelJoinNodeId = "missing";
      if (
        item.parallelJoinMismatch ||
        item.parallelJoinMissingInput ||
        item.parallelBranchMissesJoin
      ) {
        (router.config as any).parallelJoinNodeId = "join";
        const join = {
          ...state("join"),
          config: item.parallelJoinMismatch
            ? {}
            : { parallelForNodeId: "router" },
        };
        definition.nodes.splice(2, 0, join);
        if (item.parallelJoinMissingInput)
          definition.edges.push({
            id: "j-e",
            sourceNodeId: "join",
            targetNodeId: "end",
          });
        else if (item.parallelBranchMissesJoin) {
          definition.edges = [
            { id: "s-r", sourceNodeId: "start", targetNodeId: "router" },
            {
              id: "r-j",
              sourceNodeId: "router",
              sourceHandle: "a",
              targetNodeId: "join",
            },
            {
              id: "r-end",
              sourceNodeId: "router",
              sourceHandle: "default",
              targetNodeId: "end",
            },
            { id: "j-e", sourceNodeId: "join", targetNodeId: "end" },
          ];
        } else {
          definition.edges = [
            { id: "s-r", sourceNodeId: "start", targetNodeId: "router" },
            { id: "r-j", sourceNodeId: "router", targetNodeId: "join" },
            { id: "j-e", sourceNodeId: "join", targetNodeId: "end" },
          ];
        }
      }
    }
    if (item.undeclaredLoop) {
      definition.nodes.splice(1, 0, state("a"), state("b"));
      definition.edges = [
        { id: "s-a", sourceNodeId: "start", targetNodeId: "a" },
        { id: "a-b", sourceNodeId: "a", targetNodeId: "b" },
        { id: "b-a", sourceNodeId: "b", targetNodeId: "a" },
        { id: "b-e", sourceNodeId: "b", targetNodeId: "end" },
      ];
    }
    if (item.invalidLoopLimit)
      definition.edges[0] = {
        ...definition.edges[0],
        loop: { maxIterations: 0 },
      };
    if (item.nonCyclicLoop)
      definition.edges[0] = {
        ...definition.edges[0],
        loop: { maxIterations: 2 },
      };
    const result = analyzeWorkflowDefinition(definition, {
      flowType: "state",
      executable: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map(item => item.code)).toContain(code);
  });

  it("requires a connected failure branch when an LLM node declares one", () => {
    const definition = base();
    definition.nodes.splice(1, 0, {
      id: "llm",
      type: "llm",
      name: "LLM",
      position: { x: 120, y: 0 },
      config: {
        systemPrompt: "system",
        prompt: "hello",
        failureHandle: "failed",
      },
    });
    definition.edges = [
      { id: "start-llm", sourceNodeId: "start", targetNodeId: "llm" },
      {
        id: "llm-end",
        sourceNodeId: "llm",
        targetNodeId: "end",
        sourceHandle: "default",
      },
    ];
    const result = analyzeWorkflowDefinition(definition, {
      flowType: "state",
      executable: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map(item => item.code)).toContain(
        "WF_LLM_FAILURE_BRANCH_UNCONNECTED"
      );
  });

  it("keeps parallel and loop definitions editable but blocks publication until runtime semantics exist", () => {
    const parallel = base();
    parallel.nodes = [
      parallel.nodes[0]!,
      {
        ...state("router"),
        type: "router",
        config: {
          routes: [{ handle: "a" }, { handle: "b" }],
          defaultRoute: "b",
          gbms: true,
          parallelJoinNodeId: "join",
        },
      },
      state("branch-a"),
      state("branch-b"),
      {
        ...state("join"),
        config: { nodeDh: "join", jdmc: "join", parallelForNodeId: "router" },
      },
      parallel.nodes[1]!,
    ];
    parallel.edges = [
      { id: "start-router", sourceNodeId: "start", targetNodeId: "router" },
      {
        id: "router-a",
        sourceNodeId: "router",
        sourceHandle: "a",
        targetNodeId: "branch-a",
      },
      {
        id: "router-b",
        sourceNodeId: "router",
        sourceHandle: "b",
        targetNodeId: "branch-b",
      },
      { id: "a-join", sourceNodeId: "branch-a", targetNodeId: "join" },
      { id: "b-join", sourceNodeId: "branch-b", targetNodeId: "join" },
      { id: "join-end", sourceNodeId: "join", targetNodeId: "end" },
    ];
    expect(
      analyzeWorkflowDefinition(parallel, {
        flowType: "state",
        executable: false,
      }).ok
    ).toBe(true);
    const parallelPublish = analyzeWorkflowDefinition(parallel, {
      flowType: "state",
      executable: true,
    });
    expect(parallelPublish.ok).toBe(false);
    if (!parallelPublish.ok)
      expect(parallelPublish.diagnostics.map(item => item.code)).toContain(
        "WF_RUNTIME_PARALLEL_UNSUPPORTED"
      );

    const loop = base();
    loop.nodes.splice(1, 0, state("a"), state("b"));
    loop.edges = [
      { id: "start-a", sourceNodeId: "start", targetNodeId: "a" },
      { id: "a-b", sourceNodeId: "a", targetNodeId: "b" },
      {
        id: "b-a",
        sourceNodeId: "b",
        targetNodeId: "a",
        loop: { maxIterations: 2 },
      },
      { id: "b-end", sourceNodeId: "b", targetNodeId: "end" },
    ];
    expect(
      analyzeWorkflowDefinition(loop, {
        flowType: "state",
        executable: false,
      }).ok
    ).toBe(true);
    const loopPublish = analyzeWorkflowDefinition(loop, {
      flowType: "state",
      executable: true,
    });
    expect(loopPublish.ok).toBe(false);
    if (!loopPublish.ok)
      expect(loopPublish.diagnostics.map(item => item.code)).toContain(
        "WF_RUNTIME_LOOP_UNSUPPORTED"
      );
  });

  it("keeps legacy open-claim nodes editable but requires an owner for publication", () => {
    const definition = base();
    definition.nodes.splice(1, 0, {
      id: "open-task",
      type: "operate",
      name: "开放领取",
      position: { x: 160, y: 0 },
      config: {
        nodeDh: "OPEN_TASK",
        czmc: "处理",
        assigneeMode: "none",
        instruction: "处理任务",
      },
    });
    definition.edges = [
      { id: "start-open", sourceNodeId: "start", targetNodeId: "open-task" },
      { id: "open-end", sourceNodeId: "open-task", targetNodeId: "end" },
    ];
    expect(
      analyzeWorkflowDefinition(definition, {
        flowType: "state",
        executable: false,
      }).ok
    ).toBe(true);
    const published = analyzeWorkflowDefinition(definition, {
      flowType: "state",
      executable: true,
    });
    expect(published.ok).toBe(false);
    if (!published.ok)
      expect(published.diagnostics.map(item => item.code)).toContain(
        "WF_OPERATE_OWNER_REQUIRED"
      );
  });
});
