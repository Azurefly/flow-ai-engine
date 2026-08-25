import { createHash } from "node:crypto";
import {
  getFlowProfile,
  isFlowNodeAllowed,
} from "@shared/flow-profile-contract";
import {
  canConnectFlowNodeTypes,
  isFlowNodeType,
  readOperateOutcomeMode,
  readOperateOutcomes,
  validateNodeConfig,
  withNodeConfigDefaults,
  type FlowType,
  type FlowNodeType,
} from "@shared/workflow-node-contract";
import {
  compileHttpServiceTask,
  type HttpServiceTaskPlan,
} from "@shared/service-task-contract";
import { normalizeReferenceOperateConfig } from "@shared/reference-operate-config";

export type WorkflowNode = {
  id: string;
  type: FlowNodeType;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
};

export type WorkflowLoopPolicy = {
  maxIterations: number;
};

export type WorkflowEdge = {
  id: string;
  sourceNodeId: string;
  sourceHandle?: string;
  targetNodeId: string;
  loop?: WorkflowLoopPolicy;
};

export type WorkflowDefinition = {
  schemaVersion: 1;
  viewport: { x: number; y: number; zoom: number };
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  settings: Record<string, unknown>;
};

export type WorkflowDiagnosticLocation = {
  kind: "definition" | "node" | "edge";
  nodeId?: string;
  edgeId?: string;
  field?: string;
};

export type WorkflowCompileDiagnostic = {
  code: string;
  message: string;
  location: WorkflowDiagnosticLocation;
};

export type WorkflowExecutionPlan = {
  schemaVersion: 1;
  compilerVersion:
    | "1.0.0"
    | "1.1.0"
    | "1.2.0"
    | "1.3.0"
    | "1.4.0"
    | "1.5.0"
    | "1.6.0";
  profile?: {
    flowType: FlowType;
    profileVersion: number;
    runtimeKind: "workflow" | "dataflow";
  };
  definition: WorkflowDefinition;
  entryNodeId: string;
  terminalNodeIds: string[];
  outgoing: Record<
    string,
    Array<{ edgeId: string; handle: string; targetNodeId: string }>
  >;
  incoming: Record<
    string,
    Array<{ edgeId: string; sourceNodeId: string; handle: string }>
  >;
  topologicalOrder: string[] | null;
  parallelGroups: Array<{
    forkNodeId: string;
    joinNodeId: string;
    branchEdgeIds: string[];
  }>;
  loops: Array<{
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    maxIterations: number;
  }>;
  serviceTasks?: Record<string, HttpServiceTaskPlan>;
};

export type WorkflowCompileResult =
  | {
      ok: true;
      diagnostics: [];
      definition: WorkflowDefinition;
      plan: WorkflowExecutionPlan;
      planHash: string;
    }
  | { ok: false; diagnostics: WorkflowCompileDiagnostic[] };

export type WorkflowAnalysisOptions = {
  flowType: FlowType;
  executable?: boolean;
};

export class WorkflowCompileError extends Error {
  readonly code = "WORKFLOW_COMPILE_FAILED";
  constructor(readonly diagnostics: WorkflowCompileDiagnostic[]) {
    super(diagnostics[0]?.message ?? "流程编译失败。");
    this.name = "WorkflowCompileError";
  }
}

function diagnostic(
  code: string,
  message: string,
  location: WorkflowDiagnosticLocation = { kind: "definition" }
): WorkflowCompileDiagnostic {
  return { code, message, location };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  );
}

export function stableWorkflowJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function hashWorkflowExecutionPlan(plan: WorkflowExecutionPlan) {
  return createHash("sha256")
    .update(stableWorkflowJson(plan), "utf8")
    .digest("hex");
}

function normalizedDefinition(value: WorkflowDefinition): WorkflowDefinition {
  return {
    schemaVersion: 1,
    viewport: {
      x: Number(value.viewport?.x ?? 0),
      y: Number(value.viewport?.y ?? 0),
      zoom: Number(value.viewport?.zoom ?? 1),
    },
    settings:
      value.settings &&
      typeof value.settings === "object" &&
      !Array.isArray(value.settings)
        ? JSON.parse(JSON.stringify(value.settings))
        : {},
    nodes: value.nodes
      .map(node => ({
        id: node.id.trim(),
        type: node.type,
        name: node.name,
        position: { x: node.position.x, y: node.position.y },
        config: JSON.parse(
          JSON.stringify(withNodeConfigDefaults(node.type, node.config))
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: value.edges
      .map(edge => ({
        id: edge.id.trim(),
        sourceNodeId: edge.sourceNodeId,
        sourceHandle: edge.sourceHandle?.trim() || "default",
        targetNodeId: edge.targetNodeId,
        ...(edge.loop
          ? { loop: { maxIterations: Number(edge.loop.maxIterations) } }
          : {}),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function stronglyConnectedComponents(
  nodeIds: string[],
  outgoing: Map<string, WorkflowEdge[]>
) {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const components: string[][] = [];
  const visit = (nodeId: string) => {
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (!indices.has(edge.targetNodeId)) {
        visit(edge.targetNodeId);
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, lowLinks.get(edge.targetNodeId)!)
        );
      } else if (onStack.has(edge.targetNodeId)) {
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, indices.get(edge.targetNodeId)!)
        );
      }
    }
    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const component: string[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
      if (current === nodeId) break;
    }
    components.push(component);
  };
  nodeIds.forEach(nodeId => {
    if (!indices.has(nodeId)) visit(nodeId);
  });
  return components;
}

function canReachTarget(
  startNodeId: string,
  targetNodeId: string,
  outgoing: Map<string, WorkflowEdge[]>,
  blockedNodeId: string
) {
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (nodeId === targetNodeId) return true;
    if (visited.has(nodeId) || nodeId === blockedNodeId) continue;
    visited.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? [])
      queue.push(edge.targetNodeId);
  }
  return false;
}

export function analyzeWorkflowDefinition(
  definition: unknown,
  options: WorkflowAnalysisOptions
): WorkflowCompileResult {
  const executable = options.executable ?? true;
  const profile = getFlowProfile(options.flowType);
  const diagnostics: WorkflowCompileDiagnostic[] = [];
  const value = definition as WorkflowDefinition;
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return {
      ok: false,
      diagnostics: [diagnostic("WF_DEF_INVALID", "流程定义格式无效。")],
    };
  }
  if (
    !value.viewport ||
    !Number.isFinite(value.viewport.x) ||
    !Number.isFinite(value.viewport.y) ||
    !Number.isFinite(value.viewport.zoom) ||
    value.viewport.zoom <= 0
  ) {
    diagnostics.push(
      diagnostic("WF_VIEWPORT_INVALID", "流程视口格式无效。", {
        kind: "definition",
        field: "viewport",
      })
    );
  }

  const seenNodeIds = new Set<string>();
  for (const rawNode of value.nodes) {
    const node = rawNode as WorkflowNode;
    const nodeId = typeof node?.id === "string" ? node.id : undefined;
    const location: WorkflowDiagnosticLocation = {
      kind: "node",
      ...(nodeId ? { nodeId } : {}),
    };
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id.trim() ||
      typeof node.name !== "string" ||
      !isFlowNodeType(node.type)
    ) {
      diagnostics.push(
        diagnostic("WF_NODE_INVALID", "流程节点格式或类型无效。", location)
      );
      continue;
    }
    if (seenNodeIds.has(node.id))
      diagnostics.push(
        diagnostic(
          "WF_NODE_ID_DUPLICATE",
          `节点 ID 不可重复：${node.id}。`,
          location
        )
      );
    seenNodeIds.add(node.id);
    if (!isFlowNodeAllowed(options.flowType, node.type))
      diagnostics.push(
        diagnostic(
          "WF_PROFILE_NODE_FORBIDDEN",
          `${profile.label}不允许使用“${node.name || node.type}”（${node.type}）节点。`,
          location
        )
      );
    if (
      !node.position ||
      !Number.isFinite(node.position.x) ||
      !Number.isFinite(node.position.y)
    )
      diagnostics.push(
        diagnostic("WF_NODE_POSITION_INVALID", "流程节点位置无效。", {
          ...location,
          field: "position",
        })
      );
    if (
      !node.config ||
      typeof node.config !== "object" ||
      Array.isArray(node.config)
    ) {
      diagnostics.push(
        diagnostic("WF_NODE_CONFIG_INVALID", "流程节点配置必须是 JSON 对象。", {
          ...location,
          field: "config",
        })
      );
      continue;
    }
    if (executable) {
      if (
        node.type === "operate" &&
        String(node.config.assigneeMode ?? "") === "none"
      ) {
        diagnostics.push(
          diagnostic(
            "WF_OPERATE_OWNER_REQUIRED",
            `人工操作“${node.name}”必须绑定明确处理人；不再允许全员开放领取。`,
            { ...location, field: "config.assigneeMode" }
          )
        );
      }
      try {
        validateNodeConfig(
          node.type,
          withNodeConfigDefaults(node.type, node.config)
        );
      } catch (error) {
        diagnostics.push(
          diagnostic(
            "WF_NODE_CONFIG_REQUIRED",
            error instanceof Error ? error.message : "流程节点配置无效。",
            { ...location, field: "config" }
          )
        );
      }
    }
  }

  const starts = value.nodes.filter(node => node?.type === "start");
  const ends = value.nodes.filter(node => node?.type === "end");
  if (starts.length !== 1 || ends.length !== 1)
    diagnostics.push(
      diagnostic(
        "WF_START_END_CARDINALITY",
        "流程必须且仅能包含一个开始节点和一个结束节点。"
      )
    );

  const validNodes = value.nodes.filter(
    node =>
      node &&
      typeof node.id === "string" &&
      node.id.trim() &&
      typeof node.name === "string" &&
      isFlowNodeType(node.type) &&
      node.position &&
      Number.isFinite(node.position.x) &&
      Number.isFinite(node.position.y) &&
      node.config &&
      typeof node.config === "object" &&
      !Array.isArray(node.config)
  );
  const nodeIds = new Set(validNodes.map(node => node.id));
  const nodesById = new Map(validNodes.map(node => [node.id, node]));
  const outgoing = new Map(
    validNodes.map(node => [node.id, [] as WorkflowEdge[]])
  );
  const incoming = new Map(
    validNodes.map(node => [node.id, [] as WorkflowEdge[]])
  );
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const validEdges: WorkflowEdge[] = [];
  for (const rawEdge of value.edges) {
    const edge = rawEdge as WorkflowEdge;
    const edgeId = typeof edge?.id === "string" ? edge.id : undefined;
    const location: WorkflowDiagnosticLocation = {
      kind: "edge",
      ...(edgeId ? { edgeId } : {}),
    };
    if (
      !edge ||
      typeof edge.id !== "string" ||
      !edge.id.trim() ||
      !nodeIds.has(edge.sourceNodeId) ||
      !nodeIds.has(edge.targetNodeId)
    ) {
      diagnostics.push(
        diagnostic("WF_EDGE_DANGLING", "流程连线引用了不存在的节点。", location)
      );
      continue;
    }
    if (edgeIds.has(edge.id))
      diagnostics.push(
        diagnostic(
          "WF_EDGE_ID_DUPLICATE",
          `流程连线 ID 不可重复：${edge.id}。`,
          location
        )
      );
    edgeIds.add(edge.id);
    if (edge.sourceNodeId === edge.targetNodeId)
      diagnostics.push(
        diagnostic(
          "WF_EDGE_SELF_LOOP",
          `流程不允许节点自环：${edge.sourceNodeId}。`,
          location
        )
      );
    const sourceNode = nodesById.get(edge.sourceNodeId)!;
    const targetNode = nodesById.get(edge.targetNodeId)!;
    if (
      sourceNode.type !== "end" &&
      targetNode.type !== "start" &&
      !canConnectFlowNodeTypes(sourceNode.type, targetNode.type)
    )
      diagnostics.push(
        diagnostic(
          "WF_EDGE_TYPE_NOT_ALLOWED",
          `节点类型不允许连接：${sourceNode.name}（${sourceNode.type}）→ ${targetNode.name}（${targetNode.type}）。`,
          location
        )
      );
    const handle = edge.sourceHandle?.trim() || "default";
    const edgeKey = `${edge.sourceNodeId}|${handle}|${edge.targetNodeId}`;
    if (edgeKeys.has(edgeKey))
      diagnostics.push(
        diagnostic(
          "WF_EDGE_DUPLICATE",
          `流程不允许重复连线：${edge.sourceNodeId} → ${edge.targetNodeId}。`,
          location
        )
      );
    edgeKeys.add(edgeKey);
    if (edge.loop) {
      const maxIterations = Number(edge.loop.maxIterations);
      if (
        !Number.isInteger(maxIterations) ||
        maxIterations < 1 ||
        maxIterations > 1000
      )
        diagnostics.push(
          diagnostic(
            "WF_LOOP_LIMIT_INVALID",
            "循环边 maxIterations 必须是 1 到 1000 的整数。",
            { ...location, field: "loop.maxIterations" }
          )
        );
    }
    validEdges.push(edge);
    outgoing.get(edge.sourceNodeId)?.push(edge);
    incoming.get(edge.targetNodeId)?.push(edge);
  }

  if (executable && starts.length === 1 && ends.length === 1) {
    const startId = starts[0]!.id;
    const endId = ends[0]!.id;
    if ((incoming.get(startId) ?? []).length)
      diagnostics.push(
        diagnostic("WF_START_HAS_INCOMING", "开始节点不允许存在入边。", {
          kind: "node",
          nodeId: startId,
        })
      );
    if ((outgoing.get(endId) ?? []).length)
      diagnostics.push(
        diagnostic("WF_END_HAS_OUTGOING", "结束节点不允许存在出边。", {
          kind: "node",
          nodeId: endId,
        })
      );
    if (!(outgoing.get(startId) ?? []).length)
      diagnostics.push(
        diagnostic("WF_START_NO_OUTGOING", "开始节点必须连接后继节点。", {
          kind: "node",
          nodeId: startId,
        })
      );

    if (options.flowType === "control") {
      const milestoneCodes = new Set<string>();
      for (const milestone of validNodes.filter(
        node => node.type === "milestone"
      )) {
        const code = String(milestone.config.milestoneCode ?? "").trim();
        if (code && milestoneCodes.has(code))
          diagnostics.push(
            diagnostic(
              "WF_MILESTONE_CODE_DUPLICATE",
              `里程碑代号不可重复：${code}。`,
              {
                kind: "node",
                nodeId: milestone.id,
                field: "config.milestoneCode",
              }
            )
          );
        milestoneCodes.add(code);
      }
    }

    if (options.flowType === "state") {
      const stateNodes = validNodes.filter(node => node.type === "state");
      if (!stateNodes.length)
        diagnostics.push(
          diagnostic(
            "WF_STATE_REQUIRED",
            "状态流程必须至少包含一个状态节点。"
          )
        );

      const stateCodes = new Map<string, string>();
      for (const stateNode of stateNodes) {
        const stateCode = String(
          stateNode.config.stateCode ?? stateNode.config.nodeDh ?? ""
        ).trim();
        const previousNodeId = stateCodes.get(stateCode);
        if (stateCode && previousNodeId)
          diagnostics.push(
            diagnostic(
              "WF_STATE_CODE_DUPLICATE",
              `状态代号不可重复：${stateCode}。`,
              {
                kind: "node",
                nodeId: stateNode.id,
                field: "config.stateCode",
              }
            )
          );
        else if (stateCode) stateCodes.set(stateCode, stateNode.id);
      }

      const initialStateIds = new Set<string>();
      const initialQueue = (outgoing.get(startId) ?? []).map(
        edge => edge.targetNodeId
      );
      const initialVisited = new Set<string>();
      while (initialQueue.length) {
        const nodeId = initialQueue.shift()!;
        if (initialVisited.has(nodeId) || nodeId === endId) continue;
        initialVisited.add(nodeId);
        const node = nodesById.get(nodeId);
        if (!node) continue;
        if (node.type === "state") {
          initialStateIds.add(node.id);
          continue;
        }
        for (const edge of outgoing.get(nodeId) ?? [])
          initialQueue.push(edge.targetNodeId);
      }
      if (initialStateIds.size !== 1)
        diagnostics.push(
          diagnostic(
            "WF_STATE_INITIAL_AMBIGUOUS",
            "状态流程必须从开始节点确定唯一初始状态。",
            { kind: "node", nodeId: startId }
          )
        );

      const terminalStates = stateNodes.filter(
        node =>
          String(node.config.stateType ?? "") === "terminal" ||
          (outgoing.get(node.id) ?? []).some(edge => edge.targetNodeId === endId)
      );
      if (!terminalStates.length)
        diagnostics.push(
          diagnostic(
            "WF_STATE_TERMINAL_REQUIRED",
            "状态流程必须至少包含一个进入结束节点的业务终态。"
          )
        );
    }

    const reachable = new Set<string>();
    const visitQueue = [startId];
    while (visitQueue.length) {
      const nodeId = visitQueue.shift()!;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const edge of outgoing.get(nodeId) ?? [])
        visitQueue.push(edge.targetNodeId);
    }
    value.nodes
      .filter(node => node?.id && !reachable.has(node.id))
      .forEach(node =>
        diagnostics.push(
          diagnostic(
            "WF_NODE_UNREACHABLE",
            `存在从开始节点不可达的节点：${node.name || node.id}。`,
            { kind: "node", nodeId: node.id }
          )
        )
      );

    const canReachEnd = new Set<string>();
    const reverseQueue = [endId];
    while (reverseQueue.length) {
      const nodeId = reverseQueue.shift()!;
      if (canReachEnd.has(nodeId)) continue;
      canReachEnd.add(nodeId);
      for (const edge of incoming.get(nodeId) ?? [])
        reverseQueue.push(edge.sourceNodeId);
    }
    value.nodes
      .filter(node => node?.id && !canReachEnd.has(node.id))
      .forEach(node =>
        diagnostics.push(
          diagnostic(
            "WF_NODE_CANNOT_REACH_END",
            `存在无法到达结束节点的路径：${node.name || node.id}。`,
            { kind: "node", nodeId: node.id }
          )
        )
      );

    for (const node of validNodes) {
      const nodeOutgoing = outgoing.get(node.id) ?? [];
      if (
        node.type === "operate" &&
        readOperateOutcomeMode(node.config) === "explicit"
      ) {
        const outcomes = readOperateOutcomes(node.config);
        const configuredHandles = new Set(
          outcomes.map(outcome => outcome.sourceHandle)
        );
        for (const outcome of outcomes) {
          const matching = nodeOutgoing.filter(
            edge =>
              (edge.sourceHandle?.trim() || "default") === outcome.sourceHandle
          );
          if (matching.length !== 1)
            diagnostics.push(
              diagnostic(
                "WF_OPERATE_OUTCOME_BRANCH_INVALID",
                `人工操作“${node.name}”的结果 ${outcome.code} 必须且仅能连接一个 ${outcome.sourceHandle} 分支。`,
                {
                  kind: "node",
                  nodeId: node.id,
                  field: `outcome:${outcome.code}`,
                }
              )
            );
        }
        nodeOutgoing
          .filter(
            edge =>
              !configuredHandles.has(edge.sourceHandle?.trim() || "default")
          )
          .forEach(edge =>
            diagnostics.push(
              diagnostic(
                "WF_OPERATE_OUTCOME_HANDLE_UNKNOWN",
                `人工操作存在未配置的结果分支：${edge.sourceHandle || "default"}。`,
                { kind: "edge", edgeId: edge.id, field: "sourceHandle" }
              )
            )
          );
      }
      if (node.type === "condition") {
        for (const handle of ["true", "false"]) {
          const matching = nodeOutgoing.filter(
            edge => (edge.sourceHandle?.trim() || "default") === handle
          );
          if (matching.length !== 1)
            diagnostics.push(
              diagnostic(
                "WF_CONDITION_BRANCH_INVALID",
                `条件节点“${node.name}”必须且仅能连接一个 ${handle} 分支。`,
                { kind: "node", nodeId: node.id, field: handle }
              )
            );
        }
        nodeOutgoing
          .filter(
            edge =>
              !["true", "false"].includes(
                edge.sourceHandle?.trim() || "default"
              )
          )
          .forEach(edge =>
            diagnostics.push(
              diagnostic(
                "WF_CONDITION_HANDLE_UNKNOWN",
                `条件节点存在未知分支句柄：${edge.sourceHandle || "default"}。`,
                { kind: "edge", edgeId: edge.id, field: "sourceHandle" }
              )
            )
          );
      }
      if (
        node.type === "llm" &&
        String(node.config.failureHandle ?? "").trim()
      ) {
        const failureHandle = String(node.config.failureHandle).trim();
        if (
          !nodeOutgoing.some(
            edge => (edge.sourceHandle?.trim() || "default") === failureHandle
          )
        )
          diagnostics.push(
            diagnostic(
              "WF_LLM_FAILURE_BRANCH_UNCONNECTED",
              `LLM 节点“${node.name}”配置的失败分支 ${failureHandle} 未连接目标节点。`,
              { kind: "node", nodeId: node.id, field: "config.failureHandle" }
            )
          );
      }
      if (node.type === "llm") {
        const governance =
          node.config.governance &&
          typeof node.config.governance === "object" &&
          !Array.isArray(node.config.governance)
            ? (node.config.governance as Record<string, unknown>)
            : {};
        const humanReviewRequired = governance.humanReviewRequired === true;
        const deterministicValidation =
          governance.deterministicValidation &&
          typeof governance.deterministicValidation === "object" &&
          !Array.isArray(governance.deterministicValidation);
        const defaultEdges = nodeOutgoing.filter(
          edge => (edge.sourceHandle?.trim() || "default") === "default"
        );
        if (humanReviewRequired) {
          const reviewNode =
            defaultEdges.length === 1
              ? nodesById.get(defaultEdges[0].targetNodeId)
              : undefined;
          const validReviewNode =
            reviewNode?.type === "operate" &&
            !normalizeReferenceOperateConfig(reviewNode.config).autoExecute;
          if (!validReviewNode)
            diagnostics.push(
              diagnostic(
                "WF_LLM_HUMAN_REVIEW_GATE_REQUIRED",
                `LLM 节点“${node.name}”要求人工复核，default 分支必须且仅能直连一个非自动执行的人工操作节点。`,
                {
                  kind: "node",
                  nodeId: node.id,
                  field: "config.governance.humanReviewRequired",
                }
              )
            );
        }
        if (
          options.flowType === "state" &&
          !humanReviewRequired &&
          !deterministicValidation
        ) {
          const visited = new Set<string>();
          const queue = defaultEdges.map(edge => edge.targetNodeId);
          let reachesDecisionBeforeReview = false;
          while (queue.length && !reachesDecisionBeforeReview) {
            const candidateId = queue.shift()!;
            if (visited.has(candidateId)) continue;
            visited.add(candidateId);
            const candidate = nodesById.get(candidateId);
            if (!candidate || candidate.type === "operate") continue;
            if (
              ["condition", "router", "state", "end"].includes(
                candidate.type
              )
            ) {
              reachesDecisionBeforeReview = true;
              break;
            }
            for (const edge of outgoing.get(candidateId) ?? [])
              queue.push(edge.targetNodeId);
          }
          if (reachesDecisionBeforeReview)
            diagnostics.push(
              diagnostic(
                "WF_LLM_STATE_DECISION_GUARD_REQUIRED",
                `状态流程中的 LLM 节点“${node.name}”会在人工闸门前影响状态或决策，必须配置确定性校验或人工复核。`,
                {
                  kind: "node",
                  nodeId: node.id,
                  field: "config.governance",
                }
              )
            );
        }
        const allowedHandles = new Set(
          ["default", String(node.config.failureHandle ?? "").trim()].filter(
            Boolean
          )
        );
        nodeOutgoing
          .filter(
            edge => !allowedHandles.has(edge.sourceHandle?.trim() || "default")
          )
          .forEach(edge =>
            diagnostics.push(
              diagnostic(
                "WF_LLM_HANDLE_UNKNOWN",
                `LLM 节点存在未知分支句柄：${edge.sourceHandle || "default"}。`,
                { kind: "edge", edgeId: edge.id, field: "sourceHandle" }
              )
            )
          );
      }
      if (node.type === "router") {
        const routes = Array.isArray(node.config.routes)
          ? node.config.routes
          : [];
        const routeHandles = routes
          .map(route =>
            route && typeof route === "object"
              ? String(
                  (route as Record<string, unknown>).handle ??
                    (route as Record<string, unknown>).code ??
                    ""
                ).trim()
              : ""
          )
          .filter(Boolean);
        const defaultHandle =
          String(node.config.defaultRoute ?? "default").trim() || "default";
        const configuredHandles = new Set([...routeHandles, defaultHandle]);
        if (new Set(routeHandles).size !== routeHandles.length)
          diagnostics.push(
            diagnostic(
              "WF_ROUTER_HANDLE_DUPLICATE",
              `路由节点“${node.name}”的分支句柄不可重复。`,
              { kind: "node", nodeId: node.id, field: "config.routes" }
            )
          );
        configuredHandles.forEach(handle => {
          if (
            !nodeOutgoing.some(
              edge => (edge.sourceHandle?.trim() || "default") === handle
            )
          )
            diagnostics.push(
              diagnostic(
                "WF_ROUTER_BRANCH_UNCONNECTED",
                `路由节点“${node.name}”的分支 ${handle} 未连接目标节点。`,
                { kind: "node", nodeId: node.id, field: `handle:${handle}` }
              )
            );
        });
        nodeOutgoing
          .filter(
            edge =>
              !configuredHandles.has(edge.sourceHandle?.trim() || "default")
          )
          .forEach(edge =>
            diagnostics.push(
              diagnostic(
                "WF_ROUTER_HANDLE_UNKNOWN",
                `路由节点存在未配置的分支句柄：${edge.sourceHandle || "default"}。`,
                { kind: "edge", edgeId: edge.id, field: "sourceHandle" }
              )
            )
          );

        const broadcast =
          node.config.gbms === true ||
          node.config.gbms === "true" ||
          node.config.broadcast === true ||
          node.config.broadcast === "true";
        if (broadcast) {
          if (executable)
            diagnostics.push(
              diagnostic(
                "WF_RUNTIME_PARALLEL_UNSUPPORTED",
                `并行路由“${node.name}”尚未启用可靠的分支令牌与汇聚状态，当前版本禁止发布。`,
                { kind: "node", nodeId: node.id }
              )
            );
          const joinNodeId = String(
            node.config.parallelJoinNodeId ?? ""
          ).trim();
          if (nodeOutgoing.length < 2)
            diagnostics.push(
              diagnostic(
                "WF_PARALLEL_BRANCHES_REQUIRED",
                `并行路由“${node.name}”至少需要两个分支。`,
                { kind: "node", nodeId: node.id }
              )
            );
          if (!joinNodeId || !nodesById.has(joinNodeId)) {
            diagnostics.push(
              diagnostic(
                "WF_PARALLEL_JOIN_REQUIRED",
                `并行路由“${node.name}”必须配置有效的 parallelJoinNodeId。`,
                {
                  kind: "node",
                  nodeId: node.id,
                  field: "config.parallelJoinNodeId",
                }
              )
            );
          } else {
            const joinNode = nodesById.get(joinNodeId)!;
            if (
              String(joinNode.config.parallelForNodeId ?? "").trim() !== node.id
            )
              diagnostics.push(
                diagnostic(
                  "WF_PARALLEL_JOIN_MISMATCH",
                  `汇聚节点“${joinNode.name}”必须用 parallelForNodeId 反向绑定并行路由 ${node.id}。`,
                  {
                    kind: "node",
                    nodeId: joinNodeId,
                    field: "config.parallelForNodeId",
                  }
                )
              );
            if ((incoming.get(joinNodeId) ?? []).length < 2)
              diagnostics.push(
                diagnostic(
                  "WF_PARALLEL_JOIN_INPUTS_REQUIRED",
                  `汇聚节点“${joinNode.name}”至少需要两条入边。`,
                  { kind: "node", nodeId: joinNodeId }
                )
              );
            for (const edge of nodeOutgoing) {
              if (
                !canReachTarget(
                  edge.targetNodeId,
                  joinNodeId,
                  outgoing,
                  node.id
                )
              )
                diagnostics.push(
                  diagnostic(
                    "WF_PARALLEL_BRANCH_MISSES_JOIN",
                    `并行分支 ${edge.id} 无法到达汇聚节点“${joinNode.name}”。`,
                    { kind: "edge", edgeId: edge.id }
                  )
                );
            }
          }
        }
      }
    }

    const components = stronglyConnectedComponents(
      Array.from(nodeIds),
      outgoing
    );
    for (const component of components.filter(item => item.length > 1)) {
      const memberIds = new Set(component);
      const componentEdges = validEdges.filter(
        edge =>
          memberIds.has(edge.sourceNodeId) && memberIds.has(edge.targetNodeId)
      );
      const loopEdges = componentEdges.filter(edge => edge.loop);
      if (!loopEdges.length) {
        const node = nodesById.get(component[0]!);
        diagnostics.push(
          diagnostic(
            "WF_LOOP_NOT_DECLARED",
            `流程存在未声明执行语义的循环：${node?.name || component[0]}。`,
            { kind: "node", nodeId: component[0] }
          )
        );
      }
    }
    validEdges
      .filter(edge => edge.loop)
      .forEach(edge => {
        if (executable)
          diagnostics.push(
            diagnostic(
              "WF_RUNTIME_LOOP_UNSUPPORTED",
              `循环边 ${edge.id} 尚未启用持久化迭代计数，当前版本禁止发布。`,
              { kind: "edge", edgeId: edge.id, field: "loop" }
            )
          );
        const inCycle = components.some(
          component =>
            component.length > 1 &&
            component.includes(edge.sourceNodeId) &&
            component.includes(edge.targetNodeId)
        );
        if (!inCycle)
          diagnostics.push(
            diagnostic(
              "WF_LOOP_EDGE_NOT_CYCLIC",
              `连线 ${edge.id} 配置了循环策略，但不属于任何循环。`,
              { kind: "edge", edgeId: edge.id, field: "loop" }
            )
          );
      });

    for (const node of validNodes) {
      if (
        ["wait", "message_catch"].includes(node.type) &&
        (outgoing.get(node.id) ?? []).length !== 1
      )
        diagnostics.push(
          diagnostic(
            "WF_WAIT_SINGLE_CONTINUATION_REQUIRED",
            `等待节点“${node.name}”必须且只能连接一个后继节点。`,
            { kind: "node", nodeId: node.id }
          )
        );
      const serviceTask = compileHttpServiceTask(node.type, node.config);
      if (!serviceTask || serviceTask.effect !== "write") continue;
      if (serviceTask.writeSafety === "unconfigured")
        diagnostics.push(
          diagnostic(
            "WF_SERVICE_WRITE_SAFETY_REQUIRED",
            `写服务任务“${node.name}”必须声明远端幂等或补偿策略后才能发布。`,
            { kind: "node", nodeId: node.id, field: "config.writeSafety" }
          )
        );
      if (
        serviceTask.writeSafety !== "idempotent" &&
        serviceTask.retry.maxAttempts > 1
      )
        diagnostics.push(
          diagnostic(
            "WF_SERVICE_WRITE_RETRY_UNSAFE",
            `写服务任务“${node.name}”只有在远端支持幂等键时才能自动重试。`,
            { kind: "node", nodeId: node.id, field: "config.retryMaxAttempts" }
          )
        );
      if (serviceTask.writeSafety === "compensated") {
        const compensationNodeId = serviceTask.compensationNodeId ?? "";
        if (!nodesById.has(compensationNodeId))
          diagnostics.push(
            diagnostic(
              "WF_SERVICE_COMPENSATION_NODE_INVALID",
              `写服务任务“${node.name}”配置的补偿节点不存在。`,
              { kind: "node", nodeId: node.id, field: "config.compensationNodeId" }
            )
          );
        const compensationEdge = validEdges.some(
          edge =>
            edge.sourceNodeId === node.id &&
            edge.targetNodeId === compensationNodeId &&
            (edge.sourceHandle ?? "default") === "compensation"
        );
        if (!compensationEdge)
          diagnostics.push(
            diagnostic(
              "WF_SERVICE_COMPENSATION_EDGE_REQUIRED",
              `写服务任务“${node.name}”必须通过 compensation 出口连接补偿节点。`,
              { kind: "node", nodeId: node.id, field: "config.compensationNodeId" }
            )
          );
      }
    }
  }

  if (diagnostics.length) return { ok: false, diagnostics };
  const normalized = normalizedDefinition(value);
  const normalizedOutgoing = new Map(
    normalized.nodes.map(node => [node.id, [] as WorkflowEdge[]])
  );
  const normalizedIncoming = new Map(
    normalized.nodes.map(node => [node.id, [] as WorkflowEdge[]])
  );
  normalized.edges.forEach(edge => {
    normalizedOutgoing.get(edge.sourceNodeId)!.push(edge);
    normalizedIncoming.get(edge.targetNodeId)!.push(edge);
  });
  const loopEdgeIds = new Set(
    normalized.edges.filter(edge => edge.loop).map(edge => edge.id)
  );
  const indegrees = new Map(normalized.nodes.map(node => [node.id, 0]));
  normalized.edges
    .filter(edge => !loopEdgeIds.has(edge.id))
    .forEach(edge =>
      indegrees.set(
        edge.targetNodeId,
        (indegrees.get(edge.targetNodeId) ?? 0) + 1
      )
    );
  const topologyQueue = normalized.nodes
    .map(node => node.id)
    .filter(nodeId => indegrees.get(nodeId) === 0)
    .sort();
  const topologicalOrder: string[] = [];
  while (topologyQueue.length) {
    const nodeId = topologyQueue.shift()!;
    topologicalOrder.push(nodeId);
    for (const edge of normalizedOutgoing.get(nodeId) ?? []) {
      if (loopEdgeIds.has(edge.id)) continue;
      indegrees.set(edge.targetNodeId, indegrees.get(edge.targetNodeId)! - 1);
      if (indegrees.get(edge.targetNodeId) === 0)
        topologyQueue.push(edge.targetNodeId);
    }
    topologyQueue.sort();
  }
  const parallelGroups = normalized.nodes
    .filter(
      node =>
        node.type === "router" &&
        (node.config.gbms === true ||
          node.config.gbms === "true" ||
          node.config.broadcast === true ||
          node.config.broadcast === "true")
    )
    .map(node => ({
      forkNodeId: node.id,
      joinNodeId: String(node.config.parallelJoinNodeId),
      branchEdgeIds: (normalizedOutgoing.get(node.id) ?? [])
        .map(edge => edge.id)
        .sort(),
    }));
  const plan: WorkflowExecutionPlan = {
    schemaVersion: 1,
    compilerVersion: "1.6.0",
    profile: {
      flowType: profile.type,
      profileVersion: profile.version,
      runtimeKind: profile.runtimeKind,
    },
    definition: normalized,
    entryNodeId: normalized.nodes.find(node => node.type === "start")!.id,
    terminalNodeIds: normalized.nodes
      .filter(node => node.type === "end")
      .map(node => node.id)
      .sort(),
    outgoing: Object.fromEntries(
      normalized.nodes.map(node => [
        node.id,
        (normalizedOutgoing.get(node.id) ?? []).map(edge => ({
          edgeId: edge.id,
          handle: edge.sourceHandle || "default",
          targetNodeId: edge.targetNodeId,
        })),
      ])
    ),
    incoming: Object.fromEntries(
      normalized.nodes.map(node => [
        node.id,
        (normalizedIncoming.get(node.id) ?? []).map(edge => ({
          edgeId: edge.id,
          sourceNodeId: edge.sourceNodeId,
          handle: edge.sourceHandle || "default",
        })),
      ])
    ),
    topologicalOrder:
      topologicalOrder.length === normalized.nodes.length
        ? topologicalOrder
        : null,
    parallelGroups,
    loops: normalized.edges
      .filter((edge): edge is WorkflowEdge & { loop: WorkflowLoopPolicy } =>
        Boolean(edge.loop)
      )
      .map(edge => ({
        edgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        maxIterations: edge.loop.maxIterations,
      })),
    serviceTasks: Object.fromEntries(
      normalized.nodes.flatMap(node => {
        const task = compileHttpServiceTask(node.type, node.config);
        return task ? [[node.id, task]] : [];
      })
    ),
  };
  return {
    ok: true,
    diagnostics: [],
    definition: normalized,
    plan,
    planHash: hashWorkflowExecutionPlan(plan),
  };
}

export function compileWorkflowDefinition(
  definition: unknown,
  options: { flowType: FlowType }
) {
  const result = analyzeWorkflowDefinition(definition, {
    ...options,
    executable: true,
  });
  if (!result.ok) throw new WorkflowCompileError(result.diagnostics);
  return result;
}

export function validateWorkflowDefinition(
  definition: unknown,
  options: WorkflowAnalysisOptions
) {
  const result = analyzeWorkflowDefinition(definition, options);
  if (!result.ok) throw new WorkflowCompileError(result.diagnostics);
  return result.definition;
}

export function assertWorkflowExecutionPlan(
  plan: unknown,
  expectedHash: string,
  expectedFlowType?: FlowType
) {
  if (!plan || typeof plan !== "object")
    throw new Error("已发布流程缺少不可变执行计划。");
  const typed = plan as WorkflowExecutionPlan;
  const actualHash = hashWorkflowExecutionPlan(typed);
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash)
    throw new Error("已发布流程执行计划哈希校验失败。");
  if (
    expectedFlowType &&
    typed.profile?.flowType &&
    typed.profile.flowType !== expectedFlowType
  )
    throw new Error("已发布流程执行计划类型与流程类型不一致。");
  return typed;
}
