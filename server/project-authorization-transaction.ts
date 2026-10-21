import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  ensureProjectUnitTable,
  getProjectAccess,
  type ProjectUser,
} from "./project-service";

/** Every project authorization write uses a fresh actor and the same audit transaction. */
export async function commitProjectAuthorization<T>(
  user: ProjectUser,
  projectId: string,
  targetUserId: number | undefined,
  write: (
    connection: mysql.PoolConnection,
    target?: mysql.RowDataPacket
  ) => Promise<T>
): Promise<T> {
  await ensureProjectUnitTable();
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await getSharedPool().getConnection();
    try {
      await connection.beginTransaction();
      const ids = Array.from(
        new Set([user.id, ...(targetUserId ? [targetUserId] : [])])
      ).sort((a, b) => a - b);
      const [accounts] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,role,status,tokenVersion FROM users WHERE id IN (?) ORDER BY id FOR UPDATE",
        [ids]
      );
      const actor = accounts.find(row => Number(row.id) === user.id);
      if (
        !actor ||
        actor.status !== "active" ||
        !["user", "admin"].includes(actor.role) ||
        (user.tokenVersion !== undefined &&
          Number(actor.tokenVersion) !== user.tokenVersion)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "登录状态已变化，本次授权未提交；请保留填写并重新登录后重试。",
        });
      const access = await getProjectAccess(
        { id: Number(actor.id), role: actor.role },
        projectId,
        { connection, lock: true }
      );
      if (!access.exists)
        throw new TRPCError({
          code: "CONFLICT",
          message: "业务已归档或不存在，本次授权未提交；请刷新后确认。",
        });
      if (!access.permissions.has("project:manage"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "业务管理权限已变化，本次授权未提交；请保留填写并确认权限后重试。",
        });
      const result = await write(
        connection,
        accounts.find(row => Number(row.id) === targetUserId)
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      const failure = error as { code?: string; errno?: number };
      if (failure.code !== "ER_LOCK_DEADLOCK" && failure.errno !== 1213)
        throw error;
      if (attempt === 2)
        throw new TRPCError({
          code: "CONFLICT",
          message: "授权操作繁忙，本次修改未提交；请保留填写并稍后重试。",
        });
    } finally {
      connection.release();
    }
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("授权修改未提交。");
}
