import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { assertRoleExpiryRange } from "../shared/role-expiry";
import { recordAuthorizationAudit, validateRoleCode } from "./iam-service";
import {
  commitWorkflowAuthorization,
  type WorkflowAuthorizationActor,
} from "./workflow-authorization-transaction";

export type BuiltinWorkflowRole = "owner" | "editor" | "operator" | "viewer";
function expiry(expiresAt?: Date | null) {
  try {
    assertRoleExpiryRange(expiresAt);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: (error as Error).message,
    });
  }
  if (expiresAt && expiresAt <= new Date())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "临时授权到期时间必须晚于当前时间。",
    });
}
function active(target?: mysql.RowDataPacket) {
  if (target?.status !== "active")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "目标用户不存在或已停用。",
    });
}
export async function grantBuiltinWorkflowRole(
  actor: WorkflowAuthorizationActor,
  input: {
    workflowId: string;
    userId: number;
    role: BuiltinWorkflowRole;
    expiresAt?: Date | null;
  }
) {
  return commitWorkflowAuthorization(
    actor,
    input.workflowId,
    input.userId,
    async ({ connection, target, recheck }) => {
      active(target);
      await connection.query(
        "SELECT id FROM workflow_member WHERE workflowId=? AND userId=? AND role=? FOR UPDATE",
        [input.workflowId, input.userId, input.role]
      );
      await recheck();
      expiry(input.expiresAt);
      await connection.query(
        `INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,expiresAt,revokedAt,grantedByUserId)
      VALUES (?,?,?,?,NOW(),?,NULL,?) ON DUPLICATE KEY UPDATE effectiveFrom=NOW(),expiresAt=VALUES(expiresAt),revokedAt=NULL,grantedByUserId=VALUES(grantedByUserId)`,
        [
          randomUUID(),
          input.workflowId,
          input.userId,
          input.role,
          input.expiresAt ?? null,
          actor.id,
        ]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: actor.id,
          targetUserId: input.userId,
          action: input.expiresAt ? "temporary_role_assigned" : "role_assigned",
          resourceType: "workflow",
          resourceId: input.workflowId,
          details: {
            role: input.role,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
        },
        connection
      );
    }
  );
}
export async function revokeBuiltinWorkflowRole(
  actor: WorkflowAuthorizationActor,
  input: {
    workflowId: string;
    userId: number;
    role: BuiltinWorkflowRole;
  }
) {
  return commitWorkflowAuthorization(
    actor,
    input.workflowId,
    input.userId,
    async ({ connection, workflow, creator, target, recheck }) => {
      const [grants] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,(effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())) AS effective FROM workflow_member WHERE workflowId=? AND userId=? AND role=? AND revokedAt IS NULL FOR UPDATE",
        [input.workflowId, input.userId, input.role]
      );
      if (!grants.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "未找到可撤销的流程成员授权，请重新读取列表。",
        });
      if (input.role === "owner") {
        if (Number(workflow.ownerUserId) === input.userId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "流程必须保留至少一位有效所有者；创建者身份不能通过撤销协作授权移除。",
          });
        if (
          creator?.status !== "active" &&
          target?.status === "active" &&
          grants[0].effective
        ) {
          const [owners] = await connection.query<mysql.RowDataPacket[]>(
            `SELECT wm.id FROM workflow_member wm JOIN users u ON u.id=wm.userId
          WHERE wm.workflowId=? AND wm.role='owner' AND wm.userId<>? AND u.status='active' AND wm.revokedAt IS NULL
          AND wm.effectiveFrom<=NOW() AND (wm.expiresAt IS NULL OR wm.expiresAt>NOW()) FOR UPDATE`,
            [input.workflowId, input.userId]
          );
          if (!owners.length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "流程必须保留至少一位有效所有者，请先为启用中的账号授予所有者。",
            });
        }
      }
      await recheck();
      await connection.query(
        "UPDATE workflow_member SET revokedAt=NOW() WHERE id=?",
        [grants[0].id]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: actor.id,
          targetUserId: input.userId,
          action: "role_revoked",
          resourceType: "workflow",
          resourceId: input.workflowId,
          details: { role: input.role },
        },
        connection
      );
    }
  );
}
export async function grantCustomWorkflowRole(
  actor: WorkflowAuthorizationActor,
  input: {
    workflowId: string;
    userId: number;
    roleCode: string;
    expiresAt?: Date | null;
  }
) {
  let roleCode: string;
  try {
    roleCode = validateRoleCode(input.roleCode);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: (error as Error).message,
    });
  }
  await commitWorkflowAuthorization(
    actor,
    input.workflowId,
    input.userId,
    async ({ connection, target, recheck }) => {
      active(target);
      const [roles] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM iam_role WHERE code=? AND scope='workflow' AND isSystem=0 LIMIT 1 FOR SHARE",
        [roleCode]
      );
      if (!roles.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请选择自定义流程角色，系统角色不能绑定到此流程。",
        });
      const [existing] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id FROM role_assignment WHERE userId=? AND roleId=? AND scopeType='workflow' AND scopeId=?
      AND revokedAt IS NULL AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW()) FOR UPDATE`,
        [input.userId, roles[0].id, input.workflowId]
      );
      if (existing.length)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "该账号已有效绑定此角色，请先读取列表核对；变更有效期需先撤销原绑定。",
        });
      await recheck();
      expiry(input.expiresAt);
      await connection.query(
        "INSERT INTO role_assignment (id,userId,roleId,scopeType,scopeId,effectiveFrom,expiresAt,revokedAt,grantedByUserId) VALUES (?,?,?,'workflow',?,NOW(),?,NULL,?)",
        [
          randomUUID(),
          input.userId,
          roles[0].id,
          input.workflowId,
          input.expiresAt ?? null,
          actor.id,
        ]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: actor.id,
          targetUserId: input.userId,
          action: input.expiresAt ? "temporary_role_assigned" : "role_assigned",
          resourceType: "workflow",
          resourceId: input.workflowId,
          details: {
            roleCode,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
        },
        connection
      );
    }
  );
  return { success: true };
}
export async function revokeCustomWorkflowRole(
  actor: WorkflowAuthorizationActor,
  input: { workflowId: string; assignmentId: string }
) {
  await commitWorkflowAuthorization(
    actor,
    input.workflowId,
    undefined,
    async ({ connection, recheck }) => {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT ra.id,ra.userId,r.code AS roleCode FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId
      WHERE ra.id=? AND ra.scopeType='workflow' AND ra.scopeId=? AND r.scope='workflow' AND r.isSystem=0 AND ra.revokedAt IS NULL FOR UPDATE`,
        [input.assignmentId, input.workflowId]
      );
      if (!rows.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "未找到此流程的有效角色授权，不能撤销其他流程的绑定；请重新读取列表。",
        });
      await recheck();
      await connection.query(
        "UPDATE role_assignment SET revokedAt=NOW() WHERE id=?",
        [input.assignmentId]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: actor.id,
          targetUserId: Number(rows[0].userId),
          action: "role_revoked",
          resourceType: "workflow",
          resourceId: input.workflowId,
          details: {
            assignmentId: input.assignmentId,
            roleCode: rows[0].roleCode,
          },
        },
        connection
      );
    }
  );
  return { success: true };
}
