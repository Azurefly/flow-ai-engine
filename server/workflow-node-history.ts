import type { Pool, PoolConnection, Connection, RowDataPacket } from "mysql2/promise";

/** Keep large node input/output JSON out of MySQL's filesort buffer. */
export async function readWorkflowNodeHistory(
  database: Pick<Pool | PoolConnection | Connection, "query">,
  runId: string
): Promise<RowDataPacket[]> {
  const [orderedIds] = await database.query<RowDataPacket[]>(
    "SELECT id FROM workflow_node_run WHERE runId=? ORDER BY createdAt ASC,sequenceNo ASC,id ASC",
    [runId]
  );
  if (!orderedIds.length) return [];
  const [rows] = await database.query<RowDataPacket[]>(
    "SELECT * FROM workflow_node_run WHERE runId=?",
    [runId]
  );
  const byId = new Map(rows.map(row => [String(row.id), row]));
  // A worker may append another visit between reads. Include only the ordered
  // snapshot; the next refresh will include new visits without changing order.
  return orderedIds.flatMap(({ id }) => {
    const row = byId.get(String(id));
    return row ? [row] : [];
  });
}
