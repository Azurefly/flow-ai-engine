export function canManageTask(
  task: { status?: unknown; canAct?: unknown } | null | undefined
) {
  return Boolean(
    task &&
      ["pending", "claimed"].includes(String(task.status)) &&
      task.canAct === true
  );
}

export function taskAssignmentTargetReason(
  task:
    | {
        status?: unknown;
        assignedUserId?: unknown;
        claimedByUserId?: unknown;
        viewerUserId?: unknown;
        approvalGroupId?: unknown;
        approvalMembers?: Array<{ assignedUserId?: unknown }>;
      }
    | null
    | undefined,
  target: unknown
) {
  const id = Number(target);
  if (!Number.isInteger(id) || id <= 0) return "请选择可分配处理人。";
  const owner =
    Number(
      task?.status === "claimed" ? task.claimedByUserId : task?.assignedUserId
    ) || Number(task?.viewerUserId);
  if (id === owner) return "目标人员已经是当前处理人，请选择其他人员。";
  if (
    task?.approvalGroupId &&
    task.approvalMembers?.some(member => Number(member.assignedUserId) === id)
  )
    return "该人员已在当前审批组中，请选择其他人员。";
  return null;
}
