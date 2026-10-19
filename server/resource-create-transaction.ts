import { createHash, randomBytes, randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  ensureProjectUnitTable,
  getProjectAccess,
  type ProjectUser,
} from "./project-service";
import { recordAuthorizationAudit } from "./iam-service";
import {
  canonicalResourcePayload,
  resourceRequestKeyPattern,
} from "../shared/resource-creation";

const tables = {
  source: "data_source",
  asset: "data_asset",
  udf: "data_udf",
  tag: "data_tag",
  plugin: "project_plugin",
} as const;
export type CreatableResourceKind = keyof typeof tables;

/** Resource, receipt and audit commit together. Replays always recheck current permissions. */
export async function createProjectResource(
  user: ProjectUser,
  input: {
    projectId: string;
    kind: CreatableResourceKind;
    requestKey?: string;
    payload: unknown;
    auditDetails?: Record<string, unknown>;
    create: (
      connection: mysql.PoolConnection,
      resourceId: string
    ) => Promise<void>;
  }
) {
  const requestKey = input.requestKey ?? randomBytes(24).toString("hex");
  if (
    !resourceRequestKeyPattern.test(requestKey) ||
    !Object.hasOwn(tables, input.kind)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "保存请求标识无效，请重新打开表单。",
    });
  let payloadHash: string;
  try {
    payloadHash = createHash("sha256")
      .update(canonicalResourcePayload(input.payload))
      .digest("hex");
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "保存内容格式无效，请检查填写。",
    });
  }
  const requestKeyHash = createHash("sha256").update(requestKey).digest("hex");
  await ensureProjectUnitTable(); // Never execute DDL on the transaction's connection.
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
      if (!access.exists || !access.permissions.has("project:workflow:edit"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "项目不存在或当前账号无权执行此数据资源操作。",
        });
      const [receipts] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT payloadHash,resourceId FROM resource_creation_request WHERE actorUserId=? AND projectId=? AND resourceKind=? AND requestKeyHash=? FOR UPDATE",
        [user.id, input.projectId, input.kind, requestKeyHash]
      );
      const receipt = receipts[0];
      if (receipt) {
        if (receipt.payloadHash !== payloadHash)
          throw new TRPCError({
            code: "CONFLICT",
            message: "本次保存请求的内容与原请求不一致，请先核对原保存结果。",
          });
        const [resources] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT id FROM ${tables[input.kind]} WHERE id=? AND projectId=? FOR SHARE`,
          [receipt.resourceId, input.projectId]
        );
        if (!resources[0])
          throw new TRPCError({
            code: "CONFLICT",
            message: "上次创建的资源已删除；请放弃此次填写后重新创建。",
          });
        await connection.commit();
        return String(receipt.resourceId);
      }
      const resourceId = randomBytes(12).toString("base64url"),
        receiptId = randomUUID();
      await connection.query(
        "INSERT INTO resource_creation_request (id,actorUserId,projectId,resourceKind,requestKeyHash,payloadHash,resourceId) VALUES (?,?,?,?,?,?,?)",
        [
          receiptId,
          user.id,
          input.projectId,
          input.kind,
          requestKeyHash,
          payloadHash,
          resourceId,
        ]
      );
      await input.create(connection, resourceId);
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          action: "user_updated",
          resourceType: tables[input.kind],
          resourceId,
          details: {
            ...input.auditDetails,
            operation: "created",
            projectId: input.projectId,
            creationRequestId: receiptId,
          },
        },
        connection
      );
      await connection.commit();
      return resourceId;
    } catch (error) {
      await connection.rollback().catch(() => {});
      const failure = error as { code?: string; errno?: number };
      if (failure.code === "ER_LOCK_DEADLOCK" || failure.errno === 1213) {
        if (attempt < 2) retry = true;
        else
          throw new TRPCError({
            code: "CONFLICT",
            message: "资源操作繁忙，请稍后使用同一次填写重试。",
          });
      } else if (failure.code === "ER_DUP_ENTRY" || failure.errno === 1062) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "同名资源或保存请求已存在，请刷新资源列表后核对。",
        });
      } else throw error;
    } finally {
      connection.release();
    }
    if (retry)
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("保存请求未完成。");
}
