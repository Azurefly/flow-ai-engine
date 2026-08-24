import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { reconcileWorkflowContinuations, submitWorkflowRun } from "./workflow-engine";
import { drainWorkflowJobs, stopWorkflowWorker } from "./workflow-worker";
import type { Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const workflowId = randomUUID();
const username = `worker_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let userId: number | undefined;

const definition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: { value: "{{input.value}}" } } },
    { id: "map", type: "transform", name: "映射", position: { x: 180, y: 0 }, config: { mappings: { doubled: "{{vars.value}}" } } },
    { id: "end", type: "end", name: "结束", position: { x: 360, y: 0 }, config: { resultTemplate: { value: "{{nodes.map.doubled}}" } } },
  ],
  edges: [
    { id: "start-map", sourceNodeId: "start", targetNodeId: "map" },
    { id: "map-end", sourceNodeId: "map", targetNodeId: "end" },
  ],
};

describe("durable workflow worker", () => {
  afterAll(async () => {
    await stopWorkflowWorker();
    if (!pool) return;
    await pool.query("DELETE FROM workflow_run_alert WHERE workflowId=?", [workflowId]);
    await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?", [workflowId]);
    await pool.query("DELETE FROM workflow_run WHERE workflowId=?", [workflowId]);
    await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
    await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    if (userId) await pool.query("DELETE FROM users WHERE id=?", [userId]);
    await pool.end();
  });

  runIntegration("atomically queues, deduplicates and reclaims an expired lease", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query(
      "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,'admin','active','internal',NOW())",
      [`test:${username}`, username, "Worker 测试用户"]
    );
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT id,role FROM users WHERE username=?", [username]);
    const user = users[0];
    expect(user).toBeTruthy();
    userId = Number(user.id);
    await pool.query(
      "INSERT INTO workflow (id,ownerUserId,name,description,status,definitionVersion,definitionJson) VALUES (?,?,?,'worker integration','published',1,?)",
      [workflowId, user.id, "持久化 Worker 集成测试", JSON.stringify(definition)]
    );
    await pool.query(
      "INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)",
      [randomUUID(), workflowId, user.id, user.id]
    );

    const requestKey = `worker-${randomUUID()}`;
    const first = await submitWorkflowRun({
      workflowId,
      triggeredBy: { id: Number(user.id), role: user.role },
      workflowInput: { value: 7 },
      idempotencyKey: requestKey,
    });
    const duplicate = await submitWorkflowRun({
      workflowId,
      triggeredBy: { id: Number(user.id), role: user.role },
      workflowInput: { value: 7 },
      idempotencyKey: requestKey,
    });
    expect(duplicate.runId).toBe(first.runId);
    expect(duplicate.jobId).toBe(first.jobId);
    expect(duplicate.deduplicated).toBe(true);

    await pool.query(
      "UPDATE workflow_run_job SET status='leased',attempt=1,leaseToken='expired-test',leaseExpiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=?",
      [first.jobId]
    );
    await pool.query(
      "UPDATE workflow_run SET status='running',executionLockToken='expired-test',executionLockExpiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=?",
      [first.runId]
    );

    expect(await drainWorkflowJobs(5)).toBe(1);
    const [runRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT status,finalOutputJson,executionLockToken FROM workflow_run WHERE id=?",
      [first.runId]
    );
    const [jobRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT status,attempt,leaseToken FROM workflow_run_job WHERE id=?",
      [first.jobId]
    );
    expect(runRows[0].status).toBe("success");
    expect(jobRows[0]).toMatchObject({ status: "completed", attempt: 2, leaseToken: null });
    expect(runRows[0].executionLockToken).toBeNull();
  }, 30_000);

  runIntegration("keeps approval continuation reconciliation idempotent when no stranded approval exists", async () => {
    expect(await reconcileWorkflowContinuations()).toBe(0);
    expect(await reconcileWorkflowContinuations()).toBe(0);
  });
});
