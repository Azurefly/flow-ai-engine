import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import { recordAuthorizationAudit } from "./iam-service";
import { getP1SystemSettings } from "./p1-service";
import {
  assertWorkflowReviewerSeparation,
  ensureProjectUnitTable,
  getProjectAccess,
  type ProjectUser,
} from "./project-service";

export type WorkflowAuditStatus = "init" | "approved" | "rejected";
export type WorkflowReviewInput = {
  projectId: string;
  workflowId: string;
  expectedDefinitionVersion?: number;
  expectedAuditStatus?: WorkflowAuditStatus;
};

/** A decision applies to the inspected definition and review state, with its audit. */
export async function commitProjectWorkflowReview(
  user: ProjectUser,
  input: WorkflowReviewInput,
  decision: WorkflowAuditStatus
) {
  if (
    !Number.isSafeInteger(input.expectedDefinitionVersion) ||
    Number(input.expectedDefinitionVersion) < 1 ||
    !["init", "approved", "rejected"].includes(input.expectedAuditStatus ?? "")
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "审核缺少读取时的版本与状态，请重新读取流程后确认。",
    });
  if (decision === "init" && input.expectedAuditStatus !== "rejected")
    throw new TRPCError({
      code: "CONFLICT",
      message: "仅可将已驳回的草稿重置为待审核。",
    });
  await ensureProjectUnitTable();
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await getSharedPool().getConnection();
    let retry = false;
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
        (user.tokenVersion !== undefined &&
          Number(actor.tokenVersion) !== user.tokenVersion)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "登录状态已变化，请刷新权限后重试。",
        });
      const access = await getProjectAccess(
        { id: Number(actor.id), role: actor.role },
        input.projectId,
        { connection, lock: true }
      );
      if (!access.exists || !access.permissions.has("project:manage"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前账号无权审核此业务的流程。",
        });
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,ownerUserId,projectId,status,archivedAt,definitionVersion,auditStatus FROM workflow WHERE id=? AND projectId=? FOR UPDATE",
        [input.workflowId, input.projectId]
      );
      const workflow = rows[0];
      if (!workflow || workflow.archivedAt)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "流程不存在、已归档或不属于当前业务。",
        });
      if (workflow.status !== "draft")
        throw new TRPCError({
          code: "CONFLICT",
          message: "流程已发布或状态已变化，请重新读取后确认。",
        });
      const settings = await getP1SystemSettings({ connection, lock: true });
      if (decision !== "init")
        assertWorkflowReviewerSeparation({
          reviewerMode: settings.approval.reviewerMode,
          actorUserId: user.id,
          workflowOwnerUserId: Number(workflow.ownerUserId),
        });
      if (
        Number(workflow.definitionVersion) !== input.expectedDefinitionVersion
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: `流程定义已变化：当前为 v${workflow.definitionVersion}，本次审核基于 v${input.expectedDefinitionVersion}。请重新读取并复核；此次决定未提交。`,
        });
      // A lost acknowledgement can be reconciled without another write or audit.
      if (workflow.auditStatus === decision) {
        await connection.commit();
        return true;
      }
      if (
        workflow.auditStatus !== input.expectedAuditStatus ||
        (decision === "init" && workflow.auditStatus !== "rejected")
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "审核状态已被其他人更新，请重新读取并复核；此次决定未提交。",
        });
      await connection.query(
        "UPDATE workflow SET auditStatus=?,updatedAt=NOW() WHERE id=? AND projectId=?",
        [decision, input.workflowId, input.projectId]
      );
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          action: "user_updated",
          resourceType: "workflow",
          resourceId: input.workflowId,
          details: {
            operation:
              decision === "init" ? "workflow_audit_reset" : "workflow_audited",
            projectId: input.projectId,
            auditStatus: decision,
            previousAuditStatus: workflow.auditStatus,
            definitionVersion: Number(workflow.definitionVersion),
            ...(decision === "init" ? { retainedDefinition: true } : {}),
          },
        },
        connection
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback().catch(() => {});
      const failure = error as { code?: string; errno?: number };
      if (
        (failure.code === "ER_LOCK_DEADLOCK" || failure.errno === 1213) &&
        attempt < 2
      )
        retry = true;
      else if (failure.code === "ER_LOCK_DEADLOCK" || failure.errno === 1213)
        throw new TRPCError({
          code: "CONFLICT",
          message: "审核操作繁忙，请保留当前决定并稍后重试。",
        });
      else throw error;
    } finally {
      connection.release();
    }
    if (retry)
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("审核决定未提交。");
}
