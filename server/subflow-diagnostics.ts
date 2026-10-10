import type { WorkflowCompileDiagnostic } from "./workflow-compiler";

const synchronousNodeTypes = new Set([
  "start", "state", "milestone", "form", "router", "rest", "method",
  "transform", "condition", "http", "llm", "end",
]);
export function diagnoseSynchronousSubflowNodes(
  nodes: readonly { id: string; type: string; name: string }[]
): WorkflowCompileDiagnostic[] {
  return nodes.filter(node => !synchronousNodeTypes.has(node.type)).map(node => ({
    code: "WF_SUBFLOW_SYNC_NODE_UNSUPPORTED",
    message: `同步子流程不支持节点“${node.name}”（${node.type}）。等待、消息接收和人工办理请配置在主流程中。`,
    location: { kind: "node", nodeId: node.id },
  }));
}

export function locateSubflowDiagnostics(
  diagnostics: readonly WorkflowCompileDiagnostic[],
  caller: { id: string; name: string },
  subflowName: string
): WorkflowCompileDiagnostic[] {
  return diagnostics.map(item => ({
    ...item,
    message: `调用节点“${caller.name}”引用的子流程“${subflowName}”：${item.message}`,
    location: { kind: "node", nodeId: caller.id, field: "config.subflowId" },
  }));
}
