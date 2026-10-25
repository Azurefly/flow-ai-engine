import { normalizeReferenceOperateConfig } from "../shared/reference-operate-config";
import { previewOperateApproval } from "./workflow-approval-preview";
import type {
  WorkflowCompileDiagnostic,
  WorkflowDefinition,
} from "./workflow-compiler";

/** Static selectors can be checked now. Receivers/form/sender selectors need the actual run context. */
export async function workflowParticipantReadiness(
  workflowId: string,
  definition: WorkflowDefinition,
  initiatorUserId: number
): Promise<WorkflowCompileDiagnostic[]> {
  const diagnostics: WorkflowCompileDiagnostic[] = [];
  for (const node of definition.nodes) {
    if (node.type !== "operate") continue;
    const reference = normalizeReferenceOperateConfig(node.config);
    if (
      reference.autoExecute &&
      !reference.autoExecuteConditions.length &&
      !reference.hasUnsafeAutoExecuteCode
    )
      continue;
    const mode = String(
      node.config.assigneeMode ||
        (node.config.assigneeUserId ? "user" : "receivers")
    );
    if (!["user", "role", "department", "department_manager"].includes(mode))
      continue;
    if (
      mode === "department_manager" &&
      !Array.isArray(node.config.assigneeUnitIds)
    )
      continue;
    if (
      mode === "department_manager" &&
      !(node.config.assigneeUnitIds as unknown[]).length
    )
      continue;
    try {
      await previewOperateApproval({
        workflowId,
        config: node.config,
        context: {
          input: {},
          vars: {},
          nodes: {},
          runtime: {
            triggeredByUserId: initiatorUserId,
            lastActorUserId: initiatorUserId,
            receiverUserIds: [],
          },
        },
      });
    } catch (error) {
      // Connectivity/SQL failures must remain request failures, not masquerade as invalid configuration.
      if (error && typeof error === "object" && "code" in error) throw error;
      diagnostics.push({
        code: "WF_PARTICIPANTS_UNAVAILABLE",
        message: `“${node.name}”的处理人检查未通过：${error instanceof Error ? error.message : "无法解析处理人"}`,
        location: { kind: "node", nodeId: node.id, field: "assigneeMode" },
      });
    }
  }
  return diagnostics;
}
