import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dataflowSource = readFileSync(
  new URL("./p2-service.ts", import.meta.url),
  "utf8"
);
const workerSource = readFileSync(
  new URL("./workflow-worker.ts", import.meta.url),
  "utf8"
);

describe("durable dataflow worker contract", () => {
  it("creates the run and its root job in the same transaction", () => {
    const runInsert = dataflowSource.indexOf("INSERT INTO dataflow_run (");
    const jobInsert = dataflowSource.indexOf("INSERT INTO dataflow_run_job (");
    const commit = dataflowSource.indexOf(
      "await connection.commit();",
      runInsert
    );
    expect(runInsert).toBeGreaterThanOrEqual(0);
    expect(jobInsert).toBeGreaterThan(runInsert);
    expect(jobInsert).toBeLessThan(commit);
  });

  it("claims queued or expired jobs under a row lock and lease token", () => {
    expect(dataflowSource).toContain("FOR UPDATE SKIP LOCKED");
    expect(dataflowSource).toContain("j.leaseExpiresAt<NOW()");
    expect(dataflowSource).toContain("status='leased',attempt=attempt+1");
    expect(dataflowSource).toContain("DATAFLOW_EXECUTION_PLAN_INVALID");
    expect(dataflowSource).toContain(
      "WHERE id=? AND status='leased' AND leaseToken=?"
    );
  });

  it("records every node attempt with stable run-node and sequence identity", () => {
    expect(dataflowSource).toContain("INSERT INTO dataflow_node_run");
    expect(dataflowSource).toContain(
      "ON DUPLICATE KEY UPDATE status='running',attempt=attempt+1"
    );
    expect(dataflowSource).toContain("SET status='success',outputJson=?");
    expect(dataflowSource).toContain("SET status='failed',errorJson=?");
  });

  it("is polled by the process worker instead of relying on request lifetime", () => {
    expect(workerSource).toContain(
      'import { runDataflowJobOnce } from "./p2-service"'
    );
    expect(workerSource).toContain(
      "const dataflowProcessed = await runDataflowJobOnce()"
    );
  });
});
