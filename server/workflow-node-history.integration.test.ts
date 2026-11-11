import { expect, it } from "vitest";
import mysql from "mysql2/promise";
import { readWorkflowNodeHistory } from "./workflow-node-history";

it("reads repeated visits with large JSON under a small MySQL sort buffer", async () => {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // Connection-local shadow table: never change application records or indexes.
    await connection.query(`CREATE TEMPORARY TABLE workflow_node_run (
      id varchar(36) PRIMARY KEY, runId varchar(36), createdAt datetime(6),
      sequenceNo int, inputJson json, outputJson json, INDEX(runId,sequenceNo)
    )`);
    await connection.query("SET SESSION sort_buffer_size=32768");
    const largeInput = { evidence: "采购材料".repeat(30000), nested: { complete: true } };
    for (let sequence = 20; sequence >= 1; sequence--) {
      await connection.query(
        "INSERT INTO workflow_node_run VALUES (?,?,?, ?,?,?)",
        [`node-${sequence}`, "run-history", "2026-11-11 08:00:00.000000", sequence,
          JSON.stringify(largeInput), JSON.stringify({ sequence })]
      );
    }
    const rows = await readWorkflowNodeHistory(connection, "run-history");
    expect(rows.map(row => row.sequenceNo)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const row of rows) {
      const input = typeof row.inputJson === "string" ? JSON.parse(row.inputJson) : row.inputJson;
      expect(input).toEqual(largeInput);
    }
  } finally {
    await connection.end();
  }
}, 30000);
