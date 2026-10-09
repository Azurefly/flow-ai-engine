import type { WorkflowCompileDiagnostic } from "./workflow-compiler";

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
