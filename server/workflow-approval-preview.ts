import type { RowDataPacket } from "mysql2/promise";
import { getSharedPool } from "./db";
import { resolveOperateAssignees } from "./organization-service";
import { orderOperateApprovers } from "../shared/operate-approval-editor";
import {
  normalizeReferenceOperateConfig,
  approvalRequirement,
} from "../shared/reference-operate-config";

/** Called only after workflow edit authorization. Uses the same selection and ordering as execution. */
export async function previewOperateApproval(
  input: Parameters<typeof resolveOperateAssignees>[0]
) {
  const assignment = await resolveOperateAssignees(input);
  const reference = normalizeReferenceOperateConfig(input.config);
  const candidateUserIds =
    reference.signMode === "single"
      ? assignment.candidateUserIds
      : orderOperateApprovers(
          assignment.candidateUserIds,
          reference.signSelectorUserIds,
          reference.signMode === "sequentialSignFor"
        );
  if (!candidateUserIds.length)
    throw new Error("或签/会签指定方未命中当前操作候选人。");
  const visibleIds = candidateUserIds.slice(0, 100);
  const [rows] = await getSharedPool().query<RowDataPacket[]>(
    `SELECT id,name,username FROM users WHERE id IN (${visibleIds.map(() => "?").join(",")})`,
    visibleIds
  );
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  return {
    ...assignment,
    candidateUserIds,
    assignedUserId: candidateUserIds.length === 1 ? candidateUserIds[0] : null,
    signMode: reference.signMode,
    signModeLabel: {
      single: "单人办理",
      orSignFor: "或签",
      andSignFor: "会签",
      sequentialSignFor: "顺序会签",
    }[reference.signMode],
    requiredApprovals: approvalRequirement(
      reference.signMode,
      candidateUserIds.length,
      reference.passPercent
    ),
    totalApprovers: candidateUserIds.length,
    hasMore: candidateUserIds.length > visibleIds.length,
    users: visibleIds.map(id => ({
      id,
      name: String(byId.get(id)?.name || "未命名人员"),
      username: String(byId.get(id)?.username || ""),
    })),
  };
}
