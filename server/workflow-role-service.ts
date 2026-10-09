import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  assignRole,
  getWorkflowAccess,
  listRoles,
  listPermissionCatalog,
  revokeRoleAssignment,
  validateRoleCode,
} from "./iam-service";
type Actor = { id: number; role: "user" | "admin" };
async function requireManager(actor: Actor, workflowId: string) {
  const access = await getWorkflowAccess(actor, workflowId);
  if (!access.exists || !access.permissions.has("workflow:members:manage"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "无权管理此流程的角色绑定。",
    });
}
export async function listWorkflowCustomRoles(
  actor: Actor,
  workflowId: string
) {
  await requireManager(actor, workflowId);
  const catalog = listPermissionCatalog();
  return (await listRoles("workflow"))
    .filter(role => !Number(role.isSystem))
    .map(role => {
      const codes =
        typeof role.permissions === "string"
          ? JSON.parse(role.permissions)
          : role.permissions;
      return {
        id: Number(role.id),
        code: String(role.code),
        name: String(role.name),
        description: role.description ?? null,
        scope: "workflow" as const,
        isSystem: Number(role.isSystem),
        permissions: codes,
        permissionLabels: catalog
          .filter(
            item =>
              item.workflowAllowed &&
              Array.isArray(codes) &&
              codes.includes(item.code)
          )
          .map(item => item.name),
      };
    });
}
export async function listWorkflowRoleAssignments(
  actor: Actor,
  input: { workflowId: string; page: number; query?: string }
) {
  await requireManager(actor, input.workflowId);
  const search = `%${(input.query ?? "").trim()}%`;
  const where =
    "ra.scopeType='workflow' AND ra.scopeId=? AND r.isSystem=0 AND (u.name LIKE ? OR u.username LIKE ? OR r.name LIKE ? OR r.code LIKE ?)";
  const params = [input.workflowId, search, search, search, search];
  const [count] = await getSharedPool().query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM role_assignment ra JOIN users u ON u.id=ra.userId JOIN iam_role r ON r.id=ra.roleId WHERE ${where}`,
    params
  );
  const [items] = await getSharedPool().query<mysql.RowDataPacket[]>(
    `SELECT ra.id,ra.userId,ra.roleId,ra.effectiveFrom,ra.expiresAt,ra.revokedAt,u.name,u.username,u.status AS userStatus,r.code AS roleCode,r.name AS roleName,
    CASE WHEN ra.revokedAt IS NOT NULL THEN 'revoked' WHEN u.status<>'active' THEN 'disabled' WHEN ra.effectiveFrom>NOW() THEN 'pending' WHEN ra.expiresAt IS NOT NULL AND ra.expiresAt<=NOW() THEN 'expired' ELSE 'active' END AS authorizationStatus
    FROM role_assignment ra JOIN users u ON u.id=ra.userId JOIN iam_role r ON r.id=ra.roleId WHERE ${where} ORDER BY ra.effectiveFrom DESC,ra.id DESC LIMIT 10 OFFSET ?`,
    [...params, input.page * 10]
  );
  return {
    items,
    total: Number(count[0]?.total ?? 0),
    page: input.page,
    pageSize: 10,
  };
}
export async function assignWorkflowCustomRole(
  actor: Actor,
  input: {
    workflowId: string;
    userId: number;
    roleCode: string;
    expiresAt?: Date | null;
  }
) {
  await requireManager(actor, input.workflowId);
  const roleCode = validateRoleCode(input.roleCode);
  const [roles] = await getSharedPool().query<mysql.RowDataPacket[]>(
    "SELECT id FROM iam_role WHERE code=? AND scope='workflow' AND isSystem=0 LIMIT 1",
    [roleCode]
  );
  if (!roles.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请选择自定义流程角色，系统角色不能绑定到此流程。",
    });
  await assignRole({
    userId: input.userId,
    roleCode,
    scopeType: "workflow",
    scopeId: input.workflowId,
    expiresAt: input.expiresAt,
    grantedByUserId: actor.id,
  });
  return { success: true };
}
export async function revokeWorkflowCustomRole(
  actor: Actor,
  input: { workflowId: string; assignmentId: string }
) {
  await requireManager(actor, input.workflowId);
  const [rows] = await getSharedPool().query<mysql.RowDataPacket[]>(
    "SELECT ra.id FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId WHERE ra.id=? AND ra.scopeType='workflow' AND ra.scopeId=? AND r.scope='workflow' AND r.isSystem=0 LIMIT 1",
    [input.assignmentId, input.workflowId]
  );
  if (!rows.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "未找到此流程的角色授权，不能撤销其他流程的绑定。",
    });
  await revokeRoleAssignment({
    assignmentId: input.assignmentId,
    revokedByUserId: actor.id,
  });
  return { success: true };
}
