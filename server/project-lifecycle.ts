import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSharedPool } from "./db";
import { recordAuthorizationAudit } from "./iam-service";
import { ensureProjectUnitTable, type ProjectUser } from "./project-service";

export const projectLifecycleInput = z.object({
  projectId: z.string().min(8).max(64),
  status: z.enum(["active", "archived"]),
  expectedVersion: z.number().int().positive().max(2147483646),
  expectedWorkflowCount: z.number().int().min(0).max(100000),
});

export async function changeProjectStatus(actor: ProjectUser, value: z.input<typeof projectLifecycleInput>) {
  const input = projectLifecycleInput.parse(value);
  await ensureProjectUnitTable();
  const connection = await getSharedPool().getConnection();
  try {
    await connection.beginTransaction();
    const [actors] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,role,status FROM users WHERE id=? FOR UPDATE", [actor.id]
    );
    const currentActor = actors[0];
    if (!currentActor || currentActor.status !== "active")
      throw new TRPCError({ code: "FORBIDDEN", message: "当前账号已停用，无法管理业务归档。" });
    const [projects] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,name,code,ownerUserId,status,lifecycleVersion FROM flow_project WHERE id=? FOR UPDATE", [input.projectId]
    );
    const project = projects[0];
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "业务不存在。" });
    let permitted = currentActor.role === "admin" || Number(project.ownerUserId) === actor.id;
    if (!permitted) {
      const [members] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM flow_project_member WHERE projectId=? AND userId=? AND role='owner' AND revokedAt IS NULL AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW()) FOR UPDATE",
        [input.projectId, actor.id]
      );
      const [departments] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT pu.id FROM flow_project_unit pu JOIN organization_membership om ON om.unitId=pu.unitId
          JOIN organization_unit ou ON ou.id=pu.unitId AND ou.status='active'
          WHERE pu.projectId=? AND pu.role='owner' AND om.userId=? FOR UPDATE`, [input.projectId, actor.id]
      );
      permitted = Boolean(members.length || departments.length);
    }
    if (!permitted) throw new TRPCError({ code: "FORBIDDEN", message: "只有业务所有者或管理员可以归档、恢复业务。" });
    const revision = Number(project.lifecycleVersion);
    if (!Number.isInteger(revision) || revision !== input.expectedVersion || revision >= 2147483647 || project.status === input.status)
      throw new TRPCError({ code: "CONFLICT", message: "业务状态已变化，请刷新列表后重新确认。" });
    const [workflows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,archivedAt FROM workflow WHERE projectId=? ORDER BY id FOR UPDATE", [input.projectId]
    );
    const activeIds = workflows.filter(row => !row.archivedAt).map(row => String(row.id));
    if (activeIds.length !== input.expectedWorkflowCount)
      throw new TRPCError({ code: "CONFLICT", message: "业务内的流程数量已变化，请刷新列表后重新确认。" });
    if (input.status === "archived" || activeIds.length > 0) {
      for (const [table, predicate, message] of [
        ["workflow_run", "status IN ('queued','running','waiting','blocked')", "业务仍有未结束的流程实例，请先完成或取消运行。"],
        ["workflow_task", "status IN ('pending','claimed')", "业务仍有待处理或已领取的人工任务，请先完成办理。"],
        ["dataflow_run", "status IN ('queued','running')", "业务仍有排队或运行中的数据流程，请等待运行结束。"],
        ["dataflow_schedule", "status='active'", "业务仍有启用中的数据调度，请先暂停调度。"],
      ]) {
        if (!workflows.length) break;
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT id FROM ${table} WHERE workflowId IN (?) AND ${predicate} LIMIT 1 FOR UPDATE`,
          [workflows.map(row => String(row.id))]
        );
        if (rows.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message });
      }
      if (activeIds.length)
        await connection.query(
          "UPDATE workflow SET archivedAt=NOW(),archivedByUserId=?,status='draft',unpublishedAt=NOW(),updatedAt=NOW() WHERE projectId=? AND archivedAt IS NULL",
          [actor.id, input.projectId]
        );
    }
    await connection.query(
      "UPDATE flow_project SET status=?,lifecycleVersion=lifecycleVersion+1,updatedAt=NOW() WHERE id=? AND lifecycleVersion=?",
      [input.status, input.projectId, revision]
    );
    await recordAuthorizationAudit({ actorUserId: actor.id, action: "user_updated", resourceType: "flow_project", resourceId: input.projectId,
      details: { operation: input.status === "archived" ? "project_archived" : "project_restored", previousStatus: project.status, status: input.status, previousVersion: revision, lifecycleVersion: revision + 1, archivedWorkflowIds: activeIds, recoverable: true },
    }, connection);
    await connection.commit();
    return { id: input.projectId, status: input.status, lifecycleVersion: revision + 1, archivedWorkflows: activeIds.length };
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string })?.code === "ER_LOCK_DEADLOCK")
      throw new TRPCError({ code: "CONFLICT", message: "业务正在被其他操作更新，请刷新列表后重试。" });
    throw error;
  } finally { connection.release(); }
}
