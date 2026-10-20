export type WorkflowPublicationSnapshot = {
  workflowId: string;
  definitionVersion: number;
  status: string;
  auditStatus: string;
  projectScoped: boolean;
  archived: boolean;
  requireProjectApproval: boolean;
};

export function workflowPublicationGate(input: {
  workflowId: string;
  baseVersion?: number | null;
  publication?: WorkflowPublicationSnapshot | null;
  definitionChanged: boolean;
}) {
  const state = input.publication;
  const blocked = (
    kind: "unavailable" | "version" | "archived" | "draft" | "review",
    reason: string
  ) => ({ allowed: false, kind, reason });
  if (
    !state ||
    state.workflowId !== input.workflowId ||
    !Number.isSafeInteger(input.baseVersion) ||
    Number(input.baseVersion) < 1
  )
    return blocked(
      "unavailable",
      "发布规则暂不可用，请重新读取流程权限与发布规则。"
    );
  if (
    !Number.isSafeInteger(state.definitionVersion) ||
    state.definitionVersion < 1 ||
    !["draft", "published"].includes(state.status)
  )
    return blocked(
      "unavailable",
      "当前流程状态暂不可用，请重新读取流程权限与发布规则。"
    );
  if (state.archived)
    return blocked("archived", "流程或业务已归档，恢复后才能发布。");
  if (state.definitionVersion !== input.baseVersion)
    return blocked(
      "version",
      `流程版本已变化：当前为 v${state.definitionVersion}，本地编辑基于 v${input.baseVersion}。当前修改已保留，请先处理版本变化。`
    );
  if (state.projectScoped && state.requireProjectApproval) {
    if (input.definitionChanged)
      return blocked(
        "draft",
        state.status === "published"
          ? "当前规则要求审核。请先取消发布，保留当前修改并保存为草稿，再审核发布。"
          : "当前定义有未保存修改。请先保存画布，再由业务管理员复核后发布。"
      );
    if (state.auditStatus !== "approved")
      return blocked(
        "review",
        state.auditStatus === "rejected"
          ? "当前草稿已驳回。请修改定义后重新保存，或由业务管理员重置后复核。"
          : "当前规则要求审核。请由业务管理员复核此版本后发布。"
      );
  }
  return { allowed: true, kind: null, reason: null } as const;
}
