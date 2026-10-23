import { createHash, randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import {
  canonicalResourcePayload,
  resourceRequestKeyPattern,
} from "../shared/resource-creation";
import { getWorkflowAccess, hasSystemPermission } from "./iam-service";
import type { WorkflowMutationActor } from "./workflow-mutation-transaction";

export type WorkflowCreationRequest = {
  kind: "global" | "project" | "duplicate";
  keyHash: string;
  payloadHash: string;
};
export function prepareWorkflowCreationRequest(
  key: string | undefined,
  kind: WorkflowCreationRequest["kind"],
  payload: unknown
): WorkflowCreationRequest | undefined {
  if (key === undefined) return undefined;
  if (!resourceRequestKeyPattern.test(key))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "创建请求标识无效，请重新打开表单。",
    });
  try {
    return {
      kind,
      keyHash: createHash("sha256").update(key).digest("hex"),
      payloadHash: createHash("sha256")
        .update(canonicalResourcePayload(payload))
        .digest("hex"),
    };
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "创建内容格式无效，请检查填写。",
    });
  }
}

export async function assertWorkflowCreationAccess(
  connection: mysql.PoolConnection,
  actor: WorkflowMutationActor,
  projectId?: string | null
) {
  if (projectId) {
    const { getProjectAccess } = await import("./project-service");
    const access = await getProjectAccess(actor, projectId, {
      connection,
      lock: true,
    });
    if (!access.exists)
      throw new TRPCError({
        code: "CONFLICT",
        message: "业务已归档或不存在，请重新读取后创建流程。",
      });
    if (!access.permissions.has("project:workflow:create"))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "当前账号没有业务流程创建权限，请保留填写并确认权限。",
      });
  } else if (!(await hasSystemPermission(actor, "workflow:create", connection)))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前账号没有流程创建权限，请保留填写并确认权限。",
    });
}

/** The actor is locked by commitWorkflowMutation; replays still require current authority. */
export async function replayWorkflowCreationRequest(
  connection: mysql.PoolConnection,
  actor: WorkflowMutationActor,
  request?: WorkflowCreationRequest
) {
  if (!request) return null;
  const [receipts] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT requestKind,payloadHash,workflowId,projectId FROM workflow_creation_request WHERE actorUserId=? AND requestKeyHash=? FOR UPDATE",
    [actor.id, request.keyHash]
  );
  const receipt = receipts[0];
  if (!receipt) return null;
  if (
    receipt.requestKind !== request.kind ||
    receipt.payloadHash !== request.payloadHash
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "本次请求内容与上次创建不一致，请先核对原创建结果。",
    });
  await assertWorkflowCreationAccess(connection, actor, receipt.projectId);
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT w.*,p.status AS projectStatus FROM workflow w LEFT JOIN flow_project p ON p.id=w.projectId WHERE w.id=? LIMIT 1 FOR SHARE",
    [receipt.workflowId]
  );
  const workflow = rows[0];
  if (
    !workflow ||
    workflow.archivedAt ||
    (workflow.projectId ?? null) !== (receipt.projectId ?? null)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "上次创建的流程已归档、删除或移动，请核对列表；本次不会再次创建。",
    });
  const access = await getWorkflowAccess(actor, String(workflow.id), {
    connection,
    lock: true,
  });
  if (!access.exists || !access.permissions.has("workflow:view"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前账号无法查看上次创建的流程，请确认访问权限。",
    });
  return workflow;
}

export async function saveWorkflowCreationRequest(
  connection: mysql.PoolConnection,
  actor: WorkflowMutationActor,
  workflowId: string,
  projectId: string | null,
  request?: WorkflowCreationRequest
) {
  if (!request) return undefined;
  const receiptId = randomUUID();
  await connection.query(
    "INSERT INTO workflow_creation_request (id,actorUserId,projectId,requestKind,requestKeyHash,payloadHash,workflowId) VALUES (?,?,?,?,?,?,?)",
    [
      receiptId,
      actor.id,
      projectId,
      request.kind,
      request.keyHash,
      request.payloadHash,
      workflowId,
    ]
  );
  return receiptId;
}

export function workflowConfigurationToken(row: Record<string, unknown>) {
  const fields = [
    "id",
    "name",
    "description",
    "ownerUserId",
    "projectId",
    "folderId",
    "dataSourceId",
    "flowType",
    "definitionVersion",
    "status",
    "archivedAt",
    "updatedAt",
  ];
  return createHash("sha256")
    .update(
      canonicalResourcePayload(
        Object.fromEntries(fields.map(key => [key, row[key] ?? null]))
      )
    )
    .digest("hex");
}
export function assertWorkflowConfigurationToken(
  expected: string | undefined,
  row: Record<string, unknown>
) {
  if (expected !== undefined && expected !== workflowConfigurationToken(row))
    throw new TRPCError({
      code: "CONFLICT",
      message: "流程配置已变化，请读取当前版本并重新确认；本次操作未提交。",
    });
}
