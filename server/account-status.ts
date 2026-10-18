import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  ensureIamCatalog,
  hasSystemPermission,
  recordAuthorizationAudit,
} from "./iam-service";

export type AccountStatusChange = {
  userId: number;
  status: "active" | "disabled";
  actorUserId?: number;
  expectedStatus?: "active" | "disabled";
  expectedVersion?: number;
};

/** Status, revision, session revocation and its audit fact commit together. */
export async function changeAccountStatus(input: AccountStatusChange) {
  await ensureIamCatalog();
  const connection = await getSharedPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,role,status,tokenVersion FROM users WHERE role='admin' OR id IN (?,?) ORDER BY id FOR UPDATE",
      [input.userId, input.actorUserId ?? input.userId]
    );
    const target = rows.find(row => Number(row.id) === input.userId);
    if (!target)
      throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在。" });
    if (input.actorUserId !== undefined) {
      const actor = rows.find(row => Number(row.id) === input.actorUserId);
      if (
        !actor ||
        actor.status !== "active" ||
        !(await hasSystemPermission(
          { id: actor.id, role: actor.role },
          "iam:manage",
          connection
        ))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前账号无权变更人员状态，请刷新后重试。",
        });
      if (input.actorUserId === input.userId && input.status === "disabled")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能停用当前登录账号，请由其他身份管理员操作。",
        });
    }
    const version = Number(target.tokenVersion);
    if (!Number.isSafeInteger(version) || version < 1 || version >= 2147483647)
      throw new Error("账号状态版本无效，无法安全变更。");
    if (
      (input.expectedStatus !== undefined &&
        target.status !== input.expectedStatus) ||
      (input.expectedVersion !== undefined && version !== input.expectedVersion)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "账号状态已变化，请刷新目录后重新确认。",
      });
    if (
      input.status === "disabled" &&
      target.role === "admin" &&
      target.status === "active" &&
      rows.filter(row => row.role === "admin" && row.status === "active")
        .length <= 1
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "必须保留至少一位启用的管理员账号。",
      });
    const changed = target.status !== input.status;
    if (changed) {
      const [updated] = await connection.query<mysql.ResultSetHeader>(
        "UPDATE users SET status=?,tokenVersion=tokenVersion+1 WHERE id=? AND tokenVersion=?",
        [input.status, input.userId, version]
      );
      if (updated.affectedRows !== 1)
        throw new Error("账号状态已变化，未完成本次修改。");
    }
    let revokedSessions = 0;
    if (input.status === "disabled") {
      const [revoked] = await connection.query<mysql.ResultSetHeader>(
        "UPDATE auth_session SET revokedAt=NOW() WHERE userId=? AND revokedAt IS NULL",
        [input.userId]
      );
      revokedSessions = revoked.affectedRows;
    }
    if (changed || revokedSessions)
      await recordAuthorizationAudit(
        {
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          action:
            input.status === "disabled" ? "user_disabled" : "user_updated",
          resourceType: "user",
          resourceId: String(input.userId),
          details: {
            previousStatus: target.status,
            status: input.status,
            previousVersion: version,
            statusVersion: version + Number(changed),
            revokedSessions,
          },
        },
        connection
      );
    await connection.commit();
    return {
      success: true,
      changed,
      status: input.status,
      statusVersion: version + Number(changed),
      revokedSessions,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
