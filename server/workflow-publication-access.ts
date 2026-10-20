import type mysql from "mysql2/promise";
import { getSharedPool } from "./db";
import { getWorkflowAccess } from "./iam-service";
import { isProjectApprovalRequired } from "./p1-service";
import type { ProjectUser } from "./project-service";
import type { WorkflowPublicationSnapshot } from "../shared/workflow-publication";

/** Presentation metadata shares the existing access request; mutation checks remain authoritative. */
export async function getWorkflowPublicationAccess(
  user: ProjectUser,
  workflowId: string
) {
  const access = await getWorkflowAccess(user, workflowId);
  const unavailable = () => ({
    ...access,
    publication: null as WorkflowPublicationSnapshot | null,
  });
  if (
    !access.exists ||
    !access.permissions.has("workflow:view") ||
    !access.permissions.has("workflow:publish")
  )
    return unavailable();
  try {
    const [rows] = await getSharedPool().query<mysql.RowDataPacket[]>(
      "SELECT w.id,w.projectId,w.definitionVersion,w.status,w.auditStatus,w.archivedAt,p.status AS projectStatus FROM workflow w LEFT JOIN flow_project p ON p.id=w.projectId WHERE w.id=? LIMIT 1",
      [workflowId]
    );
    const row = rows[0];
    if (
      !row ||
      String(row.id) !== workflowId ||
      !Number.isSafeInteger(Number(row.definitionVersion)) ||
      Number(row.definitionVersion) < 1
    )
      return unavailable();
    const publication: WorkflowPublicationSnapshot = {
      workflowId: String(row.id),
      definitionVersion: Number(row.definitionVersion),
      status: String(row.status),
      auditStatus: String(row.auditStatus),
      projectScoped: Boolean(row.projectId),
      archived:
        Boolean(row.archivedAt) ||
        Boolean(row.projectId && row.projectStatus !== "active"),
      requireProjectApproval: row.projectId
        ? await isProjectApprovalRequired()
        : false,
    };
    return { ...access, publication };
  } catch {
    // Policy reads must not clear view/edit permissions or local drafts.
    return unavailable();
  }
}
