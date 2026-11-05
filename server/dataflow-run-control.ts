import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  getProjectAccess,
  type ProjectUser,
  type ProjectPermission,
} from "./project-service";
import { lockActiveProject } from "./project-lifecycle-lock";

type ControlRun = {
  status: unknown;
  triggeredByUserId: unknown;
  executionSource: unknown;
  admissionPermission?: unknown;
};

function canControlDataflowRun(
  userId: number,
  permissions: ReadonlySet<ProjectPermission>,
  run: ControlRun
) {
  if (permissions.has("project:manage")) return true;
  // New runs retain the permission actually checked at admission. Legacy runs
  // have no mode evidence, so keep their previous conservative scope rule.
  const requiredPermission = run.admissionPermission ??
    (run.executionSource === "draft"
      ? "project:workflow:edit"
      : "project:workflow:run");
  return (
    Number(run.triggeredByUserId) === userId &&
    (requiredPermission === "project:workflow:edit" ||
      requiredPermission === "project:workflow:run") &&
    permissions.has(requiredPermission)
  );
}

/** Advisory capability uses the same scope rule as the locked write path. */
export function canCancelDataflowRun(
  userId: number,
  permissions: ReadonlySet<ProjectPermission>,
  run: ControlRun
) {
  if (!["queued", "running"].includes(String(run.status))) return false;
  return canControlDataflowRun(userId, permissions, run);
}

export async function cancelDataflowRun(
  user: ProjectUser,
  input: { projectId: string; runId: string; reason: string },
  sessionToken: string | undefined
) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请填写取消原因，最多500个字符。",
    });
  if (!sessionToken)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "登录已失效，请重新登录后核对运行状态。",
    });
  const connection = await getSharedPool().getConnection();
  try {
    await connection.beginTransaction();
    const [actors] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,role,status,tokenVersion,name,username FROM users WHERE id=? FOR UPDATE",
      [user.id]
    );
    const actor = actors[0];
    if (
      !actor ||
      actor.status !== "active" ||
      (user.tokenVersion !== undefined &&
        Number(actor.tokenVersion) !== user.tokenVersion)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "账号或登录状态已变化，请重新核对。",
      });
    const [sessions] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM auth_session WHERE userId=? AND tokenHash=? AND revokedAt IS NULL AND expiresAt>NOW() LIMIT 1 FOR UPDATE",
      [user.id, createHash("sha256").update(sessionToken).digest("hex")]
    );
    if (!sessions[0])
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "当前会话已失效，请重新登录后核对运行状态。",
      });
    await lockActiveProject(connection, input.projectId);
    const currentActor = {
      id: user.id,
      role: actor.role === "admin" ? ("admin" as const) : ("user" as const),
    };
    const initialAccess = await getProjectAccess(
      currentActor,
      input.projectId,
      { connection }
    );
    if (!initialAccess.exists || !initialAccess.permissions.has("project:view"))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "当前账号无权控制此业务的运行。",
      });
    // Match the worker's explicit Job -> run lock order. Scope both reads.
    const [jobs] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT j.id,j.status FROM dataflow_run_job j WHERE j.runId=? AND EXISTS (SELECT 1 FROM dataflow_run r WHERE r.id=j.runId AND r.projectId=?) LIMIT 1 FOR UPDATE",
      [input.runId, input.projectId]
    );
    const [runs] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,status,triggeredByUserId,executionSource,cancellationJson,admissionPermission FROM dataflow_run WHERE id=? AND projectId=? LIMIT 1 FOR UPDATE",
      [input.runId, input.projectId]
    );
    const run = runs[0];
    if (!run)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "运行不存在或不属于当前业务。",
      });
    // Time-dependent grants/session expiry must be checked after waiting for job/run locks.
    const access = await getProjectAccess(currentActor, input.projectId, {
      connection,
      lock: true,
    });
    const [currentSessions] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM auth_session WHERE userId=? AND tokenHash=? AND revokedAt IS NULL AND expiresAt>NOW() LIMIT 1 FOR UPDATE",
      [user.id, createHash("sha256").update(sessionToken).digest("hex")]
    );
    if (!currentSessions[0])
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "等待期间登录已失效，请重新登录后核对运行状态。",
      });
    // Recheck authority even for idempotent/finished requests.
    if (
      !access.exists ||
      !access.permissions.has("project:view") ||
      !canControlDataflowRun(user.id, access.permissions, run as ControlRun)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "取消权限已变化，或此运行由其他人发起。",
      });
    if (["success", "failed", "cancelled"].includes(String(run.status))) {
      await connection.commit();
      return {
        runId: input.runId,
        status: String(run.status),
        outcome:
          run.status === "cancelled"
            ? ("already_cancelled" as const)
            : ("already_finished" as const),
      };
    }
    if (
      !["queued", "running"].includes(String(run.status)) ||
      !jobs[0] ||
      !["queued", "leased"].includes(String(jobs[0].status))
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "运行与作业状态不一致，请刷新并核对。",
      });
    const cancellation = {
      actorUserId: user.id,
      actorLabel: String(actor.name || actor.username || user.id),
      cancelledAt: new Date().toISOString(),
      reason,
    };
    await connection.query(
      "UPDATE dataflow_run_job SET status='cancelled',leaseToken=NULL,leaseExpiresAt=NULL,workerId=NULL,finishedAt=NOW() WHERE id=?",
      [jobs[0].id]
    );
    await connection.query(
      "UPDATE dataflow_run SET status='cancelled',cancellationJson=?,finishedAt=NOW(),durationMs=IF(startedAt IS NULL,NULL,LEAST(2147483647,GREATEST(0,TIMESTAMPDIFF(MICROSECOND,startedAt,NOW()) DIV 1000))) WHERE id=? AND projectId=?",
      [JSON.stringify(cancellation), input.runId, input.projectId]
    );
    await connection.query(
      "UPDATE dataflow_node_run SET status='cancelled',finishedAt=NOW(),durationMs=LEAST(2147483647,GREATEST(0,TIMESTAMPDIFF(MICROSECOND,startedAt,NOW()) DIV 1000)) WHERE runId=? AND status='running'",
      [input.runId]
    );
    await connection.query(
      "INSERT INTO authorization_audit_log (id,actorUserId,action,resourceType,resourceId,detailsJson) VALUES (?,?,'user_updated','dataflow_run',?,?)",
      [
        randomUUID(),
        user.id,
        input.runId,
        JSON.stringify({
          operation: "cancelled",
          projectId: input.projectId,
          ...cancellation,
        }),
      ]
    );
    await connection.commit();
    return {
      runId: input.runId,
      status: "cancelled",
      outcome: "cancelled" as const,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
