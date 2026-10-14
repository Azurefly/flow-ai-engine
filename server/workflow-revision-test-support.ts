import { getSharedPool } from "./db";
import type mysql from "mysql2/promise";

/** Read only fixture metadata; permission tests must still call the mutation itself. */
export async function workflowRevisionForTest(id: string) {
  const [rows] = await getSharedPool().query<mysql.RowDataPacket[]>("SELECT definitionVersion FROM workflow WHERE id=?", [id]);
  if (!rows[0]) throw new Error("流程测试对象不存在。");
  return Number(rows[0].definitionVersion);
}
