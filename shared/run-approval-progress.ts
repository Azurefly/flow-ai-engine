export type RunApprovalGroup = {
  groupId: string;
  nodeRunId: string | null;
  batchConflict?: boolean;
  nodeId: string;
  signMode: string;
  total: number;
  required: number;
  approved: number;
  rejected: number;
  participants: {
    name: string;
    status: string;
    decision: string | null;
    comment?: string | null;
  }[];
};

/** Match immutable group/batch identities; never merge repeated executions by node ID. */
export function approvalGroupsForRecord(
  groups: RunApprovalGroup[],
  record: { id?: unknown; nodeId?: unknown; outputJson?: unknown }
) {
  if (typeof record.id !== "string" || typeof record.nodeId !== "string") return [];
  let output = record.outputJson;
  if (typeof output === "string") {
    try {
      output = JSON.parse(output);
    } catch {
      output = null;
    }
  }
  const groupId =
    output && typeof output === "object" && "approvalGroupId" in output
      ? output.approvalGroupId
      : null;
  return groups.filter(
    group =>
      !group.batchConflict &&
      group.nodeId === record.nodeId &&
      (group.nodeRunId
        ? group.nodeRunId === record.id &&
          (!groupId || group.groupId === groupId)
        : Boolean(groupId) && group.groupId === groupId)
  );
}
export function approvalParticipantStatus(
  status: string,
  decision: string | null
) {
  if (status === "completed")
    return decision === "approved"
      ? "已通过"
      : decision === "rejected"
        ? "已拒绝"
        : decision === "abstained"
          ? "已弃权"
          : "已办理";
  return (
    (
      { pending: "待办理", claimed: "办理中", cancelled: "已取消" } as Record<
        string,
        string
      >
    )[status] ?? status
  );
}
