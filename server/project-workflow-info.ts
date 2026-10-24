import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import { recordAuthorizationAudit } from "./iam-service";
import {
  ensureProjectUnitTable,
  getProjectAccess,
  type ProjectUser,
} from "./project-service";
import { workflowInfoToken } from "./workflow-info-token";

export type WorkflowInfoInput = {
  projectId: string;
  workflowId: string;
  name: string;
  description?: string | null;
  expectedConfigToken?: string;
};

export async function commitProjectWorkflowInfo(
  user: ProjectUser,
  input: WorkflowInfoInput
) {
  if (!/^[a-f0-9]{64}$/.test(input.expectedConfigToken ?? ""))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "缺少基本信息的读取凭据，请先保留填写并刷新页面后重新确认。",
    });
  const name = input.name.trim(),
    description = input.description?.trim() || null;
  if (!name || name.length > 160 || (description?.length ?? 0) > 1200)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请填写1–160字的流程名称，说明不能超过1200字。",
    });
  await ensureProjectUnitTable();
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await getSharedPool().getConnection();
    try {
      await connection.beginTransaction();
      const [actors] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,role,status,tokenVersion FROM users WHERE id=? FOR UPDATE",
        [user.id]
      );
      const actor = actors[0];
      if (
        !actor ||
        actor.status !== "active" ||
        !["user", "admin"].includes(actor.role) ||
        (user.tokenVersion !== undefined &&
          Number(actor.tokenVersion) !== user.tokenVersion)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "登录状态已变化，本次修改未提交；请保留填写并重新登录。",
        });
      const access = await getProjectAccess(
        { id: Number(actor.id), role: actor.role },
        input.projectId,
        { connection, lock: true }
      );
      if (!access.exists || !access.permissions.has("project:workflow:edit"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "业务已归档或编辑权限已变化，本次修改未提交；请保留填写并重新核对权限。",
        });
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,projectId,name,description,archivedAt FROM workflow WHERE id=? AND projectId=? FOR UPDATE",
        [input.workflowId, input.projectId]
      );
      const row = rows[0];
      if (!row || row.archivedAt)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "流程不存在、已归档或不属于当前业务。",
        });
      // Absolute-value reconciliation after a lost acknowledgement never rewrites or audits twice.
      if (row.name === name && (row.description ?? null) === description) {
        await connection.commit();
        return true;
      }
      if (workflowInfoToken(row) !== input.expectedConfigToken)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "流程基本信息已被修改，当前填写已保留；请读取并确认最新名称和说明后再提交。",
        });
      await connection.query(
        "UPDATE workflow SET name=?,description=?,updatedAt=NOW() WHERE id=? AND projectId=?",
        [name, description, input.workflowId, input.projectId]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          action: "user_updated",
          resourceType: "workflow",
          resourceId: input.workflowId,
          details: {
            operation: "project_workflow_info_updated",
            projectId: input.projectId,
            fields: {
              nameChanged: row.name !== name,
              descriptionChanged: (row.description ?? null) !== description,
            },
            previousConfigToken: input.expectedConfigToken,
            configToken: workflowInfoToken({ ...row, name, description }),
          },
        },
        connection
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback().catch(() => {});
      const failure = error as { code?: string; errno?: number };
      if (failure.code === "ER_LOCK_WAIT_TIMEOUT" || failure.errno === 1205)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "基本信息修改等待超时，本次修改未提交；请保留填写并重新读取。",
        });
      if (failure.code !== "ER_LOCK_DEADLOCK" && failure.errno !== 1213)
        throw error;
      if (attempt === 2)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "基本信息正在被其他操作修改，本次修改未提交；请保留填写并稍后重试。",
        });
    } finally {
      connection.release();
    }
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("基本信息修改未提交。");
}
