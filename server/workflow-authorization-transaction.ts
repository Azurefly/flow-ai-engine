import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import { ensureIamCatalog, getWorkflowAccess } from "./iam-service";
import { ensureProjectUnitTable } from "./project-service";
import { lockActiveProject } from "./project-lifecycle-lock";

export type WorkflowAuthorizationActor = {
  id: number;
  role?: "user" | "admin";
  tokenVersion?: number;
};

/** Lock the account, project and workflow before rechecking authority and writing audit. */
export async function commitWorkflowAuthorization<T>(
  actor: WorkflowAuthorizationActor,
  workflowId: string,
  targetUserId: number | undefined,
  write: (context: {
    connection: mysql.PoolConnection;
    target?: mysql.RowDataPacket;
    creator?: mysql.RowDataPacket;
    workflow: mysql.RowDataPacket;
    recheck: () => Promise<void>;
  }) => Promise<T>
): Promise<T> {
  await ensureIamCatalog();
  await ensureProjectUnitTable();
  const [hints] = await getSharedPool().query<mysql.RowDataPacket[]>(
    "SELECT ownerUserId,projectId FROM workflow WHERE id=? LIMIT 1",
    [workflowId]
  );
  const hint = hints[0];
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await getSharedPool().getConnection();
    try {
      await connection.beginTransaction();
      const ids = Array.from(
        new Set(
          [actor.id, targetUserId, Number(hint?.ownerUserId)].filter(
            (id): id is number => Boolean(id)
          )
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
        !["user", "admin"].includes(current.role) ||
        (actor.tokenVersion !== undefined &&
          Number(current.tokenVersion) !== actor.tokenVersion)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "登录状态已变化，本次授权未提交；请保留填写并重新登录。",
        });
      if (hint?.projectId)
        await lockActiveProject(connection, String(hint.projectId));
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT ownerUserId,projectId,archivedAt FROM workflow WHERE id=? LIMIT 1 FOR UPDATE",
        [workflowId]
      );
      const workflow = rows[0];
      if (
        !hint ||
        !workflow ||
        workflow.archivedAt ||
        Number(workflow.ownerUserId) !== Number(hint.ownerUserId) ||
        (workflow.projectId ?? null) !== (hint.projectId ?? null)
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "流程已归档、不存在或所属业务已变化，本次授权未提交；请重新读取。",
        });
      const recheck = async () => {
        const access = await getWorkflowAccess(
          { id: Number(current.id), role: current.role },
          workflowId,
          { connection, lock: true }
        );
        if (
          !access.exists ||
          !access.permissions.has("workflow:members:manage")
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "流程成员管理权限已变化，本次授权未提交；请保留填写并确认权限。",
          });
      };
      await recheck();
      const result = await write({
        connection,
        workflow,
        recheck,
        target: accounts.find(row => Number(row.id) === targetUserId),
        creator: accounts.find(
          row => Number(row.id) === Number(workflow.ownerUserId)
        ),
      });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      const failure = error as { code?: string; errno?: number };
      if (failure.code !== "ER_LOCK_DEADLOCK" && failure.errno !== 1213) {
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
        });
    } finally {
      connection.release();
    }
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("流程授权未提交。");
}
