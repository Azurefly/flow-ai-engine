import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";

/** Serialize creation and restoration with project archival. */
export async function lockActiveProject(connection: mysql.PoolConnection, projectId: string) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id,status FROM flow_project WHERE id=? FOR UPDATE", [projectId]
  );
  if (!rows[0] || rows[0].status !== "active")
    throw new TRPCError({ code: "CONFLICT", message: "业务已归档或不存在，请先恢复业务后再执行此操作。" });
}
