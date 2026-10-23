import { assertWorkflowConfigurationToken } from "./workflow-creation-request";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  ensureIamCatalog,
  getWorkflowAccess,
  type WorkflowPermission,
} from "./iam-service";
import { assertWorkflowRevision } from "./workflow-revision";
import { lockActiveProject } from "./project-lifecycle-lock";

export type WorkflowMutationActor = {
  id: number;
  role: "user" | "admin";
  tokenVersion?: number;
};
export type WorkflowMutationSnapshot = {
  ownerUserId: number;
  projectId?: string | null;
  definitionVersion: number;
  status: "draft" | "published";
  archivedAt?: string | Date | null;
  updatedAt?: string | Date;
};

/** Creation, lifecycle changes and their audit either commit together or roll back together. */
export async function commitWorkflowMutation<T>(
  user: WorkflowMutationActor,
  write: (
    connection: mysql.PoolConnection,
    actor: WorkflowMutationActor
  ) => Promise<T>
): Promise<T> {
  await ensureIamCatalog();
  const { ensureProjectUnitTable } = await import("./project-service");
  await ensureProjectUnitTable();
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await getSharedPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,role,status,tokenVersion FROM users WHERE id=? FOR UPDATE",
        [user.id]
      );
      const current = rows[0];
      if (
        !current ||
        current.status !== "active" ||
        !["user", "admin"].includes(current.role) ||
        (user.tokenVersion !== undefined &&
          Number(current.tokenVersion) !== user.tokenVersion)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "登录状态已变化，请保留填写并重新登录后重试。",
        });
      const result = await write(connection, {
        id: Number(current.id),
        role: current.role,
        tokenVersion: Number(current.tokenVersion),
      });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      const failure = error as { code?: string; errno?: number };
      if (failure.code !== "ER_LOCK_DEADLOCK" && failure.errno !== 1213) {
        if (error instanceof TRPCError) throw error;
        if (failure.code === "ER_DUP_ENTRY")
          throw new TRPCError({
            code: "CONFLICT",
            message: "流程代号已存在，请保留填写并更换代号后重试。",
            cause: error,
          });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "暂时无法确认流程操作结果，请保留填写并重新读取列表核对。",
          cause: error,
        });
      }
      if (attempt === 2)
        throw new TRPCError({
          code: "CONFLICT",
          message: "流程操作繁忙，请保留填写并稍后重试。",
        });
    } finally {
      connection.release();
    }
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("流程操作未完成。");
}

/** Always recheck permissions after waiting for the project and workflow locks. */
export async function lockWorkflowMutation(
  connection: mysql.PoolConnection,
  actor: WorkflowMutationActor,
  workflowId: string,
  snapshot: WorkflowMutationSnapshot,
  permissions: WorkflowPermission[],
  options: {
    allowArchived?: boolean;
    activeProject?: boolean;
    expectedDefinitionVersion?: number;
    expectedConfigurationToken?: string;
  } = {}
) {
  if (snapshot.projectId) {
    if (options.activeProject !== false)
      await lockActiveProject(connection, snapshot.projectId);
    else {
      const [projects] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM flow_project WHERE id=? FOR UPDATE",
        [snapshot.projectId]
      );
      if (!projects[0])
        throw new TRPCError({
          code: "CONFLICT",
          message: "所属业务已不存在，请重新读取流程。",
        });
    }
  }
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow WHERE id=? LIMIT 1 FOR UPDATE",
    [workflowId]
  );
  const workflow = rows[0];
  if (
    !workflow ||
    (!options.allowArchived && workflow.archivedAt) ||
    Number(workflow.ownerUserId) !== Number(snapshot.ownerUserId) ||
    (workflow.projectId ?? null) !== (snapshot.projectId ?? null) ||
    workflow.status !== snapshot.status ||
    String(workflow.archivedAt ?? "") !== String(snapshot.archivedAt ?? "") ||
    (snapshot.updatedAt !== undefined &&
      String(workflow.updatedAt) !== String(snapshot.updatedAt))
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "流程状态或归属已变化，请重新读取后确认；本次操作未提交。",
    });
  assertWorkflowConfigurationToken(options.expectedConfigurationToken,workflow);
  assertWorkflowRevision(
    Number(workflow.definitionVersion),
    options.expectedDefinitionVersion ?? Number(snapshot.definitionVersion)
  );
  assertWorkflowRevision(
    Number(workflow.definitionVersion),
    Number(snapshot.definitionVersion)
  );
  const access = await getWorkflowAccess(actor, workflowId, {
    connection,
    lock: true,
  });
  if (
    !access.exists ||
    !["workflow:view", ...permissions].every(permission =>
      access.permissions.has(permission as WorkflowPermission)
    )
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "流程权限已变化，请保留填写并确认权限后重试。",
    });
  return workflow;
}
