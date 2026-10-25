import { commitProjectWorkflowInfo, type WorkflowInfoInput } from "./project-workflow-info";
import { prepareWorkflowCreationRequest } from "./workflow-creation-request";
import { commitProjectWorkflowReview, type WorkflowReviewInput } from "./project-review-transaction";
import { commitProjectAuthorization } from "./project-authorization-transaction";
import { assertRoleExpiryRange } from "../shared/role-expiry";
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import mysql from "mysql2/promise";
import { z } from "zod";
import { getSharedPool } from "./db";
import { getProjectWorkflowPermissions, hasSystemPermission, recordAuthorizationAudit } from "./iam-service";
import { projectWorkflowActions } from "../shared/project-workflow-actions";
import { attachOrganizationPaths } from "./organization-service";
import { getP1SystemSettings, type ReviewerMode } from "./p1-service";
import {
  createWorkflow,
  emptyDefinition,
  updateWorkflow,
  validate,
  type Definition,
} from "./workflow-service";

export type ProjectUser = { id: number; role: "user" | "admin"; tokenVersion?: number };
export type ProjectMemberRole = "owner" | "designer" | "operator" | "viewer";
export type ProjectPermission =
  | "project:view"
  | "project:manage"
  | "project:workflow:create"
  | "project:workflow:edit"
  | "project:workflow:run";

const id = () => randomBytes(12).toString("base64url");
const db = () => getSharedPool();

export const rolePermissions: Record<ProjectMemberRole, readonly ProjectPermission[]> =
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
    throw new TRPCError({ code: "FORBIDDEN", message: "独立复核模式下，流程设计所有人不能审核自己的流程。" });
}

let projectUnitTableInitialized = false;
export async function ensureProjectUnitTable() {
  if (projectUnitTableInitialized) return;
  await db().query(`
    CREATE TABLE IF NOT EXISTS flow_project_unit (
      id varchar(36) NOT NULL PRIMARY KEY,
      projectId varchar(36) NOT NULL,
      unitId varchar(36) NOT NULL,
      role enum('owner','designer','operator','viewer') NOT NULL DEFAULT 'viewer',
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY flow_project_unit_unique (projectId, unitId),
      INDEX flow_project_unit_project_idx (projectId),
      INDEX flow_project_unit_unit_idx (unitId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `);
  projectUnitTableInitialized = true;
}

export async function getProjectAccess(user: ProjectUser, projectId: string, options?: { includeArchived?: boolean; connection?: mysql.PoolConnection; lock?: boolean }) {
  if (!options?.connection) await ensureProjectUnitTable();
  const executor = options?.connection ?? db();
  const shareLock = options?.lock ? " FOR SHARE" : "";
  const [projects] = await executor.query<mysql.RowDataPacket[]>(
    `SELECT ownerUserId,status FROM flow_project WHERE id=? LIMIT 1${options?.lock ? " FOR UPDATE" : ""}`,
    [projectId]
  );
  const project = projects[0];
  if (!project || (project.status !== "active" && !(options?.includeArchived && project.status === "archived")))
    return {
      exists: false,
      permissions: new Set<ProjectPermission>(),
      roles: [] as ProjectMemberRole[],
    };
  if (user.role === "admin" || Number(project.ownerUserId) === user.id)
    return {
      exists: true,
      permissions: new Set<ProjectPermission>(project.status === "archived" ? ["project:view"] : rolePermissions.owner),
      roles: ["owner"] as ProjectMemberRole[],
    };
  const [members] = await executor.query<mysql.RowDataPacket[]>(
    `SELECT role FROM flow_project_member WHERE projectId=? AND userId=? AND revokedAt IS NULL AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())${shareLock}`,
    [projectId, user.id]
  );
  const [unitRoles] = await executor.query<mysql.RowDataPacket[]>(
    `SELECT ${options?.lock ? "" : "DISTINCT "}pu.role FROM flow_project_unit pu
       JOIN organization_membership om ON om.unitId=pu.unitId
       JOIN organization_unit ou ON ou.id=pu.unitId AND ou.status='active'
      WHERE pu.projectId=? AND om.userId=?${shareLock}`,
    [projectId, user.id]
  );
  const roles = Array.from(
    new Set(
      [...members, ...unitRoles].map(member => member.role as ProjectMemberRole)
    )
  );
  const permissions = new Set<ProjectPermission>();
  roles.forEach(role =>
    rolePermissions[role]?.forEach(permission => permissions.add(permission))
  );
  if (project.status === "archived")
    permissions.forEach(permission => { if (permission !== "project:view") permissions.delete(permission); });
  return { exists: true, permissions, roles };
}

async function requireProjectPermission(
  user: ProjectUser,
  projectId: string,
  permission: ProjectPermission
) {
  const access = await getProjectAccess(user, projectId, {
    includeArchived: permission === "project:view",
  });
  if (!access.exists || !access.permissions.has(permission))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "项目不存在或当前账号无权执行此操作。",
    });
  return access;
}

async function requireDirectoryPermission(
  user: ProjectUser,
  projectId?: string
) {
  if (projectId) {
    const access = await getProjectAccess(user, projectId);
    if (!access.exists || !access.permissions.has("project:manage")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "当前账号无权搜索此项目的成员目录。",
      });
    }
    return;
  }
  if (!(await hasSystemPermission(user, "workflow:create"))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前账号无权搜索项目成员目录。",
    });
  }
}

export async function listProjects(user: ProjectUser) {
  await ensureProjectUnitTable();
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    user.role === "admin"
      ? `SELECT p.*,owner.username AS ownerUsername,owner.name AS ownerName,d.code AS domainCode,d.name AS domainName,(SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NULL) AS workflowCount
           FROM flow_project p LEFT JOIN users owner ON owner.id=p.ownerUserId LEFT JOIN work_domain d ON d.id=p.domainId
          WHERE p.status='active' ORDER BY p.updatedAt DESC`
      : `SELECT DISTINCT p.*,owner.username AS ownerUsername,owner.name AS ownerName,d.code AS domainCode,d.name AS domainName,(SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NULL) AS workflowCount
           FROM flow_project p LEFT JOIN users owner ON owner.id=p.ownerUserId LEFT JOIN work_domain d ON d.id=p.domainId
           LEFT JOIN flow_project_member pm ON pm.projectId=p.id AND pm.userId=? AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW() AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW())
          WHERE p.status='active' AND (
            p.ownerUserId=?
            OR pm.id IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM flow_project_unit pu
              JOIN organization_membership om ON om.unitId=pu.unitId
              JOIN organization_unit ou ON ou.id=pu.unitId AND ou.status='active'
              WHERE pu.projectId=p.id AND om.userId=?
            )
          ) ORDER BY p.updatedAt DESC`,
    user.role === "admin" ? [] : [user.id, user.id, user.id]
  );
  return rows;
}

export const projectPageInput = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  limit: z.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(160).default(""),
  status: z.enum(["active", "archived"]).default("active"),
  createdFrom: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
}).refine(input => !input.createdFrom || !input.createdBefore ||
  Date.parse(input.createdFrom) < Date.parse(input.createdBefore), {
  message: "创建时间范围无效，请调整后重试。",
});

export async function listProjectPage(user: ProjectUser, value: z.input<typeof projectPageInput> = {}) {
  const input = projectPageInput.parse(value);
  await ensureProjectUnitTable();
  const clauses = [input.status === "archived" ? "p.status='archived'" : "p.status='active'"];
  const args: unknown[] = [];
  if (user.role !== "admin") {
    clauses.push(`(p.ownerUserId=? OR EXISTS (
      SELECT 1 FROM flow_project_member pm WHERE pm.projectId=p.id AND pm.userId=?
        AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW()
        AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW())
    ) OR EXISTS (
      SELECT 1 FROM flow_project_unit pu
      JOIN organization_membership om ON om.unitId=pu.unitId
      JOIN organization_unit ou ON ou.id=pu.unitId AND ou.status='active'
      WHERE pu.projectId=p.id AND om.userId=?
    ))`);
    args.push(user.id, user.id, user.id);
  }
  if (input.search) {
    clauses.push(`(LOCATE(?,p.code)>0 OR LOCATE(?,p.name)>0 OR LOCATE(?,COALESCE(p.description,''))>0
      OR EXISTS (SELECT 1 FROM work_domain search_domain WHERE search_domain.id=p.domainId
        AND (LOCATE(?,search_domain.code)>0 OR LOCATE(?,search_domain.name)>0)))`);
    args.push(input.search, input.search, input.search, input.search, input.search);
  }
  if (input.createdFrom) {
    clauses.push("p.createdAt>=?");
    args.push(new Date(input.createdFrom));
  }
  if (input.createdBefore) {
    clauses.push("p.createdAt<?");
    args.push(new Date(input.createdBefore));
  }
  const where = clauses.join(" AND ");
  const [counts] = await db().query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM flow_project p WHERE ${where}`, args
  );
  const total = Number(counts[0]?.total ?? 0);
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.limit)));
  const [items] = await db().query<mysql.RowDataPacket[]>(
    `SELECT p.*,owner.username AS ownerUsername,owner.name AS ownerName,
      d.code AS domainCode,d.name AS domainName,
      (SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NULL) AS workflowCount,
      (SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NOT NULL) AS archivedWorkflowCount,
      ${projectOwnerVisibility(user).sql} AS canManageArchive
      FROM flow_project p LEFT JOIN users owner ON owner.id=p.ownerUserId
      LEFT JOIN work_domain d ON d.id=p.domainId WHERE ${where}
      ORDER BY p.updatedAt DESC,p.id DESC LIMIT ? OFFSET ?`,
    [...projectOwnerVisibility(user).args, ...args, input.limit, (page - 1) * input.limit]
  );
  return { items, total, page, limit: input.limit, hasMore: page * input.limit < total };
}

export function projectOwnerVisibility(user: ProjectUser) {
  return user.role === "admin" ? { sql: "1", args: [] as number[] } : {
    sql: `(p.ownerUserId=? OR EXISTS (SELECT 1 FROM flow_project_member own_member WHERE own_member.projectId=p.id AND own_member.userId=? AND own_member.role='owner' AND own_member.revokedAt IS NULL AND own_member.effectiveFrom<=NOW() AND (own_member.expiresAt IS NULL OR own_member.expiresAt>NOW()))
      OR EXISTS (SELECT 1 FROM flow_project_unit own_unit JOIN organization_membership own_membership ON own_membership.unitId=own_unit.unitId JOIN organization_unit own_department ON own_department.id=own_unit.unitId AND own_department.status='active' WHERE own_unit.projectId=p.id AND own_unit.role='owner' AND own_membership.userId=?))`,
    args: [user.id, user.id, user.id],
  };
}

export async function getProjectLifecycleRecord(user: ProjectUser, projectId: string) {
  await ensureProjectUnitTable();
  const owner = projectOwnerVisibility(user);
  const access = await getProjectAccess(user, projectId, { includeArchived: true });
  if (!access.exists || !access.permissions.has("project:view")) return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT p.*,${owner.sql} AS canManageArchive,
      (SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NULL) AS workflowCount,
      (SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NOT NULL) AS archivedWorkflowCount
      FROM flow_project p WHERE p.id=? LIMIT 1`, [...owner.args, projectId]
  );
  return rows[0] ?? null;
}

export async function getProject(user: ProjectUser, projectId: string) {
  const access = await getProjectAccess(user, projectId);
  if (!access.exists || !access.permissions.has("project:view")) return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT p.*,owner.username AS ownerUsername,owner.name AS ownerName,d.code AS domainCode,d.name AS domainName,(SELECT COUNT(*) FROM workflow w WHERE w.projectId=p.id AND w.archivedAt IS NULL) AS workflowCount
       FROM flow_project p LEFT JOIN users owner ON owner.id=p.ownerUserId LEFT JOIN work_domain d ON d.id=p.domainId
      WHERE p.id=? AND p.status='active' LIMIT 1`,
    [projectId]
  );
  return rows[0] ?? null;
}
export async function existingProjectCodes(user: ProjectUser, codes: string[]) {
  if (!(await hasSystemPermission(user, "workflow:create")))
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号没有创建项目的权限。" });
  const values = z.array(z.string().trim().toUpperCase()).min(1).max(500).parse(codes);
  if (values.some(code => !/^[A-Z][A-Z0-9_-]{1,63}$/.test(code)))
    throw new TRPCError({ code: "BAD_REQUEST", message: "业务代号须以字母开头，且仅包含字母、数字、下划线或连字符，长度为 2–64 个字符。" });
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT code FROM flow_project WHERE ownerUserId=? AND code IN (?)", [user.id, values]
  );
  return rows.map(row => String(row.code));
}
export async function createProject(
  user: ProjectUser,
  input: {
    code: string;
    name: string;
    description?: string;
    domainId?: string | null;
    visibleUserIds?: number[];
    visibleUnitIds?: string[];
  }
) {
  if (!(await hasSystemPermission(user, "workflow:create")))
    throw new Error("当前账号没有创建项目的权限。");
  await ensureProjectUnitTable();
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

    // 授权可见人（若创建人选定）
    if (Array.isArray(input.visibleUserIds)) {
      for (const visibleUid of input.visibleUserIds) {
        const uid = Number(visibleUid);
        if (Number.isInteger(uid) && uid > 0 && uid !== user.id) {
          await connection.query(
            "INSERT IGNORE INTO flow_project_member (id,projectId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'viewer',NOW(),?)",
            [id(), projectId, uid, user.id]
          );
        }
      }
    }

    // 授权可见部门（若创建人选定）
    if (Array.isArray(input.visibleUnitIds)) {
      for (const unitId of input.visibleUnitIds) {
        if (typeof unitId === "string" && unitId.trim()) {
          await connection.query(
            "INSERT IGNORE INTO flow_project_unit (id,projectId,unitId,role,createdAt) VALUES (?,?,?, 'viewer', NOW())",
            [id(), projectId, unitId.trim()]
          );
        }
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string; errno?: number }).code === "ER_DUP_ENTRY" || (error as { errno?: number }).errno === 1062)
      throw new TRPCError({ code: "CONFLICT", message: "业务代号已存在，请更换代号；已归档业务也会保留原代号。" });
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
      visibleUsersCount: input.visibleUserIds?.length ?? 0,
      visibleUnitsCount: input.visibleUnitIds?.length ?? 0,
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
  const access = await requireProjectPermission(
    user,
    projectId,
    "project:view"
  );
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
    clauses.push(
      "(w.name LIKE ? ESCAPE '!' OR w.description LIKE ? ESCAPE '!' OR w.processCode LIKE ? ESCAPE '!' OR w.id LIKE ? ESCAPE '!')"
    );
    const keyword = `%${filters.keyword.trim().replace(/[!%_]/g, "!$&")}%`;
    params.push(keyword, keyword, keyword, keyword);
  }
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT w.*,u.username AS creatorUsername,u.name AS creatorName,ds.name AS dataSourceName,p.status AS projectStatus,(SELECT COUNT(*) FROM workflow_run wr WHERE wr.workflowId=w.id) AS runCount
       FROM workflow w JOIN flow_project p ON p.id=w.projectId LEFT JOIN users u ON u.id=w.ownerUserId LEFT JOIN data_source ds ON ds.id=w.dataSourceId AND ds.projectId=w.projectId
      WHERE ${clauses.join(" AND ")} ORDER BY w.updatedAt DESC`,
    params
  );
  const permissions = await getProjectWorkflowPermissions(user, {
    projectId,
    roles: access.roles,
    workflows: rows.map(row => ({
      id: String(row.id),
      projectId: String(row.projectId),
      ownerUserId: Number(row.ownerUserId),
    })),
  });
  const needsPolicy = rows.length > 0 && (access.permissions.has("project:manage") ||
    rows.some(row => permissions.get(String(row.id))?.has("workflow:publish")));
  let approval: Awaited<ReturnType<typeof getP1SystemSettings>>["approval"] | undefined;
  if (needsPolicy) {
    try { approval = (await getP1SystemSettings()).approval; } catch { /* Preserve view/run access while policy reads fail. */ }
  }
  const reviewerMode = approval?.reviewerMode ?? "independent_reviewer";
  return rows.map(row => ({
    ...row,
    actions: projectWorkflowActions({
      actorId: user.id,
      workflow: {
        status: String(row.status),
        auditStatus: String(row.auditStatus),
        flowType: String(row.flowType),
        ownerUserId: Number(row.ownerUserId),
        projectStatus: String(row.projectStatus),
      },
      projectPermissions: access.permissions,
      workflowPermissions: permissions.get(String(row.id)) ?? new Set(),
      reviewerMode,
      requireProjectApproval: approval ? Boolean(approval.requireProjectApproval) : undefined,
      publicationPolicyReady: !needsPolicy || Boolean(approval),
    }),
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
    requestKey?: string;
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
  if (input.dataSourceId && input.flowType !== "data")
    throw new TRPCError({code:"BAD_REQUEST",message:"仅数据流程可以关联项目数据源。"});
  // Reject an invalid imported/template definition before inserting a draft.
  const definition = input.definition
    ? validate(input.definition, {
        flowType: input.flowType,
        executable: false,
      })
    : undefined;
  return createWorkflow(user, input.name, input.description, {
    projectId: input.projectId,
    folderId: input.folderId ?? null,
    processCode,
    flowType: input.flowType,
    creationSource,
    dataSourceId: input.dataSourceId ?? null,
    auditStatus: "init",
    definition,
    creationRequest: prepareWorkflowCreationRequest(input.requestKey,"project",{...input,requestKey:undefined,processCode:input.processCode?.trim().toUpperCase() || null,creationSource}),
  });
}

export async function updateProjectWorkflowInfo(user: ProjectUser, input: WorkflowInfoInput) {
  return commitProjectWorkflowInfo(user, input);
}

export async function setProjectWorkflowAudit(
  user: ProjectUser,
  input: WorkflowReviewInput & { auditStatus: "approved" | "rejected" }
) {
  return commitProjectWorkflowReview(user, input, input.auditStatus);
}

/** Return a rejected draft to review without changing its definition. */
export async function resetProjectWorkflowAudit(user: ProjectUser, input: WorkflowReviewInput) {
  return commitProjectWorkflowReview(user, input, "init");
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
    `SELECT pm.*,u.username,u.name,(pm.role='owner' AND pm.userId=p.ownerUserId) AS protectedOwner
      FROM flow_project_member pm JOIN users u ON u.id=pm.userId JOIN flow_project p ON p.id=pm.projectId
      WHERE pm.projectId=? AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW()
        AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW()) AND u.status='active'
      ORDER BY pm.role,pm.createdAt`,
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
  assertRoleExpiryRange(input.expiresAt);
  if (input.expiresAt && input.expiresAt <= new Date())
    throw new Error("临时项目角色到期时间必须晚于当前时间。");
  return commitProjectAuthorization(
    user,
    input.projectId,
    input.userId,
    async (connection, target) => {
      if (target?.status !== "active")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "目标用户不存在或已停用，请重新选择。",
        });
      if (input.expiresAt && input.expiresAt <= new Date())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "授权有效期已过，请重新填写。",
        });
      await connection.query(
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
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          targetUserId: input.userId,
          action: input.expiresAt ? "temporary_role_assigned" : "role_assigned",
          resourceType: "flow_project",
          resourceId: input.projectId,
          details: {
            role: input.role,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
        },
        connection
      );
      return true;
    }
  );
}

export async function revokeProjectMember(
  user: ProjectUser,
  input: {
    projectId: string;
    userId: number;
    assignmentId?: string;
  }
) {
  await requireProjectPermission(user, input.projectId, "project:manage");
  return commitProjectAuthorization(
    user,
    input.projectId,
    input.userId,
    async connection => {
      const [projects] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT ownerUserId,status FROM flow_project WHERE id=? FOR UPDATE",
        [input.projectId]
      );
      if (!projects[0] || projects[0].status !== "active")
        throw new TRPCError({
          code: "CONFLICT",
          message: "业务状态已变化，请刷新后重新确认。",
        });
      const params: unknown[] = [input.projectId, input.userId];
      if (input.assignmentId) params.push(input.assignmentId);
      const [assignments] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id,role FROM flow_project_member WHERE projectId=? AND userId=? AND revokedAt IS NULL${input.assignmentId ? " AND id=?" : ""} FOR UPDATE`,
        params
      );
      if (input.assignmentId && assignments.length !== 1)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "成员角色授权不存在或已移除，请刷新列表。",
        });
      if (
        Number(projects[0].ownerUserId) === input.userId &&
        assignments.some(item => item.role === "owner")
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "创建人的所有权不能通过成员授权移除。",
        });
      const [updated] = await connection.query<mysql.ResultSetHeader>(
        `UPDATE flow_project_member SET revokedAt=NOW() WHERE projectId=? AND userId=? AND revokedAt IS NULL${input.assignmentId ? " AND id=?" : ""}`,
        params
      );
      if (updated.affectedRows !== assignments.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "成员授权已变化，请刷新后重试。",
        });
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          targetUserId: input.userId,
          action: "role_revoked",
          resourceType: "flow_project",
          resourceId: input.projectId,
          details: {
            assignmentId: input.assignmentId ?? null,
            roles: assignments.map(item => item.role),
          },
        },
        connection
      );
      return true;
    }
  );
}

export async function listProjectUnits(user: ProjectUser, projectId: string) {
  await ensureProjectUnitTable();
  await requireProjectPermission(user, projectId, "project:view");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT pu.*, ou.code AS unitCode, ou.name AS unitName, ou.status AS unitStatus
       FROM flow_project_unit pu
       JOIN organization_unit ou ON ou.id=pu.unitId
      WHERE pu.projectId=? ORDER BY pu.createdAt`,
    [projectId]
  );
  return rows;
}

export async function grantProjectUnit(
  user: ProjectUser,
  input: {
    projectId: string;
    unitId: string;
    role: ProjectMemberRole;
  }
) {
  await ensureProjectUnitTable();
  await requireProjectPermission(user, input.projectId, "project:manage");
  return commitProjectAuthorization(
    user,
    input.projectId,
    undefined,
    async connection => {
      const [units] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id, name FROM organization_unit WHERE id=? AND status='active' LIMIT 1 FOR SHARE",
        [input.unitId]
      );
      if (!units[0])
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "目标部门不存在或已停用，请重新选择。",
        });
      await connection.query(
        `INSERT INTO flow_project_unit (id, projectId, unitId, role, createdAt)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE role=VALUES(role)`,
        [id(), input.projectId, input.unitId, input.role]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          action: "role_assigned",
          resourceType: "flow_project",
          resourceId: input.projectId,
          details: {
            targetUnitId: input.unitId,
            unitName: units[0].name,
            role: input.role,
          },
        },
        connection
      );
      return true;
    }
  );
}

export async function revokeProjectUnit(
  user: ProjectUser,
  input: {
    projectId: string;
    unitId: string;
  }
) {
  await ensureProjectUnitTable();
  await requireProjectPermission(user, input.projectId, "project:manage");
  return commitProjectAuthorization(
    user,
    input.projectId,
    undefined,
    async connection => {
      const [removed] = await connection.query<mysql.ResultSetHeader>(
        "DELETE FROM flow_project_unit WHERE projectId=? AND unitId=?",
        [input.projectId, input.unitId]
      );
      if (!removed.affectedRows)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "部门授权已移除或不存在，请刷新列表后确认。",
        });
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          action: "role_revoked",
          resourceType: "flow_project",
          resourceId: input.projectId,
          details: {
            targetUnitId: input.unitId,
          },
        },
        connection
      );
      return true;
    }
  );
}

async function loadActiveUnits() {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id, code, name, parentUnitId FROM organization_unit WHERE status='active' ORDER BY sortOrder, code"
  );
  return attachOrganizationPaths(rows);
}

export async function listActiveUnits(user: ProjectUser) {
  await requireDirectoryPermission(user);
  return loadActiveUnits();
}

export async function searchActiveUnits(
  user: ProjectUser,
  input: { query: string; projectId?: string }
) {
  await requireDirectoryPermission(user, input.projectId);
  const query = input.query.trim().toLocaleLowerCase();
  if (!query) throw new Error("请输入部门名称或代号进行搜索。");
  const matches = (await loadActiveUnits()).filter(unit =>
    `${unit.name} ${unit.code} ${unit.displayPath ?? ""} ${unit.pathCode ?? ""}`
      .toLocaleLowerCase()
      .includes(query)
  );
  return { items: matches.slice(0, 50), hasMore: matches.length > 50 };
}

export async function listActiveUsers(user: ProjectUser) {
  await requireDirectoryPermission(user);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id, username, name FROM users WHERE status='active' ORDER BY username LIMIT 500"
  );
  return rows;
}

export async function searchActiveUsers(
  user: ProjectUser,
  input: { query: string; projectId?: string }
) {
  await requireDirectoryPermission(user, input.projectId);
  const query = input.query.trim().toLocaleLowerCase();
  if (!query) throw new Error("请输入姓名或账号进行搜索。");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT id, username, name FROM users
      WHERE status='active'
        AND (LOCATE(?,LOWER(COALESCE(name,'')))>0 OR LOCATE(?,LOWER(username))>0)
      ORDER BY username LIMIT 51`,
    [query, query]
  );
  return { items: rows.slice(0, 50), hasMore: rows.length > 50 };
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
