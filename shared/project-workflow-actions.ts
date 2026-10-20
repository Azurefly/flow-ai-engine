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
  requireProjectApproval?: boolean;
  publicationPolicyReady?: boolean;
}) {
  const { workflow, projectPermissions, workflowPermissions } = input;
  const visible = projectPermissions.has("project:view");
  const active = visible && workflow.projectStatus === "active";
  const draft = workflow.status === "draft";
  const published = workflow.status === "published";
  const requireApproval = input.requireProjectApproval ?? true;
  const policyReady = input.publicationPolicyReady !== false;
  const hasPublishPermission = workflowPermissions.has("workflow:publish");
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
      policyReady &&
      (!requireApproval || workflow.auditStatus === "approved") &&
      hasPublishPermission,
    canUnpublish:
      active && published && workflowPermissions.has("workflow:publish"),
    canReview: reviewCandidate && policyReady && separated,
    publicationRule: input.requireProjectApproval === undefined ? null : { requireProjectApproval: requireApproval },
    publishBlockedReason: active && draft && hasPublishPermission
      ? !policyReady ? "发布规则暂不可用，请重新读取流程与权限。"
        : requireApproval && workflow.auditStatus !== "approved"
          ? "当前规则要求审核通过后发布，请先由业务管理员复核。" : null
      : null,
    reviewBlockedReason:
      reviewCandidate && !policyReady ? "审核规则暂不可用，请重新读取流程与权限。"
      : reviewCandidate && !separated
        ? requireApproval ? "独立复核模式下，请由其他业务管理员审核此流程。"
          : "当前规则无需审核即可发布；如需记录审核，请由其他业务管理员处理。"
        : null,
  };
}
