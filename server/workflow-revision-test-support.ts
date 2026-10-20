import { getSharedPool } from "./db";
import type mysql from "mysql2/promise";

/** Read only fixture metadata; permission tests must still call the mutation itself. */
export async function workflowRevisionForTest(id: string) {
  const [rows] = await getSharedPool().query<mysql.RowDataPacket[]>("SELECT definitionVersion FROM workflow WHERE id=?", [id]);
  if (!rows[0]) throw new Error("流程测试对象不存在。");
  return Number(rows[0].definitionVersion);
}

/** Preserve the actual decision baseline; this does not bypass mutation permissions. */
export async function workflowReviewForTest(id: string) {
  const [rows] = await getSharedPool().query<mysql.RowDataPacket[]>("SELECT definitionVersion,auditStatus FROM workflow WHERE id=?", [id]);
  if (!rows[0]) throw new Error("流程测试对象不存在。");
  return {
    expectedDefinitionVersion: Number(rows[0].definitionVersion),
    expectedAuditStatus: rows[0].auditStatus as "init" | "approved" | "rejected",
  };
}
