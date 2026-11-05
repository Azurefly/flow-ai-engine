import type mysql from "mysql2/promise";

/** An authoritative cancellation is a normal stop, distinct from lease loss. */
export class DataflowCancelledError extends Error {
  constructor() {
    super("数据流程运行已取消。");
    this.name = "DataflowCancelledError";
  }
}

export async function assertDataflowJobLease(
  connection: mysql.PoolConnection,
  ownership: { id: string; leaseToken: string }
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT status,leaseToken,leaseExpiresAt>NOW() AS leaseValid FROM dataflow_run_job WHERE id=? LIMIT 1 FOR UPDATE",
    [ownership.id]
  );
  const job = rows[0];
  if (job?.status === "cancelled") throw new DataflowCancelledError();
  if (
    !job ||
    job.status !== "leased" ||
    job.leaseToken !== ownership.leaseToken ||
    Number(job.leaseValid) !== 1
  )
    throw new Error("数据流 Job 租约已失效，拒绝提交节点结果。");
}
