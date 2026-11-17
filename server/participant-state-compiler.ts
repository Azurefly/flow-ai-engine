import { normalizeReferenceOperateConfig } from "../shared/reference-operate-config";
import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";
import {
  participantOperation,
  PARTICIPANT_RELATION_OPTIONS,
  PARTICIPANT_SCOPE_OPTIONS,
} from "../shared/participant-state";
import {
  readOperateOutcomeMode,
  readOperateOutcomes,
} from "../shared/workflow-node-contract";
import type {
  WorkflowCompileDiagnostic,
  WorkflowDefinition,
  WorkflowExecutionPlan,
} from "./workflow-compiler";

/** A state is a durable boundary. Only the routing between an action and a state executes automatically. */
export function validateParticipantStateGraph(
  definition: WorkflowDefinition
): WorkflowCompileDiagnostic[] {
  const diagnostics: WorkflowCompileDiagnostic[] = [];
  const nodes = new Map(definition.nodes.map(node => [node.id, node]));
  const outgoing = (id: string) =>
    definition.edges.filter(edge => edge.sourceNodeId === id);
  const add = (
    code: string,
    message: string,
    nodeId?: string,
    field?: string
  ) =>
    diagnostics.push({
      code,
      message,
      location: nodeId
        ? { kind: "node", nodeId, field }
        : { kind: "definition" },
    });
  const allowedTargets: Record<string, string[]> = {
    start: ["state"],
    state: ["operate", "end"],
    operate: ["router", "state"],
    router: ["router", "state"],
    end: [],
  };
  const codes = new Set<string>();
  for (const node of definition.nodes) {
    if (!allowedTargets[node.type]) {
      add(
        "WF_PARTICIPANT_NODE_UNSUPPORTED",
        `参与人状态模式支持开始、操作、路由、状态和结束节点，请调整“${node.name}”。`,
        node.id
      );
      continue;
    }
    const edges = outgoing(node.id);
    for (const edge of edges) {
      if (
        !allowedTargets[node.type].includes(
          nodes.get(edge.targetNodeId)?.type ?? ""
        )
      )
        add(
          "WF_PARTICIPANT_EDGE_INVALID",
          `“${node.name}”的连线不符合状态驻留与操作后路由规则。`,
          node.id
        );
      if (edge.loop)
        add(
          "WF_PARTICIPANT_LOOP_POLICY",
          "参与人状态由人工操作进入新轮次，请移除执行循环次数配置。",
          node.id
        );
    }
    if (node.type === "start" && edges.length !== 1)
      add(
        "WF_PARTICIPANT_INITIAL_STATE",
        "开始节点必须连接一个初始个人状态。",
        node.id
      );
    if (node.type === "state") {
      const code = String(
        node.config.nodeDh || node.config.stateCode || node.id
      );
      if (codes.has(code))
        add("WF_STATE_CODE_DUPLICATE", `状态代号不可重复 ${code}。`, node.id);
      codes.add(code);
      if (
        node.config.stateType === "terminal" &&
        edges.some(edge => nodes.get(edge.targetNodeId)?.type !== "end")
      )
        add(
          "WF_PARTICIPANT_TERMINAL_OPERATION",
          "个人终态仅可连接结束节点。",
          node.id
        );
      if (
        node.config.stateType !== "terminal" &&
        edges.some(edge => nodes.get(edge.targetNodeId)?.type === "end")
      )
        add(
          "WF_PARTICIPANT_TERMINAL_REQUIRED",
          "连接结束节点的个人状态需设置为业务终态。",
          node.id
        );
    }
    if (node.type === "operate") {
      const operation = participantOperation(node.config);
      if (
        !PARTICIPANT_SCOPE_OPTIONS.some(
          option => option.value === operation.scope
        ) ||
        !PARTICIPANT_RELATION_OPTIONS.some(
          option => option.value === operation.relation
        )
      )
        add(
          "WF_PARTICIPANT_OPERATION_CONFIG",
          "操作影响范围或提交关系设置无效。",
          node.id,
          "config.participantOperation"
        );
      if (
        (operation.scope === "actor_and_receivers" &&
          operation.relation !== "create") ||
        (operation.scope === "relation" && operation.relation !== "consume")
      )
        add(
          "WF_PARTICIPANT_RELATION_SCOPE",
          "新接收人范围需建立提交关系，本轮关系范围需结束当前提交关系。",
          node.id,
          "config.participantOperation"
        );
      if (
        operation.relation === "create" &&
        !["actor_and_receivers", "all"].includes(operation.scope)
      )
        add(
          "WF_PARTICIPANT_RECEIVER_SCOPE",
          "建立提交关系时需覆盖操作人与新接收人。",
          node.id
        );
      const reference = normalizeReferenceOperateConfig(node.config);
      if (reference.autoExecute || reference.signMode !== "single")
        add(
          "WF_PARTICIPANT_HUMAN_OPERATION",
          "个人状态操作由持卡人独立触发，多人条件请通过路由配置。",
          node.id
        );
      if (readOperateOutcomeMode(node.config) !== "explicit")
        add(
          "WF_PARTICIPANT_OUTCOMES_REQUIRED",
          "个人状态操作需配置显式结果出口。",
          node.id
        );
      for (const outcome of readOperateOutcomes(node.config)) {
        if (
          edges.filter(
            edge => (edge.sourceHandle || "default") === outcome.sourceHandle
          ).length !== 1
        )
          add(
            "WF_PARTICIPANT_OUTCOME_EDGE",
            `操作结果“${outcome.label}”必须连接一个路由或状态节点。`,
            node.id
          );
      }
      const handles = new Set(
        readOperateOutcomes(node.config).map(outcome => outcome.sourceHandle)
      );
      if (edges.some(edge => !handles.has(edge.sourceHandle || "default")))
        add(
          "WF_PARTICIPANT_OUTCOME_UNKNOWN",
          "操作连线引用了未配置的结果出口。",
          node.id
        );
    }
    if (node.type === "router") {
      const router = normalizeReferenceRouterConfig(node.config);
      if (router.broadcast)
        add(
          "WF_PARTICIPANT_BROADCAST",
          "每张个人状态卡每次进入一个目标状态，请关闭广播。",
          node.id
        );
      if (router.hasUnsafeCode)
        add(
          "WF_PARTICIPANT_ROUTE_CODE",
          "人员路由仅支持角色与条件配置。",
          node.id
        );
      if (
        ![undefined, "keep", "error"].includes(
          node.config.unmatched as string | undefined
        )
      )
        add(
          "WF_PARTICIPANT_UNMATCHED",
          "未命中行为需选择保持原状态或阻止操作。",
          node.id
        );
      if (router.rules.filter(rule => rule.isDefault).length > 1)
        add(
          "WF_PARTICIPANT_MULTIPLE_DEFAULTS",
          "人员路由最多配置一条默认规则。",
          node.id
        );
      const handles = new Set<string>();
      for (const rule of router.rules) {
        const targets = edges.filter(
          edge => (edge.sourceHandle || "default") === rule.handle
        );
        if (handles.has(rule.handle))
          add("WF_PARTICIPANT_ROUTE_HANDLE", "路由路径句柄不可重复。", node.id);
        handles.add(rule.handle);
        if (
          targets.length !== 1 ||
          (rule.targetNodeId && targets[0]?.targetNodeId !== rule.targetNodeId)
        )
          add(
            "WF_PARTICIPANT_ROUTE_TARGET",
            `路由“${rule.name}”需连接唯一目标，且与配置目标一致。`,
            node.id
          );
      }
      if (edges.some(edge => !handles.has(edge.sourceHandle || "default")))
        add(
          "WF_PARTICIPANT_ROUTE_RULE",
          "路由的每条连线都需有对应路径规则。",
          node.id
        );
    }
    if (node.type === "end" && edges.length)
      add("WF_END_OUTGOING", "结束节点不能有后继连线。", node.id);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitRouter = (id: string) => {
    if (visiting.has(id)) {
      add(
        "WF_PARTICIPANT_ROUTER_CYCLE",
        "操作后的路由之间不能形成自动循环。",
        id
      );
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing(id))
      if (nodes.get(edge.targetNodeId)?.type === "router")
        visitRouter(edge.targetNodeId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of definition.nodes)
    if (node.type === "router") visitRouter(node.id);
  const start = definition.nodes.find(node => node.type === "start");
  const reachable = new Set<string>();
  const queue = start ? [start.id] : [];
  for (const id of queue) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of outgoing(id)) queue.push(edge.targetNodeId);
  }
  for (const node of definition.nodes)
    if (!reachable.has(node.id))
      add(
        "WF_NODE_UNREACHABLE",
        `节点“${node.name}”无法从初始状态到达。`,
        node.id
      );
  if (
    !definition.nodes.some(
      node => node.type === "state" && node.config.stateType === "terminal"
    )
  )
    add(
      "WF_STATE_TERMINAL_REQUIRED",
      "请至少配置一个个人终态。所有人员进入终态后实例完成。"
    );
  return diagnostics;
}

export function participantStateExecutionPlan(
  definition: WorkflowDefinition
): WorkflowExecutionPlan {
  return {
    schemaVersion: 1,
    compilerVersion: "1.9.0",
    profile: { flowType: "state", profileVersion: 4, runtimeKind: "workflow" },
    definition,
    entryNodeId: definition.nodes.find(node => node.type === "start")!.id,
    terminalNodeIds: definition.nodes
      .filter(node => node.type === "end")
      .map(node => node.id),
    outgoing: Object.fromEntries(
      definition.nodes.map(node => [
        node.id,
        definition.edges
          .filter(edge => edge.sourceNodeId === node.id)
          .map(edge => ({
            edgeId: edge.id,
            handle: edge.sourceHandle || "default",
            targetNodeId: edge.targetNodeId,
          })),
      ])
    ),
    incoming: Object.fromEntries(
      definition.nodes.map(node => [
        node.id,
        definition.edges
          .filter(edge => edge.targetNodeId === node.id)
          .map(edge => ({
            edgeId: edge.id,
            sourceNodeId: edge.sourceNodeId,
            handle: edge.sourceHandle || "default",
          })),
      ])
    ),
    topologicalOrder: null,
    parallelGroups: [],
    loops: [],
    serviceTasks: {},
  };
}
