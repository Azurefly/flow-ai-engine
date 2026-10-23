import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  ensureIamCatalog,
  hasSystemPermission,
  recordAuthorizationAudit,
} from "./iam-service";
import { assertRoleExpiryRange } from "../shared/role-expiry";
import { assertCustomRoleConfigToken } from "./custom-role-configuration";

type Actor = { id: number; tokenVersion?: number };
type Context = {
  connection: mysql.PoolConnection;
  accounts: mysql.RowDataPacket[];
  recheck: () => Promise<void>;
};
async function commitAssignment<T>(
  actor: Actor,
  targetId: number | undefined,
  protectAdmin: boolean,
  write: (context: Context) => Promise<T>
) {
  await ensureIamCatalog();
  for (let attempt = 0; attempt < 3; attempt++) {
    // Resolve administrator ids before acquiring locks; lock current account rows by primary key.
    const [administrators] = protectAdmin
      ? await getSharedPool().query<mysql.RowDataPacket[]>(
          "SELECT id FROM users WHERE role='admin' AND status='active'"
        )
      : [[]];
    const connection = await getSharedPool().getConnection();
    try {
      await connection.beginTransaction();
      const ids = Array.from(
        new Set(
          [
            actor.id,
            targetId,
            ...administrators.map(row => Number(row.id)),
          ].filter((id): id is number => Boolean(id))
        )
      ).sort((a, b) => a - b);
      const [accounts] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,role,status,tokenVersion FROM users WHERE id IN (?) ORDER BY id FOR UPDATE",
        [ids]
      );
      const current = accounts.find(row => Number(row.id) === actor.id);
      if (
        !current ||
        current.status !== "active" ||
        !["admin", "user"].includes(current.role) ||
        (actor.tokenVersion !== undefined &&
          Number(current.tokenVersion) !== actor.tokenVersion)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "登录状态已变化，本次授权未提交；请保留填写并重新登录。",
        });
      const recheck = async () => {
        if (
          !(await hasSystemPermission(
            { id: Number(current.id), role: current.role },
            "iam:manage",
            connection
          ))
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "身份管理权限已变化，本次授权未提交；请保留填写并重新核对权限。",
          });
      };
      await recheck();
      const result = await write({ connection, accounts, recheck });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      const failure = error as { code?: string; errno?: number };
      if (failure?.code !== "ER_LOCK_DEADLOCK" && failure?.errno !== 1213) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "暂时无法确认授权保存结果，请保留填写并重新读取列表核对。",
          cause: error,
        });
      }
      if (attempt === 2)
        throw new TRPCError({
          code: "CONFLICT",
          message: "授权操作繁忙，本次修改未提交；请保留填写并稍后重试。",
          cause: error,
        });
    } finally {
      connection.release();
    }
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("角色授权未提交。");
}

export type RoleAssignmentInput = {
  userId: number;
  roleCode: string;
  scopeType: "system" | "workflow";
  scopeId?: string | null;
  grantedByUserId: number;
  actorTokenVersion?: number;
  expiresAt?: Date | null;
  note?: string | null;
  expectedConfigToken?: string;
};
export async function assignDirectRole(input: RoleAssignmentInput) {
  if (
    (input.scopeType === "system" && input.scopeId) ||
    (input.scopeType === "workflow" && !input.scopeId)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "角色授权范围与资源 ID 不匹配。",
    });
  await commitAssignment(
    { id: input.grantedByUserId, tokenVersion: input.actorTokenVersion },
    input.userId,
    false,
    async ({ connection, accounts, recheck }) => {
      if (
        accounts.find(row => Number(row.id) === input.userId)?.status !==
        "active"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只能为启用中的用户绑定角色。",
        });
      const [roles] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,code,name,description,scope,isSystem FROM iam_role WHERE code=? LIMIT 1 FOR UPDATE",
        [input.roleCode]
      );
      const role = roles[0];
      if (!role || role.scope !== input.scopeType)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "角色不存在或授权范围不匹配。",
        });
      if (input.expectedConfigToken) {
        const [links] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT permissionId FROM role_permission WHERE roleId=? ORDER BY permissionId FOR SHARE",
          [role.id]
        );
        const [permissions] = links.length
          ? await connection.query<mysql.RowDataPacket[]>(
              "SELECT code FROM permission WHERE id IN (?) ORDER BY code FOR SHARE",
              [links.map(row => row.permissionId)]
            )
          : [[]];
        role.permissions = permissions.map(row => row.code);
        assertCustomRoleConfigToken(input.expectedConfigToken, role);
      }
      const [existing] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id FROM role_assignment WHERE userId=? AND roleId=? AND scopeType=? AND scopeId <=> ?
      AND revokedAt IS NULL AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW()) LIMIT 1 FOR UPDATE`,
        [input.userId, role.id, input.scopeType, input.scopeId ?? null]
      );
      if (existing.length)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "用户已拥有此范围下的有效直接角色，请勿重复绑定；请先读取列表核对。",
        });
      await recheck();
      try {
        assertRoleExpiryRange(input.expiresAt);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
      if (input.expiresAt && input.expiresAt <= new Date())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "临时授权到期时间必须晚于当前时间。",
        });
      await connection.query(
        "INSERT INTO role_assignment (id,userId,roleId,scopeType,scopeId,effectiveFrom,expiresAt,revokedAt,grantedByUserId,note) VALUES (?,?,?,?,?,NOW(),?,NULL,?,?)",
        [
          randomUUID(),
          input.userId,
          role.id,
          input.scopeType,
          input.scopeId ?? null,
          input.expiresAt ?? null,
          input.grantedByUserId,
          input.note ?? null,
        ]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: input.grantedByUserId,
          targetUserId: input.userId,
          action: input.expiresAt ? "temporary_role_assigned" : "role_assigned",
          resourceType: input.scopeType,
          resourceId: input.scopeId ?? undefined,
          details: {
            roleCode: input.roleCode,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
        },
        connection
      );
    }
  );
}

export async function revokeDirectRole(input: {
  assignmentId: string;
  revokedByUserId: number;
  actorTokenVersion?: number;
}) {
  await ensureIamCatalog();
  const [hints] = await getSharedPool().query<mysql.RowDataPacket[]>(
    "SELECT ra.userId,ra.roleId,ra.scopeType,r.code FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId WHERE ra.id=? LIMIT 1",
    [input.assignmentId]
  );
  const hint = hints[0];
  await commitAssignment(
    { id: input.revokedByUserId, tokenVersion: input.actorTokenVersion },
    hint ? Number(hint.userId) : undefined,
    hint?.code === "system_admin",
    async ({ connection, accounts, recheck }) => {
      if (!hint)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到可撤销的角色授权，请重新读取列表。",
        });
      await connection.query("SELECT id FROM iam_role WHERE id=? FOR UPDATE", [
        hint.roleId,
      ]);
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,userId,roleId,scopeType,scopeId,(effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())) AS effective FROM role_assignment WHERE id=? AND revokedAt IS NULL FOR UPDATE",
        [input.assignmentId]
      );
      const grant = rows[0];
      if (!grant)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到可撤销的角色授权，请重新读取列表。",
        });
      if (
        Number(grant.userId) !== Number(hint.userId) ||
        Number(grant.roleId) !== Number(hint.roleId) ||
        grant.scopeType !== hint.scopeType
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "授权记录已变化，本次撤销未提交；请重新读取列表。",
        });
      if (
        hint.code === "system_admin" &&
        grant.scopeType === "system" &&
        grant.effective &&
        accounts.find(row => Number(row.id) === Number(grant.userId))
          ?.status === "active" &&
        !accounts.some(row => row.role === "admin" && row.status === "active")
      ) {
        const [others] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT ra.id FROM role_assignment ra JOIN users u ON u.id=ra.userId WHERE ra.roleId=? AND ra.scopeType='system'
        AND ra.id<>? AND u.status='active' AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW()) FOR UPDATE`,
          [grant.roleId, input.assignmentId]
        );
        if (!others.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "系统必须保留至少一位有效系统管理员。",
          });
      }
      await recheck();
      await connection.query(
        "UPDATE role_assignment SET revokedAt=NOW(),revokedByUserId=? WHERE id=?",
        [input.revokedByUserId, input.assignmentId]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: input.revokedByUserId,
          targetUserId: Number(grant.userId),
          action: "role_revoked",
          resourceType: grant.scopeType,
          resourceId: grant.scopeId ?? undefined,
          details: { assignmentId: input.assignmentId, roleCode: hint.code },
        },
        connection
      );
    }
  );
}
