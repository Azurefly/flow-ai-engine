export type RunApprovalGroup = {
  nodeId: string;
  signMode: string;
  total: number;
  required: number;
  approved: number;
  rejected: number;
  participants: { name: string; status: string; decision: string | null }[];
};
export function approvalParticipantStatus(
  status: string,
  decision: string | null
) {
  if (status === "completed")
    return decision === "approved"
      ? "已通过"
      : decision === "rejected"
        ? "已拒绝"
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
