// Public 1180 acceptance with fault injection restricted to this script's own run.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";
const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
  const payload = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(`${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(payload)}`}`, {
    method: mutation ? "POST" : "GET",
    headers: { "content-type": "application/json", cookie },
    ...(mutation ? { body: payload } : {}),
  });
  const next = response.headers.getSetCookie()[0];
  if (next) cookie = next.split(";", 1)[0];
  const body = await response.json();
  assert(response.ok && !body.error, body.error?.json?.message ?? `HTTP ${response.status}`);
  return superjson.deserialize(body.result.data);
}
async function waitFor(read, accept) {
  for (let i = 0; i < 40; i++) {
    const result = await read();
    if (accept(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("隔离任务状态等待超时");
}
assert(process.env.DATABASE_URL && process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME && process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD);
await request("auth.login", { username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME, password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD }, true);
const source = await request("workflow.get", { id: "wEjEcT-FUPIDrEUx" });
assert.match(source.name, /^并行消息_state_[a-f0-9]{8}$/);
const tag = randomBytes(4).toString("hex");
const name = `租约耗尽隔离测试_${tag}`;
const definition = structuredClone(typeof source.definition === "string" ? JSON.parse(source.definition) : source.definition);
for (const node of definition.nodes.filter(node => node.type === "message_catch")) node.config.correlationKey = `${tag}-${node.id}`;
const flow = await request("project.createWorkflow", { projectId: source.projectId, name, flowType: "state", definition }, true);
const run = await request("workflow.run", { workflowId: flow.id, triggerType: "test", idempotencyKey: `exhausted-${tag}` }, true);
const read = () => request("workflow.runDetail", { runId: run.runId });
const pool = mysql.createPool(process.env.DATABASE_URL);
try {
  await waitFor(read, value => value.status === "waiting" && value.nodeRuns.filter(node => node.status === "waiting").length === 2);
  const job = await waitFor(async () => {
    const [rows] = await pool.query("SELECT id,status FROM workflow_run_job WHERE runId=? ORDER BY createdAt DESC LIMIT 1", [run.runId]);
    return rows[0];
  }, value => value?.status === "completed");
  const connection = await pool.getConnection();
  const token = randomBytes(20).toString("hex");
  try {
    await connection.beginTransaction();
    const [jobs] = await connection.query("SELECT id FROM workflow_run_job WHERE id=? AND runId=? AND status='completed' FOR UPDATE", [job.id, run.runId]);
    assert.equal(jobs.length, 1);
    const [runs] = await connection.query("SELECT r.id,w.name FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE r.id=? AND r.workflowId=? AND r.status='waiting' FOR UPDATE", [run.runId, flow.id]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].name, name);
    await connection.query("UPDATE workflow_run_job SET status='leased',attempt=maxAttempts,leaseToken=?,leaseExpiresAt=DATE_SUB(NOW(),INTERVAL 5 SECOND),finishedAt=NULL WHERE id=? AND runId=?", [token, job.id, run.runId]);
    await connection.query("UPDATE workflow_run SET executionLockToken=?,executionLockExpiresAt=DATE_SUB(NOW(),INTERVAL 5 SECOND) WHERE id=? AND workflowId=?", [token, run.runId, flow.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  const finished = await waitFor(read, value => value.status === "failed");
  const [jobs] = await pool.query("SELECT status,leaseToken,leaseExpiresAt,finishedAt FROM workflow_run_job WHERE id=? AND runId=?", [job.id, run.runId]);
  assert.equal(jobs[0].status, "failed");
  assert.equal(jobs[0].leaseToken, null);
  assert.equal(jobs[0].leaseExpiresAt, null);
  assert(jobs[0].finishedAt && finished.finishedAt);
  const [waits] = await pool.query("SELECT status FROM workflow_wait_subscription WHERE runId=?", [run.runId]);
  assert.equal(waits.length, 2);
  assert(waits.every(wait => wait.status === "cancelled"));
  const [events] = await pool.query("SELECT id FROM workflow_outbox_event WHERE aggregateId=? AND eventType='workflow.run.failed.notification'", [run.runId]);
  assert.equal(events.length, 1);
  console.log(JSON.stringify({ workflowId: flow.id, runId: run.runId, isolatedExpiredLeaseInjection: true, runFailed: true, jobFailed: true, waitsCancelled: true, notificationRecorded: true, actualProcessCrashTested: false }));
} finally { await pool.end(); }
