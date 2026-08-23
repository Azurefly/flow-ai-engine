import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

export const WORKFLOW_PERMISSIONS = ["workflow:create", "workflow:view", "workflow:edit", "workflow:publish", "workflow:run", "workflow:members:manage"] as const;

export const SYSTEM_PERMISSIONS = ["iam:manage"] as const;
export const ALL_PERMISSIONS = [...WORKFLOW_PERMISSIONS, ...SYSTEM_PERMISSIONS] as const;
export type WorkflowPermission = (typeof WORKFLOW_PERMISSIONS)[number];
export type PermissionCode = (typeof ALL_PERMISSIONS)[number];
export type WorkflowMemberRole = "owner" | "editor" | "operator" | "viewer";
type ProjectMemberRole = "owner" | "designer" | "operator" | "viewer";

type CatalogRole = {
  code: string;
  name: string;
  description: string;
  scope: "system" | "workflow";
  permissions: readonly PermissionCode[];
};

const catalogRoles: CatalogRole[] = [
  {
    code: "system_admin",
    name: "系统管理员",
    description: "拥有系统管理和所有流程操作权限。",
    scope: "system",
    permissions: ALL_PERMISSIONS,
  },
  {
    code: "workflow_creator",
    name: "流程创建者",
    description: "可以创建新的流程。",
    scope: "system",
    permissions: ["workflow:create"],
  },
  {
    code: "owner",
    name: "流程所有者",
    description: "拥有指定流程的全部操作权限。",
    scope: "workflow",
    permissions: WORKFLOW_PERMISSIONS,
  },
  {
    code: "editor",
    name: "流程编辑者",
    description: "可以查看并编辑指定流程。",
    scope: "workflow",
    permissions: ["workflow:view", "workflow:edit"],
  },
  {
    code: "operator",
    name: "流程运行者",
    description: "可以查看并运行指定流程。",
    scope: "workflow",
    permissions: ["workflow:view", "workflow:run"],
  },
  {
    code: "viewer",
    name: "流程查看者",
    description: "可以查看指定流程。",
    scope: "workflow",
    permissions: ["workflow:view"],
  },
];

const permissionCatalog: Record<PermissionCode, { name: string; description: string }> = {
  "workflow:create": { name: "创建流程", description: "创建流程定义。" },
  "workflow:view": {
    name: "查看流程",
    description: "查看流程定义和运行状态。",
  },
  "workflow:edit": {
    name: "编辑流程",
    description: "更新流程定义和基本信息。",
  },
  "workflow:publish": {
    name: "发布流程",
    description: "发布可运行的流程版本。",
  },
  "workflow:run": {
    name: "运行流程",
    description: "发起并查看可访问流程的运行。",
  },
  "workflow:members:manage": {
    name: "管理流程成员",
    description: "授予、调整或撤销流程资源级角色。",
  },
  "iam:manage": {
    name: "管理身份与权限",
    description: "管理系统用户、角色和系统级授权。",
  },
};

const memberRolePermissions: Record<WorkflowMemberRole, readonly WorkflowPermission[]> = {
  owner: WORKFLOW_PERMISSIONS,
  editor: ["workflow:view", "workflow:edit"],
  operator: ["workflow:view", "workflow:run"],
  viewer: ["workflow:view"],
};

const projectMemberWorkflowPermissions: Record<ProjectMemberRole, readonly WorkflowPermission[]> = {
  owner: WORKFLOW_PERMISSIONS,
  designer: ["workflow:view", "workflow:edit", "workflow:publish"],
  operator: ["workflow:view", "workflow:run"],
  viewer: ["workflow:view"],
};

let pool: mysql.Pool | undefined;
let catalogInitialization: Promise<void> | undefined;
function db() {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
}

export function isActiveWindow(effectiveFrom: Date, expiresAt: Date | null, revokedAt: Date | null, now = new Date()) {
  return !revokedAt && effectiveFrom <= now && (!expiresAt || expiresAt > now);
}

export async function ensureIamCatalog() {
  if (!catalogInitialization) {
    catalogInitialization = seedIamCatalog().catch(error => {
      catalogInitialization = undefined;
      throw error;
    });
  }
  return catalogInitialization;
}

async function seedIamCatalog() {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const permissionValues = Object.entries(permissionCatalog).map(([code, details]) => [code, details.name, details.description]);
    await connection.query("INSERT INTO permission (code,name,description) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description)", [permissionValues]);
    const roleValues = catalogRoles.map(role => [role.code, role.name, role.description, role.scope, 1]);
    await connection.query("INSERT INTO iam_role (code,name,description,scope,isSystem) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),scope=VALUES(scope),isSystem=1", [roleValues]);

    const [roleRows] = await connection.query<mysql.RowDataPacket[]>("SELECT id,code FROM iam_role WHERE code IN (?)", [catalogRoles.map(role => role.code)]);
    const [permissionRows] = await connection.query<mysql.RowDataPacket[]>("SELECT id,code FROM permission WHERE code IN (?)", [ALL_PERMISSIONS]);
    const roleIds = new Map(roleRows.map(row => [row.code, row.id]));
    const permissionIds = new Map(permissionRows.map(row => [row.code, row.id]));
    const grantValues = catalogRoles.flatMap(role =>
      role.permissions.map(permission => {
        const roleId = roleIds.get(role.code);
        const permissionId = permissionIds.get(permission);
        if (!roleId || !permissionId) throw new Error(`无法初始化角色或权限映射：${role.code}/${permission}`);
        return [roleId, permissionId];
      })
    );
    const stalePermissionClauses: string[] = [];
    const stalePermissionArgs: unknown[] = [];
    for (const role of catalogRoles) {
      stalePermissionClauses.push(`(r.code=? AND p.code NOT IN (${role.permissions.map(() => "?").join(",")}))`);
      stalePermissionArgs.push(role.code, ...role.permissions);
    }
    await connection.query(`DELETE rp FROM role_permission rp JOIN iam_role r ON r.id=rp.roleId JOIN permission p ON p.id=rp.permissionId WHERE ${stalePermissionClauses.join(" OR ")}`, stalePermissionArgs);
    if (grantValues.length) await connection.query("INSERT IGNORE INTO role_permission (roleId,permissionId) VALUES ?", [grantValues]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

type PermissionRow = mysql.RowDataPacket & { code: PermissionCode };

async function assignedPermissions(userId: number, workflowId?: string) {
  const scopeClause = workflowId ? "(ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=?))" : "ra.scopeType='system'";
  const [rows] = await db().query<PermissionRow[]>(
    `SELECT DISTINCT p.code
       FROM (
         SELECT ra.roleId
           FROM role_assignment ra
          WHERE ra.userId=? AND ra.revokedAt IS NULL
            AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
            AND ${scopeClause}
         UNION
         SELECT our.roleId
           FROM organization_membership om
           JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
           JOIN organization_unit_role our ON our.unitId=ou.id
          WHERE om.userId=?
       ) effective_role
       JOIN iam_role r ON r.id=effective_role.roleId
       JOIN role_permission rp ON rp.roleId=r.id
       JOIN permission p ON p.id=rp.permissionId
      WHERE r.code<>'system_admin' OR EXISTS (
        SELECT 1 FROM role_assignment admin_ra
         WHERE admin_ra.userId=? AND admin_ra.roleId=r.id AND admin_ra.scopeType='system'
           AND admin_ra.revokedAt IS NULL AND admin_ra.effectiveFrom<=NOW()
           AND (admin_ra.expiresAt IS NULL OR admin_ra.expiresAt>NOW())
      )`,
    workflowId ? [userId, workflowId, userId, userId] : [userId, userId, userId]
  );
  return new Set(rows.map(row => row.code));
}

export async function hasSystemPermission(user: { id: number; role: "user" | "admin" }, permission: PermissionCode) {
  if (user.role === "admin") return true;
  await ensureIamCatalog();
  return (await assignedPermissions(user.id)).has(permission);
}

export async function getWorkflowAccess(user: { id: number; role: "user" | "admin" }, workflowId: string) {
  await ensureIamCatalog();
  const [workflowRows] = await db().query<mysql.RowDataPacket[]>("SELECT ownerUserId,projectId FROM workflow WHERE id=? LIMIT 1", [workflowId]);
  const workflow = workflowRows[0];
  if (!workflow)
    return {
      exists: false,
      permissions: new Set<WorkflowPermission>(),
      memberRoles: [] as WorkflowMemberRole[],
      projectRoles: [] as ProjectMemberRole[],
    };
  if (user.role === "admin" || workflow.ownerUserId === user.id) {
    return {
      exists: true,
      permissions: new Set<WorkflowPermission>(WORKFLOW_PERMISSIONS),
      memberRoles: ["owner"] as WorkflowMemberRole[],
      projectRoles: [] as ProjectMemberRole[],
    };
  }
  const [memberRows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT role FROM workflow_member
      WHERE workflowId=? AND userId=? AND revokedAt IS NULL
        AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())`,
    [workflowId, user.id]
  );
  const memberRoles = memberRows.map(row => row.role as WorkflowMemberRole);
  const permissions = new Set<WorkflowPermission>();
  memberRoles.forEach(role => memberRolePermissions[role]?.forEach(permission => permissions.add(permission)));
  let projectRoles: ProjectMemberRole[] = [];
  if (workflow.projectId) {
    const [projectMemberRows] = await db().query<mysql.RowDataPacket[]>("SELECT role FROM flow_project_member WHERE projectId=? AND userId=? AND revokedAt IS NULL AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())", [workflow.projectId, user.id]);
    projectRoles = projectMemberRows.map(row => row.role as ProjectMemberRole);
    projectRoles.forEach(role => projectMemberWorkflowPermissions[role]?.forEach(permission => permissions.add(permission)));
  }
  for (const permission of Array.from(await assignedPermissions(user.id, workflowId))) {
    if (WORKFLOW_PERMISSIONS.includes(permission as WorkflowPermission)) permissions.add(permission as WorkflowPermission);
  }
  return { exists: true, permissions, memberRoles, projectRoles };
}

export async function hasWorkflowPermission(user: { id: number; role: "user" | "admin" }, workflowId: string, permission: WorkflowPermission) {
  const access = await getWorkflowAccess(user, workflowId);
  return access.exists && access.permissions.has(permission);
}

export async function recordAuthorizationAudit(input: { actorUserId?: number | null; targetUserId?: number | null; action: "login_success" | "login_failed" | "logout" | "user_created" | "user_updated" | "user_disabled" | "role_assigned" | "role_revoked" | "temporary_role_assigned" | "temporary_role_revoked"; resourceType?: string; resourceId?: string; details?: Record<string, unknown> }) {
  await db().query("INSERT INTO authorization_audit_log (id,actorUserId,targetUserId,action,resourceType,resourceId,detailsJson) VALUES (?,?,?,?,?,?,?)", [randomUUID(), input.actorUserId ?? null, input.targetUserId ?? null, input.action, input.resourceType ?? null, input.resourceId ?? null, input.details ? JSON.stringify(input.details) : null]);
}

export async function grantWorkflowMember(input: { workflowId: string; userId: number; role: WorkflowMemberRole; grantedByUserId: number; expiresAt?: Date | null }) {
  if (input.expiresAt && input.expiresAt <= new Date()) throw new Error("临时授权到期时间必须晚于当前时间。");
  const [userRows] = await db().query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id=? AND status='active' LIMIT 1", [input.userId]);
  if (!userRows[0]) throw new Error("目标用户不存在或已停用。");
  await db().query(
    `INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,expiresAt,revokedAt,grantedByUserId)
     VALUES (?,?,?,?,NOW(),?,NULL,?)
     ON DUPLICATE KEY UPDATE effectiveFrom=NOW(),expiresAt=VALUES(expiresAt),revokedAt=NULL,grantedByUserId=VALUES(grantedByUserId)`,
    [randomUUID(), input.workflowId, input.userId, input.role, input.expiresAt ?? null, input.grantedByUserId]
  );
  await recordAuthorizationAudit({
    actorUserId: input.grantedByUserId,
    targetUserId: input.userId,
    action: input.expiresAt ? "temporary_role_assigned" : "role_assigned",
    resourceType: "workflow",
    resourceId: input.workflowId,
    details: {
      role: input.role,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  });
}

export async function revokeWorkflowMember(input: { workflowId: string; userId: number; role: WorkflowMemberRole; revokedByUserId: number }) {
  if (input.role === "owner") {
    const [owners] = await db().query<mysql.RowDataPacket[]>(
      `SELECT id FROM workflow_member
        WHERE workflowId=? AND role='owner' AND revokedAt IS NULL
          AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())`,
      [input.workflowId]
    );
    if (owners.length <= 1) throw new Error("流程必须保留至少一位有效所有者。");
  }
  const [result] = await db().query<mysql.ResultSetHeader>("UPDATE workflow_member SET revokedAt=NOW() WHERE workflowId=? AND userId=? AND role=? AND revokedAt IS NULL", [input.workflowId, input.userId, input.role]);
  if (!result.affectedRows) throw new Error("未找到可撤销的流程成员授权。");
  await recordAuthorizationAudit({
    actorUserId: input.revokedByUserId,
    targetUserId: input.userId,
    action: "role_revoked",
    resourceType: "workflow",
    resourceId: input.workflowId,
    details: { role: input.role },
  });
}

export async function listWorkflowMembers(workflowId: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT wm.id,wm.workflowId,wm.userId,wm.role,wm.effectiveFrom,wm.expiresAt,wm.revokedAt,wm.grantedByUserId,
            u.username,u.name,u.email
       FROM workflow_member wm JOIN users u ON u.id=wm.userId
      WHERE wm.workflowId=? ORDER BY wm.role,wm.createdAt`,
    [workflowId]
  );
  return rows;
}

export async function listActiveUsersForWorkflowAssignment() {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id,username,name,email FROM users WHERE status='active' ORDER BY COALESCE(name,username),id LIMIT 200");
  return rows;
}

export async function assignRole(input: { userId: number; roleCode: string; scopeType: "system" | "workflow"; scopeId?: string | null; grantedByUserId: number; expiresAt?: Date | null; note?: string | null }) {
  if (input.scopeType === "system" && input.scopeId) throw new Error("系统角色不能绑定资源 ID。");
  if (input.scopeType === "workflow" && !input.scopeId) throw new Error("流程角色必须绑定流程 ID。");
  if (input.expiresAt && input.expiresAt <= new Date()) throw new Error("临时授权到期时间必须晚于当前时间。");
  await ensureIamCatalog();
  const [roleRows] = await db().query<mysql.RowDataPacket[]>("SELECT id,scope FROM iam_role WHERE code=? LIMIT 1", [input.roleCode]);
  const role = roleRows[0];
  if (!role || role.scope !== input.scopeType) throw new Error("角色不存在或授权范围不匹配。");
  await db().query(
    `INSERT INTO role_assignment (id,userId,roleId,scopeType,scopeId,effectiveFrom,expiresAt,revokedAt,grantedByUserId,note)
     VALUES (?,?,?,?,?,NOW(),?,NULL,?,?)`,
    [randomUUID(), input.userId, role.id, input.scopeType, input.scopeId ?? null, input.expiresAt ?? null, input.grantedByUserId, input.note ?? null]
  );
  await recordAuthorizationAudit({
    actorUserId: input.grantedByUserId,
    targetUserId: input.userId,
    action: input.expiresAt ? "temporary_role_assigned" : "role_assigned",
    resourceType: input.scopeType,
    resourceId: input.scopeId ?? undefined,
    details: {
      roleCode: input.roleCode,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  });
}

export function validateRoleCode(code: string) {
  const normalized = code.trim().toLowerCase();
  if (!/^custom_[a-z][a-z0-9_]{2,60}$/.test(normalized)) throw new Error("自定义角色编码必须以 custom_ 开头，且仅包含小写字母、数字或下划线。");
  return normalized;
}

export function validateRolePermissions(scope: "system" | "workflow", permissions: PermissionCode[]) {
  const uniquePermissions = Array.from(new Set(permissions));
  if (!uniquePermissions.length) throw new Error("角色至少需要一项权限。");
  if (uniquePermissions.some(permission => !ALL_PERMISSIONS.includes(permission))) throw new Error("包含未登记的权限编码。");
  if (scope === "workflow" && uniquePermissions.some(permission => !WORKFLOW_PERMISSIONS.includes(permission as WorkflowPermission))) {
    throw new Error("流程角色不能包含系统级权限。");
  }
  return uniquePermissions;
}

async function replaceRolePermissions(connection: mysql.PoolConnection, roleId: number, permissionCodes: PermissionCode[]) {
  const [permissionRows] = await connection.query<mysql.RowDataPacket[]>("SELECT id,code FROM permission WHERE code IN (?)", [permissionCodes]);
  if (permissionRows.length !== permissionCodes.length) throw new Error("角色权限目录不完整，请先初始化 IAM 目录。");
  await connection.query("DELETE FROM role_permission WHERE roleId=?", [roleId]);
  await connection.query("INSERT INTO role_permission (roleId,permissionId) VALUES ?", [permissionRows.map(row => [roleId, row.id])]);
}

export async function createCustomRole(input: { code: string; name: string; description?: string | null; scope: "system" | "workflow"; permissions: PermissionCode[]; actorUserId: number }) {
  const code = validateRoleCode(input.code);
  const permissions = validateRolePermissions(input.scope, input.permissions);
  await ensureIamCatalog();
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query<mysql.ResultSetHeader>("INSERT INTO iam_role (code,name,description,scope,isSystem) VALUES (?,?,?,?,0)", [code, input.name.trim(), input.description?.trim() || null, input.scope]);
    await replaceRolePermissions(connection, result.insertId, permissions);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: input.actorUserId,
    action: "user_updated",
    resourceType: "iam_role",
    resourceId: code,
    details: {
      operation: "custom_role_created",
      scope: input.scope,
      permissions,
    },
  });
}

export async function updateCustomRole(input: { code: string; name?: string; description?: string | null; permissions?: PermissionCode[]; actorUserId: number }) {
  const code = validateRoleCode(input.code);
  await ensureIamCatalog();
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT id,scope,isSystem,name,description FROM iam_role WHERE code=? FOR UPDATE", [code]);
    const role = rows[0];
    if (!role || role.isSystem) throw new Error("找不到可编辑的自定义角色。");
    const permissions = input.permissions ? validateRolePermissions(role.scope, input.permissions) : undefined;
    await connection.query("UPDATE iam_role SET name=?,description=? WHERE id=?", [input.name?.trim() || role.name, input.description === undefined ? role.description : input.description?.trim() || null, role.id]);
    if (permissions) await replaceRolePermissions(connection, role.id, permissions);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: input.actorUserId,
    action: "user_updated",
    resourceType: "iam_role",
    resourceId: code,
    details: { operation: "custom_role_updated" },
  });
}

export async function deleteCustomRole(input: { code: string; actorUserId: number }) {
  const code = validateRoleCode(input.code);
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT id,isSystem FROM iam_role WHERE code=? FOR UPDATE", [code]);
    const role = rows[0];
    if (!role || role.isSystem) throw new Error("找不到可删除的自定义角色。");
    const [assignmentRows] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM role_assignment WHERE roleId=? AND revokedAt IS NULL LIMIT 1", [role.id]);
    if (assignmentRows[0]) throw new Error("该角色仍有有效授权，请先撤销所有授权。");
    await connection.query("DELETE FROM role_assignment WHERE roleId=?", [role.id]);
    await connection.query("DELETE FROM role_permission WHERE roleId=?", [role.id]);
    await connection.query("DELETE FROM iam_role WHERE id=?", [role.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: input.actorUserId,
    action: "user_updated",
    resourceType: "iam_role",
    resourceId: code,
    details: { operation: "custom_role_deleted" },
  });
}

export async function revokeRoleAssignment(input: { assignmentId: string; revokedByUserId: number }) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ra.id,ra.userId,ra.scopeType,ra.scopeId,r.code
         FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId
        WHERE ra.id=? AND ra.revokedAt IS NULL FOR UPDATE`,
      [input.assignmentId]
    );
    const assignment = rows[0];
    if (!assignment) throw new Error("未找到可撤销的角色授权。");
    if (assignment.code === "system_admin" && assignment.scopeType === "system") {
      const [adminRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT ra.id FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId
          WHERE r.code='system_admin' AND ra.scopeType='system' AND ra.revokedAt IS NULL
            AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())`
      );
      if (adminRows.length <= 1) throw new Error("系统必须保留至少一位有效系统管理员。");
    }
    await connection.query("UPDATE role_assignment SET revokedAt=NOW(),revokedByUserId=? WHERE id=?", [input.revokedByUserId, input.assignmentId]);
    await connection.commit();
    await recordAuthorizationAudit({
      actorUserId: input.revokedByUserId,
      targetUserId: assignment.userId,
      action: "role_revoked",
      resourceType: assignment.scopeType,
      resourceId: assignment.scopeId ?? undefined,
      details: { assignmentId: input.assignmentId, roleCode: assignment.code },
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listRoles(scope?: "system" | "workflow") {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT r.id,r.code,r.name,r.description,r.scope,r.isSystem,
            COALESCE(JSON_ARRAYAGG(p.code), JSON_ARRAY()) AS permissions
       FROM iam_role r
       LEFT JOIN role_permission rp ON rp.roleId=r.id
       LEFT JOIN permission p ON p.id=rp.permissionId
      WHERE (? IS NULL OR r.scope=?)
      GROUP BY r.id,r.code,r.name,r.description,r.scope,r.isSystem
      ORDER BY r.scope,r.code`,
    [scope ?? null, scope ?? null]
  );
  return rows;
}

export async function getUserAuthorizationDetails(userId: number) {
  await ensureIamCatalog();
  const [userRows] = await db().query<mysql.RowDataPacket[]>("SELECT id,username,name,email,role,status,lastSignedIn,createdAt FROM users WHERE id=? LIMIT 1", [userId]);
  const user = userRows[0];
  if (!user) throw new Error("未找到该内部账号。");
  const [directRoles] = await db().query<mysql.RowDataPacket[]>(
    `SELECT ra.id AS assignmentId,ra.scopeType,ra.scopeId,ra.effectiveFrom,ra.expiresAt,ra.note,
            r.id AS roleId,r.code AS roleCode,r.name AS roleName,r.description AS roleDescription,r.scope
       FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId
      WHERE ra.userId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW()
        AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
      ORDER BY r.scope,r.name,r.code,ra.scopeId`, [userId]
  );
  const [inheritedRoles] = await db().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT ou.id AS unitId,ou.name AS unitName,r.id AS roleId,r.code AS roleCode,
            r.name AS roleName,r.description AS roleDescription,r.scope
       FROM organization_membership om
       JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
       JOIN organization_unit_role our ON our.unitId=ou.id
       JOIN iam_role r ON r.id=our.roleId
      WHERE om.userId=? ORDER BY ou.name,r.name,r.code`, [userId]
  );
  const [permissionRows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT p.code,p.name,p.description
       FROM (
         SELECT ra.roleId FROM role_assignment ra WHERE ra.userId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
         UNION
         SELECT our.roleId FROM organization_membership om JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active' JOIN organization_unit_role our ON our.unitId=ou.id WHERE om.userId=?
       ) effective_role
       JOIN role_permission rp ON rp.roleId=effective_role.roleId JOIN permission p ON p.id=rp.permissionId ORDER BY p.code`, [userId, userId]
  );
  const effectivePermissions = user.role === "admin"
    ? Array.from(new Map([...permissionRows, ...ALL_PERMISSIONS.map(code => ({ code, name: code, description: "管理员账号内置权限" }))].map(row => [String(row.code), row])).values())
    : permissionRows;
  return { user, directRoles, inheritedRoles, effectivePermissions };
}

export async function getRoleAuthorizationDetails(roleId: number) {
  await ensureIamCatalog();
  const [roleRows] = await db().query<mysql.RowDataPacket[]>("SELECT id,code,name,description,scope,isSystem,createdAt,updatedAt FROM iam_role WHERE id=? LIMIT 1", [roleId]);
  const role = roleRows[0];
  if (!role) throw new Error("未找到该角色。");
  const [permissions] = await db().query<mysql.RowDataPacket[]>("SELECT p.code,p.name,p.description FROM role_permission rp JOIN permission p ON p.id=rp.permissionId WHERE rp.roleId=? ORDER BY p.code", [roleId]);
  const [directUsers] = await db().query<mysql.RowDataPacket[]>(
    `SELECT ra.id AS assignmentId,ra.scopeType,ra.scopeId,ra.effectiveFrom,ra.expiresAt,ra.note,u.id AS userId,u.username,u.name,u.status
       FROM role_assignment ra JOIN users u ON u.id=ra.userId
      WHERE ra.roleId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
      ORDER BY u.name,u.username,ra.scopeType,ra.scopeId`, [roleId]
  );
  const [inheritedUsers] = await db().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT u.id AS userId,u.username,u.name,u.status,ou.id AS unitId,ou.name AS unitName
       FROM organization_unit_role our JOIN organization_unit ou ON ou.id=our.unitId AND ou.status='active'
       JOIN organization_membership om ON om.unitId=ou.id JOIN users u ON u.id=om.userId
      WHERE our.roleId=? ORDER BY ou.name,u.name,u.username`, [roleId]
  );
  const [organizationUnits] = await db().query<mysql.RowDataPacket[]>("SELECT ou.id,ou.code,ou.name,ou.status FROM organization_unit_role our JOIN organization_unit ou ON ou.id=our.unitId WHERE our.roleId=? ORDER BY ou.name,ou.code", [roleId]);
  return { role, permissions, directUsers, inheritedUsers, organizationUnits };
}

export async function listAuthorizationAudit(limit = 100) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT a.*,actor.username AS actorUsername,target.username AS targetUsername
       FROM authorization_audit_log a
       LEFT JOIN users actor ON actor.id=a.actorUserId
       LEFT JOIN users target ON target.id=a.targetUserId
      ORDER BY a.createdAt DESC LIMIT ?`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}
