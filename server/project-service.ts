import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { hasSystemPermission, recordAuthorizationAudit } from "./iam-service";
import { getP1SystemSettings, type ReviewerMode } from "./p1-service";
import {
  createWorkflow,
  emptyDefinition,
  updateWorkflow,
  validate,
  type Definition,
} from "./workflow-service";

export type ProjectUser = { id: number; role: "user" | "admin" };
export type ProjectMemberRole = "owner" | "designer" | "operator" | "viewer";
export type ProjectPermission =
  | "project:view"
  | "project:manage"
  | "project:workflow:create"
  | "project:workflow:edit"
  | "project:workflow:run";

const id = () => randomBytes(12).toString("base64url");
let pool: mysql.Pool | undefined;
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
};

const rolePermissions: Record<ProjectMemberRole, readonly ProjectPermission[]> =
  {
    owner: [
      "project:view",
      "project:manage",
      "project:workflow:create",
      "project:workflow:edit",
      "project:workflow:run",
    ],
    designer: [
      "project:view",
      "project:workflow:create",
      "project:workflow:edit",
    ],
    operator: ["project:view", "project:workflow:run"],
    viewer: ["project:view"],
  };

export function assertWorkflowReviewerSeparation(input: {
  reviewerMode: ReviewerMode;
  actorUserId: number;
  workflowOwnerUserId: number;
}) {
  if (
    input.reviewerMode === "independent_reviewer" &&
    input.actorUserId === input.workflowOwnerUserId
  )
    throw new Error("独立复核模式下，流程设计所有人不能审核自己的流程。");
}

export async function getProjectAccess(user: ProjectUser, projectId: string) {
  const [projects] = await db().query<mysql.RowDataPacket[]>(
    "SELECT ownerUserId,status FROM flow_project WHERE id=? LIMIT 1",
    [projectId]
  );
  const project = projects[0];
  if (!project || project.status !== "active")
    return {
      exists: false,
      permissions: new Set<ProjectPermission>(),
      roles: [] as ProjectMemberRole[],
    };
  if (user.role === "admin" || Number(project.ownerUserId) === user.id)
    return {
      exists: true,
      permissions: new Set<ProjectPermission>(rolePermissions.owner),
      roles: ["owner"] as ProjectMemberRole[],
    };
  const [members] = await db().query<mysql.RowDataPacket[]>(
    "SELECT role FROM flow_project_member WHERE projectId=? AND userId=? AND revokedAt IS NULL AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())",
    [projectId, user.id]
  );
  const roles = members.map(member => member.role as ProjectMemberRole);
  const permissions = new Set<ProjectPermission>();
  roles.forEach(role =>
    rolePermissions[role]?.forEach(permission => permissions.add(permission))
  );
  return { exists: true, permissions, roles };
}

async function requireProjectPermission(
  user: ProjectUser,
  projectId: string,
  permission: ProjectPermission
) {
  const access = await getProjectAccess(user, projectId);
  if (!access.exists || !access.permissions.has(permission))
    throw new Error("项目不存在或当前账号无权执行此操作。");
  return access;
}

export async function listProjects(user: ProjectUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    user.role === "admin"
      ? `SELECT p.*,owner.username AS ownerUsername,owner.name AS ownerName,d.code AS domainCode,d.name AS domainName,(SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NULL) AS workflowCount
           FROM flow_project p LEFT JOIN users owner ON owner.id=p.ownerUserId LEFT JOIN work_domain d ON d.id=p.domainId
          WHERE p.status='active' ORDER BY p.updatedAt DESC`
      : `SELECT DISTINCT p.*,owner.username AS ownerUsername,owner.name AS ownerName,d.code AS domainCode,d.name AS domainName,(SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NULL) AS workflowCount
           FROM flow_project p LEFT JOIN users owner ON owner.id=p.ownerUserId LEFT JOIN work_domain d ON d.id=p.domainId
           LEFT JOIN flow_project_member pm ON pm.projectId=p.id AND pm.userId=? AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW() AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW())
          WHERE p.status='active' AND (p.ownerUserId=? OR pm.id IS NOT NULL) ORDER BY p.updatedAt DESC`,
    user.role === "admin" ? [] : [user.id, user.id]
  );
  return rows;
}

export async function createProject(
  user: ProjectUser,
  input: {
    code: string;
    name: string;
    description?: string;
    domainId?: string | null;
  }
) {
  if (!(await hasSystemPermission(user, "workflow:create")))
    throw new Error("当前账号没有创建项目的权限。");
  const projectId = id();
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(code))
    throw new Error(
      "项目代号须以字母开头，且仅包含大写字母、数字、下划线或连字符。"
    );
  if (!name) throw new Error("项目名称不能为空。");
  if (input.domainId) {
    const [domains] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM work_domain WHERE id=? AND status='active' LIMIT 1",
      [input.domainId]
    );
    if (!domains[0]) throw new Error("所选工作域不存在或已停用。");
  }
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO flow_project (id,ownerUserId,domainId,code,name,description,status) VALUES (?,?,?,?,?,?,'active')",
      [
        projectId,
        user.id,
        input.domainId ?? null,
        code,
        name,
        input.description?.trim() || null,
      ]
    );
    await connection.query(
      "INSERT INTO flow_project_member (id,projectId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)",
      [id(), projectId, user.id, user.id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "flow_project",
    resourceId: projectId,
    details: {
      operation: "project_created",
      code,
      domainId: input.domainId ?? null,
    },
  });
  return projectId;
}

export async function listProjectWorkflows(
  user: ProjectUser,
  projectId: string,
  filters?: {
    flowType?: "state" | "control" | "data";
    auditStatus?: "init" | "approved" | "rejected";
    status?: "draft" | "published";
    keyword?: string;
  }
) {
  await requireProjectPermission(user, projectId, "project:view");
  const clauses = ["w.projectId=?", "w.archivedAt IS NULL"];
  const params: unknown[] = [projectId];
  if (filters?.flowType) {
    clauses.push("w.flowType=?");
    params.push(filters.flowType);
  }
  if (filters?.auditStatus) {
    clauses.push("w.auditStatus=?");
    params.push(filters.auditStatus);
  }
  if (filters?.status) {
    clauses.push("w.status=?");
    params.push(filters.status);
  }
  if (filters?.keyword?.trim()) {
    clauses.push("(w.name LIKE ? OR w.description LIKE ?)");
    params.push(`%${filters.keyword.trim()}%`, `%${filters.keyword.trim()}%`);
  }
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT w.*,u.username AS creatorUsername,u.name AS creatorName,(SELECT COUNT(*) FROM workflow_run wr WHERE wr.workflowId=w.id) AS runCount
       FROM workflow w LEFT JOIN users u ON u.id=w.ownerUserId
      WHERE ${clauses.join(" AND ")} ORDER BY w.updatedAt DESC`,
    params
  );
  return rows.map(row => ({
    ...row,
    definition:
      typeof row.definitionJson === "string"
        ? JSON.parse(row.definitionJson)
        : row.definitionJson,
  }));
}

export async function createProjectWorkflow(
  user: ProjectUser,
  input: {
    projectId: string;
    processCode?: string;
    name: string;
    description?: string;
    flowType: "state" | "control" | "data";
    creationSource?: "manual" | "warehouse";
    dataSourceId?: string | null;
    folderId?: string | null;
    definition?: unknown;
  }
) {
  await requireProjectPermission(
    user,
    input.projectId,
    "project:workflow:create"
  );
  const creationSource = input.creationSource ?? "manual";
  if (creationSource === "warehouse" && input.flowType === "data")
    throw new Error(
      "数据流程不支持从流程仓库导入，请在数据资源中心独立设计和运行。"
    );
  const processCode = (
    input.processCode?.trim() ||
    `${creationSource === "warehouse" ? "IMP" : "MAN"}_${id().slice(0, 10).toUpperCase()}`
  ).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(processCode))
    throw new Error(
      "流程代号须以字母开头，且仅包含大写字母、数字、下划线或连字符。"
    );
  const [existingCodes] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM workflow WHERE projectId=? AND processCode=? LIMIT 1",
    [input.projectId, processCode]
  );
  if (existingCodes[0]) throw new Error("当前业务下已存在相同流程代号。");
  if (input.dataSourceId && input.flowType !== "data")
    throw new Error("仅数据流程可以关联项目数据源。");
  if (input.dataSourceId) {
    const [sources] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM data_source WHERE id=? AND projectId=? AND status<>'disabled' LIMIT 1",
      [input.dataSourceId, input.projectId]
    );
    if (!sources[0])
      throw new Error("所选数据源不存在、不属于当前业务或已停用。");
  }
  if (input.folderId) {
    const [folders] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_folder WHERE id=? AND projectId=? LIMIT 1",
      [input.folderId, input.projectId]
    );
    if (!folders[0]) throw new Error("目标仓库目录不存在或不属于当前项目。");
  }
  const workflow = await createWorkflow(user, input.name, input.description, {
    projectId: input.projectId,
    folderId: input.folderId ?? null,
    processCode,
    flowType: input.flowType,
    creationSource,
    dataSourceId: input.dataSourceId ?? null,
    auditStatus: "init",
    projectCreationAuthorized: true,
  });
  if (input.definition && workflow)
    await updateWorkflow((workflow as any).id, user, {
      definition: validate(input.definition, {
        flowType: input.flowType,
        executable: false,
      }),
    });
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: String((workflow as any)?.id ?? ""),
    details: {
      operation: "project_workflow_created",
      projectId: input.projectId,
      processCode,
      flowType: input.flowType,
      creationSource,
      dataSourceId: input.dataSourceId ?? null,
    },
  });
  return workflow;
}

export async function updateProjectWorkflowInfo(
  user: ProjectUser,
  input: {
    projectId: string;
    workflowId: string;
    name: string;
    description?: string | null;
  }
) {
  await requireProjectPermission(
    user,
    input.projectId,
    "project:workflow:edit"
  );
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  if (!name) throw new Error("流程名称不能为空。");
  const [existing] = await db().query<mysql.RowDataPacket[]>(
    "SELECT name,description FROM workflow WHERE id=? AND projectId=? AND archivedAt IS NULL LIMIT 1",
    [input.workflowId, input.projectId]
  );
  if (!existing[0]) throw new Error("项目流程不存在、已归档或不属于当前项目。");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow SET name=?,description=?,updatedAt=NOW() WHERE id=? AND projectId=? AND archivedAt IS NULL",
    [name, description, input.workflowId, input.projectId]
  );
  if (!result.affectedRows) throw new Error("项目流程基本信息更新失败。");
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: input.workflowId,
    details: {
      operation: "project_workflow_info_updated",
      projectId: input.projectId,
      fields: {
        nameChanged: existing[0].name !== name,
        descriptionChanged: (existing[0].description ?? null) !== description,
      },
    },
  });
  return true;
}

export async function setProjectWorkflowAudit(
  user: ProjectUser,
  input: {
    projectId: string;
    workflowId: string;
    auditStatus: "approved" | "rejected";
  }
) {
  await requireProjectPermission(user, input.projectId, "project:manage");
  const [workflowRows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT ownerUserId,status FROM workflow WHERE id=? AND projectId=? AND archivedAt IS NULL LIMIT 1",
    [input.workflowId, input.projectId]
  );
  const workflow = workflowRows[0];
  if (!workflow) throw new Error("项目流程不存在、已归档或不属于当前项目。");
  if (String(workflow.status) !== "draft")
    throw new Error("仅可审核当前未发布的流程草稿。");
  const settings = await getP1SystemSettings();
  assertWorkflowReviewerSeparation({
    reviewerMode: settings.approval.reviewerMode,
    actorUserId: user.id,
    workflowOwnerUserId: Number(workflow.ownerUserId),
  });
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow SET auditStatus=?,updatedAt=NOW() WHERE id=? AND projectId=? AND archivedAt IS NULL",
    [input.auditStatus, input.workflowId, input.projectId]
  );
  if (!result.affectedRows)
    throw new Error("项目流程不存在、已归档或不属于当前项目。");
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: input.workflowId,
    details: {
      operation: "workflow_audited",
      projectId: input.projectId,
      auditStatus: input.auditStatus,
    },
  });
  return true;
}

/** Restore a rejected draft to the review queue without publishing or changing its definition. */
export async function resetProjectWorkflowAudit(
  user: ProjectUser,
  input: { projectId: string; workflowId: string }
) {
  await requireProjectPermission(user, input.projectId, "project:manage");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow SET auditStatus='init',updatedAt=NOW() WHERE id=? AND projectId=? AND archivedAt IS NULL AND status='draft' AND auditStatus='rejected'",
    [input.workflowId, input.projectId]
  );
  if (!result.affectedRows)
    throw new Error("仅可重置当前项目中未发布且已驳回的流程。");
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: input.workflowId,
    details: {
      operation: "workflow_audit_reset",
      projectId: input.projectId,
      auditStatus: "init",
      retainedDefinition: true,
    },
  });
  return true;
}

export async function listProjectWorkflowAudit(
  user: ProjectUser,
  input: { projectId: string; workflowId: string }
) {
  await requireProjectPermission(user, input.projectId, "project:view");
  const [workflows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM workflow WHERE id=? AND projectId=? AND archivedAt IS NULL LIMIT 1",
    [input.workflowId, input.projectId]
  );
  if (!workflows[0]) throw new Error("项目流程不存在或不属于当前业务。");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT a.id,a.action,a.detailsJson,a.createdAt,u.username AS actorUsername,u.name AS actorName
       FROM authorization_audit_log a LEFT JOIN users u ON u.id=a.actorUserId
      WHERE a.resourceType='workflow' AND a.resourceId=?
      ORDER BY a.createdAt DESC LIMIT 100`,
    [input.workflowId]
  );
  return rows
    .map(row => {
      const details =
        typeof row.detailsJson === "string"
          ? JSON.parse(row.detailsJson)
          : (row.detailsJson ?? {});
      return { ...row, details, operation: details.operation ?? "" };
    })
    .filter(row =>
      ["workflow_audited", "workflow_audit_reset"].includes(
        String(row.operation)
      )
    );
}

export async function listProjectMembers(user: ProjectUser, projectId: string) {
  await requireProjectPermission(user, projectId, "project:view");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT pm.*,u.username,u.name,u.email FROM flow_project_member pm JOIN users u ON u.id=pm.userId WHERE pm.projectId=? ORDER BY pm.role,pm.createdAt`,
    [projectId]
  );
  return rows;
}

export async function grantProjectMember(
  user: ProjectUser,
  input: {
    projectId: string;
    userId: number;
    role: ProjectMemberRole;
    expiresAt?: Date | null;
  }
) {
  await requireProjectPermission(user, input.projectId, "project:manage");
  if (input.expiresAt && input.expiresAt <= new Date())
    throw new Error("临时项目角色到期时间必须晚于当前时间。");
  const [accounts] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM users WHERE id=? AND status='active' LIMIT 1",
    [input.userId]
  );
  if (!accounts[0]) throw new Error("目标用户不存在或已停用。");
  await db().query(
    `INSERT INTO flow_project_member (id,projectId,userId,role,effectiveFrom,expiresAt,revokedAt,grantedByUserId)
     VALUES (?,?,?, ?,NOW(),?,NULL,?) ON DUPLICATE KEY UPDATE effectiveFrom=NOW(),expiresAt=VALUES(expiresAt),revokedAt=NULL,grantedByUserId=VALUES(grantedByUserId)`,
    [
      id(),
      input.projectId,
      input.userId,
      input.role,
      input.expiresAt ?? null,
      user.id,
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    targetUserId: input.userId,
    action: input.expiresAt ? "temporary_role_assigned" : "role_assigned",
    resourceType: "flow_project",
    resourceId: input.projectId,
    details: {
      role: input.role,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  });
  return true;
}

export async function createFolder(
  user: ProjectUser,
  input: {
    projectId: string;
    name: string;
    parentId?: string | null;
    description?: string;
  }
) {
  await requireProjectPermission(
    user,
    input.projectId,
    "project:workflow:edit"
  );
  if (input.parentId) {
    const [parents] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_folder WHERE id=? AND projectId=? LIMIT 1",
      [input.parentId, input.projectId]
    );
    if (!parents[0]) throw new Error("父目录不存在或不属于当前项目。");
  }
  const folderId = id();
  await db().query(
    "INSERT INTO workflow_folder (id,projectId,parentId,name,description,createdByUserId) VALUES (?,?,?,?,?,?)",
    [
      folderId,
      input.projectId,
      input.parentId ?? null,
      input.name.trim(),
      input.description?.trim() || null,
      user.id,
    ]
  );
  return folderId;
}

export async function updateFolder(
  user: ProjectUser,
  input: {
    projectId: string;
    folderId: string;
    name?: string;
    description?: string | null;
  }
) {
  await requireProjectPermission(
    user,
    input.projectId,
    "project:workflow:edit"
  );
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT name,description FROM workflow_folder WHERE id=? AND projectId=? LIMIT 1",
    [input.folderId, input.projectId]
  );
  const folder = rows[0];
  if (!folder) throw new Error("仓库目录不存在或不属于当前项目。");
  await db().query(
    "UPDATE workflow_folder SET name=?,description=?,updatedAt=NOW() WHERE id=? AND projectId=?",
    [
      input.name?.trim() || folder.name,
      input.description === undefined
        ? folder.description
        : input.description?.trim() || null,
      input.folderId,
      input.projectId,
    ]
  );
  return true;
}

export async function deleteFolder(
  user: ProjectUser,
  input: { projectId: string; folderId: string }
) {
  await requireProjectPermission(
    user,
    input.projectId,
    "project:workflow:edit"
  );
  const [[children], [workflows]] = await Promise.all([
    db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_folder WHERE parentId=? LIMIT 1",
      [input.folderId]
    ),
    db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow WHERE folderId=? LIMIT 1",
      [input.folderId]
    ),
  ]);
  if (children.length || workflows.length)
    throw new Error("目录仍包含子目录或流程，请先移动其内容。");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM workflow_folder WHERE id=? AND projectId=?",
    [input.folderId, input.projectId]
  );
  if (!result.affectedRows) throw new Error("仓库目录不存在或不属于当前项目。");
  return true;
}

export async function listWarehouse(user: ProjectUser, projectId: string) {
  await requireProjectPermission(user, projectId, "project:view");
  const [folders] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_folder WHERE projectId=? ORDER BY name",
    [projectId]
  );
  const [workflows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,name,description,flowType,status,auditStatus,folderId,definitionVersion,updatedAt FROM workflow WHERE projectId=? AND archivedAt IS NULL ORDER BY updatedAt DESC",
    [projectId]
  );
  return { folders, workflows };
}

export async function exportProjectWorkflows(
  user: ProjectUser,
  input: { projectId: string; workflowIds: string[] }
) {
  await requireProjectPermission(user, input.projectId, "project:view");
  const ids = Array.from(new Set(input.workflowIds));
  if (!ids.length) throw new Error("请选择至少一个要导出的流程。");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,name,description,flowType,status,auditStatus,folderId,definitionVersion,definitionJson FROM workflow WHERE projectId=? AND archivedAt IS NULL AND id IN (?) ORDER BY updatedAt DESC",
    [input.projectId, ids]
  );
  if (rows.length !== ids.length)
    throw new Error("存在不属于当前项目的流程，无法导出。");
  return rows.map(row => ({
    ...row,
    definition:
      typeof row.definitionJson === "string"
        ? JSON.parse(row.definitionJson)
        : row.definitionJson,
  }));
}

export async function moveProjectWorkflow(
  user: ProjectUser,
  input: { projectId: string; workflowId: string; folderId?: string | null }
) {
  await requireProjectPermission(
    user,
    input.projectId,
    "project:workflow:edit"
  );
  if (input.folderId) {
    const [folders] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_folder WHERE id=? AND projectId=? LIMIT 1",
      [input.folderId, input.projectId]
    );
    if (!folders[0]) throw new Error("目标目录不存在或不属于当前项目。");
  }
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow SET folderId=?,updatedAt=NOW() WHERE id=? AND projectId=? AND archivedAt IS NULL",
    [input.folderId ?? null, input.workflowId, input.projectId]
  );
  if (!result.affectedRows)
    throw new Error("流程不存在、已归档或不属于当前项目。");
  return true;
}

export const emptyProjectFlowDefinition = (
  flowType: "state" | "control" | "data" = "state"
): Definition => validate(emptyDefinition(), { flowType, executable: false });
