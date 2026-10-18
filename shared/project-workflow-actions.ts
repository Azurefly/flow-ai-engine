export function projectWorkflowActions(input: {
  actorId: number;
  workflow: {
    status?: string;
    auditStatus?: string;
    flowType?: string;
    ownerUserId?: number;
    projectStatus?: string;
  };
  projectPermissions: ReadonlySet<string>;
  workflowPermissions: ReadonlySet<string>;
  reviewerMode: string;
}) {
  const { workflow, projectPermissions, workflowPermissions } = input;
  const visible = projectPermissions.has("project:view");
  const active = visible && workflow.projectStatus === "active";
  const draft = workflow.status === "draft";
  const published = workflow.status === "published";
  const reviewCandidate =
    active &&
    draft &&
    workflow.auditStatus === "init" &&
    projectPermissions.has("project:manage");
  const separated =
    input.reviewerMode !== "independent_reviewer" ||
    Number(workflow.ownerUserId) !== input.actorId;
  return {
    canViewCanvas: visible && workflowPermissions.has("workflow:view"),
    canDesign: active && draft && workflowPermissions.has("workflow:edit"),
    canRun:
      active &&
      published &&
      (workflow.flowType === "data"
        ? projectPermissions.has("project:workflow:run")
        : workflowPermissions.has("workflow:run")),
    canPublish:
      active &&
      draft &&
      workflow.auditStatus === "approved" &&
      workflowPermissions.has("workflow:publish"),
    canUnpublish:
      active && published && workflowPermissions.has("workflow:publish"),
    canReview: reviewCandidate && separated,
    reviewBlockedReason:
      reviewCandidate && !separated
        ? "独立复核模式下，请由其他业务管理员审核此流程。"
        : null,
  };
}
