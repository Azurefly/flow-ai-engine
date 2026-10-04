import type { RowDataPacket } from "mysql2/promise";
import { getSharedPool } from "./db";
import type { RunApprovalGroup } from "../shared/run-approval-progress";
export async function getRunApprovalProgress(
  runId: string
): Promise<RunApprovalGroup[]> {
  const [rows] = await getSharedPool().query<RowDataPacket[]>(
    `SELECT g.nodeId,g.signMode,g.totalApprovers,g.requiredApprovals,t.status,
      JSON_UNQUOTE(JSON_EXTRACT(t.resultJson,'$.decision')) AS decision,
      COALESCE(NULLIF(completer.name,''),NULLIF(claimant.name,''),NULLIF(assignee.name,''),'未指定人员') AS participantName
      FROM workflow_task_group g JOIN workflow_task t ON t.approvalGroupId=g.id
      LEFT JOIN users assignee ON assignee.id=t.assignedUserId
      LEFT JOIN users claimant ON claimant.id=t.claimedByUserId
      LEFT JOIN users completer ON completer.id=t.completedByUserId
      WHERE g.runId=? ORDER BY g.createdAt,g.id,t.approvalOrder,t.createdAt,t.id`,
    [runId]
  );
  const groups = new Map<string, RunApprovalGroup>();
  for (const row of rows) {
    const nodeId = String(row.nodeId);
    let group = groups.get(nodeId);
    if (!group) {
      group = {
        nodeId,
        signMode: String(row.signMode),
        total: Number(row.totalApprovers),
        required: Number(row.requiredApprovals),
        approved: 0,
        rejected: 0,
        participants: [],
      };
      groups.set(nodeId, group);
    }
    const decision =
      row.decision === "approved" || row.decision === "rejected"
        ? row.decision
        : null;
    if (row.status === "completed" && decision === "approved") group.approved++;
    if (row.status === "completed" && decision === "rejected") group.rejected++;
    group.participants.push({
      name: String(row.participantName),
      status: String(row.status),
      decision,
    });
  }
  return Array.from(groups.values());
}
